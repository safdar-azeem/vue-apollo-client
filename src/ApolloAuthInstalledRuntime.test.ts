// @vitest-environment jsdom
import { createApp, h } from 'vue'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useQuery as useNativeQuery } from '@vue/apollo-composable'
import { createApollo } from './createApollo'
import { useAuth } from './composables/useAuth'
import { SSR_HYDRATION_HOST } from './ssrHydration'
import gql from 'graphql-tag'

const ME_QUERY = gql`
  query InstalledAuthMe {
    me {
      id
      permissions
    }
  }
`

const authConfig = (useMeQuery: any, authOverrides: Record<string, unknown> = {}) => ({
  endpoint: 'https://graphql.test/query',
  tokenKey: 'auth_token',
  formatToken: (token: string) => `Bearer ${token}`,
  auth: {
    useMeQuery,
    meSelector: (data: any) => data?.me,
    permissions: (user: any) => user?.permissions || [],
    ...authOverrides,
  },
})

describe('installed auth runtime', () => {
  beforeEach(() => {
    document.cookie = 'auth_token=; Max-Age=0; path=/'
    document.cookie = 'auth_token_refresh=; Max-Age=0; path=/'
  })

  it('resolves useAuth() from the installed application and owns session APIs', async () => {
    const runtime = createApollo(
      authConfig(() => ({
        result: undefined,
        loading: { value: false },
        onResult: () => ({ off: () => undefined }),
        onError: () => ({ off: () => undefined }),
      })) as any,
      { server: false, registerGlobal: false }
    )
    const app = createApp({ render: () => h('main') })
    app.use(runtime)
    const auth = app.runWithContext(() => useAuth())

    await auth.setSession({
      token: 'header.payload.signature',
      refreshToken: 'refresh-value',
      user: { id: 'user-1', permissions: ['reports:view'] },
    })

    expect(auth.isAuthenticated.value).toBe(true)
    expect(auth.can('reports:view')).toBe(true)
    expect(auth.can(['admin:view', 'reports:view'])).toBe(true)
    expect(auth.can('admin:view')).toBe(false)
    expect(auth.getTokenClaims()).toBeNull()

    await auth.clearSession()
    expect(auth.user.value).toBeNull()
    expect(auth.isAuthenticated.value).toBe(false)
    runtime.stop()
  })

  it('verifies SSR credentials from the current request cookie without browser APIs', async () => {
    const seenAuthorization: string[] = []
    const requestToken = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJjb29raWUtdXNlciJ9.signature'
    const useMeQuery = () => useNativeQuery(ME_QUERY, undefined, { fetchPolicy: 'network-only' })
    const runtime = createApollo(authConfig(useMeQuery) as any, {
      server: true,
      registerGlobal: false,
      headers: { cookie: `auth_token=${requestToken}` },
      fetch: async (_input, init) => {
        seenAuthorization.push(new Headers(init?.headers).get('authorization') || '')
        return new Response(JSON.stringify({
          data: { me: { id: 'request-user', permissions: ['reports:view'] } },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    const app = createSSRApp({
      setup() {
        const auth = useAuth()
        return () => h('main', auth.user.value?.id || 'pending')
      },
    })
    app.use(runtime)
    const auth = app.runWithContext(() => useAuth())
    expect(runtime.requestHeaders?.cookie).toBe(`auth_token=${requestToken}`)
    expect(auth.getTokenClaims()).toEqual({ sub: 'cookie-user' })
    expect(await auth.verifySession()).toBe(true)
    expect(auth.user.value?.id).toBe('request-user')
    expect(seenAuthorization[0]).toBe(`Bearer ${requestToken}`)
    expect(await renderToString(app)).toContain('request-user')
    runtime.stop()
  })

  it('exposes the current SSR authorization header to installed auth', async () => {
    const token = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJoZWFkZXItdXNlciJ9.signature'
    const runtime = createApollo(
      authConfig(() => ({
        result: undefined,
        loading: { value: false },
        onResult: () => ({ off: () => undefined }),
        onError: () => ({ off: () => undefined }),
      })) as any,
      {
        server: true,
        registerGlobal: false,
        headers: { authorization: `Bearer ${token}` },
      }
    )
    const app = createSSRApp({ render: () => h('main') })
    app.use(runtime)
    const auth = app.runWithContext(() => useAuth())

    expect(runtime.requestHeaders?.authorization).toBe(`Bearer ${token}`)
    expect(auth.getTokenClaims()).toEqual({ sub: 'header-user' })
    runtime.stop()
  })

  it('keeps concurrent installed SSR auth runtimes and caches isolated', async () => {
    const createRequest = (id: string, token: string) => {
      const useMeQuery = () => useNativeQuery(
        ME_QUERY,
        undefined,
        { fetchPolicy: 'network-only' },
      )
      const runtime = createApollo(authConfig(useMeQuery) as any, {
        server: true,
        registerGlobal: false,
        headers: { cookie: `auth_token=${token}` },
        fetch: async (_input, init) => {
          await Promise.resolve()
          const authorization = new Headers(init?.headers).get('authorization')
          expect(authorization).toBe(`Bearer ${token}`)
          return new Response(JSON.stringify({
            data: { me: { id, permissions: [] } },
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        },
      })
      const contributions = new Map<string, () => unknown>()
      const app = createSSRApp({
        setup() {
          const auth = useAuth()
          return () => h('main', auth.user.value?.id || 'pending')
        },
      })
      app.provide(SSR_HYDRATION_HOST, {
        server: true,
        read: () => undefined,
        contribute: (key: string, dehydrate: () => unknown) => {
          contributions.set(key, dehydrate)
        },
        onDispose: () => undefined,
      })
      app.use(runtime)
      return {
        auth: app.runWithContext(() => useAuth()),
        runtime,
        hydration: () => contributions.get('apollo:auth')?.(),
      }
    }

    const left = createRequest('user-left', 'left-request-token')
    const right = createRequest('user-right', 'right-request-token')
    await Promise.all([left.auth.verifySession(), right.auth.verifySession()])

    expect(left.auth.user.value?.id).toBe('user-left')
    expect(right.auth.user.value?.id).toBe('user-right')
    expect(JSON.stringify(left.runtime.extract())).toContain('user-left')
    expect(JSON.stringify(left.runtime.extract())).not.toContain('user-right')
    expect(JSON.stringify(right.runtime.extract())).toContain('user-right')
    expect(JSON.stringify(right.runtime.extract())).not.toContain('user-left')
    expect(JSON.stringify(left.hydration())).toContain('user-left')
    expect(JSON.stringify(left.hydration())).not.toContain('user-right')
    expect(JSON.stringify(right.hydration())).toContain('user-right')
    expect(JSON.stringify(right.hydration())).not.toContain('user-left')
    left.runtime.stop()
    right.runtime.stop()
  })

  it('restores authenticated SSR auth state before browser verification', async () => {
    const serverQuery = () => useNativeQuery(
      ME_QUERY,
      undefined,
      { fetchPolicy: 'network-only' },
    )
    const server = createApollo(authConfig(serverQuery) as any, {
      server: true,
      registerGlobal: false,
      headers: { cookie: 'auth_token=hydration-token' },
      fetch: async () => new Response(JSON.stringify({
        data: { me: { id: 'hydrated-user', permissions: ['reports:view'] } },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    })
    const serverContributions = new Map<string, () => unknown>()
    const serverApp = createSSRApp({ render: () => h('main') })
    serverApp.provide(SSR_HYDRATION_HOST, {
      server: true,
      read: () => undefined,
      contribute: (key: string, dehydrate: () => unknown) => {
        serverContributions.set(key, dehydrate)
      },
      onDispose: () => undefined,
    })
    serverApp.use(server)
    const serverAuth = serverApp.runWithContext(() => useAuth())
    await expect(serverAuth.verifySession()).resolves.toBe(true)
    const authHydration = serverContributions.get('apollo:auth')?.() as any
    expect(authHydration.user).toMatchObject({
      id: 'hydrated-user',
      permissions: ['reports:view'],
    })
    expect(JSON.stringify(authHydration)).not.toContain('hydration-token')

    let browserFetches = 0
    const browser = createApollo(authConfig(() => useNativeQuery(
      ME_QUERY,
      undefined,
      { fetchPolicy: 'network-only' },
    )) as any, {
      server: false,
      registerGlobal: false,
      initialState: serverContributions.get('apollo')?.() as any,
      initialAuthState: authHydration,
      fetch: async () => {
        browserFetches += 1
        return new Response(JSON.stringify({ data: { me: null } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    const browserApp = createApp({
      setup() {
        const auth = useAuth()
        return () => h('main', auth.user.value?.id || 'logged-out')
      },
    })
    browserApp.use(browser)
    const browserAuth = browserApp.runWithContext(() => useAuth())

    expect(browserAuth.user.value?.id).toBe('hydrated-user')
    await expect(browserAuth.verifySession()).resolves.toBe(true)
    expect(browserAuth.can('reports:view')).toBe(true)
    expect(browserFetches).toBe(0)
    server.stop()
    browser.stop()
  })

  it('requires and awaits authoritative cookie-session logout', async () => {
    expect(() => createApollo(
      authConfig(() => ({
        result: undefined,
        loading: { value: false },
        onResult: () => ({ off: () => undefined }),
        onError: () => ({ off: () => undefined }),
      }), { sessionMode: 'cookie' }) as any,
      { server: false, registerGlobal: false },
    )).toThrow(/auth\.clearSession/)

    const clearSession = vi.fn(async () => undefined)
    const runtime = createApollo(
      authConfig(() => ({
        result: undefined,
        loading: { value: false },
        onResult: () => ({ off: () => undefined }),
        onError: () => ({ off: () => undefined }),
      }), { sessionMode: 'cookie', clearSession }) as any,
      { server: false, registerGlobal: false },
    )
    const app = createApp({ render: () => h('main') })
    app.use(runtime)
    const auth = app.runWithContext(() => useAuth())
    await auth.setSession({ user: { id: 'cookie-user' } })
    await auth.clearSession()
    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(auth.user.value).toBeNull()
    runtime.stop()
  })

  it('does not report failed authoritative cookie logout as success', async () => {
    const clearSession = vi.fn(async () => {
      throw new Error('logout endpoint unavailable')
    })
    const runtime = createApollo(
      authConfig(() => ({
        result: undefined,
        loading: { value: false },
        onResult: () => ({ off: () => undefined }),
        onError: () => ({ off: () => undefined }),
      }), { sessionMode: 'cookie', clearSession }) as any,
      { server: false, registerGlobal: false },
    )
    const app = createApp({ render: () => h('main') })
    app.use(runtime)
    const auth = app.runWithContext(() => useAuth())
    await auth.setSession({ user: { id: 'cookie-user' } })

    await expect(auth.clearSession()).rejects.toThrow('logout endpoint unavailable')
    expect(auth.user.value).toBeNull()
    runtime.stop()
  })

  it('deduplicates concurrent verification for one installed runtime', async () => {
    let resolveQuery: ((value: any) => void) | undefined
    const useMeQuery = vi.fn(() => ({
      result: { value: undefined },
      loading: { value: true },
      onResult: (callback: any) => {
        resolveQuery = (value) => callback({ data: value, loading: false })
        return { off: () => undefined }
      },
      onError: () => ({ off: () => undefined }),
      stop: () => undefined,
    }))
    const runtime = createApollo(authConfig(useMeQuery, {
      // Installed auth reads credentials from its auth configuration (or the
      // normal cookie store), not from the createApollo runtime options.
      getToken: () => 'token',
    }) as any, {
      server: false,
      registerGlobal: false,
    })
    const app = createApp({ render: () => h('main') })
    app.use(runtime)
    const auth = app.runWithContext(() => useAuth())
    const first = auth.verifySession()
    const second = auth.verifySession()
    resolveQuery?.({ me: { id: 'deduped', permissions: [] } })
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(useMeQuery).toHaveBeenCalledTimes(1)
    runtime.stop()
  })
})
