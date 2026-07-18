export * from './createApollo'
export * from './ApolloConfiguration'
export * from './ApolloOperationRuntime'
export * from './ApolloSsrRuntime'
export * from './composables'
export * from './ssrHydration'
export * from './types'
// Deprecated module-level state. Retained for backward compatibility only; the
// recommended path (defineApollo) never touches these. See ReadMe.md → Migration.
export { getGlobalConfig, getClients } from './configStore'
