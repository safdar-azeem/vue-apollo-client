import { createBrowserSession } from './ApolloBrowserSession'
import { hasInjectionContext, inject, type App, type InjectionKey } from 'vue'
import { ApolloClients, provideApolloClients } from '@vue/apollo-composable'
import type {
  ApolloQueryResult,
  FetchResult,
  OperationVariables,
} from '@apollo/client/core/index.js'
import type {
  VueApolloClientOptions,
  VueApolloAuthHydrationState,
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
import { normalizeApolloOptions } from './normalize'
import {
  createCredentialMutationCoordinator,
  type CredentialMutationCoordinator,
} from './ApolloSessionRuntime'
import {
  createAuthRuntime,
  restoreAuthState as restoreInstalledAuthState,
  type AuthState,
} from './composables/useAuth'

export interface VueApolloRuntime {
  purgeSessionCaches?: () => Promise<void>
  forgetBrowserSession?: () => void
  captureBrowserLogout?: () => () => Promise<void>
  install: (app: App) => void
  server: boolean
  clients: VueApolloClients
  options: VueApolloClientOptions
  /** Internal request-scoped credentials used by SSR auth verification. */
  readonly requestHeaders?: Readonly<Record<string, string>>
  /** Auth state owned by this installed runtime, when configured. */
  auth?: AuthState
  /**
   * True when this runtime's cache was restored from serialized SSR state — the
   * single derived hydration flag. Query composables serve the first render
   * from cache (no duplicate request) exactly when this is true.
   */
  hydrated: boolean
  /** Marks the runtime hydrated after a fallback restore. Internal. */
  markHydrated: () => void
  offline: ApolloOfflineRuntime
  extract: () => VueApolloState
  restore: (state: VueApolloState | null | undefined) => void
  /** Internal hydration hook for the installed auth runtime. */
  restoreAuthState?: (
    state: VueApolloAuthHydrationState | null | undefined
  ) => void
  executeQuery: <TData, TVariables extends OperationVariables = OperationVariables>(
    execution: VueApolloQueryExecution<TData, TVariables>
  ) => Promise<ApolloQueryResult<TData>>
  executeMutation: <TData, TVariables extends OperationVariables = OperationVariables>(
    execution: VueApolloMutationExecution<TData, TVariables>
  ) => Promise<FetchResult<TData>>
  clearStore: (clientId?: string) => Promise<void>
  runWithContext: <T>(callback: () => T) => T
  /** Internal credential-mutation barrier shared by auth and refresh links. */
  prepareBrowserSession?: (signal: AbortSignal) => Promise<boolean>
  readonly credentialCoordinator?: CredentialMutationCoordinator
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
  const endpoint = !server && options.browserSessionEndpoint
  const replacementParam = '__vue_apollo_reentry'
  if (endpoint) {
    const entry = new URL(window.location.href)
    if (entry.searchParams.has(replacementParam)) {
      entry.searchParams.delete(replacementParam)
      history.replaceState(history.state, '', entry.href)
    }
  }
  const managed = endpoint ? createBrowserSession(options, endpoint, () => {
    credentialCoordinator.bumpEpoch()
    installedAuth?.reset()
    void apolloRuntime.purgeSessionCaches?.()
    // Remount every editor and run the destination's normal authorization guard.
    const entry = new URL(window.location.href)
    entry.searchParams.set(replacementParam, crypto.randomUUID())
    window.location.replace(entry.href)
  }) : undefined
  const normalizedOptions = normalizeApolloOptions(managed?.options ?? options)
  const registerGlobal = runtime.registerGlobal ?? !server
  const hydrationKey = runtime.hydrationKey ?? 'apollo'
  // Single derived hydration state: true once the cache was restored, whether
  // at construction from `initialState` (the recommended path) or via the
  // legacy host fallback in `connectApolloToSsrHost`.
  let hydratedState = !server && Boolean(runtime.initialState)
  let ownerApp: App | null = null
  const runtimeOptions: VueApolloRuntimeOptions = {
    ...runtime,
    server,
    // Keep request-scoped credentials on the transport as well as in the
    // auth reader. `requestHeaders` is useful to callers that do not want to
    // populate the legacy `headers` field directly.
    headers: {
      ...(runtime.requestHeaders ?? {}),
      ...(runtime.headers ?? {}),
    },
    fetch: runtime.fetch ?? options.fetch,
    requestTimeoutMs: runtime.requestTimeoutMs ?? options.requestTimeoutMs,
    requestHeaders: runtime.requestHeaders ?? runtime.headers,
    runWithContext: <T>(callback: () => T): T =>
      ownerApp ? ownerApp.runWithContext(callback) : callback(),
  }

  const credentialCoordinator = createCredentialMutationCoordinator()
  const clients = graphqlConfig({
    endPoints: normalizedOptions.endPoints,
    tokenKey: normalizedOptions.auth?.tokenKey || normalizedOptions.tokenKey,
    tokenCookie: normalizedOptions.tokenCookie,
    setContext: normalizedOptions.setContext,
    memoryConfig: normalizedOptions.memoryConfig,
    useGETForQueries: normalizedOptions.useGETForQueries,
    apolloClientConfig: normalizedOptions.apolloClientConfig,
    apolloUploadConfig: normalizedOptions.apolloUploadConfig,
    refresh: normalizedOptions.refresh,
    refreshToken: normalizedOptions.refreshToken,
    onLogout: normalizedOptions.onLogout,
    getToken: normalizedOptions.getToken || normalizedOptions.auth?.getToken,
    setToken: normalizedOptions.setToken || normalizedOptions.auth?.setToken,
    clearToken: normalizedOptions.clearToken || normalizedOptions.auth?.clearToken,
    formatToken: normalizedOptions.formatToken,
    prepareOperation: managed?.prepareOperation,
    getSessionId: normalizedOptions.getSessionId,
    sessionMode: normalizedOptions.sessionMode || normalizedOptions.auth?.sessionMode,
    credentials: normalizedOptions.credentials,
    credentialCoordinator,
    runtime: runtimeOptions,
  })

  if (registerGlobal) {
    setGlobalConfig(normalizedOptions)
    setClients(clients)
  }

  const offline = createApolloOfflineRuntime(
    normalizedOptions,
    clients,
    () => installedAuth?.status.value === 'authenticated' ? installedAuth.user.value?.id : undefined,
    managed ? () => managed.prepareOperation(true) : undefined
  )
  let installedAuth: AuthState | undefined
  let removeSessionListeners = () => {}
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
    options: normalizedOptions,
    requestHeaders: runtimeOptions.requestHeaders,
    get hydrated() {
      return hydratedState
    },
    markHydrated: () => {
      hydratedState = true
    },
    offline,
    extract: () => extractApolloState(clients),
    restore: (state: VueApolloState | null | undefined) =>
      restoreApolloState(clients, state),
    restoreAuthState: (state) => {
      if (installedAuth) restoreInstalledAuthState(installedAuth, state)
    },
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
    prepareBrowserSession: managed?.read,
    purgeSessionCaches: async () => { await Promise.all(Object.values(clients).map(client => client.cache.reset())) },
    forgetBrowserSession: managed?.forget,
    captureBrowserLogout: managed?.captureLogout,
    credentialCoordinator,
    stop: () => {
      removeSessionListeners()
      managed?.forget()
      installedAuth?.reset()
      offline.stop()
      for (const client of Object.values(clients)) client.stop()
      if (activeBrowserRuntime === apolloRuntime) activeBrowserRuntime = null
    },
  }
  if (normalizedOptions.auth) {
    const configuredAuth = normalizedOptions.auth
    installedAuth = createAuthRuntime(apolloRuntime, {
      ...configuredAuth,
      tokenKey: configuredAuth.tokenKey || normalizedOptions.tokenKey,
      authBoundary:
        configuredAuth.authBoundary || normalizedOptions.authBoundary,
      sessionMode:
        configuredAuth.sessionMode || normalizedOptions.sessionMode,
      getToken: configuredAuth.getToken || normalizedOptions.getToken,
      setToken: configuredAuth.setToken || normalizedOptions.setToken,
      clearToken: configuredAuth.clearToken || normalizedOptions.clearToken,
      initialUser: runtime.initialAuthState?.user ?? null,
      // Navigation policy belongs to the consumer. The compatibility APIs can
      // still navigate when an explicit callback/router is supplied.
      autoNavigate: false,
    })
    apolloRuntime.auth = installedAuth
    if (!server && typeof window !== 'undefined') {
      let last = credentialCoordinator.capture?.()
      const resume = (event: Event) => {
        const current = credentialCoordinator.capture?.()
        const changed = current?.accessToken !== last?.accessToken || current?.refreshToken !== last?.refreshToken
        last = current
        const restored = (event as PageTransitionEvent).persisted
        if (changed || restored || (managed && event.type === 'focus' && installedAuth!.status.value !== 'unknown')) {
          void installedAuth!.verifySession().catch(() => undefined)
        }
      }
      const reconnect = () => {
        void installedAuth!.verifySession().then(async valid => { if (valid) await offline.sync() }).catch(() => undefined)
      }
      if (managed && offline.enabled) window.addEventListener('online', reconnect)
      window.addEventListener('focus', resume)
      window.addEventListener('pageshow', resume)
      removeSessionListeners = () => {
        window.removeEventListener('online', reconnect)
        window.removeEventListener('focus', resume)
        window.removeEventListener('pageshow', resume)
      }
    }
  }
  return apolloRuntime
}
