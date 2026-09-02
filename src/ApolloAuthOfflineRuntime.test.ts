// @vitest-environment jsdom
import { gql } from '@apollo/client/core/index.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApolloOfflineRuntime } from './ApolloOfflineRuntime'
import { createAuthRuntime } from './composables/useAuth'

const ME_QUERY = gql`query RuntimeMe { me { id } }`
const SAVE_MUTATION = gql`mutation RuntimeSave($value: String!) { save(value: $value) }`

const createTestStorage = (): Storage => {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  }
}

describe('application-scoped auth and offline state', () => {
  beforeEach(() => {
    // Keep browser queue tests independent from Node's optional global
    // localStorage implementation and jsdom origin configuration.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createTestStorage(),
      writable: true,
    })
    localStorage.clear()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  })

  it('isolates auth state and navigation between Vue application runtimes', async () => {
    const leftNavigate = vi.fn(async () => undefined)
    const rightNavigate = vi.fn(async () => undefined)
    const runtime = (id: string) => ({
      clients: { default: { clearStore: vi.fn(async () => undefined) } },
      clearStore: vi.fn(async () => undefined),
      executeQuery: vi.fn(async () => ({ data: { me: { id } } })),
    }) as any
    const leftRuntime = runtime('left')
    const rightRuntime = runtime('right')
    const left = createAuthRuntime(leftRuntime, {
      meQuery: ME_QUERY,
      getToken: () => 'left-token',
      clearToken: vi.fn(),
      navigate: leftNavigate,
    })
    const right = createAuthRuntime(rightRuntime, {
      meQuery: ME_QUERY,
      getToken: () => 'right-token',
      clearToken: vi.fn(),
      navigate: rightNavigate,
    })

    await Promise.all([left.verify(), right.verify()])
    expect(left.user.value.id).toBe('left')
    expect(right.user.value.id).toBe('right')

    await left.logout()
    expect(left.user.value).toBeNull()
    expect(right.user.value.id).toBe('right')
    expect(leftNavigate).toHaveBeenCalledWith('/login')
    expect(rightNavigate).not.toHaveBeenCalled()
  })

  it('tears down an expired session without navigating in verifySession', async () => {
    const navigate = vi.fn(async () => undefined)
    const clearToken = vi.fn()
    const runtime = {
      clearStore: vi.fn(async () => undefined),
      executeQuery: vi.fn(async () => {
        throw {
          graphQLErrors: [
            { extensions: { code: 'UNAUTHENTICATED' }, message: 'Expired' },
          ],
        }
      }),
    } as any
    const auth = createAuthRuntime(runtime, {
      meQuery: ME_QUERY,
      getToken: () => 'expired-token',
      clearToken,
      navigate,
    })

    await expect(auth.verifySession()).resolves.toBe(false)
    expect(clearToken).toHaveBeenCalledTimes(1)
    expect(runtime.clearStore).toHaveBeenCalledTimes(1)
    expect(auth.user.value).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('keeps verify() legacy session-expired navigation', async () => {
    const navigate = vi.fn(async () => undefined)
    const runtime = {
      clearStore: vi.fn(async () => undefined),
      executeQuery: vi.fn(async () => {
        throw {
          graphQLErrors: [
            { extensions: { code: 'UNAUTHENTICATED' }, message: 'Expired' },
          ],
        }
      }),
    } as any
    const auth = createAuthRuntime(runtime, {
      meQuery: ME_QUERY,
      getToken: () => 'expired-token',
      clearToken: vi.fn(),
      navigate,
      loginRoute: '/auth/login',
    })

    await expect(auth.verify()).resolves.toBe(false)
    expect(navigate).toHaveBeenCalledWith('/auth/login?reason=session_expired')
  })

  it('returns false without querying when no token is present', async () => {
    const executeQuery = vi.fn()
    const auth = createAuthRuntime({
      clearStore: vi.fn(async () => undefined),
      executeQuery,
    } as any, {
      meQuery: ME_QUERY,
      getToken: () => null,
    })

    await expect(auth.verifySession()).resolves.toBe(false)
    expect(executeQuery).not.toHaveBeenCalled()
  })

  it('treats an HTTP 401 as an expired session and tears it down', async () => {
    const clearToken = vi.fn()
    const runtime = {
      clearStore: vi.fn(async () => undefined),
      executeQuery: vi.fn(async () => {
        throw { networkError: { statusCode: 401 } }
      }),
    } as any
    const auth = createAuthRuntime(runtime, {
      meQuery: ME_QUERY,
      getToken: () => 'expired-token',
      clearToken,
    })

    await expect(auth.verifySession()).resolves.toBe(false)
    expect(clearToken).toHaveBeenCalledTimes(1)
    expect(runtime.clearStore).toHaveBeenCalledTimes(1)
    expect(auth.user.value).toBeNull()
  })

  it('propagates ordinary verification failures without tearing down the session', async () => {
    const clearStore = vi.fn(async () => undefined)
    const failure = new Error('temporary network failure')
    const auth = createAuthRuntime({
      clearStore,
      executeQuery: vi.fn(async () => { throw failure }),
    } as any, {
      meQuery: ME_QUERY,
      getToken: () => 'active-token',
      initialUser: { id: 'still-unknown' },
    })

    await expect(auth.verifySession()).rejects.toBe(failure)
    expect(auth.user.value).toEqual({ id: 'still-unknown' })
    expect(clearStore).not.toHaveBeenCalled()
  })

  it('propagates FORBIDDEN without treating authorization as session expiry', async () => {
    const clearStore = vi.fn(async () => undefined)
    const auth = createAuthRuntime({
      clearStore,
      executeQuery: vi.fn(async () => {
        throw { graphQLErrors: [{ extensions: { code: 'FORBIDDEN' } }] }
      }),
    } as any, {
      meQuery: ME_QUERY,
      getToken: () => 'active-token',
      initialUser: { id: 'authorized-user' },
    })

    await expect(auth.verifySession()).rejects.toMatchObject({
      graphQLErrors: [{ extensions: { code: 'FORBIDDEN' } }],
    })
    expect(auth.user.value).toEqual({ id: 'authorized-user' })
    expect(clearStore).not.toHaveBeenCalled()
  })

  it('keeps newer verification bookkeeping after a session replacement', async () => {
    let resolveFirst: ((value: any) => void) | undefined
    let resolveSecond: ((value: any) => void) | undefined
    let queryNumber = 0
    const executeQuery = vi.fn(() => new Promise((resolve) => {
      if (queryNumber++ === 0) resolveFirst = resolve
      else resolveSecond = resolve
    }))
    const auth = createAuthRuntime({
      clearStore: vi.fn(async () => undefined),
      executeQuery,
    } as any, {
      meQuery: ME_QUERY,
      getToken: () => 'active-token',
      setToken: vi.fn(async () => undefined),
    })

    const first = auth.verifySession()
    expect(auth.loading.value).toBe(true)

    await auth.setSession({
      token: 'replacement-token',
      user: { id: 'replacement-user' },
    })
    const second = auth.verifySession()
    expect(executeQuery).toHaveBeenCalledTimes(2)
    expect(auth.loading.value).toBe(true)

    resolveFirst?.({ data: { me: { id: 'stale-user' } } })
    await expect(first).resolves.toBe(true)
    expect(auth.user.value).toEqual({ id: 'replacement-user' })

    // The stale finalizer must not clear the active verification. A third
    // caller therefore deduplicates against the still-pending second query.
    const third = auth.verifySession()
    expect(executeQuery).toHaveBeenCalledTimes(2)
    expect(auth.loading.value).toBe(true)

    resolveSecond?.({ data: { me: { id: 'verified-replacement' } } })
    await expect(Promise.all([second, third])).resolves.toEqual([true, true])
    expect(auth.user.value).toEqual({ id: 'verified-replacement' })
    expect(auth.loading.value).toBe(false)
  })

  it('does not expire a replacement session when stale verification rejects', async () => {
    let rejectFirst: ((reason?: any) => void) | undefined
    let resolveSecond: ((value: any) => void) | undefined
    let queryNumber = 0
    const executeQuery = vi.fn(() => new Promise((resolve, reject) => {
      if (queryNumber++ === 0) rejectFirst = reject
      else resolveSecond = resolve
    }))
    const navigate = vi.fn(async () => undefined)
    const auth = createAuthRuntime({
      clearStore: vi.fn(async () => undefined),
      executeQuery,
    } as any, {
      meQuery: ME_QUERY,
      getToken: () => 'active-token',
      setToken: vi.fn(async () => undefined),
      navigate,
    })

    const first = auth.verify()
    await auth.setSession({
      token: 'replacement-token',
      user: { id: 'replacement-user' },
    })
    const second = auth.verifySession()

    rejectFirst?.(new Error('stale request failed'))
    await expect(first).resolves.toBe(true)
    expect(auth.user.value).toEqual({ id: 'replacement-user' })
    expect(navigate).not.toHaveBeenCalled()

    resolveSecond?.({ data: { me: { id: 'verified-replacement' } } })
    await expect(second).resolves.toBe(true)
  })

  it('does not reuse invalidated verification while logout is pending', async () => {
    let token: string | null = 'old-token'
    let resolveOld: ((value: any) => void) | undefined
    let releaseLogout: (() => void) | undefined
    const executeQuery = vi.fn(() => new Promise((resolve) => {
      resolveOld = resolve
    }))
    const auth = createAuthRuntime({
      clearStore: vi.fn(async () => undefined),
      executeQuery,
    } as any, {
      meQuery: ME_QUERY,
      getToken: () => token,
      clearToken: vi.fn(() => new Promise<void>((resolve) => {
        releaseLogout = () => {
          token = null
          resolve()
        }
      })),
    })

    const first = auth.verifySession()
    const logout = auth.clearSession()
    const check = auth.verifySession()
    expect(executeQuery).toHaveBeenCalledTimes(1)

    releaseLogout?.()
    await expect(logout).resolves.toBeUndefined()
    await expect(check).resolves.toBe(false)
    expect(executeQuery).toHaveBeenCalledTimes(1)

    resolveOld?.({ data: { me: { id: 'stale-user' } } })
    await expect(first).resolves.toBe(false)
  })

  it('waits for session cache reset and credential persistence before verifying', async () => {
    let token = 'old-token'
    let releaseCacheReset: (() => void) | undefined
    let releaseCredentialPersist: (() => void) | undefined
    const observedTokens: string[] = []
    const clearStore = vi.fn(() => new Promise<void>((resolve) => {
      releaseCacheReset = resolve
    }))
    const setToken = vi.fn(async (session: any) => {
      token = session.token
      await new Promise<void>((resolve) => {
        releaseCredentialPersist = resolve
      })
    })
    const executeQuery = vi.fn(async () => {
      observedTokens.push(token)
      return { data: { me: { id: 'verified-replacement' } } }
    })
    const auth = createAuthRuntime({
      clearStore,
      executeQuery,
    } as any, {
      meQuery: ME_QUERY,
      getToken: () => token,
      setToken,
    })

    const establishing = auth.setSession({
      token: 'replacement-token',
      user: { id: 'replacement-user' },
    })
    const verification = auth.verifySession()
    expect(executeQuery).not.toHaveBeenCalled()

    releaseCacheReset?.()
    await Promise.resolve()
    expect(setToken).toHaveBeenCalledTimes(1)
    expect(executeQuery).not.toHaveBeenCalled()

    releaseCredentialPersist?.()
    await establishing
    await expect(verification).resolves.toBe(true)
    expect(observedTokens).toEqual(['replacement-token'])
    expect(auth.user.value).toEqual({ id: 'verified-replacement' })
  })

  it('serializes clear → set → clear in invocation order', async () => {
    let token: string | null = 'old-token'
    let firstClearCompleted = false
    let resolveFirstClearStarted!: () => void
    let resolveSetStarted!: () => void
    let releaseFirstClear!: () => void
    let releaseSet!: () => void
    let clearCalls = 0
    const firstClearStarted = new Promise<void>((resolve) => {
      resolveFirstClearStarted = resolve
    })
    const setStarted = new Promise<void>((resolve) => {
      resolveSetStarted = resolve
    })
    const firstClear = new Promise<void>((resolve) => {
      releaseFirstClear = resolve
    })
    const setCompletion = new Promise<void>((resolve) => {
      releaseSet = resolve
    })
    const clearToken = vi.fn(async () => {
      clearCalls += 1
      if (clearCalls === 1) {
        resolveFirstClearStarted()
        await firstClear
        firstClearCompleted = true
      }
      token = null
    })
    const setToken = vi.fn(async (session: any) => {
      expect(firstClearCompleted).toBe(true)
      token = session.token
      resolveSetStarted()
      await setCompletion
    })
    const auth = createAuthRuntime({
      clearStore: vi.fn(async () => undefined),
      executeQuery: vi.fn(async () => ({ data: { me: null } })),
    } as any, {
      meQuery: ME_QUERY,
      getToken: () => token,
      clearToken,
      setToken,
    })

    const clearA = auth.clearSession()
    await firstClearStarted
    const setB = auth.setSession({
      token: 'new-token',
      user: { id: 'replacement-user' },
    })
    const clearC = auth.clearSession()
    let clearCResolved = false
    void clearC.then(() => { clearCResolved = true })

    releaseFirstClear()
    await setStarted
    expect(firstClearCompleted).toBe(true)
    expect(clearCResolved).toBe(false)
    expect(token).toBe('new-token')

    releaseSet()
    await Promise.all([clearA, setB, clearC])
    expect(clearToken).toHaveBeenCalledTimes(2)
    expect(token).toBeNull()
    expect(auth.user.value).toBeNull()
    expect(auth.isAuthenticated.value).toBe(false)
  })

  it('keeps the newest session for set → clear → set ordering', async () => {
    let token: string | null = null
    let releaseFirstSet!: () => void
    let clearStoreCalls = 0
    const firstStoreReset = new Promise<void>((resolve) => {
      releaseFirstSet = resolve
    })
    const clearStore = vi.fn(async () => {
      clearStoreCalls += 1
      if (clearStoreCalls === 1) await firstStoreReset
    })
    const setToken = vi.fn(async (session: any) => {
      token = session.token
    })
    const clearToken = vi.fn(async () => {
      token = null
    })
    const auth = createAuthRuntime({
      clearStore,
      executeQuery: vi.fn(async () => ({ data: { me: null } })),
    } as any, {
      meQuery: ME_QUERY,
      getToken: () => token,
      setToken,
      clearToken,
    })

    const setA = auth.setSession({
      token: 'first-token',
      user: { id: 'first-user' },
    })
    const clearB = auth.clearSession()
    const setC = auth.setSession({
      token: 'last-token',
      user: { id: 'last-user' },
    })

    expect(auth.user.value).toBeNull()
    releaseFirstSet()
    await Promise.all([setA, clearB, setC])
    expect(token).toBe('last-token')
    expect(auth.user.value).toEqual({ id: 'last-user' })
    expect(auth.isAuthenticated.value).toBe(true)
  })

  it('isolates offline queues and never replays into a different session', async () => {
    const jwtFor = (sub: string) => {
      const header = btoa(JSON.stringify({ alg: 'none' }))
      const payload = btoa(JSON.stringify({ sub }))
      return `${header}.${payload}.sig`
    }
    let leftSession = jwtFor('left-user')
    const leftClient = { mutate: vi.fn(async () => ({ data: { save: true } })) }
    const rightClient = { mutate: vi.fn(async () => ({ data: { save: true } })) }
    const left = createApolloOfflineRuntime({
      applicationId: 'left-app',
      authBoundary: 'customer',
      endPoints: { default: 'https://left.test/graphql' },
      allowOffline: true,
      getSessionId: () => leftSession,
    }, { default: leftClient } as any)
    const right = createApolloOfflineRuntime({
      applicationId: 'right-app',
      authBoundary: 'customer',
      endPoints: { default: 'https://right.test/graphql' },
      allowOffline: true,
      getSessionId: () => jwtFor('right-user'),
    }, { default: rightClient } as any)

    left.enqueue('default', SAVE_MUTATION, { value: 'left' })
    right.enqueue('default', SAVE_MUTATION, { value: 'right' })
    await right.sync()
    expect(rightClient.mutate).toHaveBeenCalledTimes(1)
    expect(leftClient.mutate).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(1)

    leftSession = jwtFor('replacement-user')
    await left.sync()
    expect(leftClient.mutate).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
    left.stop()
    right.stop()
  })
})
