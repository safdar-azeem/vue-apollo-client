import { gql } from '@apollo/client/core/index.js'
import { describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { createApollo } from './createApollo'
import { useMutation } from './composables/useMutation'

const VALUE_QUERY = gql`
  query RefreshRuntimeValue($id: ID!) { runtimeValue(id: $id) }
`
const CREATE_ITEM_MUTATION = gql`
  mutation CreateRuntimeItem($name: String!) { createItem(name: $name) }
`
const REFRESH_MUTATION = gql`
  mutation RefreshRuntimeToken($refreshToken: String!) {
    refreshTokens(refreshToken: $refreshToken) { token refreshToken }
  }
`

const jwt = (claims: Record<string, unknown>) => {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${header}.${payload}.sig`
}

const json = (payload: unknown) => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})

describe('generated-document refresh runtime', () => {
  it('shares one refresh within a client but never across named clients', async () => {
    const refreshed = new Set<string>()
    const refreshes = new Map<string, number>()
    const runtimeFetch: typeof fetch = async (input, init) => {
      const endpoint = input instanceof Request ? input.url : String(input)
      const clientId = endpoint.includes('reporting') ? 'reporting' : 'default'
      const body = JSON.parse(String(init?.body || '{}'))
      if (body.operationName === 'RefreshRuntimeToken') {
        refreshes.set(clientId, (refreshes.get(clientId) || 0) + 1)
        await Promise.resolve()
        refreshed.add(clientId)
        return json({
          data: { refreshTokens: { token: `${clientId}-fresh`, refreshToken: 'next' } },
        })
      }
      if (!refreshed.has(clientId)) {
        return json({
          errors: [{
            message: 'Unauthorized',
            extensions: { code: 'UNAUTHENTICATED' },
          }],
        })
      }
      return json({ data: { runtimeValue: `${clientId}:${body.variables.id}` } })
    }
    const persistTokens = vi.fn()
    const runtime = createApollo({
      endPoints: {
        default: 'https://default.test/graphql',
        reporting: 'https://reporting.test/graphql',
      },
      refresh: {
        document: REFRESH_MUTATION,
        getRefreshToken: () => 'refresh-token',
        createVariables: (refreshToken) => ({ refreshToken }),
        selectTokens: (data: any) => data?.refreshTokens,
        persistTokens,
      },
    }, {
      server: false,
      registerGlobal: false,
      fetch: runtimeFetch,
    })

    const [left, right, reporting] = await Promise.all([
      runtime.executeQuery({
        document: VALUE_QUERY,
        variables: { id: 'left' },
        fetchPolicy: 'network-only',
      }),
      runtime.executeQuery({
        document: VALUE_QUERY,
        variables: { id: 'right' },
        fetchPolicy: 'network-only',
      }),
      runtime.executeQuery({
        clientId: 'reporting',
        document: VALUE_QUERY,
        variables: { id: 'report' },
        fetchPolicy: 'network-only',
      }),
    ])

    expect(left.data.runtimeValue).toBe('default:left')
    expect(right.data.runtimeValue).toBe('default:right')
    expect(reporting.data.runtimeValue).toBe('reporting:report')
    expect(refreshes.get('default')).toBe(1)
    expect(refreshes.get('reporting')).toBe(1)
    expect(persistTokens).toHaveBeenCalledTimes(2)
    runtime.stop()
  })

  it('runs a generated refresh mutation composable inside the owning app context', async () => {
    let token = 'expired'
    const clearTokens = vi.fn(() => {
      token = ''
    })
    let refreshCount = 0
    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      refresh: {
        useMutation: (options) => useMutation(REFRESH_MUTATION, options) as any,
        getRefreshToken: () => 'refresh-token',
        createVariables: (refreshToken) => ({ refreshToken }),
        selectTokens: (data: any) => data?.refreshTokens,
        persistTokens: (tokens) => {
          token = tokens.token
        },
        clearTokens,
      },
    }, {
      server: false,
      registerGlobal: false,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body || '{}'))
        if (body.operationName === 'RefreshRuntimeToken') {
          refreshCount += 1
          return json({
            data: { refreshTokens: { token: 'fresh', refreshToken: 'next' } },
          })
        }
        if (token === 'expired') {
          return json({
            errors: [{
              message: 'Unauthorized',
              extensions: { code: 'UNAUTHENTICATED' },
            }],
          })
        }
        return json({ data: { runtimeValue: 'generated-refresh' } })
      },
    })
    createSSRApp({ render: () => null }).use(runtime)

    const result = await runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'generated' },
      fetchPolicy: 'network-only',
    })

    expect(result.data.runtimeValue).toBe('generated-refresh')
    expect(refreshCount).toBe(1)
    runtime.stop()
  })

  it('preserves credentials and does not log out on offline or HTTP 5xx failures', async () => {
    let token = 'valid-access'
    let refreshToken = 'valid-refresh'
    const clearTokens = vi.fn(() => {
      token = ''
      refreshToken = ''
    })
    const onLogout = vi.fn()
    let mode: 'offline' | '503' | 'ok' = 'offline'

    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      onLogout,
      refresh: {
        document: REFRESH_MUTATION,
        getRefreshToken: () => refreshToken,
        createVariables: (value) => ({ refreshToken: value }),
        selectTokens: (data: any) => data?.refreshTokens,
        persistTokens: (tokens) => {
          token = tokens.token
          refreshToken = tokens.refreshToken || refreshToken
        },
        clearTokens,
      },
    }, {
      server: false,
      registerGlobal: false,
      fetch: async () => {
        if (mode === 'offline') throw new TypeError('Failed to fetch')
        if (mode === '503') {
          return new Response(JSON.stringify({ error: 'Service unavailable' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
        }
        return json({ data: { runtimeValue: 'recovered' } })
      },
    })

    await expect(runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'offline' },
      fetchPolicy: 'network-only',
    })).rejects.toThrow()
    expect(token).toBe('valid-access')
    expect(refreshToken).toBe('valid-refresh')
    expect(clearTokens).not.toHaveBeenCalled()
    expect(onLogout).not.toHaveBeenCalled()

    mode = '503'
    await expect(runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: '503' },
      fetchPolicy: 'network-only',
    })).rejects.toThrow()
    expect(token).toBe('valid-access')
    expect(refreshToken).toBe('valid-refresh')
    expect(clearTokens).not.toHaveBeenCalled()
    expect(onLogout).not.toHaveBeenCalled()

    mode = 'ok'
    const recovered = await runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'ok' },
      fetchPolicy: 'network-only',
    })
    expect(recovered.data.runtimeValue).toBe('recovered')
    runtime.stop()
  })

  it('preserves credentials when refresh itself fails with a temporary 5xx/network error', async () => {
    let token = 'expired-access'
    let refreshToken = 'valid-refresh'
    const clearTokens = vi.fn(() => {
      token = ''
      refreshToken = ''
    })
    const onLogout = vi.fn()

    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      onLogout,
      refresh: {
        document: REFRESH_MUTATION,
        getRefreshToken: () => refreshToken,
        createVariables: (value) => ({ refreshToken: value }),
        selectTokens: (data: any) => data?.refreshTokens,
        persistTokens: (tokens) => {
          token = tokens.token
          refreshToken = tokens.refreshToken || refreshToken
        },
        clearTokens,
      },
    }, {
      server: false,
      registerGlobal: false,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body || '{}'))
        if (body.operationName === 'RefreshRuntimeToken') {
          return new Response(JSON.stringify({ error: 'Upstream unavailable' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
        }
        return json({
          errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
        })
      },
    })

    await expect(runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'refresh-503' },
      fetchPolicy: 'network-only',
    })).rejects.toThrow()
    expect(token).toBe('expired-access')
    expect(refreshToken).toBe('valid-refresh')
    expect(clearTokens).not.toHaveBeenCalled()
    expect(onLogout).not.toHaveBeenCalled()
    runtime.stop()
  })

  it('clears credentials when the current refresh token is proven invalid or revoked', async () => {
    let token = 'expired-access'
    let refreshToken = 'revoked-refresh'
    const clearTokens = vi.fn(() => {
      token = ''
      refreshToken = ''
    })
    const onLogout = vi.fn()

    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      onLogout,
      refresh: {
        document: REFRESH_MUTATION,
        getRefreshToken: () => refreshToken,
        createVariables: (value) => ({ refreshToken: value }),
        selectTokens: (data: any) => data?.refreshTokens,
        persistTokens: (tokens) => {
          token = tokens.token
          refreshToken = tokens.refreshToken || refreshToken
        },
        clearTokens,
      },
    }, {
      server: false,
      registerGlobal: false,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body || '{}'))
        if (body.operationName === 'RefreshRuntimeToken') {
          return json({
            errors: [{
              message: 'Invalid or expired refresh token',
              extensions: { code: 'UNAUTHENTICATED' },
            }],
          })
        }
        return json({
          errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
        })
      },
    })

    await expect(runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'revoked' },
      fetchPolicy: 'network-only',
    })).rejects.toThrow()
    expect(clearTokens).toHaveBeenCalledTimes(1)
    expect(onLogout).toHaveBeenCalledTimes(1)
    expect(token).toBe('')
    expect(refreshToken).toBe('')
    runtime.stop()
  })

  it('preserves newer credentials installed by a competing app refresh for the same account and retries once', async () => {
    const expiredAccess = jwt({ _id: 'user-1', lsid: 'same-login', sid: 'jti-1' })
    const newerAccess = jwt({ _id: 'user-1', lsid: 'same-login', sid: 'jti-2' })
    let token = expiredAccess
    let refreshToken = jwt({ sub: 'user-1', jti: 'jti-1' })
    const clearTokens = vi.fn(() => {
      token = ''
      refreshToken = ''
    })
    const onLogout = vi.fn()

    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      onLogout,
      refresh: {
        document: REFRESH_MUTATION,
        getRefreshToken: () => refreshToken,
        createVariables: (value) => ({ refreshToken: value }),
        selectTokens: (data: any) => data?.refreshTokens,
        persistTokens: (tokens) => {
          token = tokens.token
          refreshToken = tokens.refreshToken || refreshToken
        },
        clearTokens,
      },
    }, {
      server: false,
      registerGlobal: false,
      fetch: async (_input, init) => {
        const headers = new Headers(init?.headers)
        const body = JSON.parse(String(init?.body || '{}'))
        if (body.operationName === 'RefreshRuntimeToken') {
          // Simulate another Builto app winning the single-use refresh race
          // for the same account while this refresh request was in flight.
          token = newerAccess
          refreshToken = jwt({ sub: 'user-1', jti: 'jti-2' })
          return json({
            errors: [{
              message: 'Invalid or expired refresh token',
              extensions: { code: 'UNAUTHENTICATED' },
            }],
          })
        }
        if (headers.get('authorization') === newerAccess) {
          return json({ data: { runtimeValue: 'recovered-from-race' } })
        }
        return json({
          errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
        })
      },
    })

    const result = await runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'race' },
      fetchPolicy: 'network-only',
    })

    expect(result.data.runtimeValue).toBe('recovered-from-race')
    expect(token).toBe(newerAccess)
    expect(clearTokens).not.toHaveBeenCalled()
    expect(onLogout).not.toHaveBeenCalled()
    runtime.stop()
  })

  it('discards a completed refresh response when the user signed out while refresh was pending', async () => {
    const expiredAccess = jwt({ _id: 'user-a', sid: 'jti-a1' })
    const refreshedAccess = jwt({ _id: 'user-a', sid: 'jti-a2' })
    let token = expiredAccess
    let refreshToken = jwt({ sub: 'user-a', jti: 'jti-a1' })
    const persistTokens = vi.fn((tokens: { token: string; refreshToken?: string | null }) => {
      token = tokens.token
      refreshToken = tokens.refreshToken || ''
    })
    const clearTokens = vi.fn(() => {
      token = ''
      refreshToken = ''
    })
    let releaseRefresh!: () => void
    const refreshStarted = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    let allowRefreshResponse!: () => void
    const refreshGate = new Promise<void>((resolve) => {
      allowRefreshResponse = resolve
    })

    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      refresh: {
        document: REFRESH_MUTATION,
        getRefreshToken: () => refreshToken,
        createVariables: (value) => ({ refreshToken: value }),
        selectTokens: (data: any) => data?.refreshTokens,
        persistTokens,
        clearTokens,
      },
    }, {
      server: false,
      registerGlobal: false,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body || '{}'))
        if (body.operationName === 'RefreshRuntimeToken') {
          releaseRefresh()
          await refreshGate
          return json({
            data: {
              refreshTokens: {
                token: refreshedAccess,
                refreshToken: jwt({ sub: 'user-a', jti: 'jti-a2' }),
              },
            },
          })
        }
        return json({
          errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
        })
      },
    })

    const pendingQuery = runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'logout-race' },
      fetchPolicy: 'network-only',
    })

    await refreshStarted
    // User explicitly logs out while account A's refresh is in flight.
    token = ''
    refreshToken = ''
    allowRefreshResponse()

    await expect(pendingQuery).rejects.toThrow()
    expect(persistTokens).not.toHaveBeenCalled()
    expect(token).toBe('')
    expect(refreshToken).toBe('')
    runtime.stop()
  })

  it('discards a completed refresh response when the user switched accounts while refresh was pending', async () => {
    const accountAAccess = jwt({ _id: 'user-a', sid: 'jti-a1' })
    const accountARefreshed = jwt({ _id: 'user-a', sid: 'jti-a2' })
    const accountBAccess = jwt({ _id: 'user-b', sid: 'jti-b1' })
    const accountBRefresh = jwt({ sub: 'user-b', jti: 'jti-b1' })
    let token = accountAAccess
    let refreshToken = jwt({ sub: 'user-a', jti: 'jti-a1' })
    const persistTokens = vi.fn((tokens: { token: string; refreshToken?: string | null }) => {
      token = tokens.token
      refreshToken = tokens.refreshToken || ''
    })
    const clearTokens = vi.fn()
    let releaseRefresh!: () => void
    const refreshStarted = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    let allowRefreshResponse!: () => void
    const refreshGate = new Promise<void>((resolve) => {
      allowRefreshResponse = resolve
    })

    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      refresh: {
        document: REFRESH_MUTATION,
        getRefreshToken: () => refreshToken,
        createVariables: (value) => ({ refreshToken: value }),
        selectTokens: (data: any) => data?.refreshTokens,
        persistTokens,
        clearTokens,
      },
    }, {
      server: false,
      registerGlobal: false,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body || '{}'))
        if (body.operationName === 'RefreshRuntimeToken') {
          releaseRefresh()
          await refreshGate
          return json({
            data: {
              refreshTokens: {
                token: accountARefreshed,
                refreshToken: jwt({ sub: 'user-a', jti: 'jti-a2' }),
              },
            },
          })
        }
        return json({
          errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
        })
      },
    })

    const pendingQuery = runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'switch-race' },
      fetchPolicy: 'network-only',
    })

    await refreshStarted
    // User switches to Account B before Account A's refresh completes.
    token = accountBAccess
    refreshToken = accountBRefresh
    allowRefreshResponse()

    await expect(pendingQuery).rejects.toThrow()
    expect(persistTokens).not.toHaveBeenCalled()
    expect(token).toBe(accountBAccess)
    expect(refreshToken).toBe(accountBRefresh)
    runtime.stop()
  })

  it('never retries a stale mutation under a different account after an account switch', async () => {
    const accountAAccess = jwt({ _id: 'user-a', sid: 'jti-a1' })
    const accountBAccess = jwt({ _id: 'user-b', sid: 'jti-b1' })
    let token = accountAAccess
    const seenAuthorizations: string[] = []
    let releaseMutation!: () => void
    const mutationStarted = new Promise<void>((resolve) => {
      releaseMutation = resolve
    })
    let allowMutationResponse!: () => void
    const mutationGate = new Promise<void>((resolve) => {
      allowMutationResponse = resolve
    })

    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      refresh: {
        document: REFRESH_MUTATION,
        getRefreshToken: () => jwt({ sub: 'user-b', jti: 'jti-b1' }),
        createVariables: (value) => ({ refreshToken: value }),
        selectTokens: (data: any) => data?.refreshTokens,
        persistTokens: vi.fn(),
        clearTokens: vi.fn(),
      },
    }, {
      server: false,
      registerGlobal: false,
      fetch: async (_input, init) => {
        const headers = new Headers(init?.headers)
        const auth = headers.get('authorization') || ''
        seenAuthorizations.push(auth)
        releaseMutation()
        await mutationGate
        return json({
          errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
        })
      },
    })

    const pendingMutation = runtime.clients.default.mutate({
      mutation: CREATE_ITEM_MUTATION,
      variables: { name: 'belongs-to-a' },
      errorPolicy: 'none',
    })

    await mutationStarted
    // Switch to account B while account A's mutation is in flight.
    token = accountBAccess
    allowMutationResponse()

    await expect(pendingMutation).rejects.toThrow()
    expect(seenAuthorizations).toEqual([accountAAccess])
    expect(token).toBe(accountBAccess)
    runtime.stop()
  })

  it('preserves credentials when refresh returns a GraphQL INTERNAL_SERVER_ERROR', async () => {
    const expiredAccess = jwt({ _id: 'user-1', sid: 'jti-1' })
    const validRefresh = jwt({ sub: 'user-1', jti: 'jti-1' })
    let token = expiredAccess
    let refreshToken = validRefresh
    const clearTokens = vi.fn(() => {
      token = ''
      refreshToken = ''
    })
    const onLogout = vi.fn()

    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      onLogout,
      refresh: {
        document: REFRESH_MUTATION,
        getRefreshToken: () => refreshToken,
        createVariables: (value) => ({ refreshToken: value }),
        selectTokens: (data: any) => data?.refreshTokens,
        persistTokens: vi.fn(),
        clearTokens,
      },
    }, {
      server: false,
      registerGlobal: false,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body || '{}'))
        if (body.operationName === 'RefreshRuntimeToken') {
          return json({
            data: null,
            errors: [{
              message: 'An unexpected error occurred',
              extensions: { code: 'INTERNAL_SERVER_ERROR' },
            }],
          })
        }
        return json({
          errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
        })
      },
    })

    await expect(runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'gql-500' },
      fetchPolicy: 'network-only',
    })).rejects.toThrow()
    expect(token).toBe(expiredAccess)
    expect(refreshToken).toBe(validRefresh)
    expect(clearTokens).not.toHaveBeenCalled()
    expect(onLogout).not.toHaveBeenCalled()
    runtime.stop()
  })

  it('handles async clearTokens rejection without reporting logout or unhandled rejection', async () => {
    let token = jwt({ _id: 'user-1', sid: 'jti-1' })
    let refreshToken = jwt({ sub: 'user-1', jti: 'jti-1' })
    const clearTokens = vi.fn(async () => {
      throw new Error('Storage unavailable')
    })
    const onLogout = vi.fn()

    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      onLogout,
      refresh: {
        document: REFRESH_MUTATION,
        getRefreshToken: () => refreshToken,
        createVariables: (value) => ({ refreshToken: value }),
        selectTokens: (data: any) => data?.refreshTokens,
        persistTokens: vi.fn(),
        clearTokens,
      },
    }, {
      server: false,
      registerGlobal: false,
      fetch: async () => json({
        errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
      }),
    })

    await expect(runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'cleanup-fail' },
      fetchPolicy: 'network-only',
    })).rejects.toThrow()
    expect(clearTokens).toHaveBeenCalledTimes(1)
    expect(onLogout).not.toHaveBeenCalled()
    runtime.stop()
  })

  it('does not invoke onLogout if a new login completes while async credential cleanup is pending', async () => {
    const oldAccess = jwt({ _id: 'user-a', sid: 'jti-a1' })
    const newAccess = jwt({ _id: 'user-b', sid: 'jti-b1' })
    let token = oldAccess
    let finishCleanup!: () => void
    const cleanupGate = new Promise<void>((resolve) => {
      finishCleanup = resolve
    })
    let cleanupStarted!: () => void
    const cleanupRunning = new Promise<void>((resolve) => {
      cleanupStarted = resolve
    })
    const clearToken = vi.fn(async () => {
      cleanupStarted()
      await cleanupGate
    })
    const onLogout = vi.fn()

    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      clearToken,
      onLogout,
    }, {
      server: false,
      registerGlobal: false,
      fetch: async () => json({
        errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
      }),
    })

    const pendingQuery = runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'async-cleanup-login' },
      fetchPolicy: 'network-only',
    })

    await cleanupRunning
    // A new login establishes Account B while async cleanup for Account A is still resolving.
    token = newAccess
    finishCleanup()

    await expect(pendingQuery).rejects.toThrow()
    expect(clearToken).toHaveBeenCalledTimes(1)
    expect(onLogout).not.toHaveBeenCalled()
    expect(token).toBe(newAccess)
    runtime.stop()
  })

  it('resets Apollo cache when replacing one opaque account token with another', async () => {
    let token = 'opaque-token-account-a'
    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
    }, {
      server: false,
      registerGlobal: false,
      fetch: async (_input, init) => {
        const auth = new Headers(init?.headers).get('authorization')
        return json({
          data: {
            runtimeValue: auth === 'opaque-token-account-a' ? 'data-for-a' : 'data-for-b',
          },
        })
      },
    })

    const first = await runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'shared-id' },
      fetchPolicy: 'cache-first',
    })
    expect(first.data.runtimeValue).toBe('data-for-a')

    // Replace opaque token without an explicit manual cache reset.
    token = 'opaque-token-account-b'
    const second = await runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'shared-id' },
      fetchPolicy: 'network-only',
    })
    expect(second.data.runtimeValue).toBe('data-for-b')
    runtime.stop()
  })

  it('prevents a delayed async persistTokens write from restoring Account A after switching to Account B', async () => {
    const accountAAccess = jwt({ _id: 'user-a', sid: 'jti-a1' })
    const accountARefreshed = jwt({ _id: 'user-a', sid: 'jti-a2' })
    const accountBAccess = jwt({ _id: 'user-b', sid: 'jti-b1' })
    const accountBRefresh = jwt({ sub: 'user-b', jti: 'jti-b1' })
    let token = accountAAccess
    let refreshToken = jwt({ sub: 'user-a', jti: 'jti-a1' })

    let persistStarted!: () => void
    const persistInFlight = new Promise<void>((resolve) => {
      persistStarted = resolve
    })
    let resumePersist!: () => void
    const persistGate = new Promise<void>((resolve) => {
      resumePersist = resolve
    })
    let firstPersist = true

    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      auth: {
        meQuery: VALUE_QUERY,
      },
      refresh: {
        document: REFRESH_MUTATION,
        getRefreshToken: () => refreshToken,
        createVariables: (value) => ({ refreshToken: value }),
        selectTokens: (data: any) => data?.refreshTokens,
        persistTokens: async (tokens) => {
          if (firstPersist) {
            firstPersist = false
            persistStarted()
            await persistGate
          }
          token = tokens.token
          refreshToken = tokens.refreshToken || ''
        },
        clearTokens: async () => {
          token = ''
          refreshToken = ''
        },
      },
    }, {
      server: false,
      registerGlobal: false,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body || '{}'))
        if (body.operationName === 'RefreshRuntimeToken') {
          return json({
            data: {
              refreshTokens: {
                token: accountARefreshed,
                refreshToken: jwt({ sub: 'user-a', jti: 'jti-a2' }),
              },
            },
          })
        }
        return json({
          errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
        })
      },
    })

    const pendingQuery = runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'delayed-persist' },
      fetchPolicy: 'network-only',
    })

    await persistInFlight
    // Switch to Account B via the runtime auth boundary while A's async persistTokens is suspended.
    const switchPromise = runtime.auth!.setSession({
      token: accountBAccess,
      refreshToken: accountBRefresh,
      user: { id: 'user-b' },
    })
    resumePersist()

    await switchPromise
    await expect(pendingQuery).rejects.toThrow()
    expect(token).toBe(accountBAccess)
    expect(refreshToken).toBe(accountBRefresh)
    runtime.stop()
  })

  it('prevents a delayed async clearToken that deletes storage from wiping Account B after login', async () => {
    const accountAAccess = jwt({ _id: 'user-a', sid: 'jti-a1' })
    const accountBAccess = jwt({ _id: 'user-b', sid: 'jti-b1' })
    let token = accountAAccess

    let cleanupStarted!: () => void
    const cleanupInFlight = new Promise<void>((resolve) => {
      cleanupStarted = resolve
    })
    let resumeCleanup!: () => void
    const cleanupGate = new Promise<void>((resolve) => {
      resumeCleanup = resolve
    })

    const onLogout = vi.fn(() => {
      throw new Error('consumer logout error must not become unhandled')
    })

    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      setToken: async (session) => {
        token = session.token || ''
      },
      clearToken: async () => {
        cleanupStarted()
        await cleanupGate
        // Actually delete credentials when cleanup resumes.
        token = ''
      },
      auth: {
        meQuery: VALUE_QUERY,
      },
      onLogout,
    }, {
      server: false,
      registerGlobal: false,
      fetch: async () => json({
        errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
      }),
    })

    const pendingQuery = runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'delayed-cleanup-delete' },
      fetchPolicy: 'network-only',
    })

    await cleanupInFlight
    // Account B logs in while Account A's async clearToken is suspended.
    const loginPromise = runtime.auth!.setSession({
      token: accountBAccess,
      user: { id: 'user-b' },
    })
    resumeCleanup()

    await loginPromise
    await expect(pendingQuery).rejects.toThrow()
    expect(token).toBe(accountBAccess)
    expect(onLogout).not.toHaveBeenCalled()
    runtime.stop()
  })

  it('does not retry a stale mutation after explicit logout and login to the same account, while normal refresh still retries', async () => {
    const firstAccess = jwt({ _id: 'user-a', sid: 'jti-a1' })
    const firstRefresh = jwt({ sub: 'user-a', jti: 'jti-a1' })
    const secondAccess = jwt({ _id: 'user-a', sid: 'jti-a2' })
    const secondRefresh = jwt({ sub: 'user-a', jti: 'jti-a2' })
    const rotatedAccess = jwt({ _id: 'user-a', sid: 'jti-a3' })
    const rotatedRefresh = jwt({ sub: 'user-a', jti: 'jti-a3' })

    let token = firstAccess
    let refreshToken = firstRefresh
    const mutationAuthHeaders: string[] = []
    let releaseMutation!: () => void
    const mutationStarted = new Promise<void>((resolve) => {
      releaseMutation = resolve
    })
    let allowMutationResponse!: () => void
    const mutationGate = new Promise<void>((resolve) => {
      allowMutationResponse = resolve
    })

    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      auth: {
        meQuery: VALUE_QUERY,
      },
      refresh: {
        document: REFRESH_MUTATION,
        getRefreshToken: () => refreshToken,
        createVariables: (value) => ({ refreshToken: value }),
        selectTokens: (data: any) => data?.refreshTokens,
        persistTokens: (tokens) => {
          token = tokens.token
          refreshToken = tokens.refreshToken || ''
        },
        clearTokens: () => {
          token = ''
          refreshToken = ''
        },
      },
    }, {
      server: false,
      registerGlobal: false,
      fetch: async (_input, init) => {
        const headers = new Headers(init?.headers)
        const auth = headers.get('authorization') || ''
        const body = JSON.parse(String(init?.body || '{}'))
        if (body.operationName === 'CreateRuntimeItem') {
          mutationAuthHeaders.push(auth)
          releaseMutation()
          await mutationGate
          return json({
            errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
          })
        }
        if (body.operationName === 'RefreshRuntimeToken') {
          return json({
            data: {
              refreshTokens: {
                token: rotatedAccess,
                refreshToken: rotatedRefresh,
              },
            },
          })
        }
        if (auth === rotatedAccess) {
          return json({ data: { runtimeValue: 'refreshed-ok' } })
        }
        return json({
          errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
        })
      },
    })

    // 1. Start a mutation under Account A's first session.
    const staleMutation = runtime.clients.default.mutate({
      mutation: CREATE_ITEM_MUTATION,
      variables: { name: 'from-old-session' },
      errorPolicy: 'none',
    })

    await mutationStarted

    // 2. Explicitly log out and log back in as the SAME Account A.
    await runtime.auth!.clearSession()
    await runtime.auth!.setSession({
      token: secondAccess,
      refreshToken: secondRefresh,
      user: { id: 'user-a' },
    })

    // 3. Old mutation returns UNAUTHENTICATED; it must NOT retry under the new login.
    allowMutationResponse()
    await expect(staleMutation).rejects.toThrow()
    expect(mutationAuthHeaders).toEqual([firstAccess])
    expect(token).toBe(secondAccess)
    expect(refreshToken).toBe(secondRefresh)

    // 4. Normal same-account refresh in the new session still retries and succeeds.
    const refreshed = await runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'normal-refresh' },
      fetchPolicy: 'network-only',
    })
    expect(refreshed.data.runtimeValue).toBe('refreshed-ok')
    expect(token).toBe(rotatedAccess)
    runtime.stop()
  })

  it('allows a queued valid setSession(B) to succeed even when an earlier setSession(A) fails', async () => {
    const accountAAccess = jwt({ _id: 'user-a', sid: 'jti-a1' })
    const accountBAccess = jwt({ _id: 'user-b', sid: 'jti-b1' })
    let token = ''
    let failFirstPersist!: () => void
    const firstPersistGate = new Promise<void>((resolve) => {
      failFirstPersist = resolve
    })
    let firstPersistStarted!: () => void
    const firstPersistRunning = new Promise<void>((resolve) => {
      firstPersistStarted = resolve
    })

    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      setToken: async (session) => {
        if (session.token === accountAAccess) {
          firstPersistStarted()
          await firstPersistGate
          throw new Error('Transient credential store failure for A')
        }
        token = session.token || ''
      },
      clearToken: () => {
        token = ''
      },
      auth: {
        meQuery: VALUE_QUERY,
      },
    }, {
      server: false,
      registerGlobal: false,
      fetch: async () => json({ data: { runtimeValue: 'ok' } }),
    })

    const sessionAPromise = runtime.auth!.setSession({
      token: accountAAccess,
      user: { id: 'user-a' },
    })
    await firstPersistRunning

    // Queue Account B's valid login while Account A's transition is still pending.
    const sessionBPromise = runtime.auth!.setSession({
      token: accountBAccess,
      user: { id: 'user-b' },
    })

    // Account A's credential write rejects.
    failFirstPersist()

    await expect(sessionAPromise).rejects.toThrow('Transient credential store failure for A')
    await expect(sessionBPromise).resolves.toBeUndefined()
    expect(token).toBe(accountBAccess)
    expect(runtime.auth!.user.value).toEqual({ id: 'user-b' })
    expect(runtime.auth!.isAuthenticated.value).toBe(true)
    runtime.stop()
  })

  it('never replays a stale mutation across two independent runtimes after same-account logout and re-login in another app', async () => {
    const sessionA1Access = jwt({ _id: 'user-a', sid: 'jti-a1' })
    const sessionA1Refresh = jwt({ sub: 'user-a', jti: 'jti-a1' })
    const sessionA2Access = jwt({ _id: 'user-a', sid: 'jti-a2' })
    const sessionA2Refresh = jwt({ sub: 'user-a', jti: 'jti-a2' })
    const sessionA2Rotated = jwt({ _id: 'user-a', sid: 'jti-a3' })
    const sessionA2RotatedRefresh = jwt({ sub: 'user-a', jti: 'jti-a3' })

    // Shared browser cookie store simulated across two independent apps.
    let sharedAccess = sessionA1Access
    let sharedRefresh = sessionA1Refresh

    const mutationAuthHeaders: string[] = []
    let releaseMutation!: () => void
    const mutationStarted = new Promise<void>((resolve) => {
      releaseMutation = resolve
    })
    let allowMutationResponse!: () => void
    const mutationGate = new Promise<void>((resolve) => {
      allowMutationResponse = resolve
    })

    const sharedFetch: typeof fetch = async (_input, init) => {
      const auth = new Headers(init?.headers).get('authorization') || ''
      const body = JSON.parse(String(init?.body || '{}'))
      if (body.operationName === 'CreateRuntimeItem') {
        mutationAuthHeaders.push(auth)
        releaseMutation()
        await mutationGate
        return json({
          errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
        })
      }
      if (body.operationName === 'RefreshRuntimeToken') {
        if (body.variables?.refreshToken === sessionA2Refresh) {
          return json({
            data: {
              refreshTokens: {
                token: sessionA2Rotated,
                refreshToken: sessionA2RotatedRefresh,
              },
            },
          })
        }
        return json({
          errors: [{ message: 'Invalid refresh token', extensions: { code: 'UNAUTHENTICATED' } }],
        })
      }
      if (auth === sessionA2Rotated) {
        return json({ data: { runtimeValue: 'a2-refreshed-ok' } })
      }
      return json({
        errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
      })
    }

    const createSharedRuntime = (boundary: string) =>
      createApollo({
        authBoundary: boundary,
        endPoints: { default: 'https://default.test/graphql' },
        getToken: () => sharedAccess,
        auth: { meQuery: VALUE_QUERY },
        refresh: {
          document: REFRESH_MUTATION,
          getRefreshToken: () => sharedRefresh,
          createVariables: (value) => ({ refreshToken: value }),
          selectTokens: (data: any) => data?.refreshTokens,
          persistTokens: (tokens) => {
            sharedAccess = tokens.token
            sharedRefresh = tokens.refreshToken || ''
          },
          clearTokens: () => {
            sharedAccess = ''
            sharedRefresh = ''
          },
        },
      }, {
        server: false,
        registerGlobal: false,
        fetch: sharedFetch,
      })

    const runtimeA = createSharedRuntime('invoice')
    const runtimeB = createSharedRuntime('landing')

    // 1. Invoice Builder (runtime A) starts a mutation under Session A1.
    const staleMutation = runtimeA.clients.default.mutate({
      mutation: CREATE_ITEM_MUTATION,
      variables: { name: 'invoice-from-a1' },
      errorPolicy: 'none',
    })
    await mutationStarted

    // 2. Landing (runtime B) logs out and logs back into the SAME Account A (Session A2).
    await runtimeB.auth!.clearSession()
    await runtimeB.auth!.setSession({
      token: sessionA2Access,
      refreshToken: sessionA2Refresh,
      user: { id: 'user-a' },
    })

    // 3. Runtime A's A1 mutation receives UNAUTHENTICATED.
    // It must NOT replay under Session A2 and must NOT clear Session A2.
    allowMutationResponse()
    await expect(staleMutation).rejects.toThrow()
    expect(mutationAuthHeaders).toEqual([sessionA1Access])
    expect(sharedAccess).toBe(sessionA2Access)
    expect(sharedRefresh).toBe(sessionA2Refresh)

    // 4. Ordinary same-account refresh still works cleanly under Session A2.
    const refreshed = await runtimeA.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'post-relogin-refresh' },
      fetchPolicy: 'network-only',
    })
    expect(refreshed.data.runtimeValue).toBe('a2-refreshed-ok')
    expect(sharedAccess).toBe(sessionA2Rotated)

    runtimeA.stop()
    runtimeB.stop()
  })

  it('never replays a mutation via runRefresh when credentials are replaced externally by another app mid-refresh', async () => {
    const sessionA1Access = jwt({ _id: 'user-a', sid: 'jti-a1' })
    const sessionA1Refresh = jwt({ sub: 'user-a', jti: 'jti-a1' })
    const sessionA2Access = jwt({ _id: 'user-a', sid: 'jti-a2' })
    const sessionA2Refresh = jwt({ sub: 'user-a', jti: 'jti-a2' })

    let sharedAccess = sessionA1Access
    let sharedRefresh = sessionA1Refresh
    const mutationAuthHeaders: string[] = []

    let releaseRefresh!: () => void
    const refreshStarted = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    let allowRefreshResponse!: () => void
    const refreshGate = new Promise<void>((resolve) => {
      allowRefreshResponse = resolve
    })

    const sharedFetch: typeof fetch = async (_input, init) => {
      const auth = new Headers(init?.headers).get('authorization') || ''
      const body = JSON.parse(String(init?.body || '{}'))
      if (body.operationName === 'CreateRuntimeItem') {
        mutationAuthHeaders.push(auth)
        return json({
          errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED', executionStarted: false } }],
        })
      }
      if (body.operationName === 'RefreshRuntimeToken') {
        releaseRefresh()
        await refreshGate
        return json({
          errors: [{ message: 'Invalid refresh token', extensions: { code: 'UNAUTHENTICATED' } }],
        })
      }
      return json({ data: { runtimeValue: 'ok' } })
    }

    const createSharedRuntime = (boundary: string) =>
      createApollo({
        authBoundary: boundary,
        endPoints: { default: 'https://default.test/graphql' },
        getToken: () => sharedAccess,
        auth: { meQuery: VALUE_QUERY },
        refresh: {
          document: REFRESH_MUTATION,
          getRefreshToken: () => sharedRefresh,
          createVariables: (value) => ({ refreshToken: value }),
          selectTokens: (data: any) => data?.refreshTokens,
          persistTokens: (tokens) => {
            sharedAccess = tokens.token
            sharedRefresh = tokens.refreshToken || ''
          },
          clearTokens: () => {
            sharedAccess = ''
            sharedRefresh = ''
          },
        },
      }, {
        server: false,
        registerGlobal: false,
        fetch: sharedFetch,
      })

    const runtimeA = createSharedRuntime('invoice-refresh-race')
    const runtimeB = createSharedRuntime('landing-refresh-race')

    const staleMutation = runtimeA.clients.default.mutate({
      mutation: CREATE_ITEM_MUTATION,
      variables: { name: 'mid-refresh-mutation' },
      errorPolicy: 'none',
    })
    await refreshStarted

    // While runtime A's refresh is in flight, runtime B logs out and re-logs into Account A.
    await runtimeB.auth!.clearSession()
    await runtimeB.auth!.setSession({
      token: sessionA2Access,
      refreshToken: sessionA2Refresh,
      user: { id: 'user-a' },
    })

    allowRefreshResponse()
    await expect(staleMutation).rejects.toThrow()
    expect(mutationAuthHeaders).toEqual([sessionA1Access])
    expect(sharedAccess).toBe(sessionA2Access)
    expect(sharedRefresh).toBe(sessionA2Refresh)

    runtimeA.stop()
    runtimeB.stop()
  })

  it('does not let a replacement session inherit an earlier session pending refresh promise', async () => {
    const sessionAAccess = jwt({ _id: 'user-a', sid: 'jti-a1' })
    const sessionARefresh = jwt({ sub: 'user-a', jti: 'jti-a1' })
    const sessionARotated = jwt({ _id: 'user-a', sid: 'jti-a2' })
    const sessionBAccess = jwt({ _id: 'user-b', sid: 'jti-b1' })
    const sessionBRefresh = jwt({ sub: 'user-b', jti: 'jti-b1' })
    const sessionBRotated = jwt({ _id: 'user-b', sid: 'jti-b2' })
    const sessionBRotatedRefresh = jwt({ sub: 'user-b', jti: 'jti-b2' })

    let token = sessionAAccess
    let refreshToken = sessionARefresh
    const refreshCalls: string[] = []

    let releaseRefreshA!: () => void
    const refreshAStarted = new Promise<void>((resolve) => {
      releaseRefreshA = resolve
    })
    let allowRefreshAComplete!: () => void
    const refreshAGate = new Promise<void>((resolve) => {
      allowRefreshAComplete = resolve
    })

    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      auth: { meQuery: VALUE_QUERY },
      refresh: {
        document: REFRESH_MUTATION,
        getRefreshToken: () => refreshToken,
        createVariables: (value) => ({ refreshToken: value }),
        selectTokens: (data: any) => data?.refreshTokens,
        persistTokens: (tokens) => {
          token = tokens.token
          refreshToken = tokens.refreshToken || ''
        },
        clearTokens: () => {
          token = ''
          refreshToken = ''
        },
      },
    }, {
      server: false,
      registerGlobal: false,
      fetch: async (_input, init) => {
        const auth = new Headers(init?.headers).get('authorization') || ''
        const body = JSON.parse(String(init?.body || '{}'))
        if (body.operationName === 'RefreshRuntimeToken') {
          const submittedRefresh = String(body.variables?.refreshToken || '')
          refreshCalls.push(submittedRefresh)
          if (submittedRefresh === sessionARefresh) {
            releaseRefreshA()
            await refreshAGate
            return json({
              data: {
                refreshTokens: {
                  token: sessionARotated,
                  refreshToken: jwt({ sub: 'user-a', jti: 'jti-a2' }),
                },
              },
            })
          }
          if (submittedRefresh === sessionBRefresh) {
            await Promise.resolve()
            return json({
              data: {
                refreshTokens: {
                  token: sessionBRotated,
                  refreshToken: sessionBRotatedRefresh,
                },
              },
            })
          }
        }
        if (auth === sessionBRotated) {
          return json({ data: { runtimeValue: `b:${body.variables.id}` } })
        }
        return json({
          errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
        })
      },
    })

    // 1. Hold Session A's refresh request open.
    const pendingSessionAQuery = runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'from-a' },
      fetchPolicy: 'network-only',
    })
    await refreshAStarted

    // 2. Establish Session B on the same runtime while Session A's refresh is pending.
    await runtime.auth!.setSession({
      token: sessionBAccess,
      refreshToken: sessionBRefresh,
      user: { id: 'user-b' },
    })

    // 3. Start two concurrent Session B requests requiring refresh; they must
    //    NOT inherit A's promise and must share ONE refresh using B's refresh token.
    const [bLeft, bRight] = await Promise.all([
      runtime.executeQuery({
        document: VALUE_QUERY,
        variables: { id: 'left' },
        fetchPolicy: 'network-only',
      }),
      runtime.executeQuery({
        document: VALUE_QUERY,
        variables: { id: 'right' },
        fetchPolicy: 'network-only',
      }),
    ])

    expect(bLeft.data.runtimeValue).toBe('b:left')
    expect(bRight.data.runtimeValue).toBe('b:right')
    expect(refreshCalls).toEqual([sessionARefresh, sessionBRefresh])
    expect(token).toBe(sessionBRotated)
    expect(refreshToken).toBe(sessionBRotatedRefresh)

    // 4. Complete Session A's old refresh; A must fail and cannot overwrite Session B.
    allowRefreshAComplete()
    await expect(pendingSessionAQuery).rejects.toThrow()
    expect(token).toBe(sessionBRotated)
    expect(refreshToken).toBe(sessionBRotatedRefresh)
    runtime.stop()
  })

  it('rejects a mutation before dispatch if the active account changes during an async authLink cache reset', async () => {
    const initialUserAccess = jwt({ _id: 'user-initial', sid: 'jti-0' })
    const accountAAccess = jwt({ _id: 'user-a', sid: 'jti-a1' })
    const accountBAccess = jwt({ _id: 'user-b', sid: 'jti-b1' })
    const accountBRotated = jwt({ _id: 'user-b', sid: 'jti-b2' })

    let token = initialUserAccess
    const dispatchedRequests: Array<{ operationName: string; authorization: string; variables: any }> = []

    const runtime = createApollo({
      endPoints: { default: 'https://default.test/graphql' },
      getToken: () => token,
      setToken: (session) => {
        token = session.token || ''
      },
      clearToken: () => {
        token = ''
      },
      auth: { meQuery: VALUE_QUERY },
    }, {
      server: false,
      registerGlobal: false,
      fetch: async (_input, init) => {
        const authorization = new Headers(init?.headers).get('authorization') || ''
        const body = JSON.parse(String(init?.body || '{}'))
        dispatchedRequests.push({
          operationName: body.operationName,
          authorization,
          variables: body.variables,
        })
        if (body.operationName === 'CreateRuntimeItem') {
          return json({ data: { createItem: body.variables.name } })
        }
        return json({ data: { runtimeValue: `ok:${body.variables.id}` } })
      },
    })

    // Suspend the first cache.reset() triggered when transitioning to Account A.
    const originalReset = runtime.clients.default.cache.reset.bind(runtime.clients.default.cache)
    let resetStarted!: () => void
    const resetInFlight = new Promise<void>((resolve) => {
      resetStarted = resolve
    })
    let resumeReset!: () => void
    const resetGate = new Promise<void>((resolve) => {
      resumeReset = resolve
    })
    let suspendNextReset = true
    vi.spyOn(runtime.clients.default.cache, 'reset').mockImplementation(async () => {
      if (suspendNextReset) {
        suspendNextReset = false
        resetStarted()
        await resetGate
      }
      return originalReset()
    })

    // 1. Switch storage to Account A so authLink must reset caches before dispatching A's mutation.
    token = accountAAccess
    const accountAMutation = runtime.clients.default.mutate({
      mutation: CREATE_ITEM_MUTATION,
      variables: { name: 'belongs-to-account-a' },
      errorPolicy: 'none',
    })

    await resetInFlight

    // 2. Establish Account B while Account A's authLink cache reset is suspended.
    await runtime.auth!.setSession({
      token: accountBAccess,
      user: { id: 'user-b' },
    })

    // 3. Resume the suspended cache reset.
    resumeReset()

    // 4. Account A's mutation must reject BEFORE network dispatch (never sent with Account B's token).
    await expect(accountAMutation).rejects.toThrow()
    expect(dispatchedRequests).toEqual([])
    expect(token).toBe(accountBAccess)
    expect(runtime.auth!.isAuthenticated.value).toBe(true)
    expect(runtime.auth!.user.value).toEqual({ id: 'user-b' })

    // 5. A fresh operation initiated under Account B succeeds normally.
    const accountBResult = await runtime.clients.default.mutate({
      mutation: CREATE_ITEM_MUTATION,
      variables: { name: 'belongs-to-account-b' },
      errorPolicy: 'none',
    })
    expect(accountBResult.data?.createItem).toBe('belongs-to-account-b')
    expect(dispatchedRequests).toHaveLength(1)
    expect(dispatchedRequests[0]).toEqual({
      operationName: 'CreateRuntimeItem',
      authorization: accountBAccess,
      variables: { name: 'belongs-to-account-b' },
    })

    // 6. Ordinary same-account token rotation dispatches cleanly with no duplicate requests.
    token = accountBRotated
    const rotatedQuery = await runtime.executeQuery({
      document: VALUE_QUERY,
      variables: { id: 'after-rotation' },
      fetchPolicy: 'network-only',
    })
    expect(rotatedQuery.data.runtimeValue).toBe('ok:after-rotation')
    expect(dispatchedRequests).toHaveLength(2)
    expect(dispatchedRequests[1]).toEqual({
      operationName: 'RefreshRuntimeValue',
      authorization: accountBRotated,
      variables: { id: 'after-rotation' },
    })

    runtime.stop()
  })
})
