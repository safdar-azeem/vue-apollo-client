import {
  useQuery as apolloUseQuery,
  type UseQueryOptions as ApolloUseQueryOptions,
  type UseQueryReturn,
} from '@vue/apollo-composable'
import { unref, type Ref } from 'vue'
import type {
  OperationVariables,
  WatchQueryFetchPolicy,
} from '@apollo/client/core/index.js'

export type { UseQueryReturn } from '@vue/apollo-composable'

export interface UseQueryOptions<
  TData = any,
  TVariables extends OperationVariables = OperationVariables,
> extends Omit<ApolloUseQueryOptions<TData, TVariables>, 'nextFetchPolicy'> {
  ssr?: boolean
  /** @deprecated Reactive variables and Apollo cache policies own refetching. */
  refetchOnUpdate?: boolean
  /** @deprecated Use Apollo fetch policies or explicit `refetch()`. */
  refetchTimeout?: number
  nextFetchPolicy?:
    | WatchQueryFetchPolicy
    | string
    | ApolloUseQueryOptions<TData, TVariables>['nextFetchPolicy']
}

export const useQuery = <
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
  const nativeOptions = () => {
    const resolved = typeof options === 'function' ? options() : unref(options) || {}
    const {
      ssr,
      refetchOnUpdate: _refetchOnUpdate,
      refetchTimeout: _refetchTimeout,
      ...apolloOptions
    } = resolved
    return typeof window === 'undefined'
      ? { ...apolloOptions, prefetch: ssr !== false }
      : apolloOptions
  }

  return apolloUseQuery<TResult, TVariables>(
    document,
    variables as any,
    nativeOptions as any
  )
}
