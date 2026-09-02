# Vue Apollo Client — Small Real Example

A deliberately small, runnable Vue 3 application showing the normal `vue-apollo-client` workflow in real components:

- install `vue-apollo-client`
- configure the Vite codegen plugin
- define GraphQL operations in `.graphql` files
- consume generated query/mutation composables
- install Apollo once with `defineApollo`
- authenticate with `useAuth()` + `setSession()` + `verifySession()`
- share the authenticated user across components
- query a list and one record
- create, update, toggle, and delete records
- refetch a query after mutations
- configure refresh-token handling
- use `auth.can()` for simple permission checks

The included GraphQL API is an **in-memory demo server**. There is no database and no production auth implementation to distract from the client example.

## Demo credentials

```text
Email:    demo@example.com
Password: password123
```

## Quick start

```bash
yarn install
cp .env.example .env
yarn dev
```

Open:

```text
http://localhost:5173
```

GraphQL API:

```text
http://localhost:4000/graphql
```

`yarn dev` starts both the tiny GraphQL API and Vite application.

The `vueApollo()` Vite plugin watches the `.graphql` operation files and regenerates `src/graphql/generated.ts` during development. The repository includes a generated-compatible copy so the example is readable/buildable immediately; after running Vite, the package's real codegen owns that file.

## Repository tree

```text
vue-apollo-client-example/
├── README.md
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── .env.example
├── server/
│   └── index.ts
└── src/
    ├── App.vue
    ├── main.ts
    ├── style.css
    ├── config/
    │   └── apollo.ts
    ├── components/
    │   ├── LoginCard.vue
    │   ├── SessionCard.vue
    │   ├── TaskCreateForm.vue
    │   ├── TaskDetails.vue
    │   ├── TaskItem.vue
    │   └── TaskList.vue
    └── graphql/
        ├── schema.graphql
        ├── generated.ts
        └── operations/
            ├── auth.graphql
            └── tasks.graphql
```

## 1. Vite + GraphQL codegen

`vite.config.ts`:

```ts
import { vueApollo } from 'vue-apollo-client/vite'

vueApollo({
  schema: './src/graphql/schema.graphql',
  documents: ['src/graphql/operations/**/*.graphql'],
  output: 'src/graphql/generated.ts',
})
```

The important files developers should edit are the `.graphql` operation files — not `generated.ts`.

## 2. Install Apollo once

`src/config/apollo.ts` configures both the GraphQL endpoint and installed auth runtime:

```ts
export default defineApollo({
  endpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT,
  tokenKey: 'demo_auth',
  formatToken: token => `Bearer ${token}`,
  auth: {
    useMeQuery,
    meSelector: data => data?.me,
    permissions: user => user?.permissions || [],
  },
})
```

`src/main.ts` installs it once:

```ts
const app = createApp(App)
app.use(apollo)
app.mount('#app')
```

There is no second auth store.

## 3. Authentication

`LoginCard.vue` performs the generated `Login` mutation, then gives the returned session to the installed auth runtime:

```ts
const auth = useAuth()
const { mutate: login } = useLoginMutation()

const response = await login({ email, password })
const session = response?.data?.login

await auth.setSession({
  token: session.token,
  refreshToken: session.refreshToken,
  user: session.user,
})

await auth.verifySession()
```

Other components simply call:

```ts
const auth = useAuth()

auth.user
auth.isAuthenticated
auth.can('tasks:write')
await auth.logout()
```

## 4. Queries

`TaskList.vue`:

```ts
const { result, loading, error, refetch } = useGetTasksQuery()
```

`TaskDetails.vue` shows a query with variables that react when the selected task changes:

```ts
const query = useGetTaskQuery(
  () => ({ id: props.taskId }),
  () => ({ enabled: Boolean(props.taskId) }),
)
```

## 5. Create

`TaskCreateForm.vue`:

```ts
const { mutate: createTask } = useCreateTaskMutation()

await createTask(
  { title: title.value },
  { refetchQueries: ['GetTasks'], awaitRefetchQueries: true },
)
```

## 6. Update

`TaskItem.vue` uses the generated update mutation for both title edits and the completed state:

```ts
await updateTask(
  { id: props.task.id, done: !props.task.done },
  { refetchQueries: ['GetTasks'], awaitRefetchQueries: true },
)
```

## 7. Delete

```ts
await deleteTask(
  { id: props.task.id },
  { refetchQueries: ['GetTasks'], awaitRefetchQueries: true },
)
```

## 8. Refresh token

The example also wires the generated `RefreshSession` mutation into `defineApollo`:

```ts
refresh: {
  useMutation: useRefreshSessionMutation,
  createVariables: refreshToken => ({ refreshToken }),
  selectTokens: data => data?.refreshSession,
}
```

The demo API rotates tokens when the refresh mutation is called.

## What this example intentionally does not include

To keep the repository useful as documentation, it does not include:

- a database
- Vue Router
- Pinia
- SSR
- complex UI libraries
- production password hashing/JWT signing
- product-specific authorization architecture

Those concerns are independent of learning `vue-apollo-client`.

## Using this inside the vue-apollo-client repository

If you place this under `examples/basic/` in the main repository, keep the public GitHub example depending on the published package (`vue-apollo-client@^1.4.0`) so users see the same installation they would use in a real project.

For local library development only, you can temporarily point that dependency at the local package, but do not publish a public example with an accidental machine-specific path.
