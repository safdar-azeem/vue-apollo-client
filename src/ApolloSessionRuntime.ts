/**
 * Deterministic 64-bit FNV-1a fingerprint (two independent 32-bit lanes) so
 * opaque tokens and session IDs get distinct cache / offline keys without
 * persisting raw bearer credentials verbatim in browser storage.
 */
const fingerprintOpaqueSession = (value: string): string => {
  let h1 = 0x811c9dc5
  let h2 = 0x050c5d1f
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    h1 ^= code
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= code + i
    h2 = Math.imul(h2, 0x85ebca6b)
  }
  return `opaque:${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * Extract an explicit account identity from a JWT (`sub` or `_id`) when
 * present. Returns `null` for opaque tokens or JWTs without an account claim.
 */
export const resolveJwtAccountIdentity = (
  token: string | null | undefined
): string | null => {
  if (token == null) return null
  const trimmed = String(token).trim()
  if (!trimmed) return null

  const parts = trimmed.split('.')
  if (parts.length !== 3 || !parts[0] || !parts[1]) return null

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8')
    const payload = JSON.parse(json) as { sub?: unknown; _id?: unknown }
    if (typeof payload.sub === 'string' && payload.sub.trim()) {
      return `sub:${payload.sub.trim()}`
    }
    if (typeof payload._id === 'string' && payload._id.trim()) {
      return `sub:${payload._id.trim()}`
    }
  } catch {
    // Opaque or non-JSON payload.
  }

  return null
}

/**
 * Normalize a consumer `getSessionId()` value into a stable cache / offline key.
 *
 * Apps often pass access or refresh tokens here. Those rotate on every refresh,
 * which must NOT wipe the Apollo store or drop the offline queue mid-flight
 * (Apollo invariant #42: "Store reset while query was in flight").
 *
 * - JWT with a login claim (`lsid` or `sid`): use the login identity.
 * - Account-only JWTs: fingerprint the full credential; account identity cannot prove session continuity.
 * - Opaque tokens / explicit session IDs: fingerprint the value so distinct
 *   opaque accounts never share one cache key.
 * - Empty / missing: signed out (`null`).
 */
export const resolveApolloSessionCacheKey = (
  sessionId: string | null | undefined
): string | null => {
  if (sessionId == null) return null
  const trimmed = String(sessionId).trim()
  if (!trimmed) return null

  const parts = trimmed.split('.')
  if (parts.length === 3 && parts[0] && parts[1]) {
    try {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
      const json =
        typeof atob === 'function'
          ? atob(padded)
          : Buffer.from(padded, 'base64').toString('utf8')
      const payload = JSON.parse(json) as { sub?: unknown; _id?: unknown; sid?: unknown; lsid?: unknown }
      if (typeof payload.lsid === 'string' && payload.lsid.trim()) {
        return `login:${payload.lsid}`
      }
      if (typeof payload.sid === 'string' && payload.sid.trim()) {
        return `sid:${payload.sid.trim()}`
      }
    } catch {
      // Opaque or non-JSON payload — fall through.
    }
  }

  return fingerprintOpaqueSession(trimmed)
}

export interface CredentialOwnership {
  accessToken: string
  refreshToken: string
  sessionKey: string | null
  epoch: number
}

export const sameCredentialOwner = (a: CredentialOwnership, b: CredentialOwnership) =>
  a.epoch === b.epoch && a.accessToken === b.accessToken &&
  a.refreshToken === b.refreshToken && a.sessionKey === b.sessionKey

export interface CredentialMutationCoordinator {
  capture?: () => CredentialOwnership
  invalidate?: (owner: CredentialOwnership) => Promise<boolean>
  getEpoch: () => number
  bumpEpoch: () => number
  runExclusive: <T>(task: () => Promise<T> | T) => Promise<T>
}

export const createCredentialMutationCoordinator = (): CredentialMutationCoordinator => {
  let epoch = 0
  let queue: Promise<void> = Promise.resolve()

  return {
    getEpoch: () => epoch,
    bumpEpoch: () => {
      epoch += 1
      return epoch
    },
    runExclusive: <T>(task: () => Promise<T> | T): Promise<T> => {
      const next = queue.then(() => task(), () => task())
      queue = next.then(() => undefined, () => undefined)
      return next
    },
  }
}

export const isApolloStoreResetError = (error: unknown): boolean => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String((error as { message?: unknown } | null)?.message ?? error ?? '')
  return (
    message.includes('Store reset while query was in flight') ||
    // Minified Apollo builds may only expose the invariant number via the docs URL.
    /[?&#]message[=:]42\b/.test(message) ||
    message.includes('"message":42')
  )
}

const decodeBase64Url = (value: string): string | null => {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`
    if (typeof atob === 'function') {
      const binary = atob(padded)
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
      return new TextDecoder().decode(bytes)
    }
    return Buffer.from(padded, 'base64').toString('utf8')
  } catch {
    return null
  }
}

export const decodeTokenClaims = (
  token: string | null | undefined
): Record<string, unknown> | null => {
  if (!token) return null
  const encodedPayload = token.split('.')[1]
  if (!encodedPayload) return null
  const decoded = decodeBase64Url(encodedPayload)
  if (!decoded) return null
  try {
    const claims = JSON.parse(decoded)
    return claims && typeof claims === 'object' && !Array.isArray(claims)
      ? claims as Record<string, unknown>
      : null
  } catch {
    return null
  }
}
