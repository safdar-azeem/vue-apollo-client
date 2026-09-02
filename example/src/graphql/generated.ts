// @ts-nocheck
/* eslint-disable */
// Generated-compatible starter output.
// `vueApollo()` owns this file during development and may overwrite it.

import gql from 'graphql-tag'
import { useMutation, useQuery } from 'vue-apollo-client'

export type Maybe<T> = T | null

export type User = {
  __typename?: 'User'
  id: string
  name: string
  email: string
  permissions: string[]
}

export type Task = {
  __typename?: 'Task'
  id: string
  title: string
  done: boolean
  ownerId: string
}

export type MeQuery = { me?: Maybe<User> }
export type LoginMutation = {
  login: { token: string; refreshToken: string; user: User }
}
export type LoginMutationVariables = { email: string; password: string }
export type RefreshSessionMutation = {
  refreshSession: { token: string; refreshToken: string }
}
export type RefreshSessionMutationVariables = { refreshToken: string }
export type GetTasksQuery = { tasks: Task[] }
export type GetTaskQuery = { task?: Maybe<Task> }
export type GetTaskQueryVariables = { id: string }
export type CreateTaskMutation = { createTask: Task }
export type CreateTaskMutationVariables = { title: string }
export type UpdateTaskMutation = { updateTask: Task }
export type UpdateTaskMutationVariables = { id: string; title?: Maybe<string>; done?: Maybe<boolean> }
export type DeleteTaskMutation = { deleteTask: boolean }
export type DeleteTaskMutationVariables = { id: string }

export const MeDocument = gql`
  query Me {
    me { id name email permissions }
  }
`
export const LoginDocument = gql`
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      token
      refreshToken
      user { id name email permissions }
    }
  }
`
export const RefreshSessionDocument = gql`
  mutation RefreshSession($refreshToken: String!) {
    refreshSession(refreshToken: $refreshToken) { token refreshToken }
  }
`
export const GetTasksDocument = gql`
  query GetTasks {
    tasks { id title done ownerId }
  }
`
export const GetTaskDocument = gql`
  query GetTask($id: ID!) {
    task(id: $id) { id title done ownerId }
  }
`
export const CreateTaskDocument = gql`
  mutation CreateTask($title: String!) {
    createTask(title: $title) { id title done ownerId }
  }
`
export const UpdateTaskDocument = gql`
  mutation UpdateTask($id: ID!, $title: String, $done: Boolean) {
    updateTask(id: $id, title: $title, done: $done) { id title done ownerId }
  }
`
export const DeleteTaskDocument = gql`
  mutation DeleteTask($id: ID!) {
    deleteTask(id: $id)
  }
`

export function useMeQuery(options: any = {}) {
  return useQuery<MeQuery>(MeDocument, undefined, options)
}
export function useLoginMutation(options: any = {}) {
  return useMutation<LoginMutation, LoginMutationVariables>(LoginDocument, options)
}
export function useRefreshSessionMutation(options: any = {}) {
  return useMutation<RefreshSessionMutation, RefreshSessionMutationVariables>(RefreshSessionDocument, options)
}
export function useGetTasksQuery(options: any = {}) {
  return useQuery<GetTasksQuery>(GetTasksDocument, undefined, options)
}
export function useGetTaskQuery(variables: any, options: any = {}) {
  return useQuery<GetTaskQuery, GetTaskQueryVariables>(GetTaskDocument, variables, options)
}
export function useCreateTaskMutation(options: any = {}) {
  return useMutation<CreateTaskMutation, CreateTaskMutationVariables>(CreateTaskDocument, options)
}
export function useUpdateTaskMutation(options: any = {}) {
  return useMutation<UpdateTaskMutation, UpdateTaskMutationVariables>(UpdateTaskDocument, options)
}
export function useDeleteTaskMutation(options: any = {}) {
  return useMutation<DeleteTaskMutation, DeleteTaskMutationVariables>(DeleteTaskDocument, options)
}
