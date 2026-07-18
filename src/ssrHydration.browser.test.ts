// @vitest-environment jsdom
import { gql } from '@apollo/client/core/index.js'
import { renderToString } from '@vue/server-renderer'
import { createApp, createSSRApp, defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApollo } from './createApollo'
import { useQuery } from './composables/useQuery'
import { SSR_HYDRATION_HOST, type SsrHydrationHost } from './ssrHydration'

const STORE_QUERY = gql`query SsrHostStoreBrowser { store { name } }`

const response = (name: string) =>
  new Response(JSON.stringify({ data: { store: { name, __typename: 'Store' } } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const createFakeHost = (
  server: boolean,
  restored: Record<string, unknown> | null = null
): SsrHydrationHost => ({
  server,
  read: (key) => (restored ? (restored[key] as any) : undefined),
  contribute: () => {},
  onDispose: () => {},
})

const Store = defineComponent({
  setup() {
    const { result } = useQuery<{ store: { name: string } }>(STORE_QUERY, undefined, {
      fetchPolicy: 'cache-first',
    })
    return () => h('main', result.value?.store?.name || 'Loading storefront…')
  },
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('createApollo generic SSR host integration (browser)', () => {
  it('honors an explicit server runtime even when a browser global exists', async () => {
    const runtime = createApollo(
      { endPoints: { default: 'https://graphql.test/query' } },
      { server: true, fetch: async () => response('Explicit Server') }
    )
    const app = createSSRApp(Store)
    app.use(runtime)

    expect(await renderToString(app)).toContain('Explicit Server')
    expect(JSON.stringify(runtime.extract())).toContain('Explicit Server')
    runtime.stop()
  })

  it('restores the host cache before the first query — no duplicate request', async () => {
    // A server runtime produces the serialized cache the host will carry.
    const seed = createApollo(
      { endPoints: { default: 'https://graphql.test/query' } },
      { server: true, fetch: async () => response('Aperture Store') }
    )
    await seed.executeQuery({ document: STORE_QUERY, fetchPolicy: 'network-only' })
    const hydrationState = { apollo: seed.extract() }
    seed.stop()

    let browserFetches = 0
    const browser = createApollo(
      { endPoints: { default: 'https://graphql.test/query' } },
      {
        server: false,
        registerGlobal: false,
        fetch: async () => { browserFetches += 1; return response('Network Store') },
      }
    )
    const element = document.createElement('div')
    document.body.append(element)
    const app = createApp(Store)
    app.provide(SSR_HYDRATION_HOST, createFakeHost(false, hydrationState))
    app.use(browser)
    app.mount(element)

    expect(element.textContent).toBe('Aperture Store')
    expect(browserFetches).toBe(0)
    app.unmount()
    browser.stop()
  })

  it('behaves as a plain SPA when no SSR host is installed', async () => {
    let fetchCount = 0
    const spa = createApollo(
      { endPoints: { default: 'https://graphql.test/query' } },
      {
        server: false,
        registerGlobal: false,
        fetch: async () => { fetchCount += 1; return response('SPA Store') },
      }
    )
    const element = document.createElement('div')
    document.body.append(element)
    const app = createApp(Store)
    app.use(spa) // no host provided
    app.mount(element)

    await vi.waitFor(() => expect(element.textContent).toBe('SPA Store'))
    expect(fetchCount).toBe(1)
    app.unmount()
    spa.stop()
  })
})
