# Vue Apollo Client

Vue Apollo Client is a Vue 3 Apollo integration with GraphQL code generation,
typed composables, caching, authentication, SSR, uploads, and offline mutation
support.

The recommended application path is:

1. Install `vue-apollo-client` and its Vite plugin.
2. Configure one endpoint with `defineApollo`.
3. Put named GraphQL operations in `src` and use the generated composables.

The later sections document the advanced configuration and runtime APIs.

## Installation

```bash
npm install vue-apollo-client
```

Vue Apollo Client supports Vue 3.3+ and the Vite integration assumes an
existing Vite-based Vue project. The `vue-apollo-client/vite` import is an
included export of `vue-apollo-client`; there is no separate Vite plugin
package to install.

## Quick start

### 1. Add the Vite plugin

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { vueApollo } from 'vue-apollo-client/vite'

export default defineConfig({
  plugins: [vue(), vueApollo()],
})
```

By default, the plugin reads GraphQL files from
`src/**/*.{graphql,gql}` and writes typed composables to
`src/graphql/generated.ts`.

### 2. Add the GraphQL endpoint

```bash
# .env
VITE_GRAPHQL_ENDPOINT=https://api.example.com/graphql
```

### 3. Create the Apollo configuration

```typescript
// src/config/apollo.ts
import { defineApollo } from 'vue-apollo-client'

export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
})
```

### 4. Install the configuration

```typescript
// src/main.ts
import { createApp } from 'vue'
import App from './App.vue'
import apollo from './config/apollo'

const app = createApp(App)

app.use(apollo)
app.mount('#app')
```

Run the development server to generate the GraphQL composables:

```bash
npm run dev
```

Commit `src/graphql/generated.ts`. Development mode can fetch the schema and
regenerate it, but production client and SSR builds intentionally do not fetch
the schema or run live code generation.

## API and configuration index

| Need | Recommended API |
| --- | --- |
| Normal typed query or mutation | Generated `use<Name>Query` / `use<Name>Mutation` |
| Deferred query | `useLazyQuery` or a generated query with `enabled` |
| Several generated queries as one handle | `useMultiQuery` |
| Access-token cookies | `setToken`, `getToken`, `getRefreshToken`, `removeToken` |
| Shared user/session state | `useAuth` with a generated `useMeQuery` |
| Multiple endpoints | `endPoints` and a generated operation `clientId` |
| File uploads and custom headers | `apolloUploadConfig`, `setContext`, `fetch` |
| Browser offline writes | `allowOffline` on safe, replayable mutations |
| Managed SSR | `defineApollo`, normally with no per-query opt-in |
| Custom SSR or integration runtime | `createApollo` |

## Queries and mutations

### Queries

Create a named GraphQL operation:

```graphql
# src/graphql/users.graphql
query GetUsers {
  users {
    id
    name
  }
}
```

Use the generated composable in a component:

```vue
<script setup lang="ts">
import { useGetUsersQuery } from './graphql/generated'

const { result, loading, error, refetch } = useGetUsersQuery()
</script>

<template>
  <p v-if="loading">Loading…</p>
  <p v-else-if="error">Could not load users.</p>

  <ul v-else>
    <li v-for="user in result?.users ?? []" :key="user.id">
      {{ user.name }}
    </li>
  </ul>

  <button type="button" @click="refetch">Reload</button>
</template>
```

Generated composables expose the normal Apollo/Vue query handle, including
`result`, `loading`, `error`, `refetch`, and result/error subscriptions. Query
variables may be plain values, Vue refs, or getters:

```graphql
query GetUser($id: ID!) {
  user(id: $id) {
    id
    name
  }
}
```

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useGetUserQuery } from './graphql/generated'

const userId = ref('user-1')
const { result } = useGetUserQuery({ id: userId })
</script>
```

Changing a reactive variable starts a request for the new variables. The
composable does not expose stale data as the result for a new variable set
while that set is still pending. Use `enabled` to pause a query; it can also be
a ref or getter:

```typescript
const { result } = useGetUserQuery(
  () => ({ id: userId.value }),
  () => ({ enabled: Boolean(userId.value) })
)
```

Query options such as `fetchPolicy`, `errorPolicy`, `context`, and `clientId`
are passed through to Apollo. The `ssr` option is documented in [SSR and
hydration](#ssr-and-hydration).

### Mutations

```graphql
mutation CreateUser($name: String!) {
  createUser(name: $name) {
    id
    name
  }
}
```

```vue
<script setup lang="ts">
import { useCreateUserMutation } from './graphql/generated'

const { mutate, loading, error } = useCreateUserMutation()

const createUser = () => mutate({ name: 'Ada Lovelace' })
</script>

<template>
  <button type="button" :disabled="loading" @click="createUser">
    Create user
  </button>
  <p v-if="error">Could not create user.</p>
</template>
```

Refresh active queries after a mutation with string operation names:

```typescript
await mutate(
  { name: 'Ada Lovelace' },
  { refetchQueries: ['GetUsers'] }
)
```

Generated operations use this package's `useQuery` and `useMutation` runtime
behavior. The direct composables remain available for dynamic documents and
other advanced integrations; see [Advanced runtime composables](#advanced-runtime-composables).

Mutations invoked during server rendering are intentionally skipped. Perform
writes from browser-side actions such as event handlers or `onMounted`, not
while producing SSR HTML.

## Authentication

### Access tokens

The default token store uses cookies. Configure a token key and format the
value when the API expects a Bearer header:

```typescript
import { defineApollo } from 'vue-apollo-client'

export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  tokenKey: 'auth_token',
  formatToken: (token) => `Bearer ${token}`,
})
```

Without `formatToken`, the token is sent unchanged as the `authorization`
header value. Save the access token after a login mutation succeeds:

```typescript
import { setToken } from 'vue-apollo-client'

setToken('access-token-from-login')
```

### `useAuth`

`useAuth` verifies a session with a generated `useMeQuery`, keeps the current
user in shared reactive state, and handles logout/session expiration:

```typescript
import { useAuth } from 'vue-apollo-client'
import { useMeQuery } from './graphql/generated'

const { user, isAuthenticated, loading, error, verify, logout, reset } = useAuth({
  useMeQuery,
  loginRoute: '/login',
  navigate: (path) => router.push(path),
})

const valid = await verify()
```

By default, the auth query data must have the shape `{ me: User | null }`.
When the API uses another field or nesting, select the user explicitly:

```typescript
const auth = useAuth({
  useMeQuery,
  meSelector: (data) => data?.currentUser,
})
```

The returned `loading` and `error` describe verification, `isAuthenticated`
is derived from `user`, `verify()` returns a boolean, `reset()` clears local
auth state, and `logout()` clears the token and the relevant Apollo client
cache. Session expiration navigates to `loginRoute` (default `/login`) with a
`reason` query parameter (default `session_expired`); explicit logout navigates
to the route without that parameter. Pass `navigate` for a router integration.
Without it, the browser uses `window.location.assign`. `useAuth` must run after
`app.use(apollo)` has installed the runtime.

`useAuth` options include:

| Option | Purpose |
| --- | --- |
| `useMeQuery` | Generated query composable; preferred. |
| `meSelector` | Maps the query data to the current user when it is not `data.me`. |
| `clientId` | Selects the client for the legacy document form, and participates in auth-state isolation. Bind a client on a generated wrapper when needed. |
| `authBoundary` | Separates independent authentication contexts in one app. |
| `tokenKey` | Reads/removes a different cookie key than the configured default. |
| `getToken`, `clearToken` | Use an application-owned token store. |
| `loginRoute`, `sessionExpiredReason`, `navigate` | Control session-expiration and logout navigation. |

### Refresh tokens

Save both tokens after login:

```typescript
import { setToken } from 'vue-apollo-client'

setToken({
  key: 'auth_token',
  token: 'access-token',
  refreshToken: 'refresh-token',
})
```

Configure refresh with the generated refresh mutation. The library refreshes
after an authentication failure, retries the original operation, and clears
tokens and Apollo caches if refresh fails:

```typescript
import { defineApollo } from 'vue-apollo-client'
import { useRefreshTokensMutation } from './graphql/generated'

export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  tokenKey: 'auth_token',
  refresh: {
    useMutation: useRefreshTokensMutation,
    createVariables: (refreshToken) => ({ refreshToken }),
    selectTokens: (data) => data?.refreshTokens,
  },
})
```

`selectTokens` must return `{ token, refreshToken? }`. For named clients,
`refresh.clientId` selects where the refresh mutation runs; when omitted, it
uses the client that received the failed operation. A normal cookie store
automatically reads and persists `${tokenKey}_refresh`. A custom store must
also provide `refresh.getRefreshToken`, `refresh.persistTokens`, and
`refresh.clearTokens`.

### Cookies and token helpers

The public helpers are:

```typescript
import {
  getCookieOptions,
  getRefreshToken,
  getToken,
  removeToken,
  setToken,
} from 'vue-apollo-client'

setToken({
  key: 'auth_token',
  token: 'access-token',
  refreshToken: 'refresh-token',
  options: { sameSite: 'Lax' },
})

const accessToken = getToken('auth_token')
const refreshToken = getRefreshToken('auth_token')
removeToken('auth_token')
const defaults = getCookieOptions()
```

`setToken` also accepts `setToken(token)` for the configured/default key.
`removeToken` removes both the access-token cookie and its `${key}_refresh`
cookie. Cookie defaults are:

- `path: '/'`.
- Host-only cookies (`domain` is unset). Set `tokenCookie.domain` explicitly
  only when sharing auth across subdomains.
- `secure: true` and `sameSite: 'None'` on HTTPS; `secure: false` and
  `sameSite: 'Lax'` on HTTP or localhost.
- `tokenExpiration` controls the expiry. A number is interpreted as cookie
  expiry days and a `Date` is also accepted. The default is 30 days.

`tokenCookie` applies to access, refresh, and temporary stash cookies. The
runtime uses `stashToken` and `restoreStashedToken` for cookie-specific network
reachability recovery. They are exported for compatibility, but application
code normally should not call them directly. `useKeepCookieAlive` is the
supported opt-in helper for resetting the token cookie on user activity; its
default debounce interval is 10 seconds.

### Custom token stores and session isolation

Use custom callbacks when another auth SDK owns the token:

```typescript
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  getToken: () => authSdk.getAccessToken(),
  clearToken: () => authSdk.signOut(),
  getSessionId: () => authSdk.getStableSessionId(),
})
```

`getSessionId` should return a stable identity for the current login, not a
rotating access token. The runtime isolates Apollo cache state when the stable
session changes. This matters when one browser can switch users, when an
opaque-token store serves several users, or when several auth contexts share an
application. `applicationId`, `authBoundary`, client ID, endpoint, and session
identity also isolate offline queues; see [Offline mutations](#offline-mutations).

## Complete configuration reference

The quick start only needs `endpoint`. The following options are the supported
application configuration surface for `defineApollo` and `createApollo`:

| Option | Purpose and behavior | Default / guidance |
| --- | --- | --- |
| `applicationId` | Stable Vue application identity used to isolate persisted runtime state and identify managed SSR requests. | Managed `defineApollo`: request application ID, then `DefineApolloOptions.applicationId`, then `default`. Direct runtimes use an internal fallback for persistence. Set it when multiple apps share browser storage. |
| `authBoundary` | Names an independent authentication boundary, such as `admin` or `storefront-customer`. | Derived internally from the client/token configuration. Set it when one app has multiple auth contexts. |
| `endpoint` | One GraphQL endpoint for the implicit `default` client. | `http://localhost:4000/graphql` when no endpoint configuration is supplied. Do not combine with `endPoints`. |
| `endPoints` | Map of client IDs to GraphQL endpoints. | No named client is added automatically. Include a `default` entry unless every operation selects another `clientId`. Do not combine with `endpoint`. |
| `fetch` | Custom `fetch` implementation for edge runtimes, tests, or controlled transports. | Uses the runtime/global `fetch`. Custom implementations should honor `init.signal`. |
| `requestTimeoutMs` | Per-operation transport timeout. Its abort signal is combined with request cancellation and the SSR request signal. | `0`, `undefined`, or a non-positive value disables the timeout. |
| `tokenKey` | Access-token cookie key. The refresh cookie is `${tokenKey}_refresh`. | `'token'`. |
| `tokenCookie` | Cookie attributes (`domain`, `path`, `secure`, `sameSite`, and other cookie-library attributes) shared by token, refresh, and stash cookies. | Host-only, `/`, HTTPS-aware secure/same-site defaults; see [Cookies and token helpers](#cookies-and-token-helpers). |
| `tokenExpiration` | Default token-cookie expiry as a number of days or a `Date`. | 30 days. Per-call cookie options override it. |
| `memoryConfig` | Partial Apollo `InMemoryCacheConfig`, including `typePolicies`, `possibleTypes`, and cache key behavior. | A new `InMemoryCache` per named client. |
| `useGETForQueries` | Sends queries over GET when supported by the upload HTTP link; mutations remain POST. | Disabled. |
| `apolloClientConfig` | Advanced partial `ApolloClientOptions` such as `defaultOptions` or `queryDeduplication`. | The package still owns the configured cache, link, and SSR mode. |
| `apolloUploadConfig` | Partial options for the underlying `apollo-upload-client` link, including credentials, headers, and upload transport settings. | Upload link defaults, with Apollo multipart preflight support enabled. |
| `allowOffline` | Enables browser `localStorage` persistence and replay for eligible mutations. | Disabled. Server runtimes never enable the browser queue. |
| `getSessionId` | Returns a stable current-session identity for cache and offline isolation. | Derived from the configured token store; customize for opaque/custom stores. |
| `refresh` | Generated refresh-mutation contract. Supports `useMutation`, `clientId`, `getRefreshToken`, `createVariables`, `selectTokens`, `persistTokens`, and `clearTokens`. | Disabled. |
| `onLogout` | Notification hook called when authentication cannot be recovered or the runtime handles an auth/network teardown. | No callback. Navigation is handled separately by `useAuth`. |
| `getToken` | Reads an access token from an application-owned store instead of the default cookie helper. | Reads `tokenKey` from cookies in the browser. |
| `clearToken` | Removes the access token from an application-owned store. | Removes the configured cookies. |
| `formatToken` | Converts the raw access token to the `authorization` header value. | Identity function. |
| `setContext` | Runs for each operation with `{ operationName, variables, token }` and returns Apollo context values, commonly custom headers. | No additional context. |

### Deprecated configuration fields

The following fields remain for consumers migrating from earlier releases:

- `refreshToken` is the legacy callback refresh path. Prefer `refresh` with a
  generated mutation so refresh operations stay typed and runtime-scoped.
- `refetchOnUpdate` and `refetchTimeout` are legacy query options/configuration.
  Prefer reactive variables, Apollo fetch policies, and explicit `refetch()`.

## Vite plugin and code generation

### Plugin options

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { vueApollo } from 'vue-apollo-client/vite'

export default defineConfig({
  plugins: [
    vueApollo({
      documents: ['src/graphql/**/*.graphql', 'src/features/**/*.gql'],
      schema: './schema.graphql',
      output: 'src/graphql/generated.ts',
      codegenConfig: {
        skipTypename: true,
      },
    }),
  ],
})
```

Supported options are:

| Option | Behavior |
| --- | --- |
| `documents` | A glob string or array of globs. Defaults to `src/**/*.{graphql,gql}`. |
| `schema` | A local schema path or schema URL. When omitted, resolution uses the precedence below. |
| `output` | Generated file path. Defaults to `src/graphql/generated.ts`. |
| `codegenConfig` | Additional GraphQL Code Generator configuration merged with the package defaults. |
| `watch` | Compatibility-only option. The implementation does not read it; `watch: false` does not disable automatic GraphQL watching in `vite dev`. Production `vite build` always skips live codegen. |

Live code generation runs during Vite development (`vite dev` / `serve`) and
regenerates when GraphQL files change. The plugin intentionally skips remote
schema fetching and code generation during both client and SSR `vite build`,
so the generated file must be present in source control. Development file
watching is automatic. The accepted `watch` option is a no-op retained for
type/API compatibility: setting `watch: false` does not disable the watcher and
does not change production-build behavior.

When `schema` is omitted, the plugin resolves the schema in this order:

1. `VITE_GRAPHQL_ENDPOINT`.
2. `VITE_API_URL` with `/graphql` appended.
3. `http://localhost:4000/graphql`.

### Operation validation

Before code generation, every GraphQL operation in `src` must have a name, and
operation names must be unique across the whole `src` tree. Anonymous
operations or duplicates fail code generation with an error naming the file(s).
The validation scans `src` even when a custom `documents` glob is used, so a
stray anonymous or duplicate operation elsewhere in `src` can still stop the
dev build.

## Multiple GraphQL clients

Use `endPoints` for named clients:

```typescript
export default defineApollo({
  endPoints: {
    default: 'https://api.example.com/graphql',
    admin: 'https://admin.example.com/graphql',
  },
})
```

Normal generated operations default to client ID `default`. When using
`endPoints`, applications should normally provide a `default` endpoint unless
every relevant operation explicitly selects another client:

```typescript
const { result } = useGetUsersQuery({}, { clientId: 'admin' })
```

The refresh contract can target a particular client with
`refresh: { clientId: 'admin', ... }`. Do not use `endpoint` and `endPoints`
together.

## Uploads and transport customization

The runtime uses `apollo-upload-client`, so generated mutations can send
`File`, `Blob`, or other supported multipart values when the schema exposes an
upload scalar:

```graphql
mutation UploadAvatar($file: Upload!) {
  uploadAvatar(file: $file) {
    url
  }
}
```

```typescript
const { mutate } = useUploadAvatarMutation()
await mutate({ file: selectedFile })
```

Configure the upload link when the server needs custom transport settings:

```typescript
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  apolloUploadConfig: {
    credentials: 'include',
  },
  useGETForQueries: true,
})
```

Add request-specific headers with `setContext`. The callback receives the
operation name, variables, and raw token:

```typescript
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  setContext: ({ operationName, variables, token }) => ({
    headers: {
      'x-workspace-id': workspaceId.value,
      'x-operation-name': operationName,
    },
    // Other Apollo context values may be returned here as needed.
  }),
})
```

Customize normalized caching with `memoryConfig`:

```typescript
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  memoryConfig: {
    typePolicies: {
      User: {
        keyFields: ['id', 'workspaceId'],
      },
    },
  },
})
```

Use `apolloClientConfig` for advanced Apollo client settings:

```typescript
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  apolloClientConfig: {
    queryDeduplication: false,
    defaultOptions: {
      watchQuery: { fetchPolicy: 'cache-and-network' },
    },
  },
})
```

The package still installs its upload/error/auth links and its configured
`InMemoryCache`; `apolloClientConfig` is for client-level Apollo options, not
for replacing those package-managed `link` or `cache` values.

`requestTimeoutMs` applies a per-operation timeout. `0`, `undefined`, and
non-positive values disable it. The runtime combines that timeout with the
transport's existing `AbortSignal`, including a managed SSR request's
cancellation signal. Use `fetch` for an edge-runtime implementation, a test
double, or a controlled transport, and make sure it propagates `init.signal`.

## Offline mutations

Enable the browser queue explicitly:

```typescript
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  allowOffline: true,
})
```

When the browser reports `navigator.onLine === false`, eligible generated
mutations are serialized to `localStorage` and return immediately with no
server result. The queue replays when connectivity returns and also attempts a
sync after a normal online mutation.

Persistence and replay have important limits:

- The queue is browser/localStorage based; it is not an SSR or server queue.
- A queued operation must be one generated mutation document with source
  information. Queries, multi-operation documents, and source-less documents
  cannot be persisted.
- Variables must be JSON-serializable. Files and other non-JSON values cannot
  be persisted for offline replay.
- Only string entries in `refetchQueries` are persisted.
- Each client queue is limited to 100 entries.
- Queues are isolated by `applicationId`, `authBoundary`, client ID, endpoint,
  and current stable session identity. A queue belonging to another session is
  discarded rather than replayed into the current session.
- Replay is ordered. If one mutation fails, that mutation and every following
  mutation remain queued; earlier successful entries are removed.

Only enable offline mode for mutations that are naturally replay-safe from the
application's perspective. Prefer idempotent writes or server-side idempotency
keys, because connectivity can change around a replay and the client cannot
make an arbitrary mutation semantically idempotent.

## SSR and hydration

### Managed SSR with `defineApollo`

The same `defineApollo` plugin works in a managed SSR host. Enabled queries
server-prefetch by default; `ssr: false` opts a query out:

```typescript
const { result } = useGetUsersQuery(
  {},
  { ssr: false }, // do not fetch this query while rendering HTML
)
```

There is no need to add `ssr: true` to enable normal server prefetch. The
default is enabled unless the query is disabled or explicitly sets `ssr: false`.

Under a managed SSR host, `defineApollo` automatically provides:

- A request-isolated runtime and Apollo clients. Server runtimes do not write
  to the legacy module-global client store.
- Request cookie forwarding to the GraphQL transport.
- Request cancellation propagation through the transport `AbortSignal`.
- Per-request cache extraction on the server and cache restoration before the
  browser creates query composables, preventing duplicate hydration requests.
- An application context for configuration resolvers:

  ```typescript
  import { defineApollo } from 'vue-apollo-client'

  export default defineApollo<{ graphqlEndpoint?: string }>(
    ({ applicationId, server, publicConfig }) => ({
      applicationId,
      endpoint: publicConfig?.graphqlEndpoint,
      setContext: () => ({
        headers: { 'x-ssr': String(server) },
      }),
    }),
    {
      applicationId: 'storefront',
      hydrationKey: 'storefront-apollo',
    },
  )
  ```

The resolver receives `{ applicationId, server, publicConfig }`. A managed
host supplies `applicationId` and `publicConfig` from the request; the second
argument's `applicationId` is the fallback outside that host. The
`DefineApolloOptions.hydrationKey` defaults to `apollo`; set a distinct key
when installing several runtimes in the same SSR host.

On the server, `useLazyQuery` does not fetch automatically. If `load()` or
`start()` is called during setup/render, it executes against the request-scoped
client and is tracked by the SSR host; its result is included in hydration.
On browser hydration, restored cache data is served without a duplicate
request. A lazy query created later in a normal SPA uses the normal deferred
cache-and-network behavior.

### Lower-level SSR

Use `createApollo` instead of `defineApollo` only when an integration owns the
SSR lifecycle or needs to provide request state manually:

```typescript
import { createApollo } from 'vue-apollo-client'

const runtime = createApollo(
  { endPoints: { default: 'https://api.example.com/graphql' } },
  {
    server: true,
    registerGlobal: false,
    headers: { cookie: request.headers.cookie ?? '' },
    signal: request.signal,
    initialState: previousApolloState,
    hydrationKey: 'apollo',
  },
)

app.use(runtime)
```

`createApollo` also exposes `extract()`, `restore(state)`,
`executeQuery(...)`, `executeMutation(...)`, `clearStore(clientId?)`, and
`stop()` for integration code. Use `extractApolloState` and
`restoreApolloState` when managing multiple clients manually.

## Advanced runtime composables

### `useLazyQuery`

Use `useLazyQuery` for a query that should run only after an explicit action:

```typescript
import { gql } from 'graphql-tag'
import { useLazyQuery } from 'vue-apollo-client'

const SEARCH = gql`
  query Search($term: String!) {
    search(term: $term) {
      id
      title
    }
  }
`

const { result, loading, error, load, start } = useLazyQuery(
  SEARCH,
  () => ({ term: searchTerm.value }),
)

await load()
// `start()` is an alias for the same deferred execution behavior.
```

It returns the normal query state plus `load`, `start`, and `refetch`. It
supports reactive variables and query options such as `clientId`,
`fetchPolicy`, `errorPolicy`, and `context`. It does not auto-fetch during
server rendering. However, if application code explicitly calls
`load()`/`start()` during server rendering, that call executes against the
request-scoped client, is tracked for SSR, and is included in hydration. The
explicit server path does not consult the normal `useQuery` `ssr: false` or
`enabled` controls, so guard the call itself when a lazy query must be
browser-only.

### `useMultiQuery`

Use `useMultiQuery` to compose several generated query composables under one
loading/error/refetch handle:

```typescript
import * as queries from './graphql/generated'
import { useMultiQuery } from 'vue-apollo-client'

const { result, loading, error, refetch } = useMultiQuery(
  queries,
  ['useGetNavbarQuery', 'useGetFooterQuery'],
  { websiteId: websiteId.value },
  { clientId: 'default' },
)

// result.value.useGetNavbarQuery
// result.value.useGetFooterQuery
await refetch({}, ['useGetNavbarQuery']) // omit the key list to refetch all
```

The same variables and options are passed to every selected composable.
`loading` is true while any query loads, `error` is keyed by composable name,
and `result` is keyed by composable name. A single-field GraphQL payload is
unwrapped in `result`; multi-field payloads remain objects. Each query keeps
the normal reactive-variable, SSR, hydration, and cache behavior.

### Direct `useQuery` and `useMutation`

Generated composables are preferred for application operations because they
provide typed documents and variables. For dynamic or integration-owned
documents, import the runtime composables directly:

```typescript
import { useQuery, useMutation } from 'vue-apollo-client'
```

They use the installed runtime, named clients, cache, auth/refresh links,
offline queue, and SSR lifecycle described above. Direct mutations are also
skipped during server rendering and should be triggered from browser-side
actions.

## Migration and compatibility

For new code, use `defineApollo` plus generated composables. This path is
request-safe for managed SSR, avoids module-global state, and keeps refresh and
operation documents typed.

Use `createApollo` when writing a custom SSR host, manually owning request
headers/hydration, or building an integration that needs the runtime methods.

The following APIs are retained for older consumers and should not be the
starting point for new application code:

| Compatibility API | Migration |
| --- | --- |
| `getGlobalConfig`, `getClients` and module-global client/config state | Use the injected runtime (`useApolloRuntime`) or the runtime returned by `createApollo`. |
| `loadApolloClients()` | Install `createApollo(...)` on the owning Vue app. It is browser-only and deprecated. |
| `setAuthRouter()` | Pass `navigate` to `useAuth`/`createAuthRuntime`. |
| `UseAuthOptions.meQuery` | Pass a generated `useMeQuery`; use `meSelector` for a non-`data.me` response. |
| `refresh.document` | Use `refresh.useMutation` with a generated refresh mutation. |
| `refreshToken` configuration callback | Use the generated `refresh` contract, including token persistence callbacks for custom stores. |
| `refetchOnUpdate`, `refetchTimeout` | Use reactive variables, Apollo fetch policies, or explicit `refetch()`. |
| `stashToken`, `restoreStashedToken` | Leave cookie reachability recovery to the runtime unless maintaining a legacy integration. |

The lower-level SSR helpers (`extractApolloState`, `restoreApolloState`, and
the SSR hydration/resolution contracts) are for host and integration authors;
most applications should not need them.

## License

MIT
