import { inject, type App } from 'vue'
import type { VueApolloRuntime } from './createApollo'

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

/**
 * Connects an Apollo runtime to a generic SSR hydration host, if present.
 *
 * - Server: contributes the extracted per-request cache under `hydrationKey`
 *   and stops the runtime when the request is disposed.
 * - Browser: restores that cache before any query composable is created, so
 *   the first render serves from cache and no duplicate network request runs.
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
  if (host.server) {
    host.contribute(hydrationKey, () => runtime.extract())
    host.onDispose(() => runtime.stop())
  } else {
    runtime.restore(host.read(hydrationKey))
  }
}
