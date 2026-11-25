import { ref } from 'vue'
import { decodeTokenClaims } from './ApolloSessionRuntime'
import { getOperationAST, print } from 'graphql'
import { gql } from '@apollo/client/core/index.js'
import type { DocumentNode } from 'graphql'
import type { VueApolloClients } from './ApolloOperationRuntime'
import { resolveApolloSessionCacheKey } from './ApolloSessionRuntime'
import {
  getRefreshToken as getCookieRefreshToken,
  getToken as getCookieToken,
} from './composables/useCookies'
import type { VueApolloClientOptions } from './types'

interface QueuedMutation {
  orderUncertain?: boolean
  sequence?: number
  batchCreatedAt?: number
  dispatched?: boolean
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
  ) => Promise<void>
  beforeOnlineMutation: (clientId: string) => Promise<void>
  pending: (clientId: string) => number
  legacyPending: (clientId: string) => boolean
  supports: (document: DocumentNode) => boolean
  sync: (clientId?: string, options?: { untilUncertain?: boolean }) => Promise<void>
  adoptLegacyQueue: (clientId: string) => Promise<void>
  uncertain: (clientId: string) => Array<{ id: string } & Pick<QueuedMutation, 'createdAt' | 'source' | 'variables'>>
  nextUncertain: (clientId: string) => ReturnType<ApolloOfflineRuntime['uncertain']>[number] | undefined
  resolveUncertain: (clientId: string, id: string, outcome: 'committed' | 'not-committed' | 'discard') => Promise<void>
  stop: () => void
}

class OfflineConfirmationRequired extends Error {}

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
  return document.loc?.source.body?.trim() || print(document)
}

export const createApolloOfflineRuntime = (
  options: VueApolloClientOptions,
  clients: VueApolloClients,
  verifiedAccount?: () => string | undefined,
  prepareSession?: () => Promise<void> | undefined
): ApolloOfflineRuntime => {
  const enabled = Boolean(options.allowOffline && typeof window !== 'undefined')
  const syncing = new Map<string, Promise<void>>()
  const applicationId = options.applicationId || 'application'
  const authBoundary = options.authBoundary || options.tokenKey || 'anonymous'
  const sessionSource = () => {
    if (options.getSessionId) return options.getSessionId()
    const token = options.getToken
      ? options.getToken()
      : getCookieToken(options.tokenKey || 'token', options.tokenCookie)
    const refreshToken = options.refresh?.getRefreshToken
      ? options.refresh.getRefreshToken()
      : options.getToken
        ? undefined
        : getCookieRefreshToken(options.tokenKey || 'token', options.tokenCookie)
    return token || refreshToken
  }
  const sessionId = () =>
    resolveApolloSessionCacheKey(sessionSource() ?? null) || 'anonymous'
  const unresolved = () => Boolean(options.browserSessionEndpoint && !sessionSource())
  const queuePrefix = (clientId: string, version: 'v1' | 'v2', endpoint = options.endPoints?.[clientId] || options.endpoint || '') => {
    return [
      'vue-apollo-mutations:' + version,
      stableHash(applicationId),
      stableHash(authBoundary),
      stableHash(clientId),
      stableHash(endpoint),
    ].join(':')
  }
  const queueKey = (clientId: string, version: 'v1' | 'v2' = 'v2') =>
    `${queuePrefix(clientId, version)}:${stableHash(sessionId())}`
  const itemKeys = (queue: string) => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    .filter((key): key is string => !!key?.startsWith(queue + ':item:'))
  const readLegacy = (queue: string): QueuedMutation[] => JSON.parse(localStorage.getItem(queue) ?? '[]')
  const readItem = (key: string): QueuedMutation | null => JSON.parse(localStorage.getItem(key) ?? 'null')
  const orderedItems = (queue: string) => itemKeys(queue)
    .map(key => ({ key, item: readItem(key) }))
    .sort((a, b) => (a.item?.sequence ?? 0) - (b.item?.sequence ?? 0) ||
      (a.item?.batchCreatedAt ?? a.item?.createdAt ?? 0) - (b.item?.batchCreatedAt ?? b.item?.createdAt ?? 0) ||
      a.key.localeCompare(b.key, 'en', { numeric: true }))
  const revision = ref(0)
  const changed = () => { revision.value++ }
  const supports = (doc: DocumentNode) => !options.offlineMutationNames ||
    options.offlineMutationNames.includes(getOperationAST(doc)?.name?.value ?? '')
  const legacyKeys = (clientId: string) => {
    const owners = [sessionId()]
    const account = verifiedAccount?.()
    const claims = decodeTokenClaims(options.getToken?.())
    if (account && (claims?.sub ?? claims?._id) === account) owners.push('sub:' + account)
    const endpoints = [options.endPoints?.[clientId] || options.endpoint || '', ...(options.legacyOfflineEndpoints ?? [])]
    return [...new Set(endpoints.flatMap(endpoint => owners.map(owner =>
      queuePrefix(clientId, 'v1', endpoint) + ':' + stableHash(owner))))]
  }
  const pending = (clientId: string) => {
    void revision.value
    return enabled && !unresolved() ? itemKeys(queueKey(clientId)).length : 0
  }
  const legacyPending = (clientId: string) => {
    void revision.value
    return enabled && !unresolved() && legacyKeys(clientId).some(key => localStorage.getItem(key) !== null)
  }
  // Old clients never acquire Web Locks. Only an explicit upgrade after the old
  // documents close can transfer their array without competing with a v1 writer.
  const adoptLegacyQueue = async (clientId: string) => {
    if (!enabled || unresolved() || !navigator.locks) throw new Error('Verify the original login in a browser with Web Locks.')
    const queue = queueKey(clientId)
    await navigator.locks.request(queue, async () => {
      for (const legacyKey of legacyKeys(clientId)) {
        const snapshot = localStorage.getItem(legacyKey)
        if (snapshot === null) continue
        const legacy: QueuedMutation[] = JSON.parse(snapshot)
        if (legacy.some(item => stableHash(item.sessionId) !== legacyKey.split(':').at(-1) ||
            (item.sessionId !== sessionId() && item.sessionId !== 'sub:' + verifiedAccount?.()))) throw new Error('The legacy queue owner differs.')
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(legacyKey + '\0' + snapshot))
        const batch = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
        if (stopped || unresolved() || queue !== queueKey(clientId) || !legacyKeys(clientId).includes(legacyKey) || localStorage.getItem(legacyKey) !== snapshot) {
          throw new Error('The legacy queue changed during adoption.')
        }
        for (const [index, item] of legacy.entries()) {
          const key = queue + ':item:legacy-' + batch + '-' + index
          // Deterministic keys also survive quota errors or interruption mid-copy.
          if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify({ ...item, batchCreatedAt: legacy[0]!.createdAt, sessionId: sessionId(), dispatched: true }))
        }
        localStorage.removeItem(legacyKey)
        changed()
      }
    })
  }

  const enqueue: ApolloOfflineRuntime['enqueue'] = async (
    clientId,
    document,
    variables,
    mutationOptions
  ) => {
    if (!enabled) return
    if (!navigator.locks) throw new Error('Offline saving requires a browser with Web Locks. Reconnect before saving.')
    if (unresolved()) throw new Error('Verify the session before queuing private work.')
    if (!supports(document)) throw new Error('Reconnect before performing this action.')
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
    const queue = queueKey(clientId)
    const mutation: QueuedMutation = {
      source: documentSource(document),
      variables: storedVariables,
      refetchQueries,
      sessionId: sessionId(),
      createdAt: performance.timeOrigin + performance.now(),
    }
    await navigator.locks.request(queue, () => {
      if (stopped || unresolved() || mutation.sessionId !== sessionId()) throw new Error('The active login changed before saving.')
      const entries = itemKeys(queue)
      if (entries.length + readLegacy(queueKey(clientId, 'v1')).length >= 100) {
        throw new Error('Offline mutation queue limit (100) has been reached.')
      }
      // The replay lock serializes insertion across documents. Only outstanding
      // entries need distinct positions; there is no separate counter to recover.
      mutation.sequence = 1 + entries.reduce((max, key) => Math.max(max, readItem(key)?.sequence ?? 0), 0)
      if (!Number.isSafeInteger(mutation.sequence)) throw new Error('Offline queue position limit reached.')
      localStorage.setItem(queue + ':item:' + crypto.randomUUID(), JSON.stringify(mutation))
      changed()
    })
  }

  const syncClient = async (clientId: string, beforeWrite = false) => {
    if (!enabled) return
    if (beforeWrite && unresolved()) await prepareSession?.()
    if (stopped || unresolved() || navigator.onLine === false) {
      if (beforeWrite) throw new Error('Verify the session and connection before saving.')
      return
    }
    const existing = syncing.get(clientId)
    if (existing && !beforeWrite) return existing
    const locks = navigator.locks
    if (!locks && beforeWrite && !pending(clientId) && !legacyPending(clientId)) return
    if (!locks) throw new Error('Offline replay requires Web Locks. Queued changes have been retained.')
    const owner = sessionId()
    const queue = queueKey(clientId)
    const promise = locks.request(queue, async () => {
      const client = clients[clientId]
      if (!client || stopped || unresolved() || owner !== sessionId()) return
      if (legacyPending(clientId)) {
        throw new Error('Close older app tabs, then adopt the legacy queue before replay.')
      }
      const entries = orderedItems(queue)
      // Previous releases did not record a position for native v2 entries.
      // Equal-time UUIDs have no recoverable chronology. Ask for reconciliation
      // before sending any member of such a group, including after interruption.
      const oldTimes = new Map<number, number>()
      for (const { key, item } of entries) {
        if (item && item.sequence === undefined && !key.startsWith(queue + ':item:legacy-')) {
          oldTimes.set(item.createdAt, (oldTimes.get(item.createdAt) ?? 0) + 1)
        }
      }
      for (const { key, item } of entries) {
        if (item && item.sequence === undefined && !item.orderUncertain &&
            !key.startsWith(queue + ':item:legacy-') && (oldTimes.get(item.createdAt) ?? 0) > 1) {
          localStorage.setItem(key, JSON.stringify({ ...item, dispatched: true, orderUncertain: true }))
          changed()
        }
      }
      for (const { key } of entries) {
        if (stopped || unresolved() || owner !== sessionId() || navigator.onLine === false) return
        const item = readItem(key)
        if (!item || item.sessionId !== owner) continue
        if (item.dispatched) throw new OfflineConfirmationRequired('An offline change requires confirmation before replay.')
        const mutation = gql(item.source)
        // Persist the claim before sending. A tab may close after the server
        // commits and before acknowledgement. Never replay an ambiguous write.
        localStorage.setItem(key, JSON.stringify({ ...item, dispatched: true }))
        changed()
        const result = await client.mutate({ mutation, errorPolicy: 'none', context: { vueApolloOfflineOwner: owner }, variables: item.variables, refetchQueries: item.refetchQueries,
          awaitRefetchQueries: Boolean(item.refetchQueries?.length) })
        if (result.data == null || result.errors?.length) throw new Error('Offline change completion was not confirmed.')
        localStorage.removeItem(key)
        changed()
      }
    }).then(() => {
      if (beforeWrite && (stopped || unresolved() || owner !== sessionId() || navigator.onLine === false)) {
        throw new Error('The session or connection changed before saving.')
      }
    })
    // A foreground save needs its own turn behind every already-requested enqueue.
    // Background sync callers can still share the scan already in progress.
    if (beforeWrite) return promise
    syncing.set(clientId, promise)
    try { await promise } finally { syncing.delete(clientId) }
  }
  const sync: ApolloOfflineRuntime['sync'] = async (clientId, options) => {
    const clientIds = clientId ? [clientId] : Object.keys(clients)
    await Promise.all(clientIds.map(async id => {
      try { await syncClient(id) }
      catch (error) {
        if (!(options?.untilUncertain && error instanceof OfflineConfirmationRequired)) throw error
      }
    }))
  }
  let stopped = false
  const online = () => void sync().catch(() => { /* Explicit sync reports replay errors. */ })
  if (enabled) window.addEventListener('storage', changed)
  if (enabled && !options.browserSessionEndpoint) window.addEventListener('online', online)

  const uncertain = (clientId: string, headOnly: boolean) => {
    void revision.value
    if (!enabled || unresolved()) return []
    const queue = queueKey(clientId)
    const entries = orderedItems(queue)
    return (headOnly ? entries.slice(0, 1) : entries).flatMap(({ key, item }) =>
      item?.dispatched && item.sessionId === sessionId()
        ? [{ id: key.slice((queue + ':item:').length), createdAt: item.createdAt, source: item.source, variables: item.variables }]
        : [])
  }

  return {
    enabled,
    enqueue,
    sync,
    beforeOnlineMutation: clientId => syncClient(clientId, true),
    pending, legacyPending, supports, adoptLegacyQueue,
    uncertain: clientId => uncertain(clientId, false),
    nextUncertain: clientId => uncertain(clientId, true)[0],
    resolveUncertain: async (clientId, id, outcome) => {
      if (!enabled || unresolved() || !navigator.locks || !/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Cannot resolve this offline change.')
      const queue = queueKey(clientId)
      await navigator.locks.request(queue, async () => {
        const key = queue + ':item:' + id
        const head = orderedItems(queue)[0]
        if (head?.key !== key) throw new Error('Review the earliest queued change first.')
        const item = head.item
        if (stopped || unresolved() || queue !== queueKey(clientId) || !item?.dispatched || item.sessionId !== sessionId()) throw new Error('Offline change unavailable.')
        if (outcome === 'committed' || outcome === 'discard') localStorage.removeItem(key)
        else if (outcome === 'not-committed' && supports(gql(item.source))) localStorage.setItem(key, JSON.stringify({ ...item, dispatched: false }))
        else throw new Error('Complete this action online.')
        changed()
      })
    },
    stop: () => {
      if (enabled) window.removeEventListener('online', online)
      if (enabled) window.removeEventListener('storage', changed)
      stopped = true
    },
  }
}
