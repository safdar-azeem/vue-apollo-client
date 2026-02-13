import {
  useQuery as apolloUseQuery,
  UseQueryReturn,
  UseQueryOptions as ApolloUseQueryOptions,
} from '@vue/apollo-composable'
export type { UseQueryReturn } from '@vue/apollo-composable'
import {
  getCurrentInstance,
  onMounted,
  onUpdated,
  onUnmounted,
  watch,
  reactive,
  ref,
  unref,
  toRaw,
  Ref,
} from 'vue'
import { useRoute } from 'vue-router'
import { getGlobalConfig } from '../configStore'
import { useLazyQuery } from './useLazyQuery'
import { unwrapVariables } from '../utils/common'
import { useSSRQuery } from './useSSRQuery'

// Extend options
import { OperationVariables } from '@apollo/client/core'
import { WatchQueryFetchPolicy } from '@apollo/client/core'

export interface UseQueryOptions<
  TData = any,
  TVariables extends OperationVariables = OperationVariables,
> extends Omit<ApolloUseQueryOptions<TData, TVariables>, 'nextFetchPolicy'> {
  ssr?: boolean
  refetchOnUpdate?: boolean
  refetchTimeout?: number
  nextFetchPolicy?:
    | WatchQueryFetchPolicy
    | string
    | ApolloUseQueryOptions<TData, TVariables>['nextFetchPolicy']
}

interface QueryCacheEntry<T> {
  loading: boolean
  timestamp: number
  result?: T
  subscribers: Map<
    number,
    {
      setResult: (data: T) => void
      setLoading: (loading: boolean) => void
      propsSnapshot: any
      isActive: boolean
    }
  >
  manualRefetchTriggered?: boolean
  routeSnapshot?: string
  isCacheOnly?: boolean
  lastActiveTimestamp?: number
}

const queryCache = new Map<string, QueryCacheEntry<any>>()
const pendingQueries = new Map<string, AbortController>()
const DEFAULT_REFETCH_TIMEOUT = 10000

// Clean up logic
const isServer = typeof window === 'undefined'
if (!isServer) {
  const CLEANUP_INTERVAL = 60000
  const MAX_INACTIVE_TIME = 300000

  setInterval(() => {
    const now = Date.now()

    queryCache.forEach((entry, key) => {
      if (entry.isCacheOnly) return

      let hasActiveSubscribers = false
      entry.subscribers.forEach((sub) => {
        if (sub.isActive) hasActiveSubscribers = true
      })

      if (
        !hasActiveSubscribers &&
        entry.lastActiveTimestamp &&
        now - entry.lastActiveTimestamp > MAX_INACTIVE_TIME
      ) {
        const controller = pendingQueries.get(key)
        if (controller) {
          controller.abort()
          pendingQueries.delete(key)
        }

        if (!entry.manualRefetchTriggered) {
          queryCache.delete(key)
        }
      }
    })
  }, CLEANUP_INTERVAL)
}

export const useQuery = <TResult = any, TVariables extends OperationVariables = OperationVariables>(
  document: any,
  variables?: TVariables | (() => TVariables) | Ref<TVariables>,
  options?:
    | UseQueryOptions<TResult, TVariables>
    | Ref<UseQueryOptions<TResult, TVariables>>
    | (() => UseQueryOptions<TResult, TVariables>)
): UseQueryReturn<TResult, TVariables> => {
  const opts = typeof options === 'function' ? options() : unref(options) || {}

  if (isServer || opts.ssr) {
    // This returns a promise-like structure in Nuxt impl, but composables must return synchronous objects.
    // The Nuxt impl of useSSRQuery is async.
    // If usage is `await useQuery(...)` it works.
    // Standard useQuery is synchronous.
    // If the user expects await, they must mark their component async.
    return useSSRQuery(document, variables, options) as any
  }

  const route = useRoute()
  const config = getGlobalConfig()

  const globalRefetchOnUpdate = config?.refetchOnUpdate
  const queryRefetchOnUpdate =
    opts.refetchOnUpdate !== undefined ? opts.refetchOnUpdate : globalRefetchOnUpdate

  if (!queryRefetchOnUpdate) {
    // @ts-ignore
    return apolloUseQuery<TResult, TVariables>(document, variables, options)
  }

  const reactiveVariables = reactive(
    typeof variables === 'function' ? variables() : unref(variables) || ({} as any)
  )

  const instance = getCurrentInstance()
  const instanceId = instance?.uid ?? Math.random()

  const getQueryKey = () => {
    // @ts-ignore
    const operationName = document?.definitions?.[0]?.name?.value || 'Unnamed'
    const rawVariables = unwrapVariables(reactiveVariables)

    return JSON.stringify({
      key: operationName,
      variables: rawVariables,
    })
  }

  const isCacheOnly = opts.nextFetchPolicy === 'cache-only' || opts.fetchPolicy === 'cache-only'

  let currentQueryKey = getQueryKey()

  let query = useLazyQuery<TResult, TVariables>(document, reactiveVariables, options as any)

  if (!queryCache.has(currentQueryKey)) {
    queryCache.set(currentQueryKey, {
      loading: false,
      timestamp: 0,
      subscribers: new Map(),
      manualRefetchTriggered: false,
      routeSnapshot: JSON.stringify(route?.fullPath), // Handle undefined route
      isCacheOnly,
      lastActiveTimestamp: Date.now(),
    })
  }

  let cacheEntry = queryCache.get(currentQueryKey)!

  const getPropsSnapshot = () => {
    return JSON.stringify({
      ...(instance?.props || {}),
      ...(instance?.attrs || {}),
      value: null,
      values: null,
      selected: null,
    })
  }

  const havePropsChanged = (oldSnapshot: string | null) => {
    if (!oldSnapshot) return false
    const currentSnapshot = getPropsSnapshot()
    return oldSnapshot !== currentSnapshot
  }

  const hasRouteChanged = () => {
    const currentRouteSnapshot = JSON.stringify(route?.fullPath) // Handle undefined
    const hasChanged = currentRouteSnapshot === cacheEntry.routeSnapshot
    if (hasChanged) {
      cacheEntry.routeSnapshot = currentRouteSnapshot
    }
    return hasChanged
  }

  const getRefetchTimeout = () => {
    return opts.refetchTimeout || config?.refetchTimeout || DEFAULT_REFETCH_TIMEOUT
  }

  const cancelInFlightRequests = () => {
    const controller = pendingQueries.get(currentQueryKey)
    if (controller) {
      controller.abort()
      pendingQueries.delete(currentQueryKey)
    }
  }

  const isQueryActive = () => {
    if (
      cacheEntry.subscribers.has(instanceId) &&
      cacheEntry.subscribers.get(instanceId)?.isActive
    ) {
      return true
    }
    for (const sub of cacheEntry.subscribers.values()) {
      if (sub.isActive) return true
    }
    return false
  }

  const updateActiveTimestamp = () => {
    if (isQueryActive()) {
      cacheEntry.lastActiveTimestamp = Date.now()
    }
  }

  const performRefetch = async (newVariables?: any) => {
    const now = Date.now()
    const timeoutValue = getRefetchTimeout()

    updateActiveTimestamp()

    if (now - cacheEntry.timestamp < timeoutValue && cacheEntry.result) {
      query.result.value = cacheEntry.result
      query.loading.value = false
      return Promise.resolve({ data: cacheEntry.result })
    }

    if (!cacheEntry.manualRefetchTriggered && !isQueryActive()) {
      if (cacheEntry.result) {
        query.result.value = cacheEntry.result
        query.loading.value = false
        return Promise.resolve({ data: cacheEntry.result })
      }
    }

    const controller = new AbortController()
    pendingQueries.set(currentQueryKey, controller)

    const isInitialLoad = !cacheEntry.result
    if (isInitialLoad) {
      cacheEntry.loading = true
      query.loading.value = true

      cacheEntry.subscribers.forEach((subscriber) => {
        subscriber.setLoading(true)
      })
    }

    cacheEntry.timestamp = now

    const fetchPromise = query.refetch(newVariables || unwrapVariables(reactiveVariables))

    try {
      const result = await fetchPromise

      if (!controller.signal.aborted) {
        if (result?.data) {
          cacheEntry.result = result.data

          cacheEntry.subscribers.forEach((subscriber) => {
            subscriber.setResult(result.data)
            subscriber.setLoading(false)
          })
        }

        pendingQueries.delete(currentQueryKey)
        return result
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('Query error:', error)
        pendingQueries.delete(currentQueryKey)
      }
      throw error
    } finally {
      cacheEntry.loading = false
      query.loading.value = false
    }
  }

  const originalRefetch = query.refetch
  query.refetch = async (...args) => {
    cacheEntry.manualRefetchTriggered = true
    cacheEntry.timestamp = Date.now()

    cancelInFlightRequests()

    try {
      const result = await originalRefetch?.(...args)
      if (result?.data) {
        cacheEntry.result = result.data
        query.result.value = result.data

        cacheEntry.subscribers.forEach((subscriber) => {
          subscriber.setResult(result.data)
        })
      }
      return result as any
    } catch (error) {
      throw error
    } finally {
      cacheEntry.manualRefetchTriggered = false
    }
  }

  const subscriber = {
    setResult: (data: TResult) => {
      query.result.value = data
    },
    setLoading: (loading: boolean) => {
      query.loading.value = loading
    },
    propsSnapshot: getPropsSnapshot(),
    isActive: true,
  }

  const updateVisibility = (isVisible = true) => {
    const sub = cacheEntry.subscribers.get(instanceId)
    if (sub) {
      sub.isActive = isVisible
      if (isVisible) {
        updateActiveTimestamp()
      }
    }
  }

  onMounted(() => {
    cacheEntry.subscribers.set(instanceId, subscriber)
    updateVisibility(true)

    if (cacheEntry.result) {
      query.result.value = cacheEntry.result
      query.loading.value = false
    }

    if (isCacheOnly && cacheEntry.result) return

    const now = Date.now()
    const shouldFetch =
      !cacheEntry.result ||
      (now - cacheEntry.timestamp > getRefetchTimeout() && !cacheEntry.isCacheOnly)

    if (shouldFetch) {
      performRefetch()
    }
  })

  watch(
    () => {
      return toRaw(reactiveVariables)
    },
    (newVars) => {
      if (!queryRefetchOnUpdate || cacheEntry.manualRefetchTriggered) return

      updateActiveTimestamp()

      const newVariables = unwrapVariables(newVars)
      const newQueryKey = getQueryKey()

      if (newQueryKey !== currentQueryKey) {
        if (cacheEntry.subscribers.size === 1) {
          queryCache.delete(currentQueryKey)
        } else {
          cacheEntry.subscribers.delete(instanceId)
        }

        currentQueryKey = newQueryKey

        if (!queryCache.has(currentQueryKey)) {
          queryCache.set(currentQueryKey, {
            loading: false,
            timestamp: 0,
            subscribers: new Map(),
            manualRefetchTriggered: false,
            routeSnapshot: JSON.stringify(route?.fullPath),
            isCacheOnly,
            lastActiveTimestamp: Date.now(),
          })
        }

        cacheEntry = queryCache.get(currentQueryKey)!
        cacheEntry.subscribers.set(instanceId, subscriber)

        performRefetch(newVariables)
      } else {
        const now = Date.now()
        if (!isCacheOnly && now - cacheEntry.timestamp > getRefetchTimeout() && isQueryActive()) {
          performRefetch(newVariables)
        }
      }
    },
    { deep: true }
  )

  if (route) {
    watch(
      () => route.fullPath,
      () => {
        if (isCacheOnly) return
        if (!queryRefetchOnUpdate || cacheEntry.manualRefetchTriggered) return

        updateActiveTimestamp()

        const now = Date.now()
        if (now - cacheEntry.timestamp > getRefetchTimeout()) {
          if (hasRouteChanged() && isQueryActive()) {
            performRefetch()
          }
        }
      }
    )
  }

  watch(query.result, (newData) => {
    if (newData) {
      cacheEntry.result = newData

      cacheEntry.subscribers.forEach((sub, subId) => {
        if (subId !== instanceId) {
          sub.setResult(newData)
        }
      })
    }
  })

  onUpdated(() => {
    if (isCacheOnly) return
    if (!queryRefetchOnUpdate || cacheEntry.manualRefetchTriggered) return

    const subscriber = cacheEntry.subscribers.get(instanceId)
    if (!subscriber) return

    subscriber.isActive = true
    updateActiveTimestamp()

    const now = Date.now()
    if (
      havePropsChanged(subscriber.propsSnapshot) &&
      now - cacheEntry.timestamp > getRefetchTimeout() &&
      isQueryActive()
    ) {
      subscriber.propsSnapshot = getPropsSnapshot()
      performRefetch()
    }
  })

  onUnmounted(() => {
    updateVisibility(false)

    if (isCacheOnly) {
      const sub = cacheEntry.subscribers.get(instanceId)
      if (sub) {
        sub.isActive = false
      }
    } else {
      cacheEntry.subscribers.delete(instanceId)

      if (cacheEntry.subscribers.size === 0 && !isCacheOnly) {
        queryCache.delete(currentQueryKey)
        cancelInFlightRequests()
      }
    }
  })

  return query
}
