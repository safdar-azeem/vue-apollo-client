import { hasInjectionContext, inject, type App, type InjectionKey } from 'vue'
import { ApolloClients, provideApolloClients } from '@vue/apollo-composable'
import type {
  ApolloQueryResult,
  FetchResult,
  OperationVariables,
} from '@apollo/client/core/index.js'
import type {
  VueApolloClientOptions,
  VueApolloRuntimeOptions,
  VueApolloState,
} from './types'
import { setGlobalConfig, setClients } from './configStore'
import { graphqlConfig } from './utils/graphql.config'
import {
  executeApolloMutation,
  executeApolloQuery,
  type VueApolloMutationExecution,
  type VueApolloClients,
  type VueApolloQueryExecution,
} from './ApolloOperationRuntime'
import { createApolloOfflineRuntime, type ApolloOfflineRuntime } from './ApolloOfflineRuntime'
import { connectApolloToSsrHost } from './ssrHydration'

export interface VueApolloRuntime {
  install: (app: App) => void
  server: boolean
  clients: VueApolloClients
  options: VueApolloClientOptions
  /** True when browser clients were constructed from serialized SSR state. */
  hydrated: boolean
  offline: ApolloOfflineRuntime
  extract: () => VueApolloState
  restore: (state: VueApolloState | null | undefined) => void
  executeQuery: <TData, TVariables extends OperationVariables = OperationVariables>(
    execution: VueApolloQueryExecution<TData, TVariables>
  ) => Promise<ApolloQueryResult<TData>>
  executeMutation: <TData, TVariables extends OperationVariables = OperationVariables>(
    execution: VueApolloMutationExecution<TData, TVariables>
  ) => Promise<FetchResult<TData>>
  clearStore: (clientId?: string) => Promise<void>
  runWithContext: <T>(callback: () => T) => T
  stop: () => void
}

export const VUE_APOLLO_RUNTIME: InjectionKey<VueApolloRuntime> =
  Symbol.for('vue-apollo:runtime') as InjectionKey<VueApolloRuntime>

let activeBrowserRuntime: VueApolloRuntime | null = null

export const prepareApolloComposable = (): void => {
  if (typeof window === 'undefined' || hasInjectionContext()) return
  if (activeBrowserRuntime) provideApolloClients(activeBrowserRuntime.clients)
}

export const useApolloRuntime = (): VueApolloRuntime => {
  const runtime = hasInjectionContext()
    ? inject(VUE_APOLLO_RUNTIME, null)
    : activeBrowserRuntime
  if (!runtime) throw new Error('vue-apollo-client runtime is not installed.')
  return runtime
}

export const extractApolloState = (clients: VueApolloClients): VueApolloState =>
  Object.fromEntries(
    Object.entries(clients).map(([clientId, client]) => [clientId, client.extract()])
  )

export const restoreApolloState = (
  clients: VueApolloClients,
  state: VueApolloState | null | undefined
): void => {
  if (!state) return
  for (const [clientId, cacheState] of Object.entries(state)) {
    clients[clientId]?.cache.restore(cacheState)
  }
}

export const createApollo = (
  options: VueApolloClientOptions,
  runtime: VueApolloRuntimeOptions = {}
): VueApolloRuntime => {
  const server = runtime.server ?? typeof window === 'undefined'
  const registerGlobal = runtime.registerGlobal ?? !server
  const hydrationKey = runtime.hydrationKey ?? 'apollo'
  const hydrated = !server && Boolean(runtime.initialState)
  let ownerApp: App | null = null
  const runtimeOptions: VueApolloRuntimeOptions = {
    ...runtime,
    server,
    fetch: runtime.fetch ?? options.fetch,
    requestTimeoutMs: runtime.requestTimeoutMs ?? options.requestTimeoutMs,
    runWithContext: <T>(callback: () => T): T =>
      ownerApp ? ownerApp.runWithContext(callback) : callback(),
  }

  const clients = graphqlConfig({
    endPoints: options.endPoints,
    tokenKey: options.tokenKey || 'token',
    setContext: options.setContext,
    memoryConfig: options.memoryConfig,
    useGETForQueries: options.useGETForQueries,
    apolloClientConfig: options.apolloClientConfig,
    apolloUploadConfig: options.apolloUploadConfig,
    refresh: options.refresh,
    refreshToken: options.refreshToken,
    onLogout: options.onLogout,
    getToken: options.getToken,
    clearToken: options.clearToken,
    formatToken: options.formatToken,
    getSessionId: options.getSessionId,
    runtime: runtimeOptions,
  })

  if (registerGlobal) {
    setGlobalConfig(options)
    setClients(clients)
  }

  const offline = createApolloOfflineRuntime(options, clients)
  const apolloRuntime: VueApolloRuntime = {
    install(app: App) {
      if (ownerApp && ownerApp !== app) {
        throw new Error('An Apollo runtime cannot be installed on multiple Vue applications.')
      }
      ownerApp = app
      app.provide(ApolloClients, clients)
      app.provide(VUE_APOLLO_RUNTIME, apolloRuntime)
      if (!server && registerGlobal) {
        activeBrowserRuntime = apolloRuntime
        provideApolloClients(clients)
      }
      // Automatically integrate with a generic SSR hydration host when one is
      // present. On the server this contributes the extracted cache to the
      // shared hydration state; in the browser it restores that cache before
      // any query composable is created, so hydration issues no duplicate
      // request. In a plain SPA (no host) this is a no-op.
      connectApolloToSsrHost(app, apolloRuntime, hydrationKey)
    },
    server,
    clients,
    options,
    hydrated,
    offline,
    extract: () => extractApolloState(clients),
    restore: (state: VueApolloState | null | undefined) =>
      restoreApolloState(clients, state),
    executeQuery: (execution) => executeApolloQuery(apolloRuntime, execution),
    executeMutation: (execution) => executeApolloMutation(apolloRuntime, execution),
    clearStore: async (clientId) => {
      if (clientId) {
        const client = clients[clientId]
        if (!client) throw new Error(`Apollo client "${clientId}" is not installed.`)
        await client.clearStore()
        return
      }
      await Promise.all(Object.values(clients).map((client) => client.clearStore()))
    },
    runWithContext: (callback) =>
      ownerApp ? ownerApp.runWithContext(callback) : callback(),
    stop: () => {
      offline.stop()
      for (const client of Object.values(clients)) client.stop()
      if (activeBrowserRuntime === apolloRuntime) activeBrowserRuntime = null
    },
  }
  return apolloRuntime
}
