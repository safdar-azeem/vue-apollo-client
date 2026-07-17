import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { gql } from '@apollo/client/core/index.js'
import { createApollo } from './createApollo'
import { useQuery } from './composables/useQuery'

const VALUE_QUERY = gql`
  query RuntimeValue {
    runtimeValue
  }
`

const response = (runtimeValue: string) =>
  new Response(JSON.stringify({ data: { runtimeValue } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const renderRequest = async (requestValue: string) => {
  const seenHeaders: Array<Record<string, string>> = []
  const runtimeFetch: typeof fetch = async (_input, init) => {
    seenHeaders.push(Object.fromEntries(new Headers(init?.headers).entries()))
    await Promise.resolve()
    return response(requestValue)
  }
  const apollo = createApollo(
    { endPoints: { default: 'http://graphql.test/query' } },
    {
      server: true,
      headers: { 'x-request-value': requestValue },
      fetch: runtimeFetch,
    }
  )
  const Root = defineComponent({
    setup() {
      const { result } = useQuery<{ runtimeValue: string }>(VALUE_QUERY)
      return () => h('span', result.value?.runtimeValue || 'pending')
    },
  })
  const app = createSSRApp(Root)
  app.use(apollo)
  const html = await renderToString(app)
  const state = apollo.extract()
  apollo.stop()
  return { html, seenHeaders, state }
}

describe('request-scoped Apollo runtime', () => {
  it('isolates concurrent clients, headers, query data, and caches', async () => {
    const [left, right] = await Promise.all([
      renderRequest('left-request'),
      renderRequest('right-request'),
    ])

    expect(left.html).toContain('left-request')
    expect(right.html).toContain('right-request')
    expect(left.html).not.toContain('right-request')
    expect(right.html).not.toContain('left-request')
    expect(left.seenHeaders[0]?.['x-request-value']).toBe('left-request')
    expect(right.seenHeaders[0]?.['x-request-value']).toBe('right-request')
    expect(left.seenHeaders[0]?.authorization).toBeUndefined()
    expect(right.seenHeaders[0]?.authorization).toBeUndefined()
    expect(JSON.stringify(left.state)).not.toContain('right-request')
    expect(JSON.stringify(right.state)).not.toContain('left-request')
  })

  it('restores named caches before the first browser query', async () => {
    const serverRuntime = await renderRequest('hydrated-value')
    let fetchCount = 0
    const browserApollo = createApollo(
      {
        endPoints: {
          default: 'http://graphql.test/default',
          reporting: 'http://graphql.test/reporting',
        },
      },
      {
        server: false,
        registerGlobal: false,
        initialState: serverRuntime.state,
        fetch: async () => {
          fetchCount += 1
          return response('network-value')
        },
      }
    )

    const result = await browserApollo.clients.default.query({
      query: VALUE_QUERY,
      fetchPolicy: 'cache-first',
    })
    expect(result.data.runtimeValue).toBe('hydrated-value')
    expect(fetchCount).toBe(0)
    expect(browserApollo.clients.reporting).toBeDefined()
    browserApollo.stop()
  })

  it('applies consumer-owned browser authentication without server token lookup', async () => {
    const seenHeaders: Array<Record<string, string>> = []
    const browserApollo = createApollo(
      {
        endPoints: { default: 'http://graphql.test/default' },
        getToken: () => 'customer-token',
        formatToken: (token) => `Bearer ${token}`,
      },
      {
        server: false,
        registerGlobal: false,
        fetch: async (_input, init) => {
          seenHeaders.push(
            Object.fromEntries(new Headers(init?.headers).entries())
          )
          return response('authenticated')
        },
      }
    )

    await browserApollo.clients.default.query({
      query: VALUE_QUERY,
      fetchPolicy: 'network-only',
    })
    expect(seenHeaders[0]?.authorization).toBe('Bearer customer-token')
    browserApollo.stop()
  })

  it('stops every named client owned by the runtime', () => {
    const runtime = createApollo({
      endPoints: {
        default: 'http://graphql.test/default',
        reporting: 'http://graphql.test/reporting',
      },
    }, { server: true })
    const defaultStop = vi.spyOn(runtime.clients.default, 'stop')
    const reportingStop = vi.spyOn(runtime.clients.reporting, 'stop')
    runtime.stop()
    expect(defaultStop).toHaveBeenCalledTimes(1)
    expect(reportingStop).toHaveBeenCalledTimes(1)
  })
})
