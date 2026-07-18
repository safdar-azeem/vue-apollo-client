import { inject, type App, type Plugin } from 'vue'
import { createApollo } from './createApollo'
import type { VueApolloClientOptions } from './types'

const SSR_REQUEST_CONTEXT = Symbol.for('vue-ssr:request-context')

interface ManagedSsrRequestContext {
  applicationId?: string
  publicConfig?: unknown
  request?: {
    cookie?: string
    signal?: AbortSignal
  }
  hydration?: {
    server: boolean
    read?: <T = unknown>(key: string) => T | undefined
  }
}

export interface ApolloConfigurationContext<TPublicConfig = unknown> {
  applicationId: string
  server: boolean
  publicConfig: TPublicConfig | undefined
}

export interface DefineApolloOptions {
  /** Application identity used when no managed SSR request context is present. */
  applicationId?: string
  /** Generic SSR hydration-state key. Defaults to `apollo`. */
  hydrationKey?: string
}

export type ApolloConfigurationResolver<TPublicConfig = unknown> = (
  context: ApolloConfigurationContext<TPublicConfig>
) => VueApolloClientOptions

const resolveRequestContext = (app: App): ManagedSsrRequestContext | null =>
  app.runWithContext(() =>
    inject<ManagedSsrRequestContext | null>(SSR_REQUEST_CONTEXT, null)
  )

/**
 * Defines one immutable Apollo configuration plugin for SPA, SSR, and browser
 * hydration. Runtime clients are created internally per owning Vue application.
 */
export const defineApollo = <TPublicConfig = unknown>(
  configuration:
    | VueApolloClientOptions
    | ApolloConfigurationResolver<TPublicConfig>,
  defaults: DefineApolloOptions = {}
): Plugin => {
  const installed = new WeakSet<App>()

  return {
    install(app: App) {
      if (installed.has(app)) return
      const requestContext = resolveRequestContext(app)
      const server = requestContext?.hydration?.server ?? typeof window === 'undefined'
      const applicationId =
        requestContext?.applicationId || defaults.applicationId || 'default'
      const context: ApolloConfigurationContext<TPublicConfig> = {
        applicationId,
        server,
        publicConfig: requestContext?.publicConfig as TPublicConfig | undefined,
      }
      const resolved =
        typeof configuration === 'function'
          ? configuration(context)
          : configuration
      const runtime = createApollo(
        { ...resolved, applicationId: resolved.applicationId || applicationId },
        {
          server,
          registerGlobal: !server,
          headers:
            server && requestContext?.request?.cookie
              ? { cookie: requestContext.request.cookie }
              : undefined,
          signal: server ? requestContext?.request?.signal : undefined,
          initialState: !server
            ? requestContext?.hydration?.read?.(
                defaults.hydrationKey || 'apollo'
              ) as any
            : undefined,
          fetch: resolved.fetch,
          requestTimeoutMs: resolved.requestTimeoutMs,
          hydrationKey: defaults.hydrationKey,
        }
      )
      app.use(runtime)
      installed.add(app)
    },
  }
}
