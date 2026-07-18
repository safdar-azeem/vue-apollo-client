import { gql } from '@apollo/client/core/index.js'
import { renderToString } from '@vue/server-renderer'
import { createSSRApp, defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { defineApollo } from './ApolloConfiguration'
import { useQuery } from './composables/useQuery'

const REQUEST_CONTEXT = Symbol.for('vue-ssr:request-context')
const HYDRATION_CONTEXT = Symbol.for('vue-ssr:hydration-context')
const VALUE_QUERY = gql`query ManagedValue { managedValue }`

const renderManagedRequest = async (value: string) => {
  const contributors = new Map<string, () => unknown>()
  const disposers: Array<() => void> = []
  const seenHeaders: Record<string, string>[] = []
  const hydration = {
    server: true,
    read: () => undefined,
    contribute: (key: string, dehydrate: () => unknown) =>
      contributors.set(key, dehydrate),
    onDispose: (dispose: () => void) => disposers.push(dispose),
  }
  const configuration = defineApollo<{ environment: string }>(
    ({ applicationId, publicConfig }) => ({
      applicationId,
      endPoints: { default: 'https://graphql.test/query' },
      fetch: async (_input, init) => {
        seenHeaders.push(Object.fromEntries(new Headers(init?.headers).entries()))
        return new Response(JSON.stringify({ data: { managedValue: value } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
      setContext: () => ({ headers: { 'x-public': publicConfig?.environment } }),
    }),
    { applicationId: 'spa-fallback' }
  )
  const Root = defineComponent({
    setup() {
      const query = useQuery<{ managedValue: string }>(VALUE_QUERY, undefined, {
        ssr: true,
      })
      return () => h('main', query.result.value?.managedValue || 'pending')
    },
  })
  const app = createSSRApp(Root)
  app.provide(HYDRATION_CONTEXT, hydration)
  app.provide(REQUEST_CONTEXT, {
    applicationId: `application-${value}`,
    publicConfig: { environment: value },
    request: {
      cookie: `store=${value}`,
      signal: new AbortController().signal,
    },
    hydration,
  })
  app.use(configuration)

  try {
    const html = await renderToString(app)
    return {
      html,
      state: contributors.get('apollo')?.(),
      headers: seenHeaders[0],
    }
  } finally {
    while (disposers.length) disposers.pop()?.()
  }
}

describe('defineApollo', () => {
  it('automatically derives isolated SSR runtimes from generic request context', async () => {
    const [left, right] = await Promise.all([
      renderManagedRequest('left'),
      renderManagedRequest('right'),
    ])

    expect(left.html).toContain('left')
    expect(right.html).toContain('right')
    expect(left.html).not.toContain('right')
    expect(right.html).not.toContain('left')
    expect(left.headers?.cookie).toBe('store=left')
    expect(right.headers?.cookie).toBe('store=right')
    expect(left.headers?.['x-public']).toBe('left')
    expect(right.headers?.['x-public']).toBe('right')
    expect(JSON.stringify(left.state)).not.toContain('right')
    expect(JSON.stringify(right.state)).not.toContain('left')
  })
})
