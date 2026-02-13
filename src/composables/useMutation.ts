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

  if (allowOffline && typeof window !== 'undefined') {
    const originalMutate = mutation.mutate
    // @ts-ignore
    mutation.mutate = async (variables?: TVariables, overrideOptions?: any) => {
      if (!isOnline()) {
        saveMutationToQueue(document, variables, { ...options, ...overrideOptions })
        return { data: null, loading: ref(false), error: ref(null) } as any
      } else {
        const result = await originalMutate(variables, overrideOptions)
        if (apolloClient) {
          await syncMutations(apolloClient)
        }
        return result
      }
    }

    let cleanup: (() => void) | undefined
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
