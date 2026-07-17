import type {
  ApolloClient,
  ApolloQueryResult,
  ErrorPolicy,
  FetchPolicy,
  FetchResult,
  NormalizedCacheObject,
  OperationVariables,
} from '@apollo/client/core/index.js'
import type { DocumentNode } from 'graphql'

export type VueApolloClients = Record<
  string,
  ApolloClient<NormalizedCacheObject>
>

export interface VueApolloRuntimeLike {
  clients: VueApolloClients
}

interface VueApolloExecutionBase {
  clientId?: string
  context?: Record<string, any>
  signal?: AbortSignal
  timeoutMs?: number
}

export interface VueApolloQueryExecution<
  TData,
  TVariables extends OperationVariables = OperationVariables,
> extends VueApolloExecutionBase {
  document: DocumentNode
  variables?: TVariables
  fetchPolicy?: FetchPolicy
  errorPolicy?: ErrorPolicy
}

export interface VueApolloMutationExecution<
  TData,
  TVariables extends OperationVariables = OperationVariables,
> extends VueApolloExecutionBase {
  document: DocumentNode
  variables?: TVariables
  errorPolicy?: ErrorPolicy
  refetchQueries?: any
  awaitRefetchQueries?: boolean
}

const resolveClient = (
  runtime: VueApolloRuntimeLike,
  clientId = 'default'
): ApolloClient<NormalizedCacheObject> => {
  const client = runtime.clients[clientId]
  if (!client) throw new Error(`Apollo client "${clientId}" is not installed.`)
  return client
}

const executeWithAbort = async <T>(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
  execute: (signal: AbortSignal | undefined) => Promise<T>
): Promise<T> => {
  const timeout = Number(timeoutMs)
  if (!signal && (!Number.isFinite(timeout) || timeout <= 0)) {
    return execute(undefined)
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = Number.isFinite(timeout) && timeout > 0
    ? setTimeout(abort, timeout)
    : undefined

  try {
    return await execute(controller.signal)
  } finally {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

const operationContext = (
  context: Record<string, any> | undefined,
  signal: AbortSignal | undefined
) => signal
  ? {
      ...context,
      fetchOptions: { ...context?.fetchOptions, signal },
    }
  : context

export const executeApolloQuery = <
  TData,
  TVariables extends OperationVariables = OperationVariables,
>(
  runtime: VueApolloRuntimeLike,
  execution: VueApolloQueryExecution<TData, TVariables>
): Promise<ApolloQueryResult<TData>> => {
  const client = resolveClient(runtime, execution.clientId)
  return executeWithAbort(
    execution.signal,
    execution.timeoutMs,
    (signal) => client.query({
      query: execution.document,
      variables: execution.variables,
      fetchPolicy: execution.fetchPolicy,
      errorPolicy: execution.errorPolicy,
      context: operationContext(execution.context, signal),
    } as any) as Promise<ApolloQueryResult<TData>>
  )
}

export const executeApolloMutation = <
  TData,
  TVariables extends OperationVariables = OperationVariables,
>(
  runtime: VueApolloRuntimeLike,
  execution: VueApolloMutationExecution<TData, TVariables>
): Promise<FetchResult<TData>> => {
  const client = resolveClient(runtime, execution.clientId)
  return executeWithAbort(
    execution.signal,
    execution.timeoutMs,
    (signal) => client.mutate({
      mutation: execution.document,
      variables: execution.variables,
      errorPolicy: execution.errorPolicy,
      refetchQueries: execution.refetchQueries,
      awaitRefetchQueries: execution.awaitRefetchQueries,
      context: operationContext(execution.context, signal),
    } as any) as Promise<FetchResult<TData>>
  )
}
