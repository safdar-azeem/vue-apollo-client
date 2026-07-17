import { useQuery as apolloUseQuery } from '@vue/apollo-composable'
import { unref, type Ref } from 'vue'
import type { OperationVariables } from '@apollo/client/core'
import type { UseQueryOptions, UseQueryReturn } from './useQuery'

/**
 * Backward-compatible alias for the unified query composable.
 *
 * Vue Apollo's native `onServerPrefetch` integration performs SSR prefetching;
 * callers receive the same synchronous return object on server and browser.
 * Existing `await useSSRQuery(...)` calls remain valid because awaiting a
 * non-Promise returns that object unchanged.
 */
export const useSSRQuery = <
  TResult = any,
  TVariables extends OperationVariables = OperationVariables,
>(
  document: any,
  variables?: TVariables | (() => TVariables) | Ref<TVariables>,
  options?:
    | UseQueryOptions<TResult, TVariables>
    | Ref<UseQueryOptions<TResult, TVariables>>
    | (() => UseQueryOptions<TResult, TVariables>)
): UseQueryReturn<TResult, TVariables> => {
  const normalizedOptions = () => {
    const resolved = typeof options === 'function' ? options() : unref(options) || {}
    const {
      ssr,
      refetchOnUpdate: _refetchOnUpdate,
      refetchTimeout: _refetchTimeout,
      ...nativeOptions
    } = resolved
    return {
      ...nativeOptions,
      prefetch: typeof window === 'undefined' ? ssr !== false : nativeOptions.prefetch,
    }
  }

  return apolloUseQuery<TResult, TVariables>(
    document,
    variables as any,
    normalizedOptions as any
  )
}
