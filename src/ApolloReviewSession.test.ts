// @vitest-environment jsdom
import { gql } from '@apollo/client/core/index.js'
import { afterEach, expect, it, vi } from 'vitest'
import { createBrowserSession } from './ApolloBrowserSession'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createApollo } from './createApollo'

const me = gql`query ReviewMe { me { id } }`
const privateQuery = gql`query PrivateRecord { secret }`
const reply = (data: unknown) => Response.json(data)
const clientOnly = { server: false, registerGlobal: false }
afterEach(() => vi.unstubAllGlobals())

it.each(['external removal', 'cookie revocation', 'managed null'])('evicts warm named caches on %s', async mode => {
  let access = 'original'
  let valid = true
  const terminate = vi.fn()
  const broker = vi.fn(async () => reply({ token: access, sessionId: 'login' }))
  vi.stubGlobal('fetch', broker)
  const runtime = createApollo({
    endPoints: { default: '/graphql', other: '/other' },
    ...(mode === 'managed null' ? { browserSessionEndpoint: 'https://auth.example.test/session' }
      : { getToken: () => access, clearToken: () => { access = '' } }),
    auth: { meQuery: me, ...(mode === 'cookie revocation' ? { sessionMode: 'cookie', clearSession: terminate } : {}) },
    fetch: async () => reply({ data: { me: valid ? { id: 'old' } : null } }),
  }, clientOnly)
  try {
    expect(await runtime.auth!.verifySession()).toBe(true)
    for (const client of Object.values(runtime.clients)) client.writeQuery({ query: privateQuery, data: { secret: 'private' } })
    valid = false
    if (mode === 'external removal') access = ''
    expect(await runtime.auth!.verifySession()).toBe(false)
    for (const client of Object.values(runtime.clients)) expect(client.readQuery({ query: privateQuery })).toBeNull()
    expect(runtime.auth!.user.value).toBeNull()
    expect(runtime.options.getToken?.()).toBeFalsy()
    expect(terminate).not.toHaveBeenCalled()
    expect(broker.mock.calls.flat().map(String).some(url => url.endsWith('/logout'))).toBe(false)
  } finally { runtime.stop() }
})

it('reconciles an expired shared hint before an ordinary authenticated operation', async () => {
  document.cookie = 'change=original; path=/'
  let reads = 0
  vi.stubGlobal('fetch', async () => reply({ token: 'access-' + ++reads, sessionId: 'login' }))
  const headers: (string | null)[] = []
  const runtime = createApollo({ endpoint: '/graphql', browserSessionEndpoint: 'https://auth.example.test/session',
    browserSessionChangeKey: 'change', auth: { meQuery: me },
    fetch: async (_, init) => {
      headers.push(new Headers(init?.headers).get('authorization'))
      return reply({ data: { me: { id: 'old' }, secret: 'value' } })
    },
  }, clientOnly)
  try {
    await runtime.auth!.verifySession()
    document.cookie = 'change=; path=/; max-age=0'
    await runtime.clients.default!.query({ query: privateQuery, fetchPolicy: 'network-only' })
    expect(reads).toBe(2)
    expect(headers.at(-1)).toContain('access-2')
  } finally { runtime.stop() }
})

it.each(['partial', 'pre-execution', 'idempotent'])('enforces mutation retry contract for %s', async mode => {
  let attempts = 0
  let token = 'original'
  const refreshToken = vi.fn(async () => (token = 'rotated'))
  const runtime = createApollo({ endpoint: '/graphql', sessionMode: 'cookie', getSessionId: () => 'same-login', getToken: () => token, refreshToken,
    fetch: async () => {
      if (++attempts > 1) return reply({ data: { write: true, other: true } })
      const partial = mode !== 'pre-execution'
      return reply({ ...(partial ? { data: { write: true, other: null } } : {}),
        errors: [{ message: 'Unauthorized', ...(partial ? { path: ['other'] } : {}),
          extensions: { code: 'UNAUTHENTICATED', ...(partial ? {} : { executionStarted: false }) } }] })
    },
  }, clientOnly)
  try {
    const mutation = mode === 'pre-execution' ? gql`mutation Single { write }` : gql`mutation Multi { write other }`
    const result = runtime.clients.default!.mutate({ mutation, context: { vueApolloIdempotent: mode === 'idempotent' } })
    if (mode === 'partial') await expect(result).rejects.toThrow(/Unauthorized/)
    else await expect(result).resolves.toHaveProperty('data.write', true)
    expect(attempts).toBe(mode === 'partial' ? 1 : 2)
    expect(refreshToken).toHaveBeenCalledOnce()
  } finally { runtime.stop() }
})

it.each(['cache', 'persistence', 'logout'])('bounds a stalled %s and serializes deliberate recovery', async stage => {
  let release!: () => void
  const gate = new Promise<void>(done => { release = done })
  let token = 'initial'
  const runtime = createApollo({ endpoint: '/graphql', getToken: () => token,
    setToken: async session => { if (stage === 'persistence' && session.token === 'old') await gate; token = String(session.token) },
    clearToken: async () => { if (stage === 'logout') await gate; token = '' },
    auth: { meQuery: me, verificationTimeoutMs: 25 },
  }, clientOnly)
  if (stage === 'cache') vi.spyOn(runtime, 'clearStore').mockImplementationOnce(() => gate)
  try {
    const auth = runtime.auth!
    const stale = stage === 'logout' ? auth.clearSession() : auth.setSession({ token: 'old' })
    await expect(stale).rejects.toMatchObject({ name: 'TimeoutError' })
    await expect(auth.setSession({ token: 'unwanted' })).rejects.toThrow(/pending/)
    release()
    await vi.waitFor(async () => { await auth.setSession({ token: 'new', user: { id: 'new' } }) })
    expect(token).toBe('new')
    expect(auth.user.value.id).toBe('new')
  } finally { release(); runtime.stop() }
})

it('does not evict replacement data when an old null Me finishes late', async () => {
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(done => { release = done })
  const pending = new Promise<void>(done => { started = done })
  let token = 'old'
  const runtime = createApollo({ endpoint: '/graphql', getToken: () => token,
    setToken: session => { token = String(session.token) }, clearToken: () => { token = '' }, auth: { meQuery: me },
    fetch: async () => { started(); await gate; return reply({ data: { me: null } }) },
  }, clientOnly)
  try {
    const check = runtime.auth!.verifySession()
    await pending
    await runtime.auth!.setSession({ token: 'new', user: { id: 'new' } })
    runtime.clients.default!.writeQuery({ query: privateQuery, data: { secret: 'replacement' } })
    release()
    await check
    expect(token).toBe('new')
    expect(runtime.clients.default!.readQuery({ query: privateQuery })).toEqual({ secret: 'replacement' })
    expect(runtime.auth!.user.value.id).toBe('new')
  } finally { release(); runtime.stop() }
})

it.each(['replacement-user', 'same-user'])('blocks consecutive old-editor writes across a new login for %s', async user => {
  document.cookie = 'replacement_hint=A; path=/'
  let login = 'first'
  vi.stubGlobal('fetch', async () => reply({ token: user + login, sessionId: login }))
  let writes = 0
  const runtime = createApollo({ endpoint: '/graphql', browserSessionChangeKey: 'replacement_hint',
    browserSessionEndpoint: 'https://auth.example.test/broker', auth: { meQuery: me },
    fetch: async (_, init) => {
      if (String(init?.body).includes('mutation')) writes++
      return reply({ data: { me: { id: 'same-user' } } })
    } }, clientOnly)
  try {
    await runtime.auth!.verifySession()
    login = 'second'
    document.cookie = 'replacement_hint=B; path=/'
    const write = () => runtime.clients.default!.mutate({ mutation: gql`mutation Save { save }` })
    const results = await Promise.allSettled([write(), write()])
    expect(results.every(r => r.status === 'rejected')).toBe(true)
    await expect(write()).rejects.toThrow(/Session changed/)
    expect(writes).toBe(0)
    expect(runtime.auth!.user.value).toBeNull()
    expect(runtime.options.getToken?.()).toBeNull()
  } finally { runtime.stop() }
})

it('obtains a fresh access token before sending the first protected write after expiry', async () => {
  const token = (exp: number) => 'x.' + btoa(JSON.stringify({ exp })) + '.x'
  const fresh = token(Math.floor(Date.now() / 1000) + 3600)
  let reads = 0
  vi.stubGlobal('fetch', async () => reply({ token: ++reads === 1 ? token(1) : fresh, sessionId: 'same' }))
  const headers: string[] = []
  const runtime = createApollo({ endpoint: '/graphql', browserSessionEndpoint: 'https://auth.example.test/broker', auth: { meQuery: me },
    fetch: async (_, init) => { headers.push(new Headers(init?.headers).get('authorization')!); return reply({data:{save:true}}) },
  }, clientOnly)
  try {
    await runtime.prepareBrowserSession!(new AbortController().signal)
    await runtime.clients.default!.mutate({mutation:gql`mutation Save { save }`})
    expect(reads).toBe(2)
    expect(headers).toHaveLength(1)
    expect(headers[0]).toContain(fresh)
  } finally { runtime.stop() }
})

function gate() {
  let open!: () => void
  const pending = new Promise<void>(resolve => { open = resolve })
  return { open, pending }
}

it.each(['before invocation', 'while waiting for the writer'])('rejects establishment after replacement %s', async ordering => {
  const acquired = gate()
  const waiting = gate()
  const locks = { request: async (_name: string, _options: unknown, work: () => Promise<void>) => {
    waiting.open()
    await acquired.pending
    return work()
  } }
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { locks }))
  let login = 'initial'
  const establish = vi.fn(() => { login = 'obsolete-writer-login' })
  vi.stubGlobal('fetch', async (url: URL) => {
    if (url.pathname.endsWith('/establish')) establish()
    return reply({ sessionId: login, token: 'access' })
  })
  const broker = createBrowserSession({ endpoint: '/graphql' }, location.origin + '/session')
  const signal = new AbortController().signal
  await broker.read(signal)
  const signIn = () => broker.options.setToken({ token: 'fixture', refreshToken: 'fixture-refresh' })
  const queued = ordering === 'while waiting for the writer' ? signIn() : undefined
  if (queued) await waiting.pending
  login = 'replacement'
  await expect(broker.read(signal)).rejects.toThrow(/Session changed/)
  acquired.open()
  await expect(queued ?? signIn()).rejects.toThrow(/Session changed/)
  expect(establish).not.toHaveBeenCalled()
  expect(login).toBe('replacement')
  expect(broker.options.getToken()).toBeNull()
})

it.each(['focus first', 'save first'])('shares renewal with verification and simultaneous saves (%s)', async ordering => {
  const started = gate()
  const renewal = gate()
  const now = Date.now()
  const token = (seconds: number) => 'x.' + btoa(JSON.stringify({ exp: Math.floor(now / 1000) + seconds })) + '.x'
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  const broker = vi.fn(async () => {
    if (broker.mock.calls.length === 1) return reply({ token: token(60), sessionId: 'same' })
    started.open()
    await renewal.pending
    return reply({ token: token(3600), sessionId: 'same' })
  })
  vi.stubGlobal('fetch', broker)
  const writes: string[] = []
  const runtime = createApollo({ endpoint: '/graphql', browserSessionEndpoint: '/broker', auth: { meQuery: me },
    fetch: async (_, init) => {
      const body = JSON.parse(String(init?.body))
      if (body.operationName === 'EditorSave') {
        writes.push(body.variables.value)
        expect(new Headers(init?.headers).get('authorization')).toContain(token(3600))
      }
      return reply({ data: { save: true, me: { id: 'user' } } })
    } }, clientOnly)
  try {
    expect(await runtime.auth!.verifySession()).toBe(true)
    clock.mockReturnValue(now + 55000)
    const focus = () => { window.dispatchEvent(new Event('focus')); return runtime.auth!.verifySession() }
    const save = (value: string) => runtime.clients.default!.mutate({
      mutation: gql`mutation EditorSave($value: String!) { save(value: $value) }`, variables: { value },
    })
    const first = ordering === 'focus first' ? focus() : save('first')
    await started.pending
    const other = ordering === 'focus first' ? save('first') : focus()
    const results = Promise.all([first, other, save('second'), runtime.options.refreshToken!()])
    await nextTurn()
    renewal.open()
    const values = await results
    expect(values).toContain(true)
    expect(writes.sort()).toEqual(['first', 'second'])
    expect(broker).toHaveBeenCalledTimes(2)
  } finally { renewal.open(); clock.mockRestore(); runtime.stop() }
})

it('cancels an access read only after its last caller leaves', async () => {
  const network = gate()
  let transportSignal!: AbortSignal
  const fetchAccess = vi.fn(async (_url: URL, init: RequestInit) => {
    transportSignal = init.signal!
    await network.pending
    return reply({ sessionId: 'same', token: 'valid' })
  })
  vi.stubGlobal('fetch', fetchAccess)
  const broker = createBrowserSession({ endpoint: '/graphql' }, 'https://auth.example.test/broker')
  const first = new AbortController()
  const second = new AbortController()
  const cancelled = broker.read(first.signal)
  const remaining = broker.read(second.signal)
  first.abort()
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
  expect(transportSignal.aborted).toBe(false)
  second.abort()
  await expect(remaining).rejects.toMatchObject({ name: 'AbortError' })
  expect(transportSignal.aborted).toBe(true)
  network.open()
  await nextTurn()
  expect(broker.options.getToken()).toBeNull()
  expect(fetchAccess).toHaveBeenCalledOnce()
  expect(await broker.read(new AbortController().signal)).toBe(true)
})
