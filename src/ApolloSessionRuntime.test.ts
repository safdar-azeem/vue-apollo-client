import { describe, expect, it } from 'vitest'
import {
  isApolloStoreResetError,
  resolveApolloSessionCacheKey,
  resolveJwtAccountIdentity,
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

  it('isolates same-account logins unless a stable login claim proves continuity', () => {
    expect(resolveApolloSessionCacheKey(jwt({ sub: 'u', jti: 'a' }))).not.toBe(resolveApolloSessionCacheKey(jwt({ sub: 'u', jti: 'b' })))
    expect(resolveApolloSessionCacheKey(jwt({ _id: 'u', sid: 'a' }))).not.toBe(resolveApolloSessionCacheKey(jwt({ _id: 'u', sid: 'b' })))
    expect(resolveApolloSessionCacheKey(jwt({ lsid: 'login', jti: 'a' }))).toBe(resolveApolloSessionCacheKey(jwt({ lsid: 'login', jti: 'b' })))
  })

  it('isolates distinct opaque tokens while keeping identical opaque session IDs stable', () => {
    const first = resolveApolloSessionCacheKey('opaque-account-a')
    const second = resolveApolloSessionCacheKey('opaque-account-b')
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first).not.toBe(second)
    expect(resolveApolloSessionCacheKey('opaque-account-a')).toBe(first)
    expect(first).not.toContain('opaque-account-a')
  })

  it('extracts JWT account identity only when sub or _id is present', () => {
    expect(resolveJwtAccountIdentity(jwt({ sub: 'user-1' }))).toBe('sub:user-1')
    expect(resolveJwtAccountIdentity(jwt({ _id: 'user-1', sid: 'jti-1' }))).toBe('sub:user-1')
    expect(resolveJwtAccountIdentity(jwt({ sid: 'jti-1' }))).toBeNull()
    expect(resolveJwtAccountIdentity('opaque-token')).toBeNull()
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
