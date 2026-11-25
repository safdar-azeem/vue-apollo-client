import { decodeTokenClaims } from './ApolloSessionRuntime'
import { getRefreshToken, getToken } from './composables/useCookies'
import { verificationDeadline, executeWithAbort } from './ApolloOperationRuntime'
import type { AuthSession, VueApolloClientOptions } from './types'

/** One in-memory access credential per installed browser runtime. The session
 * endpoint keeps its durable credential in its own host-only HttpOnly cookie. */
export function createBrowserSession(options: VueApolloClientOptions, base: string, onReplacement?: () => void) {
  const endpoint = new URL(base, window.location.origin)
  if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost') {
    throw new Error('A secure session endpoint is required.')
  }
  let token: string | null = null
  let sessionId: string | null = null
  let documentLogin: string | null = null
  let replaced = false
  let expiresAt = Infinity
  const assertActive = () => { if (replaced) throw new Error('Session changed before dispatch. Reopen this page.') }
  let revision = 0
  let nextRead = 0
  const readHint = () => options.browserSessionChangeKey ? getToken(options.browserSessionChangeKey) : undefined
  let knownHint = readHint()
  const stillCurrent = () => readHint() === knownHint
  const forget = () => { revision++; token = null; sessionId = null }
  const request = async (action: string, body: unknown, signal?: AbortSignal) => {
    assertActive()
    signal?.throwIfAborted()
    const url = new URL(endpoint.href)
    url.pathname = endpoint.pathname.replace(/\/$/, '') + '/' + action
    const response = await fetch(url, {
      method: 'POST', credentials: 'include', redirect: 'error', cache: 'no-store',
      headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body), signal,
    })
    if (response.status === 401) return null
    if (!response.ok) throw Object.assign(new Error('The session service is unavailable.'), { status: response.status })
    return response.json()
  }
  const withWriter = <T>(signal: AbortSignal, work: () => Promise<T>) => {
    if (endpoint.origin !== window.location.origin || !navigator.locks) {
      throw new Error('A secure sign-in window with Web Locks support is required.')
    }
    return navigator.locks.request(endpoint.href, { signal }, work)
  }
  let migrate = endpoint.origin === window.location.origin
  const readBroker = async (signal: AbortSignal, refreshOnly: boolean): Promise<boolean> => {
    assertActive()
    const start = revision
    const id = ++nextRead
    const checkOwner = () => {
      assertActive()
      if (start !== revision || id !== nextRead || signal.aborted) throw new Error('Session verification was superseded.')
    }
    let hint = readHint()
    let result = await request('access', {}, signal)
    checkOwner()
    if (!result && migrate && !refreshOnly) {
      result = await withWriter(signal, async () => {
        checkOwner()
        const current = await request('access', {}, signal)
        checkOwner()
        if (current) { hint = readHint(); return current }
        const legacy = getToken(options.tokenKey, options.tokenCookie)
        const refreshToken = getRefreshToken(options.tokenKey, options.tokenCookie)
        if (!refreshToken) return null
        // Retain independent possession proof across a lost response or reload.
        const key = endpoint.href + ':migration'
        let recoveryKey = sessionStorage.getItem(key)
        if (!recoveryKey) {
          recoveryKey = crypto.randomUUID()
          sessionStorage.setItem(key, recoveryKey)
        }
        const established = await request('establish', { token: legacy ?? '', refreshToken, recoveryKey }, signal)
        if (!established) return null
        hint = readHint()
        const access = await request('access', {}, signal)
        if (!access || access.sessionId !== established.sessionId) throw new Error('Sign-in was superseded.')
        sessionStorage.removeItem(key)
        return access
      })
      migrate = false
    }
    checkOwner()
    if (hint !== readHint()) throw new Error('The active login changed. Try again.')
    if (!result) { knownHint = hint; forget(); return false }
    if (typeof result.token !== 'string' || !result.token || typeof result.sessionId !== 'string' || !result.sessionId) {
      throw new Error('The session service returned an invalid response.')
    }
    if (documentLogin && documentLogin !== result.sessionId) {
      replaced = true
      forget()
      onReplacement?.()
      assertActive()
    }
    if (refreshOnly && sessionId !== result.sessionId) {
      forget()
      throw new Error('The active login changed. Verify the current session.')
    }
    migrate = false
    knownHint = hint
    documentLogin = result.sessionId
    const exp = decodeTokenClaims(result.token)?.exp
    expiresAt = typeof exp === 'number' ? exp * 1000 : Infinity
    token = result.token
    sessionId = result.sessionId
    return true
  }
  const bounded = <T>(work: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal) =>
    executeWithAbort(parent, verificationDeadline(options.auth?.verificationTimeoutMs), signal => work(signal!))
  // Readers share the network operation, while each caller retains its own cancellation.
  // Migration and a cold refresh have different authority and cannot join one another.
  type AccessRead = {
    revision: number
    hint: ReturnType<typeof readHint>
    refreshOnly: boolean
    controller: AbortController
    callers: number
    result: Promise<boolean>
  }
  let activeRead: AccessRead | undefined
  const read = async (signal: AbortSignal, refreshOnly = false) => {
    assertActive()
    signal.throwIfAborted()
    const intended = sessionId
    const strict = refreshOnly && (!intended || intended !== documentLogin)
    const hint = readHint()
    let shared = activeRead
    if (!shared || shared.revision !== revision || shared.hint !== hint ||
        shared.refreshOnly !== strict || shared.controller.signal.aborted) {
      const controller = new AbortController()
      const flight: AccessRead = {
        revision, hint, refreshOnly: strict, controller, callers: 0,
        result: bounded(inner => readBroker(inner, strict), controller.signal),
      }
      activeRead = shared = flight
      flight.result = flight.result.finally(() => {
        if (activeRead === flight) activeRead = undefined
      })
    }
    shared.callers++
    try {
      const present = await executeWithAbort(signal, undefined, () => shared.result)
      if (refreshOnly && present && intended !== sessionId) throw new Error('The active login changed. Verify the current session.')
      return present
    } finally {
      if (--shared.callers === 0) shared.controller.abort()
    }
  }
  const prepareOperation = (requireIdentity = false) => {
    assertActive()
    if (stillCurrent() && (token ? expiresAt > Date.now() + 15000 : !requireIdentity)) return
    const original = sessionId
    return bounded(signal => read(signal)).then(() => {
      if (original && sessionId !== original) {
        replaced = true
        onReplacement?.()
        assertActive()
      }
    })
  }
  const establish = async (session: AuthSession, wait?: { signal?: AbortSignal }) => {
    assertActive()
    const start = ++revision
    const hint = knownHint
    if (!session.token || !session.refreshToken) throw new Error('A complete sign-in response is required.')
    await bounded(signal => withWriter(signal, async () => {
      const body = { token: session.token, refreshToken: session.refreshToken }
      const dispatch = () => {
        assertActive()
        if (start !== revision || (documentLogin && hint !== readHint())) throw new Error('Sign-in was superseded.')
        return request('establish', body, signal)
      }
      let established = await dispatch()
      let previousCount = Infinity
      while (Number.isInteger(established?.remaining)) {
        signal.throwIfAborted()
        if (revision !== start || established.remaining >= previousCount || established.remaining <= 8) {
          throw new Error('Session cookie cleanup did not progress. Please retry sign-in.')
        }
        previousCount = established.remaining
        established = await dispatch()
      }
      if (!established?.sessionId || revision !== start) throw new Error('Sign-in was superseded.')
      assertActive()
      revision++
      migrate = false
      documentLogin = established.sessionId
      if (!await read(signal) || sessionId !== established.sessionId || !stillCurrent()) {
        forget()
        throw new Error('Sign-in was superseded.')
      }
    }), wait?.signal)
  }
  const captureLogout = () => {
    const intended = sessionId
    const start = ++revision
    return async () => {
      assertActive()
      if (!intended) throw new Error('Verify the current login before signing out.')
      await bounded(signal => request('logout', { sessionId: intended }, signal))
      if (revision === start) forget()
    }
  }
  return {
    read, forget, captureLogout, prepareOperation,
    options: {
      ...options, getToken: () => stillCurrent() ? token : null, getSessionId: () => stillCurrent() ? sessionId : null, setToken: establish, clearToken: forget,
      refresh: undefined, refreshToken: async () => {
        if (!await bounded(signal => read(signal, true))) throw Object.assign(new Error('Session expired.'), { status: 401 })
        return token
      },
      sessionMode: 'cookie' as const, credentials: 'omit' as const,
      auth: { ...options.auth, sessionMode: 'cookie' as const, getToken: () => stillCurrent() ? token : null, setToken: establish,
        clearToken: forget, clearSession: () => captureLogout()() },
    },
  }
}
