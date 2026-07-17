import { gql } from '@apollo/client/core/index.js'
import type { DocumentNode } from 'graphql'
import type { VueApolloClients } from './ApolloOperationRuntime'
import type { VueApolloClientOptions } from './types'

interface QueuedMutation {
  source: string
  variables?: Record<string, unknown>
  refetchQueries?: string[]
  sessionId: string
  createdAt: number
}

export interface ApolloOfflineRuntime {
  enabled: boolean
  enqueue: (
    clientId: string,
    document: DocumentNode,
    variables: unknown,
    options?: Record<string, any>
  ) => void
  sync: (clientId?: string) => Promise<void>
  stop: () => void
}

const stableHash = (value: string): string => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const documentSource = (document: DocumentNode): string => {
  const operations = document.definitions.filter(
    (definition: any) => definition.kind === 'OperationDefinition'
  ) as Array<{ operation?: string }>
  if (operations.length !== 1 || operations[0]?.operation !== 'mutation') {
    throw new Error('Offline persistence accepts one generated mutation document only.')
  }
  const source = document.loc?.source.body?.trim()
  if (!source) {
    throw new Error('Offline mutations require generated documents with source locations.')
  }
  return source
}

export const createApolloOfflineRuntime = (
  options: VueApolloClientOptions,
  clients: VueApolloClients
): ApolloOfflineRuntime => {
  const enabled = Boolean(options.allowOffline && typeof window !== 'undefined')
  const syncing = new Map<string, Promise<void>>()
  const applicationId = options.applicationId || 'application'
  const authBoundary = options.authBoundary || options.tokenKey || 'anonymous'
  const sessionId = () => options.getSessionId?.() || 'anonymous'
  const queuePrefix = (clientId: string) => {
    const endpoint = options.endPoints[clientId] || ''
    return [
      'vue-apollo-mutations:v1',
      stableHash(applicationId),
      stableHash(authBoundary),
      stableHash(clientId),
      stableHash(endpoint),
    ].join(':')
  }
  const queueKey = (clientId: string) =>
    `${queuePrefix(clientId)}:${stableHash(sessionId())}`
  const pruneForeignSessions = (clientId: string) => {
    if (!enabled) return
    const prefix = `${queuePrefix(clientId)}:`
    const current = queueKey(clientId)
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(prefix) && key !== current) localStorage.removeItem(key)
    }
  }
  const readQueue = (clientId: string): QueuedMutation[] => {
    if (!enabled) return []
    pruneForeignSessions(clientId)
    try {
      const parsed = JSON.parse(localStorage.getItem(queueKey(clientId)) || '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  const writeQueue = (clientId: string, queue: QueuedMutation[]) => {
    if (!enabled) return
    if (queue.length === 0) localStorage.removeItem(queueKey(clientId))
    else localStorage.setItem(queueKey(clientId), JSON.stringify(queue))
  }

  const enqueue: ApolloOfflineRuntime['enqueue'] = (
    clientId,
    document,
    variables,
    mutationOptions
  ) => {
    if (!enabled) return
    let storedVariables: Record<string, unknown> | undefined
    if (variables !== undefined) {
      try {
        storedVariables = JSON.parse(JSON.stringify(variables))
      } catch {
        throw new Error('Offline mutation variables must be JSON serializable.')
      }
    }
    const refetchQueries = Array.isArray(mutationOptions?.refetchQueries)
      ? mutationOptions.refetchQueries.filter(
          (entry: unknown): entry is string => typeof entry === 'string'
        )
      : undefined
    const queue = readQueue(clientId)
    if (queue.length >= 100) {
      throw new Error('Offline mutation queue limit (100) has been reached.')
    }
    queue.push({
      source: documentSource(document),
      variables: storedVariables,
      refetchQueries,
      sessionId: sessionId(),
      createdAt: Date.now(),
    })
    writeQueue(clientId, queue)
  }

  const syncClient = async (clientId: string) => {
    if (!enabled || navigator.onLine === false) return
    const existing = syncing.get(clientId)
    if (existing) return existing
    const promise = (async () => {
      const client = clients[clientId]
      if (!client) return
      const currentSessionId = sessionId()
      const queue = readQueue(clientId)
      const remaining: QueuedMutation[] = []
      for (let index = 0; index < queue.length; index += 1) {
        const mutation = queue[index]!
        if (mutation.sessionId !== currentSessionId) continue
        try {
          await client.mutate({
            mutation: gql(mutation.source),
            variables: mutation.variables,
            refetchQueries: mutation.refetchQueries,
            awaitRefetchQueries: Boolean(mutation.refetchQueries?.length),
          })
        } catch {
          remaining.push(mutation)
          remaining.push(...queue.slice(index + 1))
          break
        }
      }
      writeQueue(clientId, remaining)
    })().finally(() => syncing.delete(clientId))
    syncing.set(clientId, promise)
    return promise
  }
  const sync = async (clientId?: string) => {
    const clientIds = clientId ? [clientId] : Object.keys(clients)
    await Promise.all(clientIds.map(syncClient))
  }
  const online = () => void sync()
  if (enabled) window.addEventListener('online', online)

  return {
    enabled,
    enqueue,
    sync,
    stop: () => {
      if (enabled) window.removeEventListener('online', online)
      syncing.clear()
    },
  }
}
