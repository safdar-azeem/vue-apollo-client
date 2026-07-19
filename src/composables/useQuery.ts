import {
  useQuery as apolloUseQuery,
  type UseQueryOptions as ApolloUseQueryOptions,
  type UseQueryReturn,
} from '@vue/apollo-composable'
import {
  computed,
  getCurrentInstance,
  onServerPrefetch,
  shallowRef,
  unref,
  type Ref,
} from 'vue'
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

const stableSignature = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return String(value)
  }
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
  const server = owningRuntime?.server ?? typeof window === 'undefined'
  const resolveDocument = () =>
    typeof document === 'function' ? document() : unref(document)
  const resolveVariables = () =>
    typeof variables === 'function' ? variables() : unref(variables)
  const resolveOptions = (): UseQueryOptions<TResult, TVariables> =>
    (typeof options === 'function' ? options() : unref(options)) || {}
  const isEnabled = (): boolean => {
    const enabled = resolveOptions().enabled
    return enabled === undefined ? true : Boolean(unref(enabled as any))
  }
  // Signature of the variables the query is currently asking for. When it
  // changes, the query is "pending for the new variables" until it settles.
  const currentSignature = () => stableSignature(resolveVariables())

  // Complete cached data for the current variables at creation.
  //
  // Browser: drives the hydration cache-only decision and the synchronous first
  // settle. A MISS means the data was not part of the SSR payload — a query
  // created after hydration for a route that was not server-rendered — so it
  // must fetch normally instead of starving on a cache-only policy.
  //
  // Server: on a re-render pass the request cache is already warm (the renderer
  // carries it forward between passes), so reading it here settles the query
  // SYNCHRONOUSLY at setup. That lets data reach consumers that read it
  // indirectly — through an external store populated by this query, then read by
  // a sibling component — which a single async prefetch pass cannot reach,
  // because Vue does not block a sibling's render on an earlier sibling's
  // `onServerPrefetch`.
  const readCompleteCache = (): TResult | undefined => {
    if (!owningRuntime) return undefined
    try {
      const client = owningRuntime.clients[resolveOptions().clientId || 'default']
      const cached = client?.readQuery<TResult, TVariables>({
        query: resolveDocument(),
        variables: resolveVariables() as TVariables,
      })
      return cached === null ? undefined : (cached as TResult | undefined)
    } catch {
      return undefined
    }
  }
  const cachedAtCreation = readCompleteCache()
  // A genuine hydration cache HIT: the runtime was hydrated AND the restored
  // cache already holds this exact query. Only then may the first render serve
  // cache-only without a duplicate request. `owningRuntime.hydrated` alone stays
  // true for the whole session, so it must never gate cache-only by itself.
  const hydratedHit = Boolean(
    owningRuntime?.hydrated && cachedAtCreation !== undefined
  )
  const hydratedVariables = hydratedHit ? currentSignature() : null
  const nativeOptions = () => {
    const resolved = resolveOptions()
    const {
      ssr,
      refetchOnUpdate: _refetchOnUpdate,
      refetchTimeout: _refetchTimeout,
      ...apolloOptions
    } = resolved
    if (server) {
      return { ...apolloOptions, enabled: false, prefetch: false }
    }
    if (
      hydratedHit &&
      ssr !== false &&
      currentSignature() === hydratedVariables
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

  // --- Settled-for-current-variables lifecycle -----------------------------
  //
  // The single source of truth that distinguishes "not yet completed for the
  // current variables" (loading / pending / hydration miss / stale) from
  // "completed for the current variables" (data OR a confirmed null). A
  // not-found decision must only ever read a settled result.
  const settledSignature = shallowRef<string | undefined>(undefined)
  const markSettled = () => {
    settledSignature.value = currentSignature()
  }

  // Apollo delivers results and errors through these event hooks (not scheduler
  // watchers), so they mark the CURRENT variables settled reliably — including
  // after a reactive variable change, which re-subscribes and re-emits.
  query.onResult?.((result) => {
    if (result && (result.data !== undefined || result.loading === false)) {
      markSettled()
    }
  })
  query.onError?.(() => markSettled())

  const serverResolution = server ? resolveApolloServerResolution() : null
  if (server && getCurrentInstance()) {
    onServerPrefetch(async () => {
      const resolvedOptions = resolveOptions()
      if (resolvedOptions.ssr === false || !isEnabled()) {
        // Disabled/opted-out on the server: nothing to await, and it is settled
        // for these variables (there is deliberately no data to fetch).
        markSettled()
        return
      }
      // Already warm in the request cache (a re-render pass): the synchronous
      // settle above populated the result, so there is nothing to fetch and no
      // duplicate network request. Skipping also prevents a re-render loop.
      if (cachedAtCreation !== undefined) return
      const clientId = resolvedOptions.clientId || 'default'
      const client = owningRuntime!.clients[clientId]
      if (!client) throw new Error(`Apollo client "${clientId}" is not installed.`)
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
        // Settled either way — the renderer now knows whether data exists.
        markSettled()
      }
    })
  }

  // Synchronous settle for the initial render (hydration / cache-first restore).
  // If the native observable already produced data for the current variables
  // synchronously (a cache hit), it is settled now — this is what keeps a
  // hydrated render from flashing a loading/not-found state and mismatching the
  // server HTML. Otherwise fall back to the complete cache read taken above.
  // Only a COMPLETE result counts as settled: a partial object would look like a
  // confirmed-but-empty result and produce a false not-found.
  if (query.result.value !== undefined) {
    markSettled()
  } else if (cachedAtCreation !== undefined) {
    query.result.value = cachedAtCreation
    markSettled()
  }

  // --- Robust loading & result ---------------------------------------------
  //
  // `loading` is true whenever the query is enabled for the current variables
  // but has not settled for them — no false-negative window on fresh mount,
  // `enabled` flips, SSR, or reactive variable changes. `result` exposes ONLY
  // data settled for the current variables, so stale previous-variable data can
  // never appear under a new route.
  const pendingForCurrent = () =>
    settledSignature.value !== currentSignature()
  const robustLoading = computed<boolean>(() => {
    if (query.error.value) return false
    if (!isEnabled()) return false
    return pendingForCurrent()
  })
  const robustResult = computed<TResult | undefined>(() =>
    pendingForCurrent() ? undefined : (query.result.value as TResult | undefined)
  )

  const nativeRefetch = query.refetch
  query.refetch = ((nextVariables?: TVariables) => {
    const activeRequest = nativeRefetch(nextVariables)
    if (activeRequest) {
      return activeRequest.then((result) => {
        markSettled()
        return result
      })
    }

    const runtime = owningRuntime || useApolloRuntime()
    const resolvedOptions = resolveOptions()
    const clientId = resolvedOptions.clientId || 'default'
    const client = runtime.clients[clientId]
    if (!client) throw new Error(`Apollo client "${clientId}" is not installed.`)
    const resolvedVariables = nextVariables ?? resolveVariables()
    const requestedPolicy = resolvedOptions.fetchPolicy
    const fetchPolicy =
      requestedPolicy === 'cache-first' ||
      requestedPolicy === 'network-only' ||
      requestedPolicy === 'no-cache' ||
      requestedPolicy === 'cache-only'
        ? requestedPolicy
        : 'network-only'

    query.error.value = null
    return client.query<TResult, TVariables>({
      query: resolveDocument(),
      variables: resolvedVariables as TVariables,
      fetchPolicy,
      errorPolicy: resolvedOptions.errorPolicy,
      context: resolvedOptions.context,
    }).then((result) => {
      query.result.value = result.data
      markSettled()
      return result
    }).catch((error) => {
      query.error.value = error
      markSettled()
      throw error
    })
  }) as typeof query.refetch

  return {
    ...query,
    loading: robustLoading as unknown as Ref<boolean>,
    result: robustResult as unknown as Ref<TResult | undefined>,
  }
}
