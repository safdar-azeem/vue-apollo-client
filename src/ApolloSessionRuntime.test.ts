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

  it('uses JWT sub/_id/sid so token rotation stays in the same session', () => {
    expect(resolveApolloSessionCacheKey(jwt({ sub: 'user-1', jti: 'a' }))).toBe(
      'sub:user-1'
    )
    expect(resolveApolloSessionCacheKey(jwt({ sub: 'user-1', jti: 'b' }))).toBe(
      'sub:user-1'
    )
    // Builto access tokens carry `_id` and a rotating refresh-session `sid`.
    expect(resolveApolloSessionCacheKey(jwt({ _id: 'user-1', sid: 'jti-1' }))).toBe(
      'sub:user-1'
    )
    expect(resolveApolloSessionCacheKey(jwt({ _id: 'user-1', sid: 'jti-2' }))).toBe(
      'sub:user-1'
    )
    expect(resolveApolloSessionCacheKey(jwt({ _id: 'user-2', sid: 'jti-3' }))).toBe(
      'sub:user-2'
    )
    expect(resolveApolloSessionCacheKey(jwt({ sid: 'sess-9' }))).toBe('sid:sess-9')
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
