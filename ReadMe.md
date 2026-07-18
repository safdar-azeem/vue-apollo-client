# Vue Apollo Client

A Vue 3, Vite, Nuxt 3 Apollo Client featuring smart queries with caching and refetching, SSR support, offline mutations, **zero-config code generation**, and **built-in auth lifecycle**.

Package-managed Apollo for Vue 3 SPA, SSR, and hydration. Applications declare
one configuration and use generated composables; the package owns client
creation, request isolation, prefetch, cache transfer, restoration, cleanup,
timeouts, token refresh, and Vite runtime identity.

## Features

- Apollo Client integration with Vue 3
- Server-Side Rendering (SSR) support
- GraphQL Code Generator integration
- Offline support (mutations)
- Multiple client support
- File Upload support
- Automatic token management
- **`defineApollo` configuration plugin** — one config for SPA, SSR, and hydration
- **Built-in auth runtime** — `createAuthRuntime({ useMeQuery })` / `useAuth` handles the full session lifecycle (verify / logout / auto SPA-navigate on auth failure)
- **Auto-detected cookie options** — `setToken` / `removeToken` pick the right `secure` / `sameSite` / `domain` for the current environment
- Automatic type generation for queries and mutations
- Auto-imports for generated composables and types
- Authentication support with cookie, token, and refresh token
- Request timeouts and abort-signal forwarding
- Production-ready 📦


## Installation

```bash
npm install vue-apollo-client
# or
yarn add vue-apollo-client
```

### Everything is set up for you: 🚀

- GraphQL codegen is handled by the Vite plugin
- Apollo Client runtime configuration is done for you via `defineApollo`
- Cookie attributes (domain, secure, sameSite) are auto-detected
- Auth flow (verify / logout / session expiry) is built in
- SSR request isolation, cache transfer, and hydration restore are package-owned

---

> Don't forget to follow me on [GitHub](https://github.com/safdar-azeem)!

---

## Setup

### 1. Vite Plugin

To enable automatic codegen without manual configuration, add the Vite plugin. This will scan your `.graphql` files and generate typed composables automatically.

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { vueApollo } from 'vue-apollo-client/vite'

export default defineConfig({
  plugins: [
    vue(),
    vueApollo({
      // Optional configuration
      // documents: ['src/graphql/**/*.{graphql,gql}'],
      // schema: process.env.VITE_GRAPHQL_ENDPOINT,
      // schema: 'http://localhost:4000/graphql'
    }),
  ],
})
```

Now, just run `npm run dev`. The plugin will:

1. Scan for `.graphql` files.
2. Generate typed hooks in `src/graphql/generated.ts`.
3. Watch for changes and regenerate automatically.

### 2. App Initialization

Define one configuration with `defineApollo`. It returns a Vue plugin, not an
Apollo client. It creates the internal runtime only when an owning Vue
application is installed.

```typescript
// src/config/ApolloConfiguration.ts
import {
  defineApollo,
  getRefreshToken,
  setToken,
  removeToken,
} from 'vue-apollo-client'
import { useRefreshTokensMutation } from '@/graphql'

export default defineApollo(
  ({ applicationId }) => ({
    endPoints: {
      default: import.meta.env.VITE_GRAPHQL_ENDPOINT,
      // Add more endpoints as needed
      // api2: 'http://localhost:3000/graphql',
      // const { result, loading, error, refetch } = useMeQuery({}, { clientId: 'api2' })
    },
    authBoundary:
      applicationId === 'website' ? 'website-customer' : 'admin',
    tokenKey: 'auth_token',
    allowOffline: true,
    requestTimeoutMs: 8_000,
    refresh: {
      useMutation: useRefreshTokensMutation,
      getRefreshToken: () => getRefreshToken('auth_token'),
      createVariables: (refreshToken) => ({ refreshToken }),
      selectTokens: (data) => data?.refreshTokens,
      persistTokens: ({ token, refreshToken }) =>
        setToken({ key: 'auth_token', token, refreshToken }),
      clearTokens: () => removeToken('auth_token'),
    },
  }),
  { applicationId: 'admin' }
)
```

Install that same plugin in a SPA:

```typescript
import { createApp } from 'vue'
import apolloConfiguration from './config/ApolloConfiguration'
import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(apolloConfiguration)
app.use(router)
app.mount('#app')
```

Pass `navigate` to `createAuthRuntime` / `useAuth` so logout and session expiry
can SPA-navigate. `setAuthRouter(router)` still works for compatibility, but
prefer `navigate`.

An SSR host can install the same plugin as a generic application plugin. When
the host provides the `vue-ssr` request and hydration contracts, the package
automatically:

- creates a fresh named-client set and cache for each request
- forwards only the host-filtered cookie header
- attaches the request abort signal and configured timeout
- waits for generated composables using Vue server prefetch
- extracts cache state after rendering
- restores it before browser component setup
- prevents duplicate initial hydration queries
- stops request clients during host cleanup

No application code creates a server client, calls `executeQuery`, extracts a
cache, serializes state, or restores hydration data.

## Usage

### Built-in Authentication

The library ships with `createAuthRuntime` / `useAuth`, which handle the full session lifecycle out of the box — `me` query, single-flight verification, auth-error detection, store clearing, and SPA logout navigation.

Prefer a generated `useMeQuery` composable. Application code should not import GraphQL documents for auth.

```typescript
import { createAuthRuntime } from 'vue-apollo-client'
import { useMeQuery } from './graphql'

// Shared reactive state — every component sees the same `user`.
const { user, isAuthenticated, verify, logout, loading, error } = createAuthRuntime({
  useMeQuery, // generated composable
  meSelector: (data) => data?.me, // how to extract the user
  tokenKey: 'auth_token',
  loginRoute: '/auth/login', // SPA redirect target on logout
  navigate: (path) => router.push(path),
})

// Run the `me` query — returns true if authenticated, false otherwise.
const ok = await verify()

// Logout — clears the cookie, drops the Apollo store, navigates to login.
await logout()
```

`verify()` is single-flight. Authentication teardown clears tokens and the active application cache before navigation. A configured `getSessionId` automatically invalidates cached data when the browser session changes.

`useAuth(options)` resolves the installed runtime and calls `createAuthRuntime`.

#### What `useAuth` / `createAuthRuntime` does for you

- **Single-flight `verify()`** — concurrent calls share the same promise
- **Detects auth failures** — `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND` ("user not found"), HTTP 401 / 403
- **Treats 5xx / network as transient** — token is kept so a later retry can succeed
- **On auth failure**: wipes cookie → clears Apollo store → SPA-navigates to `loginRoute`
- **No reload storm** — a teardown latch prevents in-flight `me` responses from re-entering the teardown
- **Auto-recovers on re-login** — a fresh token automatically clears the latch

#### Router guard example

```typescript
import { createAuthRuntime, getToken } from 'vue-apollo-client'
import { useMeQuery } from './graphql'

const { verify } = createAuthRuntime({
  useMeQuery,
  tokenKey: 'auth_token',
  loginRoute: '/auth/login',
  navigate: (path) => router.push(path),
})

export const authGuard = async (to, _from, next) => {
  if (!getToken('auth_token')) {
    return to.meta.requiresAuth ? next({ path: '/auth/login', query: to.query }) : next()
  }

  if (to.meta.requiresAuth) {
    const ok = await verify()
    if (!ok) {
      return next({ path: '/auth/login', query: { reason: 'session_expired' } })
    }
  }

  next()
}
```

### 1. Define a query

```graphql
# src/graphql/user.query.graphql
query GetUser {
  me {
    id
    name
  }
}
```

### 2. Client-side Query

For standard client-side fetching:

```vue
<script setup>
import { useMeQuery } from './graphql/generated'

const { result, loading, error, refetch } = useMeQuery()
</script>
```

### 3. Server-side Query (SSR) and Async Prefetching

When a managed SSR host is present, generated composables with `{ ssr: true }` are prefetched on the server through Vue `onServerPrefetch`. After HTML render, the package extracts the Apollo cache, transfers it with the page, and restores it before browser setup so hydration does not refetch the same data.

```vue
<script setup>
import { useGetPostsQuery } from './graphql/generated'

// Prefetch on the server; restore from cache during browser hydration.
const { result, loading, error, refetch } = useGetPostsQuery(
  {},
  { ssr: true, fetchPolicy: 'cache-first' }
)
</script>

<template>
  <article v-for="post in result?.posts ?? []" :key="post.id">
    <h2>{{ post.title }}</h2>
  </article>
</template>
```

Use `ssr: true` for public data that should be included in server-rendered HTML.

Use `ssr: false` for browser-only or private queries.

Disabled generated queries can be used on demand without accessing a client:

```typescript
const query = useGetServiceQuery({ id }, { enabled: false })
const result = await query.refetch({ id })
query.stop()
```

#### The `ssr: true` option (Client-Side Suspense)

You can also explicitly pass `{ ssr: true }` as an option to force the query to behave asynchronously _even on the client side_. This is highly useful when using Vue's `<Suspense>` component, allowing you to block the component tree from rendering until the data is fully fetched.

```vue
<script setup>
import { useGetUserQuery } from './graphql/generated'

// Forces the query to return a Promise on the client side as well.
// The component mounting will suspend until the query finishes.
const { result } = await useGetUserQuery({ id: 1 }, { ssr: true })
</script>
```

### Different Apollo Clients

You can use different Apollo Clients for different queries.

```vue
<script setup>
// with default client
const { result, loading, error, refetch } = useMeQuery()
// with api2 client
const { result, loading, error, refetch } = useMeQuery({}, { clientId: 'api2' })
</script>
```

### Dynamic Refetching Query

You can pass reactive variables (`ref`, `reactive`, `computed`) to the query. The hook will automatically refetch when variables change.

```vue
<script setup>
import { ref, computed } from 'vue'
import { useGetUserQuery } from './graphql/generated'

const userId = ref('1')

// Automatically refetches when userId changes
const { result } = useGetUserQuery({ id: userId })

// Or with computed
const { result: otherResult } = useGetUserQuery({ id: computed(() => '2') })
</script>
```

### Smart Query Caching & Auto-Refetching

Our `useQuery` implementation includes intelligent caching and hydration-aware mechanisms out of the box:

- **Global Cache Sharing**: If multiple components use the same query with the same variables, they automatically share the cache and in-flight request, preventing duplicate network calls.
- **SSR Hydration Cache**: After SSR, matching queries restore from the transferred cache instead of issuing a duplicate network request.
- **Cache-Only Support**: Respects `fetchPolicy: 'cache-only'`, bypassing network fetches when cache data is available.
- **Reactive Variables**: Passing `ref` / `computed` variables automatically keeps the observable query in sync when variables change.

> `refetchOnUpdate` and `refetchTimeout` are deprecated. Prefer Apollo fetch policies and explicit `refetch()`.

### Multiple Queries (`useMultiQuery`)

The `useMultiQuery` composable allows you to combine multiple GraphQL queries into a single unified loading/error state and refetch function.

```typescript
import { useMultiQuery } from 'vue-apollo-client'
import * as queries from './graphql/generated' // Import all generated hooks

const { result, loading, error, refetch } = useMultiQuery(
  queries, // 1. Map of query definitions
  ['useGetUserQuery', 'useMeQuery'], // 2. Array of query keys to execute
  {
    /* shared variables */
  },
  {
    /* options */
  }
)

// Data is automatically unwrapped from the root query field!
// No need to do `result.value.useGetUserQuery.getUser`, just:
const users = result.value?.useGetUserQuery
const me = result.value?.useMeQuery

// Combined loading state across all queries
if (loading.value) {
  /* ... */
}

// Map of errors by query key
if (error.value.useGetUserQuery) {
  /* ... */
}

// Refetch all queries at once
await refetch()

// Or selectively refetch specific queries
await refetch(
  {
    /* new variables */
  },
  ['useMeQuery']
)
```

### Mutations

Our `useMutation` composable includes advanced features for offline resilience and cache invalidation:

- **Offline Support (`allowOffline`)**: If `allowOffline: true` is configured and the user goes offline, mutations are automatically serialized and queued in `localStorage`. Once the user reconnects to the network, the client automatically syncs the queued mutations in the background.
- **Smart `refetchQueries`**: When you pass operation names to `refetchQueries` (e.g., `['GetUsers']`), the client performs a two-step invalidation:
  1. It actively refetches any currently mounted observable queries with that name.
  2. It aggressively evicts the data from the Apollo `InMemoryCache` using garbage collection. This ensures that even if the query is currently unmounted, it will fetch fresh data from the network the next time it mounts, rather than relying on stale cache.

```vue
<script setup lang="ts">
import { useDeletePostMutation } from './graphql/generated'

const { mutate, loading, error, onDone, onError } = useDeletePostMutation()

const handleDelete = async (id: string) => {
  await mutate(
    { id },
    { refetchQueries: ['GetPosts'] } // Smartly updates active and inactive queries
  )
  // Handle successful deletion
}
</script>
```

## Configuration Options

Pass these options to `defineApollo()` (or to `createApollo()` for advanced hosts):

| Option             | Type                        | Description                                                                                      | Default                                        |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| endPoints          | `Record<string, string>`    | GraphQL endpoint URLs                                                                            | `{ default: 'http://localhost:4000/graphql' }` |
| applicationId      | `string`                    | Stable Vue application identity                                                                  | —                                              |
| authBoundary       | `string`                    | Stable authentication boundary (for example `admin`)                                             | —                                              |
| tokenKey           | `string`                    | Key for storing the authentication token in cookies                                              | `'token'`                                      |
| tokenExpiration    | `number/Date`               | When the token expires.                                                                          | 30 days                                        |
| requestTimeoutMs   | `number`                    | Per-operation transport timeout                                                                  | `undefined`                                    |
| memoryConfig       | `InMemoryCacheConfig`       | Memory cache config for Apollo Client                                                            | `{}`                                           |
| useGETForQueries   | `boolean`                   | Use GET for queries                                                                              | `false`                                        |
| apolloClientConfig | `ApolloClientOptions<any>`  | Apollo Client config                                                                             | `null`                                         |
| apolloUploadConfig | `ApolloUploadClientOptions` | Apollo Upload Client config                                                                      | `{}`                                           |
| allowOffline       | `boolean`                   | Queue mutations when offline and sync when online.                                               | `false`                                        |
| getSessionId       | `function`                  | Identifies the current session for cache / offline isolation                                     | `undefined`                                    |
| getToken           | `function`                  | Override cookie token lookup                                                                     | `undefined`                                    |
| clearToken         | `function`                  | Override token removal when authentication becomes invalid                                       | `undefined`                                    |
| formatToken        | `function`                  | Format the Authorization header value                                                            | identity                                       |
| setContext         | `function`                  | method to setup context                                                                          | `({operationName, variables, token}) => any`   |
| refresh            | `object`                    | Generated-composable refresh contract (`useMutation`, `getRefreshToken`, …)                      | `undefined`                                    |
| refreshToken       | `function`                  | **Deprecated.** Prefer `refresh` with a generated mutation.                                      | `undefined`                                    |
| refetchOnUpdate    | `boolean`                   | **Deprecated.** Prefer Apollo fetch policies or explicit `refetch()`.                            | `false`                                        |
| refetchTimeout     | `number`                    | **Deprecated.** Prefer Apollo fetch policies or explicit `refetch()`.                            | `10000`                                        |
| onLogout           | `function`                  | Called when refresh fails (or 401/403 is received). Library clears all client stores first.      | `undefined`                                    |

## Functions

| Function           | Description                                                                                                         | Syntax                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| defineApollo       | Preferred SPA / SSR configuration plugin. Creates the runtime when installed on a Vue app.                          | `defineApollo(options \| resolver, defaults?)`                     |
| createApollo       | Advanced / legacy runtime factory for package integrations                                                          | `createApollo(options, runtimeOptions?)`                           |
| setToken           | Sets the token and refresh token in the cookie. Cookie attrs are auto-detected.                                     | `setToken(token)` or `setToken({ key?, token, refreshToken, options? })` |
| getToken           | Gets the token from the cookie                                                                                      | `getToken(key?)`                                                   |
| getRefreshToken    | Gets the refresh token from the cookie                                                                              | `getRefreshToken(key?)`                                            |
| removeToken        | Removes the token and refresh token. Uses auto-detected options so cookies on parent domains are removed correctly. | `removeToken(key?, options?)`                                      |
| getCookieOptions   | Returns the auto-detected cookie attributes for the current environment.                                            | `getCookieOptions(overrides?)`                                     |
| loadApolloClients  | Initializes Apollo Clients for use outside components                                                               | `loadApolloClients()`                                              |
| useKeepCookieAlive | Keeps the auth token cookie alive by updating it periodically                                                       | `useKeepCookieAlive(debounceMs?: number)` (defaults to 10000 ms)   |
| createAuthRuntime  | Built-in auth runtime — shared reactive state, verify / logout, auto SPA navigate                                   | `createAuthRuntime({ useMeQuery, ... })`                           |
| useAuth            | Thin wrapper around `createAuthRuntime` using the installed runtime                                                 | `useAuth({ useMeQuery, meSelector?, loginRoute?, clientId? })`     |
| setAuthRouter      | **Deprecated.** Prefer `navigate` on `createAuthRuntime` / `useAuth`.                                               | `setAuthRouter(router)`                                            |

### `createAuthRuntime` / `useAuth` options

| Option                 | Type         | Description                                                   | Default             |
| ---------------------- | ------------ | ------------------------------------------------------------- | ------------------- |
| `useMeQuery`           | `composable` | **Required.** Generated composable for fetching the current user. | —               |
| `meQuery`              | `Document`   | **Deprecated.** Prefer `useMeQuery`.                          | —                   |
| `meSelector`           | `function`   | Extract the user object from the query result.                | `data => data?.me`  |
| `tokenKey`             | `string`     | Cookie key used for the access token.                         | config / `'token'`  |
| `authBoundary`         | `string`     | Stable auth boundary when one app has multiple surfaces.      | derived             |
| `loginRoute`           | `string`     | Path to navigate to on logout / session expiry.               | `'/login'`          |
| `sessionExpiredReason` | `string`     | Query string parameter name for session-expiry redirects.     | `'session_expired'` |
| `clientId`             | `string`     | Apollo client name to use.                                    | `'default'`         |
| `navigate`             | `function`   | SPA navigation handler for logout / session expiry.           | `location.assign`   |

### Refresh Token Support

The client automatically handles `UNAUTHENTICATED` (401) errors. If a request fails with a 401, it attempts to refresh the token using the stored refresh token.

1. It runs your generated refresh mutation through the `refresh` contract.
2. If successful, it persists the new tokens and retries the original request.
3. If valid tokens are not returned, it logs the user out: calls `onLogout`, clears all client stores, removes the cookie, and SPA-navigates to `loginRoute` (if `createAuthRuntime` / `useAuth` is being used).

To enable this, ensure your login flow saves the refresh token:

```typescript
import { setToken } from 'vue-apollo-client'

// On login success
setToken({
  key: 'auth_token',
  token: 'new-access-token',
  refreshToken: 'new-refresh-token',
})
```

---

### Automatic Token Refresh

Configure the generated-composable `refresh` contract on `defineApollo`:

```typescript
import {
  defineApollo,
  getRefreshToken,
  setToken,
  removeToken,
} from 'vue-apollo-client'
import { useRefreshTokensMutation } from '@/graphql'

export default defineApollo({
  endPoints: { default: '...' },
  tokenKey: 'auth_token',
  refresh: {
    useMutation: useRefreshTokensMutation,
    getRefreshToken: () => getRefreshToken('auth_token'),
    createVariables: (refreshToken) => ({ refreshToken }),
    selectTokens: (data) => data?.refreshTokens,
    persistTokens: ({ token, refreshToken }) =>
      setToken({ key: 'auth_token', token, refreshToken }),
    clearTokens: () => removeToken('auth_token'),
  },
  onLogout: () => {
    // The library already cleared all Apollo stores before this runs.
    // Use this hook for additional cross-cutting teardown — analytics,
    // toast notification, etc. SPA navigation is handled by `createAuthRuntime` / `useAuth`.
    console.log('session ended')
  },
})
```

---

### Cookie Management & Security

`vue-apollo-client` auto-detects the best cookie attributes for the current environment, so you rarely need to pass anything:

| Field      | Auto-detected value                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `path`     | `'/'`                                                                                          |
| `secure`   | `true` on HTTPS, `false` on localhost                                                          |
| `sameSite` | `'None'` on HTTPS, `'Lax'` on localhost / HTTP                                                 |
| `domain`   | parent domain for subdomains (e.g. `app.example.com` → `.example.com`), none on localhost / IP |

The library also coerces `SameSite=None` → `Secure=true` automatically (browsers reject the cookie otherwise).

```typescript
import { setToken, getCookieOptions, useKeepCookieAlive } from 'vue-apollo-client'

// Login — no options needed
setToken({ token: 'jwt', refreshToken: 'rt' })

// Override individual fields when you need to (e.g. custom path)
setToken({ token: 'jwt', options: { path: '/admin' } })

// Inspect the auto-detected defaults
console.log(getCookieOptions())
// → { path: '/', domain: '.example.com', secure: true, sameSite: 'None' }

// Keep the session alive on user activity
useKeepCookieAlive()
```

## Advanced compatibility API

`createApollo` remains available for package integrations and legacy advanced hosts. Normal applications should use `defineApollo`; request runtimes and cache lifecycle should not be application-owned.

```typescript
import { createApollo } from 'vue-apollo-client'

const runtime = createApollo(
  { endPoints: { default: 'https://api.example.com/graphql' } },
  { server: true, registerGlobal: false }
)

app.use(runtime)
// advanced hosts may call runtime.extract(), runtime.restore(), runtime.stop()
```
