// @vitest-environment jsdom
import { gql } from '@apollo/client/core/index.js'
import { computed, createApp, defineComponent, h, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createApollo } from './createApollo'
import { useQuery } from './composables/useQuery'

const VALUE_QUERY = gql`
  query BrowserRuntimeValue($scope: String) { runtimeValue(scope: $scope) }
`
const ME_QUERY = gql`
  query BrowserRuntimeMe { me { id } }
`

const response = (runtimeValue: string) =>
  new Response(JSON.stringify({ data: { runtimeValue } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const jwtFor = (sub: string) => {
  const header = btoa(JSON.stringify({ alg: 'none' }))
  const payload = btoa(JSON.stringify({ sub }))
  return `${header}.${payload}.sig`
}

describe('browser Apollo runtime', () => {
  it('restores generated-style query state before render without a duplicate request', async () => {
    const server = createApollo(
      { endPoints: { default: 'https://graphql.test/query' } },
      { server: true, fetch: async () => response('hydrated') }
    )
    await server.executeQuery({
      document: VALUE_QUERY,
      variables: { scope: 'initial' },
      fetchPolicy: 'network-only',
    })
    const initialState = server.extract()
    server.stop()

    let fetchCount = 0
    const browser = createApollo(
      { endPoints: { default: 'https://graphql.test/query' } },
      {
        server: false,
        registerGlobal: false,
        initialState,
        fetch: async () => {
          fetchCount += 1
          return response('network')
        },
      }
    )
    const Root = defineComponent({
      setup() {
        const query = useQuery<{ runtimeValue: string }>(
          VALUE_QUERY,
          { scope: 'initial' },
          { fetchPolicy: 'cache-first' }
        )
        return () => h('main', query.result.value?.runtimeValue || 'pending')
      },
    })
    const element = document.createElement('div')
    document.body.append(element)
    const app = createApp(Root)
    app.use(browser)
    app.mount(element)

    await vi.waitFor(() => expect(element.textContent).toBe('hydrated'))
    expect(fetchCount).toBe(0)
    app.unmount()
    browser.stop()
  })

  it('follows reactive generated variables through the public query API', async () => {
    const requests: string[] = []
    const runtime = createApollo(
      { endPoints: { default: 'https://graphql.test/query' } },
      {
        server: false,
        registerGlobal: false,
        fetch: async (_input, init) => {
          const body = JSON.parse(String(init?.body || '{}'))
          const scope = String(body.variables?.scope || '')
          requests.push(scope)
          return response(scope)
        },
      }
    )
    const scope = ref('left')
    const Root = defineComponent({
      setup() {
        const query = useQuery<{ runtimeValue: string }>(
          VALUE_QUERY,
          computed(() => ({ scope: scope.value })),
          { fetchPolicy: 'network-only' }
        )
        return () => h('main', query.result.value?.runtimeValue || 'pending')
      },
    })
    const element = document.createElement('div')
    document.body.append(element)
    const app = createApp(Root)
    app.use(runtime)
    app.mount(element)

    await vi.waitFor(() => expect(element.textContent).toBe('left'))
    scope.value = 'right'
    await vi.waitFor(() => expect(element.textContent).toBe('right'))
    expect(requests).toEqual(['left', 'right'])
    app.unmount()
    runtime.stop()
  })

  it('does not abort the first authenticated query after signed-out → signed-in', async () => {
    // Mirrors post-login verify(): token appears, then the first authed `me`
    // request must complete. clearStore()-based session isolation used to cancel
    // that in-flight op (Apollo #42) and leave the router guard stuck on /auth.
    let session: string | null = null
    const runtime = createApollo(
      {
        endPoints: { default: 'https://graphql.test/query' },
        getSessionId: () => session,
      },
      {
        server: false,
        registerGlobal: false,
        fetch: async () =>
          new Response(JSON.stringify({ data: { me: { id: 'user-1' } } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      }
    )

    session = jwtFor('user-1')
    const result = await runtime.executeQuery<{ me: { id: string } }>({
      document: ME_QUERY,
      fetchPolicy: 'network-only',
    })

    expect(result.data.me.id).toBe('user-1')
    runtime.stop()
  })

  it('isolates generated query state across multiple Vue applications', async () => {
    const mountRuntime = (value: string) => {
      const runtime = createApollo(
        { endPoints: { default: `https://${value}.test/graphql` } },
        {
          server: false,
          registerGlobal: false,
          fetch: async () => response(value),
        }
      )
      const Root = defineComponent({
        setup() {
          const query = useQuery<{ runtimeValue: string }>(VALUE_QUERY)
          return () => h('main', query.result.value?.runtimeValue || 'pending')
        },
      })
      const element = document.createElement('div')
      document.body.append(element)
      const app = createApp(Root)
      app.use(runtime)
      app.mount(element)
      return { app, element, runtime }
    }

    const left = mountRuntime('left-app')
    const right = mountRuntime('right-app')
    await vi.waitFor(() => {
      expect(left.element.textContent).toBe('left-app')
      expect(right.element.textContent).toBe('right-app')
    })
    expect(left.runtime.extract()).not.toEqual(right.runtime.extract())
    left.app.unmount()
    right.app.unmount()
    left.runtime.stop()
    right.runtime.stop()
  })
})
