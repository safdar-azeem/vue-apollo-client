import { gql } from '@apollo/client/core/index.js'
import { describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { createApollo } from './createApollo'
import { useMutation } from './composables/useMutation'

const VALUE_QUERY = gql`
  query RefreshRuntimeValue($id: ID!) { runtimeValue(id: $id) }
`
const REFRESH_MUTATION = gql`
  mutation RefreshRuntimeToken($refreshToken: String!) {
    refreshTokens(refreshToken: $refreshToken) { token refreshToken }
  }
`

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
})
