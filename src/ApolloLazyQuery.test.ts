// @vitest-environment jsdom
import { gql } from '@apollo/client/core/index.js'
import { createApp, defineComponent } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { createApollo, SSR_HYDRATION_HOST, type SsrHydrationHost, useLazyQuery } from './index'

const LIST_QUERY = gql`query LazyList { resumes { title } }`
const config = { endPoints: { default: 'https://graphql.test/query' } }

const response = (title: string) =>
  new Response(JSON.stringify({ data: { resumes: [{ title, __typename: 'Resume' }] } }), {
    headers: { 'content-type': 'application/json' },
  })

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

type RestoredCache = ReturnType<ReturnType<typeof createApollo>['extract']>

function mountQuery(fetch: typeof globalThis.fetch, restored?: RestoredCache) {
  const runtime = createApollo(config, { server: false, registerGlobal: false, fetch })
  let query!: ReturnType<typeof useLazyQuery>
  const app = createApp(defineComponent({
    setup() {
      query = useLazyQuery(LIST_QUERY, undefined, restored ? undefined : { fetchPolicy: 'network-only' })
      return () => null
    },
  }))
  if (restored) {
    const host: SsrHydrationHost = {
      server: false,
      read: <T>(key: string) => (key === 'apollo' ? restored as T : undefined),
      contribute: () => {},
      onDispose: () => {},
    }
    app.provide(SSR_HYDRATION_HOST, host)
  }
  app.use(runtime)
  app.mount(document.createElement('div'))
  cleanup = () => {
    app.unmount()
    runtime.stop()
  }
  return query
}

it('loads once, then makes one fresh request for explicit refetch', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(response('First'))
    .mockImplementation(async () => response('Fresh'))
  const query = mountQuery(fetch)
  expect(fetch).not.toHaveBeenCalled()

  const loading = query.load()
  expect(query.loading.value).toBe(true)
  expect(await loading).toMatchObject({ data: { resumes: [{ title: 'First' }] }, loading: false })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(query.loading.value).toBe(false)

  expect(await query.refetch()).toMatchObject({ data: { resumes: [{ title: 'Fresh' }] } })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('rejects a failed initial load and can recover with one explicit refetch', async () => {
  const fetch = vi.fn()
    .mockRejectedValueOnce(new Error('Network unavailable'))
    .mockImplementation(async () => response('Recovered'))
  const query = mountQuery(fetch)

  await expect(query.start()).rejects.toThrow('Network unavailable')
  expect(query.error.value?.message).toContain('Network unavailable')
  expect(query.loading.value).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)

  expect(await query.refetch()).toMatchObject({ data: { resumes: [{ title: 'Recovered' }] } })
  expect(fetch).toHaveBeenCalledTimes(2)
})

async function seedCache() {
  const server = createApollo(config, { server: true, fetch: async () => response('Restored') })
  try {
    await server.executeQuery({ document: LIST_QUERY })
    return server.extract()
  } finally {
    server.stop()
  }
}

it('loads the hydrated cache without a request and still allows a network refetch', async () => {
  const restored = await seedCache()
  const fetch = vi.fn(async () => response('Fresh'))
  const query = mountQuery(fetch, restored)

  expect(await query.load()).toMatchObject({ data: { resumes: [{ title: 'Restored' }] } })
  expect(fetch).not.toHaveBeenCalled()
  expect(await query.refetch()).toMatchObject({ data: { resumes: [{ title: 'Fresh' }] } })
  expect(fetch).toHaveBeenCalledTimes(1)
})


it('makes one network request when refetch is the first action after hydration', async () => {
  const fetch = vi.fn(async () => response('Fresh'))
  const query = mountQuery(fetch, await seedCache())

  expect(await query.refetch()).toMatchObject({ data: { resumes: [{ title: 'Fresh' }] } })
  expect(fetch).toHaveBeenCalledTimes(1)
})
