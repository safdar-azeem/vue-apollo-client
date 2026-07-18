import { useLazyQuery as apolloUseLazyQuery, UseQueryReturn } from '@vue/apollo-composable'
import { UseQueryOptions } from './useQuery'
import { ref, Ref, unref } from 'vue'
import type { OperationVariables } from '@apollo/client/core/index.js'
import { unwrapVariables } from '../utils/common'
import { prepareApolloComposable, useApolloRuntime } from '../createApollo'
import { resolveApolloServerResolution } from '../ApolloSsrRuntime'

export interface UseLazyQueryReturn<
  TResult,
  TVariables extends OperationVariables,
> extends UseQueryReturn<TResult, TVariables> {
  load: (
    document?: any,
    variables?: TVariables,
    options?: UseQueryOptions<TResult, TVariables>
  ) => Promise<any>
  start: (variables?: TVariables) => Promise<any>
}

/**
 * Deferred query with the same three-mode SSR contract as {@link useQuery}:
 *
 *  - Server: does not auto-fetch. When `load()` / `start()` runs during the
 *    server render it executes against the request-scoped client, registers the
 *    operation with the SSR resolution contract so the renderer awaits it, and
 *    writes to the request cache so the browser restores it.
 *  - Hydration: defaults to `cache-first` so data already in the restored cache
 *    is served without a duplicate network request.
 *  - SPA: `cache-and-network`, the familiar deferred-query behaviour.
 */
export const useLazyQuery = <
  TResult = any,
  TVariables extends OperationVariables = OperationVariables,
>(
  document: any,
  variables?: TVariables | (() => TVariables) | Ref<TVariables>,
  options?:
    | UseQueryOptions<TResult, TVariables>
    | Ref<UseQueryOptions<TResult, TVariables>>
    | (() => UseQueryOptions<TResult, TVariables>)
): UseLazyQueryReturn<TResult, TVariables> => {
  prepareApolloComposable()
  let owningRuntime: ReturnType<typeof useApolloRuntime> | null = null
  try {
    owningRuntime = useApolloRuntime()
  } catch {
    // Compatibility: consumers may provide only @vue/apollo-composable clients.
  }
  const server = owningRuntime?.server ?? typeof window === 'undefined'
  const serverResolution = server ? resolveApolloServerResolution() : null

  const resolveOptions = (): UseQueryOptions<TResult, TVariables> =>
    (typeof options === 'function' ? options() : unref(options)) || {}
  const resolveDocument = () =>
    typeof document === 'function' ? document() : unref(document)
  const resolveVariables = (override?: TVariables) =>
    unwrapVariables(
      override ?? (typeof variables === 'function' ? variables() : unref(variables))
    )

  // Hydration serves from the restored cache; a fresh SPA keeps the deferred
  // cache-and-network default.
  const defaultFetchPolicy = owningRuntime?.hydrated
    ? 'cache-first'
    : 'cache-and-network'

  const lazyQuery = apolloUseLazyQuery(document, variables, () => {
    const opt = resolveOptions()
    return {
      fetchPolicy: defaultFetchPolicy,
      ...(opt as any),
    }
  }) as any

  const loadingState = ref(false)

  const runServerLoad = async (override?: TVariables) => {
    const opt = resolveOptions()
    const clientId = opt.clientId || 'default'
    const client = owningRuntime?.clients[clientId]
    if (!client) throw new Error(`Apollo client "${clientId}" is not installed.`)
    loadingState.value = true
    const work = client.query<TResult, TVariables>({
      query: resolveDocument(),
      variables: resolveVariables(override) as TVariables,
      fetchPolicy: opt.fetchPolicy === 'no-cache' ? 'no-cache' : 'cache-first',
      errorPolicy: opt.errorPolicy,
      context: opt.context,
    })
    serverResolution?.track(work)
    try {
      const result = await work
      lazyQuery.result.value = result.data
      return result
    } finally {
      loadingState.value = false
    }
  }

  async function fetchOrRefetch(newVariables?: TVariables) {
    if (server) return runServerLoad(newVariables)

    loadingState.value = lazyQuery.result?.value ? false : true
    try {
      if (!lazyQuery.result?.value) {
        // @ts-ignore — @vue/apollo-composable load signature
        await lazyQuery?.load(document, newVariables, options)
        return lazyQuery.refetch(resolveVariables(newVariables))
      }
      return lazyQuery.refetch(resolveVariables(newVariables))
    } finally {
      loadingState.value = false
    }
  }

  return {
    ...lazyQuery,
    start: fetchOrRefetch,
    load: fetchOrRefetch,
    refetch: fetchOrRefetch,
    loading: loadingState,
  }
}
