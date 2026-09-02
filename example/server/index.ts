import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { GraphQLError } from 'graphql'
import { createSchema, createYoga } from 'graphql-yoga'

const PORT = Number(process.env.API_PORT || 4000)

type DemoUser = {
  id: string
  name: string
  email: string
  permissions: string[]
}

type Task = {
  id: string
  title: string
  done: boolean
  ownerId: string
}

const demoUser: DemoUser = {
  id: 'user-1',
  name: 'Demo User',
  email: 'demo@example.com',
  permissions: ['tasks:read', 'tasks:write', 'tasks:delete'],
}

let tasks: Task[] = [
  { id: 'task-1', title: 'Read the example GraphQL files', done: true, ownerId: demoUser.id },
  { id: 'task-2', title: 'Try creating a task', done: false, ownerId: demoUser.id },
  { id: 'task-3', title: 'Edit, toggle, and delete a task', done: false, ownerId: demoUser.id },
]

const accessTokens = new Map<string, string>()
const refreshTokens = new Map<string, string>()

const createSession = (user: DemoUser) => {
  const token = `access-${randomUUID()}`
  const refreshToken = `refresh-${randomUUID()}`
  accessTokens.set(token, user.id)
  refreshTokens.set(refreshToken, user.id)
  return { token, refreshToken, user }
}

const getBearerToken = (request: Request) => {
  const authorization = request.headers.get('authorization') || ''
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : authorization
}

const requireUser = (request: Request) => {
  const token = getBearerToken(request)
  const userId = accessTokens.get(token)
  if (!userId || userId !== demoUser.id) {
    throw new GraphQLError('Your session is not authenticated.', {
      extensions: { code: 'UNAUTHENTICATED' },
    })
  }
  return demoUser
}

const requirePermission = (request: Request, permission: string) => {
  const user = requireUser(request)
  if (!user.permissions.includes(permission)) {
    throw new GraphQLError(`Missing permission: ${permission}.`, {
      extensions: { code: 'FORBIDDEN' },
    })
  }
  return user
}

const typeDefs = /* GraphQL */ `
  type User {
    id: ID!
    name: String!
    email: String!
    permissions: [String!]!
  }

  type Task {
    id: ID!
    title: String!
    done: Boolean!
    ownerId: ID!
  }

  type Session {
    token: String!
    refreshToken: String!
    user: User!
  }

  type RefreshResult {
    token: String!
    refreshToken: String!
  }

  type Query {
    me: User
    tasks: [Task!]!
    task(id: ID!): Task
  }

  type Mutation {
    login(email: String!, password: String!): Session!
    refreshSession(refreshToken: String!): RefreshResult!
    createTask(title: String!): Task!
    updateTask(id: ID!, title: String, done: Boolean): Task!
    deleteTask(id: ID!): Boolean!
  }
`

type Context = { request: Request }

const resolvers = {
  Query: {
    me: (_parent: unknown, _args: unknown, context: Context) => requireUser(context.request),
    tasks: (_parent: unknown, _args: unknown, context: Context) => {
      const user = requireUser(context.request)
      return tasks.filter(task => task.ownerId === user.id)
    },
    task: (_parent: unknown, args: { id: string }, context: Context) => {
      const user = requireUser(context.request)
      return tasks.find(task => task.id === args.id && task.ownerId === user.id) || null
    },
  },
  Mutation: {
    login: (_parent: unknown, args: { email: string; password: string }) => {
      if (args.email !== demoUser.email || args.password !== 'password123') {
        throw new GraphQLError('Invalid email or password.', {
          extensions: { code: 'UNAUTHENTICATED' },
        })
      }
      return createSession(demoUser)
    },
    refreshSession: (_parent: unknown, args: { refreshToken: string }) => {
      const userId = refreshTokens.get(args.refreshToken)
      if (!userId || userId !== demoUser.id) {
        throw new GraphQLError('Refresh token is invalid.', {
          extensions: { code: 'UNAUTHENTICATED' },
        })
      }
      refreshTokens.delete(args.refreshToken)
      const next = createSession(demoUser)
      return { token: next.token, refreshToken: next.refreshToken }
    },
    createTask: (_parent: unknown, args: { title: string }, context: Context) => {
      const user = requirePermission(context.request, 'tasks:write')
      const task: Task = {
        id: `task-${randomUUID()}`,
        title: args.title.trim(),
        done: false,
        ownerId: user.id,
      }
      tasks = [task, ...tasks]
      return task
    },
    updateTask: (
      _parent: unknown,
      args: { id: string; title?: string | null; done?: boolean | null },
      context: Context,
    ) => {
      const user = requirePermission(context.request, 'tasks:write')
      const task = tasks.find(item => item.id === args.id && item.ownerId === user.id)
      if (!task) throw new GraphQLError('Task not found.', { extensions: { code: 'NOT_FOUND' } })
      if (typeof args.title === 'string') task.title = args.title.trim()
      if (typeof args.done === 'boolean') task.done = args.done
      return task
    },
    deleteTask: (_parent: unknown, args: { id: string }, context: Context) => {
      const user = requirePermission(context.request, 'tasks:delete')
      const before = tasks.length
      tasks = tasks.filter(task => !(task.id === args.id && task.ownerId === user.id))
      return tasks.length !== before
    },
  },
}

const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),
  graphqlEndpoint: '/graphql',
  cors: {
    origin: 'http://localhost:5173',
    credentials: true,
  },
})

const server = createServer(yoga)
server.listen(PORT, () => {
  console.log(`Demo GraphQL API → http://localhost:${PORT}/graphql`)
  console.log('Login: demo@example.com / password123')
})
