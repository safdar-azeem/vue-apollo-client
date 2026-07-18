// @vitest-environment node
import { gql } from '@apollo/client/core/index.js'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createApollo } from './createApollo'
import { useQuery } from './composables/useQuery'
import { SSR_HYDRATION_HOST, type SsrHydrationHost } from './ssrHydration'

const STORE_QUERY = gql`query SsrHostStore { store { name } }`

const response = (name: string) =>
  new Response(JSON.stringify({ data: { store: { name, __typename: 'Store' } } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

/** A minimal, Apollo-agnostic stand-in for an SSR host such as vue-ssr-lite. */
const createFakeHost = (
  server: boolean,
  restored: Record<string, unknown> | null = null
) => {
  const contributions = new Map<string, () => unknown>()
  const disposers: Array<() => void> = []
  const host: SsrHydrationHost = {
    server,
    read: (key) => (restored ? (restored[key] as any) : undefined),
    contribute: (key, dehydrate) => contributions.set(key, dehydrate),
    onDispose: (dispose) => disposers.push(dispose),
  }
  return {
    host,
    collect: () => {
      const out: Record<string, unknown> = {}
      for (const [key, fn] of contributions) out[key] = fn()
      return out
    },
    dispose: () => disposers.forEach((d) => d()),
    disposerCount: () => disposers.length,
  }
}

const Store = defineComponent({
  setup() {
    const { result } = useQuery<{ store: { name: string } }>(STORE_QUERY)
    return () => h('main', result.value?.store?.name || 'Loading storefront…')
  },
})

describe('createApollo generic SSR host integration (server)', () => {
  it('contributes its extracted cache to the host after a server render', async () => {
    let fetchCount = 0
    const apollo = createApollo(
      { endPoints: { default: 'https://graphql.test/query' } },
      { server: true, fetch: async () => { fetchCount += 1; return response('Aperture Store') } }
    )
    const controller = createFakeHost(true)

    const app = createSSRApp(Store)
    app.provide(SSR_HYDRATION_HOST, controller.host)
    app.use(apollo)
    const html = await renderToString(app)

    // Native onServerPrefetch resolved the query before the HTML completed.
    expect(html).toContain('Aperture Store')
    expect(html).not.toContain('Loading storefront…')
    expect(fetchCount).toBe(1)

    // The extracted request-scoped cache was contributed under the default key.
    const state = controller.collect()
    expect(JSON.stringify(state.apollo)).toContain('Aperture Store')
    // And a teardown was registered with the host.
    expect(controller.disposerCount()).toBe(1)
    controller.dispose()
  })

  it('uses a custom hydrationKey so multiple runtimes never collide', async () => {
    const apollo = createApollo(
      { endPoints: { default: 'https://graphql.test/query' } },
      {
        server: true,
        hydrationKey: 'storefront',
        fetch: async () => response('Keyed Store'),
      }
    )
    const controller = createFakeHost(true)
    const app = createSSRApp(Store)
    app.provide(SSR_HYDRATION_HOST, controller.host)
    app.use(apollo)
    await renderToString(app)

    const state = controller.collect()
    expect(state.storefront).toBeDefined()
    expect(state.apollo).toBeUndefined()
    controller.dispose()
  })
})
