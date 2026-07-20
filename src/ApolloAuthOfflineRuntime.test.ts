// @vitest-environment jsdom
import { gql } from '@apollo/client/core/index.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApolloOfflineRuntime } from './ApolloOfflineRuntime'
import { createAuthRuntime } from './composables/useAuth'

const ME_QUERY = gql`query RuntimeMe { me { id } }`
const SAVE_MUTATION = gql`mutation RuntimeSave($value: String!) { save(value: $value) }`

describe('application-scoped auth and offline state', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  })

  it('isolates auth state and navigation between Vue application runtimes', async () => {
    const leftNavigate = vi.fn(async () => undefined)
    const rightNavigate = vi.fn(async () => undefined)
    const runtime = (id: string) => ({
      clients: { default: { clearStore: vi.fn(async () => undefined) } },
      clearStore: vi.fn(async () => undefined),
      executeQuery: vi.fn(async () => ({ data: { me: { id } } })),
    }) as any
    const leftRuntime = runtime('left')
    const rightRuntime = runtime('right')
    const left = createAuthRuntime(leftRuntime, {
      meQuery: ME_QUERY,
      getToken: () => 'left-token',
      clearToken: vi.fn(),
      navigate: leftNavigate,
    })
    const right = createAuthRuntime(rightRuntime, {
      meQuery: ME_QUERY,
      getToken: () => 'right-token',
      clearToken: vi.fn(),
      navigate: rightNavigate,
    })

    await Promise.all([left.verify(), right.verify()])
    expect(left.user.value.id).toBe('left')
    expect(right.user.value.id).toBe('right')

    await left.logout()
    expect(left.user.value).toBeNull()
    expect(right.user.value.id).toBe('right')
    expect(leftNavigate).toHaveBeenCalledWith('/login')
    expect(rightNavigate).not.toHaveBeenCalled()
  })

  it('isolates offline queues and never replays into a different session', async () => {
    const jwtFor = (sub: string) => {
      const header = btoa(JSON.stringify({ alg: 'none' }))
      const payload = btoa(JSON.stringify({ sub }))
      return `${header}.${payload}.sig`
    }
    let leftSession = jwtFor('left-user')
    const leftClient = { mutate: vi.fn(async () => ({ data: { save: true } })) }
    const rightClient = { mutate: vi.fn(async () => ({ data: { save: true } })) }
    const left = createApolloOfflineRuntime({
      applicationId: 'left-app',
      authBoundary: 'customer',
      endPoints: { default: 'https://left.test/graphql' },
      allowOffline: true,
      getSessionId: () => leftSession,
    }, { default: leftClient } as any)
    const right = createApolloOfflineRuntime({
      applicationId: 'right-app',
      authBoundary: 'customer',
      endPoints: { default: 'https://right.test/graphql' },
      allowOffline: true,
      getSessionId: () => jwtFor('right-user'),
    }, { default: rightClient } as any)

    left.enqueue('default', SAVE_MUTATION, { value: 'left' })
    right.enqueue('default', SAVE_MUTATION, { value: 'right' })
    await right.sync()
    expect(rightClient.mutate).toHaveBeenCalledTimes(1)
    expect(leftClient.mutate).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(1)

    leftSession = jwtFor('replacement-user')
    await left.sync()
    expect(leftClient.mutate).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
    left.stop()
    right.stop()
  })
})
