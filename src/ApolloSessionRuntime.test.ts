import { describe, expect, it } from 'vitest'
import {
  isApolloStoreResetError,
  resolveApolloSessionCacheKey,
} from './ApolloSessionRuntime'

const jwt = (claims: Record<string, unknown>) => {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${header}.${payload}.sig`
}

describe('resolveApolloSessionCacheKey', () => {
  it('returns null for signed-out values', () => {
    expect(resolveApolloSessionCacheKey(null)).toBeNull()
    expect(resolveApolloSessionCacheKey('')).toBeNull()
    expect(resolveApolloSessionCacheKey('   ')).toBeNull()
  })

  it('uses JWT sub/sid so token rotation stays in the same session', () => {
    expect(resolveApolloSessionCacheKey(jwt({ sub: 'user-1', jti: 'a' }))).toBe(
      'sub:user-1'
    )
    expect(resolveApolloSessionCacheKey(jwt({ sub: 'user-1', jti: 'b' }))).toBe(
      'sub:user-1'
    )
    expect(resolveApolloSessionCacheKey(jwt({ sid: 'sess-9' }))).toBe('sid:sess-9')
  })

  it('buckets opaque rotating tokens as a single signed-in session', () => {
    expect(resolveApolloSessionCacheKey('opaque-refresh-1')).toBe('authenticated')
    expect(resolveApolloSessionCacheKey('opaque-refresh-2')).toBe('authenticated')
  })
})

describe('isApolloStoreResetError', () => {
  it('detects Apollo invariant #42 messages', () => {
    expect(
      isApolloStoreResetError(
        new Error('Store reset while query was in flight (not completed in link chain)')
      )
    ).toBe(true)
    expect(
      isApolloStoreResetError(
        'https://go.apollo.dev/c/err#{"version":"3.14.1","message":42,"args":[]}'
      )
    ).toBe(true)
    expect(isApolloStoreResetError(new Error('Network error'))).toBe(false)
  })
})
