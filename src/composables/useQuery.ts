import {
  useQuery as apolloUseQuery,
  type UseQueryOptions as ApolloUseQueryOptions,
  type UseQueryReturn,
} from '@vue/apollo-composable'
import { getCurrentInstance, onServerPrefetch, unref, type Ref } from 'vue'
import type {
  OperationVariables,
  WatchQueryFetchPolicy,
} from '@apollo/client/core/index.js'
import { prepareApolloComposable, useApolloRuntime } from '../createApollo'
import { resolveApolloServerResolution } from '../ApolloSsrRuntime'

export type { UseQueryReturn } from '@vue/apollo-composable'

export interface UseQueryOptions<
  TData = any,
  TVariables extends OperationVariables = OperationVariables,
> extends Omit<ApolloUseQueryOptions<TData, TVariables>, 'nextFetchPolicy'> {
  ssr?: boolean
  /** @deprecated Reactive variables and Apollo cache policies own refetching. */
  refetchOnUpdate?: boolean
  /** @deprecated Use Apollo fetch policies or explicit `refetch()`. */
  refetchTimeout?: number
  nextFetchPolicy?:
    | WatchQueryFetchPolicy
    | string
    | ApolloUseQueryOptions<TData, TVariables>['nextFetchPolicy']
}

export const useQuery = <
  TResult = any,
  TVariables extends OperationVariables = OperationVariables,
>(
  document: any,
  variables?: TVariables | (() => TVariables) | Ref<TVariables>,
  options?:
    | UseQueryOptions<TResult, TVariables>
    | Ref<UseQueryOptions<TResult, TVariables>>
    | (() => UseQueryOptions<TResult, TVariables>)
): UseQueryReturn<TResult, TVariables> => {
  prepareApolloComposable()
  let owningRuntime: ReturnType<typeof useApolloRuntime> | null = null
  try {
    owningRuntime = useApolloRuntime()
  } catch {
    // Compatibility: consumers may provide only @vue/apollo-composable clients.
  }
  const resolveDocument = () =>
    typeof document === 'function' ? document() : unref(document)
  const resolveVariables = () =>
    typeof variables === 'function' ? variables() : unref(variables)
  const hydratedVariables = owningRuntime?.hydrated
    ? JSON.stringify(resolveVariables())
    : null
  const nativeOptions = () => {
    const resolved = typeof options === 'function' ? options() : unref(options) || {}
    const {
      ssr,
      refetchOnUpdate: _refetchOnUpdate,
      refetchTimeout: _refetchTimeout,
      ...apolloOptions
    } = resolved
    if (owningRuntime?.server ?? typeof window === 'undefined') {
      return { ...apolloOptions, enabled: false, prefetch: false }
    }
    if (
      owningRuntime?.hydrated &&
      ssr !== false &&
      JSON.stringify(resolveVariables()) === hydratedVariables
    ) {
      return {
        ...apolloOptions,
        fetchPolicy: 'cache-only' as const,
        returnPartialData: true,
      }
    }
    return apolloOptions
  }

  const query = apolloUseQuery<TResult, TVariables>(
    document,
    variables as any,
    nativeOptions as any
  )
  // Captured during setup so the resolution contract is reachable from the
  // async server-prefetch hook. Lets the renderer await this operation even
  // though it was started outside its own component prefetch.
  const serverResolution = owningRuntime?.server
    ? resolveApolloServerResolution()
    : null
  if (owningRuntime?.server && getCurrentInstance()) {
    onServerPrefetch(async () => {
      const resolvedOptions =
        typeof options === 'function' ? options() : unref(options) || {}
      if (
        resolvedOptions.ssr === false ||
        unref(resolvedOptions.enabled as any) === false
      ) return
      const clientId = resolvedOptions.clientId || 'default'
      const client = owningRuntime!.clients[clientId]
      if (!client) throw new Error(`Apollo client "${clientId}" is not installed.`)
      query.loading.value = true
      query.error.value = null
      const work = client.query<TResult, TVariables>({
        query: resolveDocument(),
        variables: resolveVariables() as TVariables,
        fetchPolicy:
          resolvedOptions.fetchPolicy === 'no-cache'
            ? 'no-cache'
            : 'network-only',
        errorPolicy: resolvedOptions.errorPolicy,
        context: resolvedOptions.context,
      })
      serverResolution?.track(work)
      try {
        const result = await work
        query.result.value = result.data
      } catch (error) {
        query.error.value = error as any
        throw error
      } finally {
        query.loading.value = false
      }
    })
  }
  if (query.result.value === undefined && owningRuntime) {
    try {
      const resolvedOptions =
        typeof options === 'function' ? options() : unref(options) || {}
      const client = owningRuntime.clients[resolvedOptions.clientId || 'default']
      const cached = client?.readQuery<TResult, TVariables>({
        query: resolveDocument(),
        variables: resolveVariables() as TVariables,
        returnPartialData: true,
      })
      if (cached !== null && cached !== undefined) query.result.value = cached
    } catch {
      // Missing/partial cache data follows the native observable lifecycle.
    }
  }
  const nativeRefetch = query.refetch
  query.refetch = ((nextVariables?: TVariables) => {
    const activeRequest = nativeRefetch(nextVariables)
    if (activeRequest) return activeRequest

    const runtime = owningRuntime || useApolloRuntime()
    const resolvedOptions =
      typeof options === 'function' ? options() : unref(options) || {}
    const clientId = resolvedOptions.clientId || 'default'
    const client = runtime.clients[clientId]
    if (!client) throw new Error(`Apollo client "${clientId}" is not installed.`)
    const resolvedVariables =
      nextVariables ??
      resolveVariables()
    const requestedPolicy = resolvedOptions.fetchPolicy
    const fetchPolicy =
      requestedPolicy === 'cache-first' ||
      requestedPolicy === 'network-only' ||
      requestedPolicy === 'no-cache' ||
      requestedPolicy === 'cache-only'
        ? requestedPolicy
        : 'network-only'

    query.loading.value = true
    query.error.value = null
    return client.query<TResult, TVariables>({
      query: resolveDocument(),
      variables: resolvedVariables as TVariables,
      fetchPolicy,
      errorPolicy: resolvedOptions.errorPolicy,
      context: resolvedOptions.context,
    }).then((result) => {
      query.result.value = result.data
      return result
    }).catch((error) => {
      query.error.value = error
      throw error
    }).finally(() => {
      query.loading.value = false
    })
  }) as typeof query.refetch

  return query
}
