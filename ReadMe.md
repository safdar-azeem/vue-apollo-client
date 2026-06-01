# Vue Apollo Client

A Vue 3, Vite, Nuxt 3 Apollo Client featuring smart queries with caching and refetching, SSR support, offline mutations, **zero-config code generation**, and **built-in auth lifecycle**.

## Features

- Apollo Client integration with Vue 3
- Server-Side Rendering (SSR) support
- GraphQL Code Generator integration
- Offline support (mutations)
- Multiple client support
- File Upload support
- Automatic token management
- **Built-in auth composable** — `useAuth({ meQuery })` handles the full session lifecycle (verify / logout / auto SPA-navigate on auth failure)
- **Auto-detected cookie options** — `setToken` / `removeToken` pick the right `secure` / `sameSite` / `domain` for the current environment
- Automatic type generation for queries and mutations
- Auto-imports for generated composables and types
- Authentication support with cookie, token, and refresh token
- Production-ready 📦

## Installation

```bash
npm install vue-apollo-client
# or
yarn add vue-apollo-client
```

### Everything is set up for you: 🚀

- No need to install Apollo Client or GraphQL codegen packages
- All necessary dependencies will be automatically handled
- Apollo Client configuration is done for you
- Cookie attributes (domain, secure, sameSite) are auto-detected
- Auth flow (verify / logout / session expiry) is built in

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
      // documents: 'src/**/*.graphql',
      // schema?: string | string[]
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

In your main entry file (e.g., `main.ts`), initialize the Apollo client and register the router so `useAuth` can do SPA navigation on logout:

```typescript
import { createApp } from 'vue'
import { createApollo, setAuthRouter } from 'vue-apollo-client'
import App from './App.vue'
import router from './router'

const app = createApp(App)

const apollo = createApollo({
  endPoints: {
    default: 'http://localhost:4000/graphql',
    // Add more endpoints as needed
    // api2: 'http://localhost:3000/graphql',
    // const { result, loading, error, refetch } = useMeQuery({ client: 'api2' });
  },
  tokenKey: 'auth_token',
  allowOffline: true,
  refreshToken: async () => {
    // ... see "Automatic Token Refresh" below
  },
})

setAuthRouter(router) // enables SPA navigation on logout / session expiry
app.use(apollo)
app.use(router)
app.mount('#app')
```

## Usage

### Built-in Authentication

The library ships with `useAuth`, a composable that handles the full session lifecycle out of the box — `me` query, single-flight verification, auth-error detection, store clearing, and SPA logout navigation.

```typescript
import { useAuth } from 'vue-apollo-client'
import { MeDocument } from './graphql'

// Shared reactive state — every component sees the same `user`.
const { user, isAuthenticated, verify, logout, loading, error } = useAuth({
  meQuery: MeDocument,            // generated GraphQL document
  meSelector: (data) => data?.me, // how to extract the user
  loginRoute: '/auth/login',      // SPA redirect target on logout
})

// Run the `me` query — returns true if authenticated, false otherwise.
const ok = await verify()

// Logout — clears the cookie, drops the Apollo store, navigates to login.
await logout()
```

#### What `useAuth` does for you

- **Single-flight `verify()`** — concurrent calls share the same promise
- **Detects auth failures** — `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND` ("user not found"), HTTP 401 / 403
- **Treats 5xx / offline as transient** — token is kept so a later retry can succeed
- **On auth failure**: wipes cookie → clears Apollo store → SPA-navigates to `loginRoute`
- **No reload storm** — an `_invalidating` latch prevents in-flight `me` responses from re-entering the teardown
- **Auto-recovers on re-login** — a fresh token automatically clears the latch

#### Router guard example

```typescript
import { useAuth, getToken } from 'vue-apollo-client'
import { MeDocument } from './graphql'

const { verify } = useAuth({
  meQuery: MeDocument,
  loginRoute: '/auth/login',
})

export const authGuard = async (to, _from, next) => {
  if (!getToken()) {
    return to.meta.requiresAuth
      ? next({ path: '/auth/login', query: to.query })
      : next()
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

### 3. Server-side Query (SSR)

If you are using this with SSR (e.g. `vite-ssr` or custom setup), you can await the query to fetch data on the server.

```vue
<script setup>
import { useMeQuery } from './graphql/generated'

// Await the result for SSR pre-fetching
const { result, loading, error, refetch } = await useMeQuery()
</script>

<template>
  <div v-if="result">Welcome, {{ result.me.name }}!</div>
</template>
```

### Different Apollo Clients

You can use different Apollo Clients for different queries.

```vue
<script setup>
// with default client
const { result, loading, error, refetch } = useMeQuery()
// with api2 client
const { result, loading, error, refetch } = useMeQuery({ client: 'api2' })
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

### Multple Queries

The `useMultiQuery` composable allows you to combine multiple GraphQL queries into a single loading/error state.
**Note**: Unlike the Nuxt version, you must pass the generated query hooks code map (or object containing them) if you want to use them by key, or pass the functions directly.

```typescript
import { useMultiQuery } from 'vue-apollo-client'
import * as queries from './graphql/generated' // Import all generated hooks

const { result, loading, error, refetch } = useMultiQuery(
  queries,
  ['useGetUserQuery', 'useMeQuery'], // Keys must match exported names
  {
    /* shared variables */
  },
  {
    /* options */
  }
)

const users = result.value?.getUser
const me = result.value?.me
```

### Mutations

```vue
<script setup lang="ts">
import { useDeletePostMutation } from './graphql/generated'

const { mutate, loading, error, onDone, onError } = useDeletePostMutation()

const handleDelete = async (id: string) => {
  await mutate({ id })
  // Handle successful deletion
}
</script>
```

## Configuration Options

Pass these options to `createApollo()`:

| Option             | Type                        | Description                                                                                      | Default                                        |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| endPoints          | `Record<string, string>`    | GraphQL endpoint URLs                                                                            | `{ default: 'http://localhost:4000/graphql' }` |
| tokenKey           | `string`                    | Key for storing the authentication token in cookies                                              | `'token'`                                      |
| tokenExpiration    | `number/Date`               | When the token expires.                                                                          | 30 days                                        |
| memoryConfig       | `InMemoryCacheConfig`       | Memory cache config for Apollo Client                                                            | `{}`                                           |
| useGETForQueries   | `boolean`                   | Use GET for queries                                                                              | `false`                                        |
| apolloClientConfig | `ApolloClientOptions<any>`  | Apollo Client config                                                                             | `null`                                         |
| apolloUploadConfig | `ApolloUploadClientOptions` | Apollo Upload Client config                                                                      | `{}`                                           |
| refetchOnUpdate    | `boolean`                   | Smartly Refetch queries on component, page, or route changes.                                    | `false`                                        |
| refetchTimeout     | `number`                    | Time in milliseconds to wait before refetching a query after a component, page, or route change. | `10000`                                        |
| allowOffline       | `boolean`                   | Queue mutations when offline and sync when online.                                               | `false`                                        |
| setContext         | `function`                  | method to setup context                                                                          | `({operationName, variables, token}) => any`   |
| refreshToken       | `function`                  | Async function that returns a new access token when the current one expires                      | `undefined`                                    |
| onLogout           | `function`                  | Called when refresh fails (or 401/403 is received). Library clears all client stores first.     | `undefined`                                    |

## Functions

| Function           | Description                                                                                  | Syntax                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| setToken           | Sets the token and refresh token in the cookie. Cookie attrs are auto-detected.              | `setToken(token)` or `setToken({ token, refreshToken, options? })`                  |
| getToken           | Gets the token from the cookie                                                               | `getToken(key?)`                                                                    |
| getRefreshToken    | Gets the refresh token from the cookie                                                       | `getRefreshToken(key?)`                                                             |
| removeToken        | Removes the token and refresh token. Uses auto-detected options so cookies on parent domains are removed correctly. | `removeToken(key?, options?)`                          |
| getCookieOptions   | Returns the auto-detected cookie attributes for the current environment.                     | `getCookieOptions(overrides?)`                                                      |
| loadApolloClients  | Initializes Apollo Clients for use outside components                                        | `loadApolloClients()`                                                               |
| useKeepCookieAlive | Keeps the auth token cookie alive by updating it periodically                                | `useKeepCookieAlive(debounceMs?: number)` (defaults to 10000 ms)                    |
| useAuth            | Built-in auth composable — shared reactive state, verify / logout, auto SPA navigate         | `useAuth({ meQuery, meSelector?, loginRoute?, clientId? })`                         |
| setAuthRouter      | Registers the Vue Router instance so `useAuth` can do SPA navigation on logout               | `setAuthRouter(router)`                                                             |

### `useAuth` options

| Option                 | Type       | Description                                                                | Default            |
| ---------------------- | ---------- | -------------------------------------------------------------------------- | ------------------ |
| `meQuery`              | `Document` | **Required.** GraphQL document for fetching the current user.              | —                  |
| `meSelector`           | `function` | Extract the user object from the query result.                            | `data => data?.me` |
| `loginRoute`           | `string`   | Path to navigate to on logout / session expiry.                           | `'/login'`         |
| `sessionExpiredReason` | `string`   | Query string parameter name for session-expiry redirects.                  | `'session_expired'`|
| `clientId`             | `string`   | Apollo client name to use.                                                 | `'default'`        |

### Refresh Token Support

The client automatically handles `UNAUTHENTICATED` (401) errors. If a request fails with a 401, it attempts to refresh the token using the stored refresh token.

1. It calls a `refreshToken` mutation on your backend.
2. If successful, it updates the cookies and retries the original request.
3. If valid tokens are not returned, it logs the user out: calls `onLogout`, clears all client stores, removes the cookie, and SPA-navigates to `loginRoute` (if `useAuth` is being used).

To enable this, ensure your login flow saves the refresh token:

```typescript
import { setToken } from 'vue-apollo-client'

// On login success
setToken({
  token: 'new-access-token',
  refreshToken: 'new-refresh-token',
})
```

---

### Automatic Token Refresh

If your API returns a `UNAUTHENTICATED` error, the client can attempt to refresh the token:

```typescript
const apollo = createApollo({
  endPoints: { default: '...' },
  refreshToken: async () => {
    // Logic to call your refresh endpoint
    const response = await fetch('/auth/refresh')
    const data = await response.json()
    return data.accessToken // Return the new token
  },
  onLogout: () => {
    // The library already cleared all Apollo stores before this runs.
    // Use this hook for additional cross-cutting teardown — analytics,
    // toast notification, etc. SPA navigation is handled by `useAuth`.
    console.log('session ended')
  },
})
```

---

### Cookie Management & Security

`vue-apollo-client` auto-detects the best cookie attributes for the current environment, so you rarely need to pass anything:

| Field      | Auto-detected value                                                                |
| ---------- | ---------------------------------------------------------------------------------- |
| `path`     | `'/'`                                                                              |
| `secure`   | `true` on HTTPS, `false` on localhost                                              |
| `sameSite` | `'None'` on HTTPS, `'Lax'` on localhost / HTTP                                     |
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

## Contributing

Contributions are welcome. Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.
