import { inject, type App, type InjectionKey } from 'vue'
import { ApolloClients } from '@vue/apollo-composable'
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

export interface VueApolloRuntime {
  install: (app: App) => void
  clients: VueApolloClients
  options: VueApolloClientOptions
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
  stop: () => void
}

export const VUE_APOLLO_RUNTIME: InjectionKey<VueApolloRuntime> =
  Symbol('vue-apollo-client-runtime')

export const useApolloRuntime = (): VueApolloRuntime => {
  const runtime = inject(VUE_APOLLO_RUNTIME)
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
    runtime: { ...runtime, server },
  })

  if (registerGlobal) {
    setGlobalConfig(options)
    setClients(clients)
  }

  const offline = createApolloOfflineRuntime(options, clients)
  const apolloRuntime: VueApolloRuntime = {
    install(app: App) {
      app.provide(ApolloClients, clients)
      app.provide(VUE_APOLLO_RUNTIME, apolloRuntime)
    },
    clients,
    options,
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
    stop: () => {
      offline.stop()
      for (const client of Object.values(clients)) client.stop()
    },
  }
  return apolloRuntime
}
