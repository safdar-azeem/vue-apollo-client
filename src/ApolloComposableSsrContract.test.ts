// @vitest-environment node
import { gql } from '@apollo/client/core/index.js'
import { createSSRApp, defineComponent, h, onServerPrefetch, ref } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createApollo } from './createApollo'
import { useMutation } from './composables/useMutation'
import { useLazyQuery } from './composables/useLazyQuery'

const STORE_QUERY = gql`query LazyContractStore { store { name } }`
const DO_THING = gql`mutation ContractDoThing { doThing { ok } }`

const jsonResponse = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

describe('mutation SSR contract', () => {
  it('never executes a mutation during the server render', async () => {
    let fetches = 0
    const runtime = createApollo(
      { endPoints: { default: 'https://graphql.test/query' } },
      {
        server: true,
        fetch: async () => {
          fetches += 1
          return jsonResponse({ doThing: { ok: true, __typename: 'Thing' } })
        },
      }
    )
    const Component = defineComponent({
      setup() {
        const { mutate } = useMutation(DO_THING)
        const outcome = ref('unset')
        onServerPrefetch(async () => {
          const result = await mutate()
          outcome.value = result?.data ? 'ran' : 'skipped'
        })
        return () => h('main', outcome.value)
      },
    })
    const app = createSSRApp(Component)
    app.use(runtime)
    const html = await renderToString(app)

    expect(fetches).toBe(0)
    expect(html).toContain('skipped')
    runtime.stop()
  })
})

describe('useLazyQuery SSR contract', () => {
  it('resolves against the request-scoped client when loaded during the server render', async () => {
    let fetches = 0
    const runtime = createApollo(
      { endPoints: { default: 'https://graphql.test/query' } },
      {
        server: true,
        fetch: async () => {
          fetches += 1
          return jsonResponse({ store: { name: 'Lazy Store', __typename: 'Store' } })
        },
      }
    )
    const Component = defineComponent({
      setup() {
        const query = useLazyQuery<{ store: { name: string } }>(STORE_QUERY, undefined, {
          fetchPolicy: 'cache-first',
        })
        const name = ref('idle')
        onServerPrefetch(async () => {
          await query.load()
          name.value = (query.result.value as any)?.store?.name || 'empty'
        })
        return () => h('main', name.value)
      },
    })
    const app = createSSRApp(Component)
    app.use(runtime)
    const html = await renderToString(app)

    expect(html).toContain('Lazy Store')
    expect(fetches).toBe(1)
    // The load wrote to the request cache, so the state can hydrate the browser.
    expect(JSON.stringify(runtime.extract())).toContain('Lazy Store')
    runtime.stop()
  })
})
