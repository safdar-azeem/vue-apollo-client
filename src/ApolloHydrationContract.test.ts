// @vitest-environment jsdom
import { gql } from '@apollo/client/core/index.js'
import { renderToString } from '@vue/server-renderer'
import { createApp, createSSRApp, defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { createApollo } from './createApollo'
import { useQuery } from './composables/useQuery'
import { SSR_HYDRATION_HOST, type SsrHydrationHost } from './ssrHydration'

const STORE_QUERY = gql`query HydrateContractStore { store { name } }`

const response = (name: string) =>
  new Response(
    JSON.stringify({ data: { store: { name, __typename: 'Store' } } }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )

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
    return () => h('main', result.value?.store?.name || 'Loading…')
  },
})

const seedCache = async () => {
  const seed = createApollo(
    { endPoints: { default: 'https://graphql.test/query' } },
    { server: true, fetch: async () => response('Seeded Store') }
  )
  await seed.executeQuery({ document: STORE_QUERY, fetchPolicy: 'network-only' })
  const state = seed.extract()
  seed.stop()
  return state
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('single hydration restore path (SSOT)', () => {
  it('initialState restores at construction, sets hydrated, and issues no duplicate request', async () => {
    const state = await seedCache()
    let fetches = 0
    const browser = createApollo(
      { endPoints: { default: 'https://graphql.test/query' } },
      {
        server: false,
        registerGlobal: false,
        initialState: state,
        fetch: async () => {
          fetches += 1
          return response('Network Store')
        },
      }
    )
    expect(browser.hydrated).toBe(true)

    const element = document.createElement('div')
    document.body.append(element)
    const app = createApp(Store)
    app.provide(SSR_HYDRATION_HOST, createFakeHost(false, { apollo: state }))
    app.use(browser)
    app.mount(element)

    // Served from the construction-time restore; the host branch did not restore
    // a second time and no network request ran.
    expect(element.textContent).toBe('Seeded Store')
    expect(fetches).toBe(0)
    app.unmount()
    browser.stop()
  })

  it('marks the runtime hydrated on the legacy host-only restore (coherent flag)', async () => {
    const state = await seedCache()
    let fetches = 0
    const browser = createApollo(
      { endPoints: { default: 'https://graphql.test/query' } },
      {
        server: false,
        registerGlobal: false,
        // No initialState: the host fallback path performs the single restore.
        fetch: async () => {
          fetches += 1
          return response('Network Store')
        },
      }
    )
    expect(browser.hydrated).toBe(false)

    const element = document.createElement('div')
    document.body.append(element)
    const app = createApp(Store)
    app.provide(SSR_HYDRATION_HOST, createFakeHost(false, { apollo: state }))
    app.use(browser)
    app.mount(element)

    expect(browser.hydrated).toBe(true)
    expect(element.textContent).toBe('Seeded Store')
    expect(fetches).toBe(0)
    app.unmount()
    browser.stop()
  })
})

describe('per-request isolation under concurrency (server)', () => {
  it('never bleeds cache or data across concurrent server renders', async () => {
    const renderFor = async (name: string) => {
      const runtime = createApollo(
        { endPoints: { default: 'https://graphql.test/query' } },
        {
          server: true,
          fetch: async () => {
            // Interleave to force concurrency.
            await new Promise((r) => setTimeout(r, 5))
            return response(name)
          },
        }
      )
      const app = createSSRApp(Store)
      app.use(runtime)
      const html = await renderToString(app)
      const extracted = JSON.stringify(runtime.extract())
      runtime.stop()
      return { html, extracted }
    }

    const [left, right] = await Promise.all([
      renderFor('Left Store'),
      renderFor('Right Store'),
    ])

    expect(left.html).toContain('Left Store')
    expect(left.html).not.toContain('Right Store')
    expect(right.html).toContain('Right Store')
    expect(right.html).not.toContain('Left Store')
    expect(left.extracted).not.toContain('Right Store')
    expect(right.extracted).not.toContain('Left Store')
  })
})
