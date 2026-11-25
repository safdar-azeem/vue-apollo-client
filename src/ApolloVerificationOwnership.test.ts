// @vitest-environment jsdom
import { gql } from '@apollo/client/core/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCookieValueFromHeader } from './composables/useCookies'
import { createApolloOfflineRuntime } from './ApolloOfflineRuntime'
import { createBrowserSession } from './ApolloBrowserSession'
import { createApollo } from './createApollo'

const me = gql`query SessionOwner { me { id } }`
const response = (id: string | null) => new Response(JSON.stringify({
  data: { me: id ? { __typename: 'User', id } : null },
}), { headers: { 'content-type': 'application/json' } })

afterEach(() => vi.useRealTimers())

describe('authoritative session verification', () => {
  it.each(['old-user', null, 'network-error'])('reconciles the replaced credentials when the old result is %s', async oldUser => {
    let token = 'first'
    let release!: () => void
    let began!: () => void
    const started = new Promise<void>(done => { began = done })
    const barrier = new Promise<void>(done => { release = done })
    let requests = 0
    const runtime = createApollo({
      endpoint: '/graphql', auth: { meQuery: me },
      getToken: () => token, clearToken: () => { token = '' },
      fetch: async () => {
        if (++requests === 1) { began(); await barrier; if (oldUser === 'network-error') throw new Error('Offline'); return response(oldUser) }
        return response('replacement')
      },
    }, { server: false, registerGlobal: false })
    try {
      const verification = runtime.auth!.verifySession()
      await started
      token = 'second'
      release()
      expect(await verification).toBe(true)
      expect(token).toBe('second')
      expect(runtime.auth!.user.value?.id).toBe('replacement')
      expect(requests).toBe(2)
    } finally { runtime.stop() }
  })

  it('checks a refresh-only store and never trusts a hydrated user as verification', async () => {
    const fetch = vi.fn(async () => response('current'))
    const runtime = createApollo({
      endpoint: '/graphql', auth: { meQuery: me }, fetch,
      refresh: { getRefreshToken: () => 'refresh', createVariables: token => ({ token }), selectTokens: () => null },
    }, { server: false, registerGlobal: false, initialAuthState: { user: { id: 'old' } } })
    try {
      expect(await runtime.auth!.verifySession()).toBe(true)
      expect(runtime.auth!.user.value?.id).toBe('current')
      runtime.auth!.reset()
      expect(await runtime.auth!.verifySession()).toBe(true)
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally { runtime.stop() }
  })

  it.each([429, 500, 502, 503, 504])('preserves credentials after HTTP %i', async status => {
    const clearToken = vi.fn()
    const runtime = createApollo({ endpoint: '/graphql', auth: { meQuery: me },
      getToken: () => 'active', clearToken,
      fetch: async () => new Response('Unavailable', { status, headers: { 'retry-after': '1' } }),
    }, { server: false, registerGlobal: false })
    try {
      await expect(runtime.auth!.verifySession()).rejects.toBeDefined()
      expect(clearToken).not.toHaveBeenCalled()
      expect(runtime.auth!.loading.value).toBe(false)
    } finally { runtime.stop() }
  })

  it('bounds verification even when response headers arrive but the body stalls', async () => {
    const clearToken = vi.fn()
    const runtime = createApollo({ endpoint: '/graphql', getToken: () => 'active', clearToken,
      auth: { meQuery: me, verificationTimeoutMs: 50 },
      fetch: async (_url, init) => new Response(new ReadableStream({
        start(controller) { init?.signal?.addEventListener('abort', () => controller.error(new Error('Cancelled')), { once: true }) },
      }), { headers: { 'content-type': 'application/json' } }),
    }, { server: false, registerGlobal: false })
    try {
      await expect(runtime.auth!.verifySession()).rejects.toBeDefined()
      expect(runtime.auth!.loading.value).toBe(false)
      expect(clearToken).not.toHaveBeenCalled()
    } finally { runtime.stop() }
  })

  it('releases a cancelled waiter while another caller receives the one network result', async () => {
    let release!: () => void
    const barrier = new Promise<void>(done => { release = done })
    const fetch = vi.fn(async () => { await barrier; return response('current') })
    const runtime = createApollo({ endpoint: '/graphql', getToken: () => 'active', auth: { meQuery: me }, fetch },
      { server: false, registerGlobal: false })
    try {
      const controller = new AbortController()
      const cancelled = runtime.auth!.verifySession({ signal: controller.signal })
      const accepted = runtime.auth!.verifySession()
      controller.abort()
      await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
      release()
      await expect(accepted).resolves.toBe(true)
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally { release(); runtime.stop() }
  })

  it.each(['all', 'ignore'] as const)('discards late partial data under errorPolicy %s', async errorPolicy => {
    let owner = 'login-one'
    let respond!: (result: Response) => void
    let dispatch!: () => void
    const started = new Promise<void>(resolve => { dispatch = resolve })
    const runtime = createApollo({ endpoint: '/graphql', getToken: () => 'test', getSessionId: () => owner,
      fetch: () => new Promise<Response>(resolve => { respond = resolve; dispatch() }),
    }, { server: false, registerGlobal: false })
    try {
      const result = runtime.clients.default!.query({ query: me, errorPolicy, fetchPolicy: 'network-only' })
      await started
      owner = 'login-two'
      respond(Response.json({ data: { me: { __typename: 'User', id: 'old' } }, errors: [{ message: 'Field unavailable' }] }))
      await expect(result).rejects.toThrow(/session changed/i)
      expect(runtime.clients.default!.cache.extract()).not.toHaveProperty('User:old')
    } finally { runtime.stop() }
  })

  it('bounds a verification waiting for unfinished credential persistence', async () => {
    let finish!: () => void
    const barrier = new Promise<void>(resolve => { finish = resolve })
    const runtime = createApollo({ endpoint: '/graphql', getToken: () => 'token', setToken: () => barrier,
      auth: { meQuery: me, verificationTimeoutMs: 40 }, fetch: async () => response('current'),
    }, { server: false, registerGlobal: false })
    const transition = runtime.auth!.setSession({ token: 'token' })
    const expired = expect(transition).rejects.toMatchObject({ name: 'TimeoutError' })
    try {
      await expect(runtime.auth!.verifySession()).rejects.toMatchObject({ name: 'TimeoutError' })
      await expired
      finish()
      await vi.waitFor(async () => { await runtime.auth!.setSession({ token: 'recovered' }) })
      await expect(runtime.auth!.verifySession()).resolves.toBe(true)
    } finally { finish(); runtime.stop() }
  })

  it('holds offline work through reconnect until its original login is restored', async () => {
    let owner: string | null = 'alice-login'
    const mutate = vi.fn(async () => ({ data: { save: true } }))
    const options = { endpoint: '/graphql', tokenKey: 'fixture', browserSessionEndpoint: '/broker', allowOffline: true, getSessionId: () => owner }
    const make = () => createApolloOfflineRuntime(options, { default: { mutate } } as any)
    localStorage.clear()
    Object.defineProperty(navigator, 'locks', { configurable: true, writable: true, value: { request: (_: string, callback: () => unknown) => callback() } })
    const initial = make()
    await initial.enqueue('default', gql`mutation Save { save }`, {})
    initial.stop()
    owner = null
    const resumed = make()
    try {
      await resumed.sync()
      expect(localStorage.length).toBe(1)
      expect(mutate).not.toHaveBeenCalled()
      owner = 'alice-login'
      await resumed.sync()
      expect(mutate).toHaveBeenCalledOnce()
      expect(localStorage.length).toBe(0)
    } finally { resumed.stop(); localStorage.clear() }
  })

  it('fences a queued logout once its document has been replaced', async () => {
    let current = 'first'
    let submitted: string | undefined
    vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
      if (url.pathname.endsWith('/logout')) {
        submitted = JSON.parse(String(init.body)).sessionId
        return Response.json({}, { status: 409 })
      }
      return Response.json({ token: 'access', sessionId: current })
    })
    try {
      const broker = createBrowserSession({ tokenKey: 'fixture', endpoint: '/graphql' }, 'https://auth.example.test/session')
      await broker.read(new AbortController().signal)
      const logout = broker.captureLogout()
      broker.forget()
      current = 'replacement'
      await expect(broker.read(new AbortController().signal)).rejects.toThrow(/session changed/i)
      await expect(logout()).rejects.toThrow()
      expect(submitted).toBeUndefined()
      broker.forget()
      await expect(broker.captureLogout()()).rejects.toThrow(/session changed/i)
      expect(submitted).toBeUndefined()
    } finally { vi.unstubAllGlobals() }
  })

  it('rejects a post-establishment read that identifies another login', async () => {
    const navigatorWithLock = Object.create(navigator)
    navigatorWithLock.locks = { request: async (_name: string, _options: unknown, work: () => Promise<unknown>) => work() }
    vi.stubGlobal('navigator', navigatorWithLock)
    vi.stubGlobal('fetch', async (url: URL) => Response.json(url.pathname.endsWith('/establish')
      ? { sessionId: 'intended' } : { token: 'other-access', sessionId: 'other' }))
    try {
      const broker = createBrowserSession({ endpoint: '/graphql', tokenKey: 'test' }, window.location.origin + '/session')
      await expect(broker.options.setToken({ token: 'original-access', refreshToken: 'original-refresh' })).rejects.toThrow(/session changed/i)
      expect(broker.options.getSessionId()).toBeNull()
    } finally { vi.unstubAllGlobals() }
  })

  it('keeps the verified profile visible during same-login access renewal', async () => {
    let token = 'first'
    let wait = false
    let respond!: () => void
    let dispatched!: () => void
    const started = new Promise<void>(resolve => { dispatched = resolve })
    const runtime = createApollo({
      endpoint: '/graphql', getToken: () => token, getSessionId: () => 'stable',
      auth: { meQuery: me },
      fetch: async () => {
        if (wait) {
          dispatched()
          await new Promise<void>(done => { respond = done })
        }
        return response('current')
      },
    }, { server: false, registerGlobal: false })
    try {
      await runtime.auth!.verifySession()
      token = 'renewed'
      wait = true
      const verification = runtime.auth!.verifySession()
      await started
      expect(runtime.auth!.user.value.id).toBe('current')
      respond()
      await expect(verification).resolves.toBe(true)
    } finally { runtime.stop() }
  })

  it('rejects conflicting host and domain cookie values regardless of order', () => {
    expect(getCookieValueFromHeader('k=a; k=b', 'k')).toBeUndefined()
    expect(getCookieValueFromHeader('k=b; k=a', 'k')).toBeUndefined()
    expect(getCookieValueFromHeader('k=a; k=a', 'k')).toBe('a')
  })
})
