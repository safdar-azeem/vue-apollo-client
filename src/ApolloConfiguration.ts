import { inject, type App, type Plugin } from 'vue'
import { createApollo } from './createApollo'
import type { VueApolloClientOptions } from './types'

const SSR_REQUEST_CONTEXT = Symbol.for('vue-ssr:request-context')

interface ManagedSsrRequestContext {
  applicationId?: string
  publicConfig?: unknown
  request?: {
    cookie?: string
    headers?: Readonly<Record<string, string | readonly string[] | undefined>>
    signal?: AbortSignal
  }
  hydration?: {
    server: boolean
    read?: <T = unknown>(key: string) => T | undefined
  }
}

const resolveRequestCredentialHeaders = (
  request: ManagedSsrRequestContext['request']
): Record<string, string> | undefined => {
  if (!request) return undefined
  const hasFilteredCookie = Object.prototype.hasOwnProperty.call(request, 'cookie')
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    const lowerName = name.toLowerCase()
    if (lowerName === 'cookie' && hasFilteredCookie) continue
    if (lowerName !== 'cookie' && lowerName !== 'authorization') continue
    if (typeof value === 'string') headers[lowerName] = value
    else if (Array.isArray(value)) {
      headers[lowerName] = value.join(lowerName === 'cookie' ? '; ' : ', ')
    }
  }
  if (hasFilteredCookie && request.cookie !== undefined) headers.cookie = request.cookie
  return Object.keys(headers).length ? headers : undefined
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
      const hydrationKey = defaults.hydrationKey || 'apollo'
      const requestHeaders = resolveRequestCredentialHeaders(requestContext?.request)
      const runtime = createApollo(
        { ...resolved, applicationId: resolved.applicationId || applicationId },
        {
          server,
          registerGlobal: !server,
          headers: server ? requestHeaders : undefined,
          requestHeaders,
          signal: server ? requestContext?.request?.signal : undefined,
          // Single restore path. On the browser this restores the serialized
          // SSR cache; on a server re-render pass it restores the cache carried
          // forward by the host so the runtime resumes warm. On the first
          // server pass the host has nothing to read, so this is undefined.
          initialState: requestContext?.hydration?.read?.(hydrationKey) as any,
          initialAuthState: requestContext?.hydration?.read?.(
            `${hydrationKey}:auth`
          ) as any,
          fetch: resolved.fetch,
          requestTimeoutMs: resolved.requestTimeoutMs,
          hydrationKey,
        }
      )
      app.use(runtime)
      installed.add(app)
    },
  }
}
