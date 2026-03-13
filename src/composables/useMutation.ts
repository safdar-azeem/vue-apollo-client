import {
  useMutation as apolloUseMutation,
  UseMutationReturn,
  ApolloClients,
  UseMutationOptions,
} from '@vue/apollo-composable'
export type { UseMutationOptions, UseMutationReturn } from '@vue/apollo-composable'
import { inject, onMounted, onUnmounted, ref } from 'vue'
import { getGlobalConfig } from '../configStore'
import { ApolloClient, gql, OperationVariables } from '@apollo/client/core'

const MUTATION_QUEUE_KEY = 'apollo_mutation_queue'
let isSyncing = false

const saveMutationToQueue = (document: any, variables: any, options: any) => {
  const queue = JSON.parse(localStorage.getItem(MUTATION_QUEUE_KEY) || '[]')
  queue.push({ document: document.loc?.source.body, variables, options, timestamp: Date.now() })
  localStorage.setItem(MUTATION_QUEUE_KEY, JSON.stringify(queue))
}

const getMutationQueue = () => {
  return JSON.parse(localStorage.getItem(MUTATION_QUEUE_KEY) || '[]')
}

const clearMutationQueue = () => {
  localStorage.setItem(MUTATION_QUEUE_KEY, '[]')
}

const isOnline = () => {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

const syncMutations = async (client: ApolloClient<any>) => {
  if (isSyncing || !isOnline()) return
  isSyncing = true

  const queue = getMutationQueue()
  if (queue.length === 0) {
    isSyncing = false
    return
  }

  try {
    for (const mutation of queue) {
      const parsedDocument = gql(mutation.document)
      await client.mutate({
        mutation: parsedDocument,
        variables: mutation.variables,
        ...mutation.options,
      })
    }
    clearMutationQueue()
  } catch (error) {
    console.error('Failed to sync mutations:', error)
  } finally {
    isSyncing = false
  }
}

const setupGlobalSync = (client: ApolloClient<any>, allowOffline: boolean) => {
  if (typeof window === 'undefined' || !allowOffline) return

  const handleSync = () => syncMutations(client)

  if (isOnline()) {
    syncMutations(client)
  }

  window.addEventListener('online', handleSync)

  return () => {
    window.removeEventListener('online', handleSync)
  }
}

/**
 * For every string query name in refetchQueries:
 * 1. Try to refetch all active matching observable queries directly.
 * 2. Always evict the field from Apollo InMemoryCache — so if the query
 *    component is unmounted (stopped observable), it fetches fresh on next mount.
 */
const handleRefetchQueries = async (client: ApolloClient<any>, refetchQueries: any[]) => {
  const stringQueries = refetchQueries.filter((q) => typeof q === 'string')
  if (stringQueries.length === 0) return

  for (const opName of stringQueries) {
    // Step 1: evict from Apollo cache so unmounted queries fetch fresh on remount
    // Try both the exact casing and camelCase first-letter variant
    const fieldName = opName.charAt(0).toLowerCase() + opName.slice(1)
    const variants = [...new Set([opName, fieldName])]

    for (const field of variants) {
      try {
        client.cache.evict({ id: 'ROOT_QUERY', fieldName: field })
      } catch (_) {}
    }
    client.cache.gc()

    // Step 2: refetch any currently active observable queries with this name
    const queryManager = (client as any).queryManager
    if (!queryManager) continue

    const queries: Map<string, any> = queryManager.queries
    const refetchPromises: Promise<any>[] = []

    queries.forEach((queryInfo: any) => {
      const oq = queryInfo.observableQuery
      if (!oq || queryInfo.stopped) return

      const name: string | undefined =
        oq.queryName || queryInfo.document?.definitions?.[0]?.name?.value

      if (name === opName && oq.observers?.size > 0) {
        refetchPromises.push(oq.refetch())
      }
    })

    if (refetchPromises.length > 0) {
      await Promise.allSettled(refetchPromises)
    }
  }
}

export const useMutation = <
  TResult = any,
  TVariables extends OperationVariables = OperationVariables,
>(
  document: any,
  options?: any
): UseMutationReturn<TResult, TVariables> => {
  const clients = inject(ApolloClients) as Record<string, ApolloClient<any>>
  const clientId = options?.clientId || 'default'
  const apolloClient = clients?.[clientId]
  const config = getGlobalConfig()

  const mutation = apolloUseMutation<TResult, TVariables>(document, options)
  const allowOffline = config?.allowOffline || false

  const originalMutate = mutation.mutate

  // @ts-ignore
  mutation.mutate = async (variables?: TVariables, overrideOptions?: any) => {
    const mergedRefetchQueries: any[] =
      overrideOptions?.refetchQueries ?? options?.refetchQueries ?? []

    if (allowOffline && typeof window !== 'undefined' && !isOnline()) {
      saveMutationToQueue(document, variables, { ...options, ...overrideOptions })
      return { data: null, loading: ref(false), error: ref(null) } as any
    }

    try {
      const result = await originalMutate(variables, overrideOptions)

      if (apolloClient && mergedRefetchQueries.length > 0) {
        await handleRefetchQueries(apolloClient, mergedRefetchQueries)
      }

      if (allowOffline && apolloClient) {
        await syncMutations(apolloClient)
      }

      return result
    } catch (error) {
      if (mutation.loading.value) {
        mutation.loading.value = false
      }
      throw error
    }
  }

  let cleanup: (() => void) | undefined

  if (allowOffline && typeof window !== 'undefined') {
    onMounted(() => {
      if (!cleanup && apolloClient) {
        cleanup = setupGlobalSync(apolloClient, allowOffline)
      }
    })

    onUnmounted(() => {
      if (cleanup) {
        cleanup()
        cleanup = undefined
      }
    })
  }

  return mutation
}
