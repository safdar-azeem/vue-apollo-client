// @vitest-environment jsdom
import { gql } from '@apollo/client/core/index.js'
import { renderToString } from '@vue/server-renderer'
import { computed, createApp, createSSRApp, defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApollo } from './createApollo'
import { useQuery } from './composables/useQuery'

/**
 * The core state-lifecycle contract: a query result is "not found" ONLY after
 * the query has COMPLETED for the CURRENT variables and returned a confirmed
 * missing entity. `undefined`, loading, a pending variable change, stale
 * previous-variable data, and a hydration cache miss must never be reported as a
 * confirmed 404.
 */

const STORE_QUERY = gql`
  query LifecycleStore($domain: String!) {
    getEcommerceStore(domain: $domain) {
      id
      name
    }
  }
`

const storeResponse = (domain: string, name: string | null) =>
  new Response(
    JSON.stringify({
      data: {
        getEcommerceStore:
          name === null
            ? null
            : { __typename: 'EcommerceStore', id: `store-${domain}`, name },
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )

/** Root-owned store query + the exact ERP "store not found" derivation. */
const StoreProbe = (domain: () => string) =>
  defineComponent({
    setup() {
      const { result, loading, error } = useQuery<{
        getEcommerceStore: { id: string; name: string } | null
      }>(STORE_QUERY, () => ({ domain: domain() }), { ssr: true, fetchPolicy: 'cache-first' })

      // Mirrors useCurrentStorefront.storefrontError.
      const notFound = computed(
        () =>
          !loading.value &&
          Boolean(result.value) &&
          !result.value?.getEcommerceStore
      )
      return () =>
        h(
          'main',
          error.value
            ? 'ERROR'
            : notFound.value
              ? 'Store not found'
              : (result.value?.getEcommerceStore?.name ?? 'Loading storefront…')
        )
    },
  })

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  document.body.innerHTML = ''
})

describe('SSR query lifecycle', () => {
  it('renders real store data — never "Store not found" or "Loading" — for a valid store', async () => {
    let fetches = 0
    const runtime = createApollo(
      { endPoints: { default: 'http://mock.test/graphql' } },
      {
        server: true,
        fetch: async () => {
          fetches += 1
          return storeResponse('valid', 'Aperture Store')
        },
      }
    )
    const app = createSSRApp(StoreProbe(() => 'valid'))
    app.use(runtime)
    const html = await renderToString(app)

    expect(html).toContain('Aperture Store')
    expect(html).not.toContain('Store not found')
    expect(html).not.toContain('Loading storefront…')
    expect(fetches).toBe(1)
    runtime.stop()
  })

  it('renders a confirmed 404 only after the query settles with a null entity', async () => {
    const runtime = createApollo(
      { endPoints: { default: 'http://mock.test/graphql' } },
      { server: true, fetch: async () => storeResponse('ghost', null) }
    )
    const app = createSSRApp(StoreProbe(() => 'ghost'))
    app.use(runtime)
    const html = await renderToString(app)

    expect(html).toContain('Store not found')
    expect(html).not.toContain('Loading storefront…')
    runtime.stop()
  })
})

describe('hydration query lifecycle', () => {
  it('shows the store synchronously from the restored cache with no duplicate request and no not-found flash', async () => {
    const seed = createApollo(
      { endPoints: { default: 'http://mock.test/graphql' } },
      { server: true, fetch: async () => storeResponse('valid', 'Aperture Store') }
    )
    await seed.executeQuery({
      document: STORE_QUERY,
      variables: { domain: 'valid' },
      fetchPolicy: 'network-only',
    })
    const state = seed.extract()
    seed.stop()

    let fetches = 0
    const browser = createApollo(
      { endPoints: { default: 'http://mock.test/graphql' } },
      {
        server: false,
        registerGlobal: false,
        initialState: state,
        fetch: async () => {
          fetches += 1
          return storeResponse('valid', 'Network Store')
        },
      }
    )
    const element = document.createElement('div')
    document.body.append(element)
    const app = createApp(StoreProbe(() => 'valid'))
    app.use(browser)
    app.mount(element)

    expect(element.textContent).toBe('Aperture Store')
    expect(element.textContent).not.toContain('Store not found')
    expect(fetches).toBe(0)
    app.unmount()
    browser.stop()
  })
})

describe('SPA navigation query lifecycle', () => {
  it('keeps loading (never a false not-found, never stale) across a reactive variable change', async () => {
    const deferred = new Map<string, (value: Response) => void>()
    let fetchCount = 0
    const runtime = createApollo(
      { endPoints: { default: 'http://mock.test/graphql' } },
      {
        server: false,
        registerGlobal: false,
        fetch: (async (_input: any, init: any) => {
          fetchCount += 1
          const body = JSON.parse(String(init?.body ?? '{}'))
          const domain = String(body.variables?.domain ?? '')
          return new Promise<Response>((resolve) => deferred.set(domain, resolve))
        }) as typeof fetch,
      }
    )

    const domain = ref('first')
    const element = document.createElement('div')
    document.body.append(element)
    const app = createApp(StoreProbe(() => domain.value))
    app.use(runtime)
    app.mount(element)

    // Pending for the first product: loading, never a false not-found.
    expect(element.textContent).toBe('Loading storefront…')
    expect(element.textContent).not.toContain('Store not found')

    // The query subscribes and fires its request asynchronously; wait for it,
    // then resolve. Throughout, the view stays "loading" — not "not found".
    await vi.waitFor(() => expect(deferred.has('first')).toBe(true))
    expect(element.textContent).toBe('Loading storefront…')
    deferred.get('first')!(storeResponse('first', 'First Store'))
    await vi.waitFor(() => expect(element.textContent).toBe('First Store'))

    // Navigate to a new product: the new query runs; the old data must not
    // linger and a false not-found must not appear while the new query is
    // pending.
    domain.value = 'second'
    await vi.waitFor(() => expect(deferred.has('second')).toBe(true))
    expect(element.textContent).not.toBe('First Store')
    expect(element.textContent).not.toContain('Store not found')
    expect(element.textContent).toBe('Loading storefront…')

    deferred.get('second')!(storeResponse('second', 'Second Store'))
    await vi.waitFor(() => expect(element.textContent).toBe('Second Store'))

    // Exactly one network request per distinct set of variables.
    expect(fetchCount).toBe(2)
    app.unmount()
    runtime.stop()
  })

  it('keeps a transport error distinct from a confirmed not-found', async () => {
    const runtime = createApollo(
      { endPoints: { default: 'http://mock.test/graphql' } },
      {
        server: false,
        registerGlobal: false,
        fetch: (async () => {
          throw new Error('Failed to fetch')
        }) as typeof fetch,
      }
    )
    const element = document.createElement('div')
    document.body.append(element)
    const app = createApp(
      defineComponent({
        setup() {
          const { result, loading, error } = useQuery<{
            getEcommerceStore: { id: string; name: string } | null
          }>(STORE_QUERY, () => ({ domain: 'x' }), {
            fetchPolicy: 'network-only',
            errorPolicy: 'none',
          })
          const notFound = computed(
            () =>
              !loading.value &&
              Boolean(result.value) &&
              !result.value?.getEcommerceStore
          )
          return () =>
            h(
              'main',
              error.value
                ? 'ERROR'
                : notFound.value
                  ? 'Store not found'
                  : (result.value?.getEcommerceStore?.name ?? 'Loading storefront…')
            )
        },
      })
    )
    app.use(runtime)
    app.mount(element)

    await vi.waitFor(() => expect(element.textContent).toBe('ERROR'))
    expect(element.textContent).not.toContain('Store not found')
    app.unmount()
    runtime.stop()
  })

  it('reports a confirmed not-found only once the current-variable query completes', async () => {
    let resolveFetch: ((value: Response) => void) | null = null
    const runtime = createApollo(
      { endPoints: { default: 'http://mock.test/graphql' } },
      {
        server: false,
        registerGlobal: false,
        fetch: (async () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve
          })) as typeof fetch,
      }
    )
    const element = document.createElement('div')
    document.body.append(element)
    const app = createApp(StoreProbe(() => 'ghost'))
    app.use(runtime)
    app.mount(element)

    // While pending, it is loading — not "Store not found".
    expect(element.textContent).toBe('Loading storefront…')
    // Wait for the async request to fire, then complete it with a null entity.
    await vi.waitFor(() => expect(resolveFetch).not.toBeNull())
    expect(element.textContent).toBe('Loading storefront…')
    resolveFetch!(storeResponse('ghost', null))
    await vi.waitFor(() => expect(element.textContent).toBe('Store not found'))
    app.unmount()
    runtime.stop()
  })
})
