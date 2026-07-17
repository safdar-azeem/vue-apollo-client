import {
  useMutation as apolloUseMutation,
  type UseMutationOptions,
  type UseMutationReturn,
} from '@vue/apollo-composable'
import type { OperationVariables } from '@apollo/client/core/index.js'
import { useApolloRuntime } from '../createApollo'

export type { UseMutationOptions, UseMutationReturn } from '@vue/apollo-composable'

export const useMutation = <
  TResult = any,
  TVariables extends OperationVariables = OperationVariables,
>(
  document: any,
  options?: UseMutationOptions<TResult, TVariables> | any
): UseMutationReturn<TResult, TVariables> => {
  const runtime = useApolloRuntime()
  const mutation = apolloUseMutation<TResult, TVariables>(document, options)
  const originalMutate = mutation.mutate
  const clientId = options?.clientId || 'default'

  mutation.mutate = (async (variables?: TVariables, overrideOptions?: any) => {
    if (
      runtime.offline.enabled &&
      typeof navigator !== 'undefined' &&
      navigator.onLine === false
    ) {
      runtime.offline.enqueue(clientId, document, variables, {
        ...options,
        ...overrideOptions,
      })
      return { data: null } as any
    }

    const result = await originalMutate(variables, overrideOptions)
    if (runtime.offline.enabled) void runtime.offline.sync(clientId)
    return result
  }) as typeof mutation.mutate

  return mutation
}
