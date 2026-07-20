/**
 * Normalize a consumer `getSessionId()` value into a stable cache / offline key.
 *
 * Apps often pass access or refresh tokens here. Those rotate on every refresh,
 * which must NOT wipe the Apollo store or drop the offline queue mid-flight
 * (Apollo invariant #42: "Store reset while query was in flight").
 *
 * - JWT with `sub` / `sid`: use that claim (stable for the browser session).
 * - Opaque tokens: one signed-in bucket (`authenticated`) so rotation is ignored.
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
      const payload = JSON.parse(json) as { sub?: unknown; sid?: unknown }
      if (typeof payload.sub === 'string' && payload.sub.trim()) {
        return `sub:${payload.sub.trim()}`
      }
      if (typeof payload.sid === 'string' && payload.sid.trim()) {
        return `sid:${payload.sid.trim()}`
      }
    } catch {
      // Opaque or non-JSON payload — fall through.
    }
  }

  return 'authenticated'
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
