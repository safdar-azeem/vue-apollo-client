// @ts-nocheck
/* eslint-disable */

/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import gql from 'graphql-tag';
import * as VueApolloComposable from 'vue-apollo-client';
import * as VueCompositionApi from 'vue';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type ReactiveFunction<TParam> = () => TParam;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type Mutation = {
  __typename?: 'Mutation';
  createTask: Task;
  deleteTask: Scalars['Boolean']['output'];
  login: Session;
  refreshSession: RefreshResult;
  updateTask: Task;
};


export type MutationCreateTaskArgs = {
  title: Scalars['String']['input'];
};


export type MutationDeleteTaskArgs = {
  id: Scalars['ID']['input'];
};


export type MutationLoginArgs = {
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
};


export type MutationRefreshSessionArgs = {
  refreshToken: Scalars['String']['input'];
};


export type MutationUpdateTaskArgs = {
  done?: InputMaybe<Scalars['Boolean']['input']>;
  id: Scalars['ID']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
};

export type Query = {
  __typename?: 'Query';
  me?: Maybe<User>;
  task?: Maybe<Task>;
  tasks: Array<Task>;
};


export type QueryTaskArgs = {
  id: Scalars['ID']['input'];
};

export type RefreshResult = {
  __typename?: 'RefreshResult';
  refreshToken: Scalars['String']['output'];
  token: Scalars['String']['output'];
};

export type Session = {
  __typename?: 'Session';
  refreshToken: Scalars['String']['output'];
  token: Scalars['String']['output'];
  user: User;
};

export type Task = {
  __typename?: 'Task';
  done: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  ownerId: Scalars['ID']['output'];
  title: Scalars['String']['output'];
};

export type User = {
  __typename?: 'User';
  email: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  permissions: Array<Scalars['String']['output']>;
};

export type LoginMutationVariables = Exact<{
  email: string;
  password: string;
}>;


export type LoginMutation = { login: { token: string, refreshToken: string, user: { id: string, name: string, email: string, permissions: Array<string> } } };

export type RefreshSessionMutationVariables = Exact<{
  refreshToken: string;
}>;


export type RefreshSessionMutation = { refreshSession: { token: string, refreshToken: string } };

export type CreateTaskMutationVariables = Exact<{
  title: string;
}>;


export type CreateTaskMutation = { createTask: { id: string, title: string, done: boolean, ownerId: string } };

export type UpdateTaskMutationVariables = Exact<{
  id: string | number;
  title?: string | null | undefined;
  done?: boolean | null | undefined;
}>;


export type UpdateTaskMutation = { updateTask: { id: string, title: string, done: boolean, ownerId: string } };

export type DeleteTaskMutationVariables = Exact<{
  id: string | number;
}>;


export type DeleteTaskMutation = { deleteTask: boolean };

export type MeQueryVariables = Exact<{ [key: string]: never; }>;


export type MeQuery = { me: { id: string, name: string, email: string, permissions: Array<string> } | null };

export type GetTasksQueryVariables = Exact<{ [key: string]: never; }>;


export type GetTasksQuery = { tasks: Array<{ id: string, title: string, done: boolean, ownerId: string }> };

export type GetTaskQueryVariables = Exact<{
  id: string | number;
}>;


export type GetTaskQuery = { task: { id: string, title: string, done: boolean, ownerId: string } | null };


export const LoginDocument = gql`
    mutation Login($email: String!, $password: String!) {
  login(email: $email, password: $password) {
    token
    refreshToken
    user {
      id
      name
      email
      permissions
    }
  }
}
    `;

/**
 * __useLoginMutation__
 *
 * To run a mutation, you first call `useLoginMutation` within a Vue component and pass it any options that fit your needs.
 * When your component renders, `useLoginMutation` returns an object that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - Several other properties: https://v4.apollo.vuejs.org/api/use-mutation.html#return
 *
 * @param options that will be passed into the mutation, supported options are listed on: https://v4.apollo.vuejs.org/guide-composable/mutation.html#options;
 *
 * @example
 * const { mutate, loading, error, onDone } = useLoginMutation({
 *   variables: {
 *     email: // value for 'email'
 *     password: // value for 'password'
 *   },
 * });
 */
export function useLoginMutation(options: VueApolloComposable.UseMutationOptions<LoginMutation, LoginMutationVariables> | ReactiveFunction<VueApolloComposable.UseMutationOptions<LoginMutation, LoginMutationVariables>> = {}) {
  return VueApolloComposable.useMutation<LoginMutation, LoginMutationVariables>(LoginDocument, options);
}
export type LoginMutationCompositionFunctionResult = VueApolloComposable.UseMutationReturn<LoginMutation, LoginMutationVariables>;
export const RefreshSessionDocument = gql`
    mutation RefreshSession($refreshToken: String!) {
  refreshSession(refreshToken: $refreshToken) {
    token
    refreshToken
  }
}
    `;

/**
 * __useRefreshSessionMutation__
 *
 * To run a mutation, you first call `useRefreshSessionMutation` within a Vue component and pass it any options that fit your needs.
 * When your component renders, `useRefreshSessionMutation` returns an object that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - Several other properties: https://v4.apollo.vuejs.org/api/use-mutation.html#return
 *
 * @param options that will be passed into the mutation, supported options are listed on: https://v4.apollo.vuejs.org/guide-composable/mutation.html#options;
 *
 * @example
 * const { mutate, loading, error, onDone } = useRefreshSessionMutation({
 *   variables: {
 *     refreshToken: // value for 'refreshToken'
 *   },
 * });
 */
export function useRefreshSessionMutation(options: VueApolloComposable.UseMutationOptions<RefreshSessionMutation, RefreshSessionMutationVariables> | ReactiveFunction<VueApolloComposable.UseMutationOptions<RefreshSessionMutation, RefreshSessionMutationVariables>> = {}) {
  return VueApolloComposable.useMutation<RefreshSessionMutation, RefreshSessionMutationVariables>(RefreshSessionDocument, options);
}
export type RefreshSessionMutationCompositionFunctionResult = VueApolloComposable.UseMutationReturn<RefreshSessionMutation, RefreshSessionMutationVariables>;
export const CreateTaskDocument = gql`
    mutation CreateTask($title: String!) {
  createTask(title: $title) {
    id
    title
    done
    ownerId
  }
}
    `;

/**
 * __useCreateTaskMutation__
 *
 * To run a mutation, you first call `useCreateTaskMutation` within a Vue component and pass it any options that fit your needs.
 * When your component renders, `useCreateTaskMutation` returns an object that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - Several other properties: https://v4.apollo.vuejs.org/api/use-mutation.html#return
 *
 * @param options that will be passed into the mutation, supported options are listed on: https://v4.apollo.vuejs.org/guide-composable/mutation.html#options;
 *
 * @example
 * const { mutate, loading, error, onDone } = useCreateTaskMutation({
 *   variables: {
 *     title: // value for 'title'
 *   },
 * });
 */
export function useCreateTaskMutation(options: VueApolloComposable.UseMutationOptions<CreateTaskMutation, CreateTaskMutationVariables> | ReactiveFunction<VueApolloComposable.UseMutationOptions<CreateTaskMutation, CreateTaskMutationVariables>> = {}) {
  return VueApolloComposable.useMutation<CreateTaskMutation, CreateTaskMutationVariables>(CreateTaskDocument, options);
}
export type CreateTaskMutationCompositionFunctionResult = VueApolloComposable.UseMutationReturn<CreateTaskMutation, CreateTaskMutationVariables>;
export const UpdateTaskDocument = gql`
    mutation UpdateTask($id: ID!, $title: String, $done: Boolean) {
  updateTask(id: $id, title: $title, done: $done) {
    id
    title
    done
    ownerId
  }
}
    `;

/**
 * __useUpdateTaskMutation__
 *
 * To run a mutation, you first call `useUpdateTaskMutation` within a Vue component and pass it any options that fit your needs.
 * When your component renders, `useUpdateTaskMutation` returns an object that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - Several other properties: https://v4.apollo.vuejs.org/api/use-mutation.html#return
 *
 * @param options that will be passed into the mutation, supported options are listed on: https://v4.apollo.vuejs.org/guide-composable/mutation.html#options;
 *
 * @example
 * const { mutate, loading, error, onDone } = useUpdateTaskMutation({
 *   variables: {
 *     id: // value for 'id'
 *     title: // value for 'title'
 *     done: // value for 'done'
 *   },
 * });
 */
export function useUpdateTaskMutation(options: VueApolloComposable.UseMutationOptions<UpdateTaskMutation, UpdateTaskMutationVariables> | ReactiveFunction<VueApolloComposable.UseMutationOptions<UpdateTaskMutation, UpdateTaskMutationVariables>> = {}) {
  return VueApolloComposable.useMutation<UpdateTaskMutation, UpdateTaskMutationVariables>(UpdateTaskDocument, options);
}
export type UpdateTaskMutationCompositionFunctionResult = VueApolloComposable.UseMutationReturn<UpdateTaskMutation, UpdateTaskMutationVariables>;
export const DeleteTaskDocument = gql`
    mutation DeleteTask($id: ID!) {
  deleteTask(id: $id)
}
    `;

/**
 * __useDeleteTaskMutation__
 *
 * To run a mutation, you first call `useDeleteTaskMutation` within a Vue component and pass it any options that fit your needs.
 * When your component renders, `useDeleteTaskMutation` returns an object that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - Several other properties: https://v4.apollo.vuejs.org/api/use-mutation.html#return
 *
 * @param options that will be passed into the mutation, supported options are listed on: https://v4.apollo.vuejs.org/guide-composable/mutation.html#options;
 *
 * @example
 * const { mutate, loading, error, onDone } = useDeleteTaskMutation({
 *   variables: {
 *     id: // value for 'id'
 *   },
 * });
 */
export function useDeleteTaskMutation(options: VueApolloComposable.UseMutationOptions<DeleteTaskMutation, DeleteTaskMutationVariables> | ReactiveFunction<VueApolloComposable.UseMutationOptions<DeleteTaskMutation, DeleteTaskMutationVariables>> = {}) {
  return VueApolloComposable.useMutation<DeleteTaskMutation, DeleteTaskMutationVariables>(DeleteTaskDocument, options);
}
export type DeleteTaskMutationCompositionFunctionResult = VueApolloComposable.UseMutationReturn<DeleteTaskMutation, DeleteTaskMutationVariables>;
export const MeDocument = gql`
    query Me {
  me {
    id
    name
    email
    permissions
  }
}
    `;

/**
 * __useMeQuery__
 *
 * To run a query within a Vue component, call `useMeQuery` and pass it any options that fit your needs.
 * When your component renders, `useMeQuery` returns an object from Apollo Client that contains result, loading and error properties
 * you can use to render your UI.
 *
 * @param options that will be passed into the query, supported options are listed on: https://v4.apollo.vuejs.org/guide-composable/query.html#options;
 *
 * @example
 * const { result, loading, error } = useMeQuery();
 */
export function useMeQuery(options: VueApolloComposable.UseQueryOptions<MeQuery, MeQueryVariables> | VueCompositionApi.Ref<VueApolloComposable.UseQueryOptions<MeQuery, MeQueryVariables>> | ReactiveFunction<VueApolloComposable.UseQueryOptions<MeQuery, MeQueryVariables>> = {}) {
  return VueApolloComposable.useQuery<MeQuery, MeQueryVariables>(MeDocument, {}, options);
}
export function useMeLazyQuery(options: VueApolloComposable.UseQueryOptions<MeQuery, MeQueryVariables> | VueCompositionApi.Ref<VueApolloComposable.UseQueryOptions<MeQuery, MeQueryVariables>> | ReactiveFunction<VueApolloComposable.UseQueryOptions<MeQuery, MeQueryVariables>> = {}) {
  return VueApolloComposable.useLazyQuery<MeQuery, MeQueryVariables>(MeDocument, {}, options);
}
export type MeQueryCompositionFunctionResult = VueApolloComposable.UseQueryReturn<MeQuery, MeQueryVariables>;
export const GetTasksDocument = gql`
    query GetTasks {
  tasks {
    id
    title
    done
    ownerId
  }
}
    `;

/**
 * __useGetTasksQuery__
 *
 * To run a query within a Vue component, call `useGetTasksQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetTasksQuery` returns an object from Apollo Client that contains result, loading and error properties
 * you can use to render your UI.
 *
 * @param options that will be passed into the query, supported options are listed on: https://v4.apollo.vuejs.org/guide-composable/query.html#options;
 *
 * @example
 * const { result, loading, error } = useGetTasksQuery();
 */
export function useGetTasksQuery(options: VueApolloComposable.UseQueryOptions<GetTasksQuery, GetTasksQueryVariables> | VueCompositionApi.Ref<VueApolloComposable.UseQueryOptions<GetTasksQuery, GetTasksQueryVariables>> | ReactiveFunction<VueApolloComposable.UseQueryOptions<GetTasksQuery, GetTasksQueryVariables>> = {}) {
  return VueApolloComposable.useQuery<GetTasksQuery, GetTasksQueryVariables>(GetTasksDocument, {}, options);
}
export function useGetTasksLazyQuery(options: VueApolloComposable.UseQueryOptions<GetTasksQuery, GetTasksQueryVariables> | VueCompositionApi.Ref<VueApolloComposable.UseQueryOptions<GetTasksQuery, GetTasksQueryVariables>> | ReactiveFunction<VueApolloComposable.UseQueryOptions<GetTasksQuery, GetTasksQueryVariables>> = {}) {
  return VueApolloComposable.useLazyQuery<GetTasksQuery, GetTasksQueryVariables>(GetTasksDocument, {}, options);
}
export type GetTasksQueryCompositionFunctionResult = VueApolloComposable.UseQueryReturn<GetTasksQuery, GetTasksQueryVariables>;
export const GetTaskDocument = gql`
    query GetTask($id: ID!) {
  task(id: $id) {
    id
    title
    done
    ownerId
  }
}
    `;

/**
 * __useGetTaskQuery__
 *
 * To run a query within a Vue component, call `useGetTaskQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetTaskQuery` returns an object from Apollo Client that contains result, loading and error properties
 * you can use to render your UI.
 *
 * @param variables that will be passed into the query
 * @param options that will be passed into the query, supported options are listed on: https://v4.apollo.vuejs.org/guide-composable/query.html#options;
 *
 * @example
 * const { result, loading, error } = useGetTaskQuery({
 *   id: // value for 'id'
 * });
 */
export function useGetTaskQuery(variables: GetTaskQueryVariables | VueCompositionApi.Ref<GetTaskQueryVariables> | ReactiveFunction<GetTaskQueryVariables>, options: VueApolloComposable.UseQueryOptions<GetTaskQuery, GetTaskQueryVariables> | VueCompositionApi.Ref<VueApolloComposable.UseQueryOptions<GetTaskQuery, GetTaskQueryVariables>> | ReactiveFunction<VueApolloComposable.UseQueryOptions<GetTaskQuery, GetTaskQueryVariables>> = {}) {
  return VueApolloComposable.useQuery<GetTaskQuery, GetTaskQueryVariables>(GetTaskDocument, variables, options);
}
export function useGetTaskLazyQuery(variables?: GetTaskQueryVariables | VueCompositionApi.Ref<GetTaskQueryVariables> | ReactiveFunction<GetTaskQueryVariables>, options: VueApolloComposable.UseQueryOptions<GetTaskQuery, GetTaskQueryVariables> | VueCompositionApi.Ref<VueApolloComposable.UseQueryOptions<GetTaskQuery, GetTaskQueryVariables>> | ReactiveFunction<VueApolloComposable.UseQueryOptions<GetTaskQuery, GetTaskQueryVariables>> = {}) {
  return VueApolloComposable.useLazyQuery<GetTaskQuery, GetTaskQueryVariables>(GetTaskDocument, variables, options);
}
export type GetTaskQueryCompositionFunctionResult = VueApolloComposable.UseQueryReturn<GetTaskQuery, GetTaskQueryVariables>;