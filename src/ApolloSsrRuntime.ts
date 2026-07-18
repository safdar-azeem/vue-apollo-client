import { hasInjectionContext, inject } from 'vue'

/**
 * Minimal shape of the generic SSR resolution contract exposed by an SSR host
 * (for example `vue-ssr-lite`). Apollo integrates with it WITHOUT importing the
 * host: the injection identity is shared through the global symbol registry, so
 * the host never learns what Apollo is and Apollo never depends on the host.
 */
export interface ApolloSsrResolution {
  readonly server: boolean
  track<T>(work: Promise<T>): Promise<T>
  requestAdditionalPass(): void
}

/** Cross-package-stable resolution injection key (re-derived, no import). */
export const SSR_REQUEST_RESOLUTION = Symbol.for('vue-ssr:request-resolution')

/**
 * Resolve the active SSR resolution contract, if a host installed one. MUST be
 * called during component `setup` (it uses `inject`). Capture the result and
 * reuse it inside later async hooks such as `onServerPrefetch`.
 */
export const resolveApolloServerResolution = (): ApolloSsrResolution | null => {
  if (!hasInjectionContext()) return null
  return inject<ApolloSsrResolution | null>(SSR_REQUEST_RESOLUTION, null)
}

/**
 * Register a server-side operation with the resolution contract so the renderer
 * can await it regardless of which composable started it. No-op in the browser
 * or when no host is present. Returns the same promise for chaining.
 */
export const trackApolloServerWork = <T>(
  resolution: ApolloSsrResolution | null,
  work: Promise<T>
): Promise<T> => {
  if (resolution?.server) resolution.track(work)
  return work
}
