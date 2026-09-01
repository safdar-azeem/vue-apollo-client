import { inject, type App } from 'vue'
import type { VueApolloRuntime } from './createApollo'
import type { VueApolloAuthHydrationState, VueApolloState } from './types'

/**
 * Minimal shape of a generic SSR hydration host.
 *
 * An SSR framework (for example `vue-ssr-lite`) provides this on the Vue app so
 * plugins can embed serializable state during the server render and restore it
 * before the browser mounts. This package integrates with that host WITHOUT
 * importing it: the injection identity is shared through the global symbol
 * registry, so `vue-ssr-lite` never learns what Apollo is, and Apollo never
 * depends on `vue-ssr-lite`.
 */
export interface SsrHydrationHost {
  /** True during the server render, false during browser hydration. */
  readonly server: boolean
  /** Browser: the state contributed under `key` on the server, or `undefined`. */
  read<T = unknown>(key: string): T | undefined
  /** Server: register a contributor serialized under `key` after the render. */
  contribute(key: string, dehydrate: () => unknown): void
  /** Register teardown run after the render (server) or on teardown (browser). */
  onDispose(dispose: () => void): void
}

/**
 * Cross-package-stable injection key. Created with `Symbol.for(...)` so it
 * resolves to the same identity the SSR host registered, without a shared
 * import.
 */
export const SSR_HYDRATION_HOST = Symbol.for('vue-ssr:hydration-context')

/** Resolves the active SSR hydration host from the app, if one is installed. */
export const resolveSsrHydrationHost = (app: App): SsrHydrationHost | null =>
  app.runWithContext(
    () => inject<SsrHydrationHost | null>(SSR_HYDRATION_HOST, null)
  )

const isCredentialField = (key: string): boolean =>
  /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|authorization)$/i.test(key)

const safeAuthUser = (user: unknown): unknown => {
  try {
    return JSON.parse(JSON.stringify(user, (key, value) =>
      key && isCredentialField(key) ? undefined : value
    ))
  } catch {
    // A non-serializable user cannot be safely hydrated. The next browser
    // verification will repopulate it from the active session.
    return null
  }
}

/**
 * Connects an Apollo runtime to a generic SSR hydration host, if present.
 *
 * - Server: contributes the extracted per-request cache under `hydrationKey`
 *   and stops the runtime when the request is disposed.
 * - Browser: restores that cache before any query composable is created, so
 *   the first render serves from cache and no duplicate network request runs.
 *
 * Single restore path: when the runtime was already hydrated at construction
 * from `initialState` (the recommended `defineApollo` path — which also sets
 * `ssrForceFetchDelay` and the `hydrated` flag together), this does NOT restore
 * a second time. The browser branch only restores as a backward-compatible
 * fallback for a legacy `createApollo` runtime that received no `initialState`,
 * and it marks `hydrated` so downstream composables behave coherently.
 *
 * Called automatically by {@link createApollo}'s plugin during `app.use(...)`.
 */
export const connectApolloToSsrHost = (
  app: App,
  runtime: VueApolloRuntime,
  hydrationKey: string
): void => {
  const host = resolveSsrHydrationHost(app)
  if (!host) return
  const authHydrationKey = `${hydrationKey}:auth`
  if (host.server) {
    // Apollo cache hydration preserves the exact normalized cache. Auth
    // credentials are not stored in this cache by the session runtime; only
    // the dedicated auth projection below receives credential-field filtering.
    host.contribute(hydrationKey, () => runtime.extract())
    if (runtime.auth) {
      host.contribute(authHydrationKey, () => ({
        // Auth hydration is deliberately user-only. Access and refresh
        // credentials remain in cookies/custom stores and never enter HTML.
        user: safeAuthUser(runtime.auth?.user.value ?? null),
      } satisfies VueApolloAuthHydrationState))
    }
    host.onDispose(() => runtime.stop())
    return
  }
  // Browser. The construction-time `initialState` restore is the single source
  // of truth. Only fall back to restoring here when it did not run.
  if (!runtime.hydrated) {
    const restored = host.read<VueApolloState>(hydrationKey)
    if (restored !== undefined && restored !== null) {
      runtime.restore(restored)
      runtime.markHydrated()
      if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        console.warn(
          '[vue-apollo-client] Restored SSR cache through the legacy host path. ' +
            'Prefer defineApollo (or pass initialState to createApollo) so the ' +
            'cache-only first render and ssrForceFetchDelay apply together.'
        )
      }
    }
  }
  if (runtime.auth && runtime.auth.user.value == null) {
    runtime.restoreAuthState?.(
      host.read<VueApolloAuthHydrationState>(authHydrationKey)
    )
  }
}
