import createUploadLink from 'apollo-upload-client/createUploadLink.mjs'
import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  Observable,
  type ApolloClientOptions,
  type InMemoryCacheConfig,
  type NormalizedCacheObject,
  from,
  fromPromise,
} from '@apollo/client/core/index.js'
import { onError } from '@apollo/client/link/error/index.js'
import { setContext as setContextLink } from '@apollo/client/link/context/index.js'
import {
  getCookieValueFromHeader,
  getToken as getCookieToken,
  getRefreshToken as getCookieRefreshToken,
  removeToken,
  setToken,
} from '../composables/useCookies'
import type {
  VueApolloRefreshContract,
  VueApolloRuntimeOptions,
  TokenCookieOptions,
} from '../types'
import {
  createCredentialMutationCoordinator,
  resolveApolloSessionCacheKey,
  sameCredentialOwner,
  type CredentialOwnership,
  type CredentialMutationCoordinator,
} from '../ApolloSessionRuntime'

export type SetGraphqlContext = ({
  operationName,
  variables,
  token,
}: {
  operationName: string
  variables: any
  token: string
}) => Record<string, any>

export type ApolloUploadConfig = Parameters<typeof createUploadLink>[0]

interface ConfigProps {
  endPoints: Record<string, string>
  tokenKey: string
  tokenCookie?: TokenCookieOptions
  setContext?: SetGraphqlContext
  memoryConfig?: Partial<InMemoryCacheConfig>
  useGETForQueries?: boolean
  apolloClientConfig?: Partial<ApolloClientOptions<any>> | null
  apolloUploadConfig?: Partial<ApolloUploadConfig>
  refresh?: VueApolloRefreshContract<any, any>
  refreshToken?: () => Promise<string | void | null>
  onLogout?: () => void
  getToken?: () => string | null | undefined
  setToken?: (session: { token?: string | null; refreshToken?: string | null }) => void | Promise<void>
  clearToken?: () => void | Promise<void>
  formatToken?: (token: string) => string
  prepareOperation?: () => Promise<void> | undefined
  getSessionId?: () => string | null | undefined
  sessionMode?: 'token' | 'cookie'
  credentials?: RequestCredentials
  credentialCoordinator?: CredentialMutationCoordinator
  runtime?: VueApolloRuntimeOptions
}

const positiveTimeout = (value: number | undefined): number | undefined =>
  Number.isFinite(value) && Number(value) > 0 ? Number(value) : undefined

const createRuntimeFetch = (
  runtime: VueApolloRuntimeOptions
): typeof fetch => {
  const baseFetch = runtime.fetch ?? globalThis.fetch
  const timeoutMs = positiveTimeout(runtime.requestTimeoutMs)

  return async (input, init = {}) => {
    if (!baseFetch) throw new Error('No fetch implementation is available for Apollo.')
    if (!timeoutMs && !runtime.signal) return baseFetch(input, init)

    const signals = [runtime.signal, init.signal].filter(Boolean) as AbortSignal[]
    if (timeoutMs) signals.push(AbortSignal.timeout(timeoutMs))
    // Fetch resolves at headers. The composed signal must still reach the
    // native response stream throughout body consumption.
    const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals)
    return baseFetch(input, { ...init, signal })
  }
}

export const graphqlConfig = ({
  endPoints,
  tokenKey,
  tokenCookie,
  setContext,
  memoryConfig,
  useGETForQueries,
  apolloClientConfig,
  apolloUploadConfig,
  refresh: refreshTokenContract,
  refreshToken,
  onLogout,
  getToken,
  setToken: setConfiguredToken,
  clearToken,
  prepareOperation,
  formatToken = (token) => token,
  getSessionId,
  sessionMode,
  credentials,
  credentialCoordinator: providedCredentialCoordinator,
  runtime = {},
}: ConfigProps): Record<string, ApolloClient<NormalizedCacheObject>> => {
  const credentialCoordinator =
    providedCredentialCoordinator ?? createCredentialMutationCoordinator()
  const server = runtime.server ?? typeof window === 'undefined'
  const readRequestHeader = (name: string): string | undefined => {
    const entry = Object.entries(runtime.requestHeaders ?? runtime.headers ?? {})
      .find(([key]) => key.toLowerCase() === name)
    return entry?.[1]
  }
  const readRequestToken = (): string | undefined => {
    const authorization = readRequestHeader('authorization')
    if (authorization) {
      return authorization.replace(/^Bearer\s+/i, '').trim() || undefined
    }
    return getCookieValueFromHeader(readRequestHeader('cookie'), tokenKey)
  }
  const readToken = (): string | null | undefined =>
    server
      ? readRequestToken()
      : getToken
        ? getToken()
        : getCookieToken(tokenKey, tokenCookie)
  const removeConfiguredToken = (): void | Promise<void> => {
    if (server) return
    if (clearToken) return clearToken()
    removeToken(tokenKey, tokenCookie)
  }

  const usesCustomTokenStore = Boolean(getToken || setConfiguredToken || clearToken)
  if (usesCustomTokenStore && refreshTokenContract) {
    const missingCallbacks: string[] = []
    if (!refreshTokenContract.getRefreshToken) missingCallbacks.push('getRefreshToken')
    if (!refreshTokenContract.persistTokens) missingCallbacks.push('persistTokens')
    if (!refreshTokenContract.clearTokens) missingCallbacks.push('clearTokens')
    if (missingCallbacks.length) {
      throw new Error(
        `Custom token stores must provide refresh callbacks: ${missingCallbacks.join(', ')}.`,
      )
    }
  }


  const refresh = refreshTokenContract
    ? {
        ...refreshTokenContract,
        getRefreshToken: refreshTokenContract.getRefreshToken ?? (() =>
          getCookieRefreshToken(tokenKey, tokenCookie)),
        persistTokens: refreshTokenContract.persistTokens ?? ((tokens) => {
          if (setConfiguredToken) {
            return setConfiguredToken(tokens)
          }
          return setToken({
            key: tokenKey,
            token: tokens.token,
            refreshToken: tokens.refreshToken || undefined,
            options: tokenCookie,
          })
        }),
        clearTokens: refreshTokenContract.clearTokens ?? (() =>
          (clearToken ? clearToken() : removeToken(tokenKey, tokenCookie))),
      }
    : undefined

  const clearAuthentication = (): void | Promise<void> => {
    if (refresh) return refresh.clearTokens()
    return removeConfiguredToken()
  }

  interface RefreshOutcome {
    token: string
    source: 'refreshed' | 'external'
  }

  const clients: Record<string, ApolloClient<NormalizedCacheObject>> = {}
  const refreshPromises = new Map<string, Promise<RefreshOutcome>>()
  // Tracks access tokens directly rotated by this runtime in the current epoch
  // so concurrent operations in the same runtime can establish continuity,
  // while externally replaced credentials (e.g. logout + re-login in another
  // Builto app) are never treated as proof of session continuity for mutations.
  const inRuntimeRotations = new Map<string, { token: string; epoch: number }>()
  const recordInRuntimeRotation = (fromToken: string, toToken: string, epoch: number) => {
    if (!fromToken || !toToken || fromToken === toToken) return
    inRuntimeRotations.set(fromToken, { token: toToken, epoch })
    if (inRuntimeRotations.size > 8) {
      const oldest = inRuntimeRotations.keys().next().value
      if (oldest !== undefined) inRuntimeRotations.delete(oldest)
    }
  }
  const hasInRuntimeContinuity = (fromToken: string, toToken: string, epoch: number): boolean => {
    if (!fromToken || !toToken) return false
    let cursor = fromToken
    for (let hop = 0; hop < 8; hop += 1) {
      const next = inRuntimeRotations.get(cursor)
      if (!next || next.epoch !== epoch) return false
      if (next.token === toToken) return true
      cursor = next.token
    }
    return false
  }
  const isMutationOperation = (operation: { query?: { definitions?: readonly any[] } }): boolean =>
    Boolean(
      operation.query?.definitions?.some(
        (definition: any) =>
          definition?.kind === 'OperationDefinition' &&
          definition?.operation === 'mutation'
      )
    )
  const readRefreshToken = () => refresh
    ? refresh.getRefreshToken()
    : server
      ? getCookieValueFromHeader(readRequestHeader('cookie'), `${tokenKey}_refresh`)
      : usesCustomTokenStore ? undefined : getCookieRefreshToken(tokenKey, tokenCookie)
  const readSessionSource = () => {
    if (getSessionId) return getSessionId()
    const token = readToken()
    if (token || getToken) return token
    return readRefreshToken()
  }
  let lastSessionKey = server
    ? null
    : resolveApolloSessionCacheKey(readSessionSource() ?? null)
  const clearAllStores = async () => {
    await Promise.all(Object.values(clients).map(async (client) => {
      try {
        await client.clearStore()
      } catch {
        // Best-effort browser session cleanup.
      }
    }))
  }
  /**
   * Isolate cached data when the stable session identity changes.
   *
   * Must NOT use `client.clearStore()` here: that cancels in-flight observables
   * (Apollo invariant #42). The first authenticated request after login is the
   * operation that detects signed-out → signed-in, so clearing via `clearStore`
   * aborts the post-login `me` verify and leaves the router auth guard stuck
   * (toast shows success, URL stays on /auth/login until a hard refresh — when
   * `lastSessionKey` is already primed and no clear runs).
   */
  const resetSessionCaches = async () => {
    await Promise.all(Object.values(clients).map(async (client) => {
      try {
        await client.cache.reset()
      } catch {
        // Best-effort browser session cleanup.
      }
    }))
  }

  const isAuthenticationError = (error: any): boolean => {
    const graphQLErrors: any[] = error?.graphQLErrors || []
    if (graphQLErrors.some((entry: any) => {
      const code = entry?.extensions?.code
      if (code === 'UNAUTHENTICATED') return true
      if (code) return false
      return /unauthori[sz]ed/i.test(entry?.message ?? '')
    })) return true
    const statusCode =
      error?.networkError?.statusCode ??
      error?.networkError?.result?.status ??
      error?.statusCode ??
      error?.status
    return statusCode === 401
  }

  /**
   * Resolve a verifiable account identity for safe stale-token retry checks.
   * Explicit session IDs and login claims establish continuity. An external
   * replacement of account-only tokens cannot authorize private result replay.
   */
  const resolveAccountIdentity = (
    token: string | null | undefined,
    explicitSessionId?: string | null
  ): string | null => {
    if (getSessionId) {
      const source = explicitSessionId !== undefined ? explicitSessionId : getSessionId()
      return resolveApolloSessionCacheKey(source ?? null)
    }
    return resolveApolloSessionCacheKey(token)
  }

  const isSameAccount = (
    previousIdentity: string | null,
    currentIdentity: string | null
  ): boolean => Boolean(previousIdentity && currentIdentity && previousIdentity === currentIdentity)

  // Serialize asynchronous credential cleanup and refresh writes through the
  // runtime's shared credential barrier so explicit logins / logouts never
  // overlap with stale writes or deletions, and cleanup errors never become
  // unhandled rejections or falsely report logout.
  const capture = (): CredentialOwnership => ({
    accessToken: readToken() || '',
    refreshToken: readRefreshToken() || '',
    sessionKey: resolveApolloSessionCacheKey(readSessionSource() ?? null),
    epoch: credentialCoordinator.getEpoch(),
  })

  const clearSessionIfCurrent = (expected: CredentialOwnership): Promise<boolean> =>
    credentialCoordinator.runExclusive(async (): Promise<boolean> => {
      const current = capture()
      if (!sameCredentialOwner(expected, current)) return false
      const { accessToken: currentAccessToken, refreshToken: currentRefreshToken } = current
      if (!currentAccessToken && !currentRefreshToken) {
        return false
      }

      try {
        await clearAuthentication()
      } catch {
        return false
      }

      // If a newer session transition started while async cleanup was in
      // flight, do not wipe stores or report logout.
      if (
        credentialCoordinator.getEpoch() !== expected.epoch ||
        readToken() ||
        readRefreshToken()
      ) {
        return false
      }

      await clearAllStores()
      try {
        onLogout?.()
      } catch {
        // Never allow a consumer logout callback to turn cleanup into an
        // unhandled rejection.
      }
      return true
    })

  credentialCoordinator.capture = capture
  credentialCoordinator.invalidate = clearSessionIfCurrent

  const authLink = setContextLink(async (operation, previousContext) => {
    const requestEpoch = credentialCoordinator.getEpoch()
    const preparation = prepareOperation?.()
    if (preparation) {
      await preparation
      if (requestEpoch !== credentialCoordinator.getEpoch()) throw new Error('Session changed before dispatch.')
    }
    const initialToken = readToken() || ''
    const initialAccountIdentity = resolveAccountIdentity(initialToken)
    const initialSessionKey = server
      ? null
      : resolveApolloSessionCacheKey(readSessionSource() ?? null)

    if (previousContext.vueApolloOfflineOwner !== undefined &&
        previousContext.vueApolloOfflineOwner !== (initialSessionKey ?? 'anonymous')) {
      throw new Error('Offline change belongs to another login.')
    }
    let didResetCaches = false
    if (!server) {
      // Compare stable session keys — never raw rotating access/refresh tokens.
      if (initialSessionKey !== lastSessionKey) {
        const previousSessionKey = lastSessionKey
        lastSessionKey = initialSessionKey
        // Signed-out → signed-in: nothing authenticated to isolate. Skipping the
        // reset avoids racing the first authed op against its own cache purge.
        if (previousSessionKey != null) {
          didResetCaches = true
          await resetSessionCaches()
        }
      }
    }

    let token = initialToken
    let requestAccountIdentity = initialAccountIdentity
    let requestSessionKey = initialSessionKey

    if (!server && didResetCaches) {
      const currentEpoch = credentialCoordinator.getEpoch()
      const currentToken = readToken() || ''
      const currentAccountIdentity = resolveAccountIdentity(currentToken)
      const currentSessionKey = resolveApolloSessionCacheKey(readSessionSource() ?? null)

      const ownershipChanged =
        currentEpoch !== requestEpoch ||
        currentSessionKey !== initialSessionKey ||
        currentAccountIdentity !== initialAccountIdentity ||
        (Boolean(initialToken) && !currentToken) ||
        (currentToken !== initialToken &&
          isMutationOperation(operation) &&
          !hasInRuntimeContinuity(initialToken, currentToken, requestEpoch))

      if (ownershipChanged) {
        throw new Error('Session changed while preparing authenticated request.')
      }

      token = currentToken
      requestAccountIdentity = currentAccountIdentity
      requestSessionKey = currentSessionKey
    }

    const configuredContext = setContext?.({
      operationName: operation.operationName || '',
      variables: operation.variables,
      token,
    })
    const authorization = token ? formatToken(token) : ''

    return {
      ...configuredContext,
      vueApolloRequestToken: token,
      vueApolloRequestAccountIdentity: requestAccountIdentity,
      vueApolloRequestSessionKey: requestSessionKey,
      vueApolloRequestEpoch: requestEpoch,
      headers: {
        ...runtime.headers,
        ...configuredContext?.headers,
        ...previousContext?.headers,
        ...(authorization ? { authorization } : {}),
      },
    }
  })

  const runRefresh = (failedClientId: string): Promise<RefreshOutcome> => {
    const refreshClientId = refresh?.clientId || failedClientId
    const startEpoch = credentialCoordinator.getEpoch()
    const attemptedAccessToken = readToken() || ''
    const attemptedRefreshToken = refresh ? (refresh.getRefreshToken() || '') : ''
    const attemptedSessionKey = resolveApolloSessionCacheKey(readSessionSource() ?? null)
    const attemptedAccountIdentity = resolveAccountIdentity(attemptedAccessToken)

    const refreshKey = [
      refreshClientId,
      String(startEpoch),
      attemptedSessionKey ?? '',
      refresh ? attemptedRefreshToken : attemptedAccessToken,
    ].join('\0')

    const existing = refreshPromises.get(refreshKey)
    if (existing) return existing

    let promise!: Promise<RefreshOutcome>
    promise = (async (): Promise<RefreshOutcome> => {
      let refreshedTokens: { token: string; refreshToken?: string | null } | null = null

      try {
        if (refresh) {
          if (!attemptedRefreshToken) {
            throw new Error('No refresh token is available.')
          }
          let data: unknown
          if (refresh.useMutation) {
            const createMutation = () => refresh.useMutation!({
              clientId: refreshClientId,
              context: { vueApolloSkipRefresh: true },
              errorPolicy: 'none',
            })
            const mutation = runtime.runWithContext
              ? runtime.runWithContext(createMutation)
              : createMutation()
            const result = await mutation.mutate(
              refresh.createVariables(attemptedRefreshToken),
              { context: { vueApolloSkipRefresh: true }, errorPolicy: 'none' }
            )
            data = result?.data
          } else if (refresh.document) {
            const refreshClient = clients[refreshClientId]
            if (!refreshClient) {
              throw new Error(`Apollo refresh client "${refreshClientId}" is not installed.`)
            }
            const result = await refreshClient.mutate({
              mutation: refresh.document,
              variables: refresh.createVariables(attemptedRefreshToken),
              errorPolicy: 'none',
              context: { vueApolloSkipRefresh: true },
            })
            data = result.data
          } else {
            throw new Error('Apollo refresh requires a generated mutation composable.')
          }
          const tokens = refresh.selectTokens(data)
          if (!tokens?.token) throw new Error('Token refresh returned no access token.')
          refreshedTokens = tokens
        } else {
          const token = await refreshToken?.()
          if (!token) throw new Error('Token refresh returned no access token.')
          refreshedTokens = { token }
        }
      } catch (error) {
        // Another tab or Builto application may have already rotated the
        // single-use refresh token while this request was in flight, or the
        // user may have signed out / switched accounts.
        const currentAccessToken = readToken() || ''
        const currentRefreshToken = refresh ? (refresh.getRefreshToken() || '') : ''
        const currentSessionKey = resolveApolloSessionCacheKey(readSessionSource() ?? null)
        const currentAccountIdentity = resolveAccountIdentity(currentAccessToken)

        const credentialsUnchanged =
          credentialCoordinator.getEpoch() === startEpoch &&
          currentAccessToken === attemptedAccessToken &&
          (!refresh || currentRefreshToken === attemptedRefreshToken) &&
          currentSessionKey === attemptedSessionKey

        if (!credentialsUnchanged) {
          // Only surface the externally replaced access token if no explicit
          // session transition occurred in this runtime and the token belongs
          // to the same account. Callers still refuse to replay mutations
          // unless continuity was established by this runtime.
          if (
            credentialCoordinator.getEpoch() === startEpoch &&
            currentAccessToken &&
            currentAccessToken !== attemptedAccessToken &&
            isSameAccount(attemptedAccountIdentity, currentAccountIdentity)
          ) {
            return { token: currentAccessToken, source: 'external' }
          }
          throw error
        }

        // Only clear credentials when the attempted credential is still current
        // and the API proved it invalid, expired, or revoked. Preserve
        // credentials for network failures, HTTP 5xx, GraphQL
        // INTERNAL_SERVER_ERROR, RATE_LIMIT_EXCEEDED, and other non-auth errors.
        if (isAuthenticationError(error)) {
          await clearSessionIfCurrent({
            accessToken: attemptedAccessToken,
            refreshToken: attemptedRefreshToken,
            sessionKey: attemptedSessionKey,
            epoch: startEpoch,
          })
        }
        throw error
      }

      // Coordinate persistence through the shared credential barrier so
      // explicit login/logout transitions cannot be overwritten by a delayed
      // refresh write.
      const resolvedOutcome = await credentialCoordinator.runExclusive(async (): Promise<RefreshOutcome> => {
        const currentAccessToken = readToken() || ''
        const currentRefreshToken = refresh ? (refresh.getRefreshToken() || '') : ''
        const currentSessionKey = resolveApolloSessionCacheKey(readSessionSource() ?? null)
        const currentAccountIdentity = resolveAccountIdentity(currentAccessToken)

        const sessionStillCurrent =
          credentialCoordinator.getEpoch() === startEpoch &&
          currentAccessToken === attemptedAccessToken &&
          (!refresh || currentRefreshToken === attemptedRefreshToken) &&
          currentSessionKey === attemptedSessionKey

        if (!sessionStillCurrent) {
          if (!refresh && sessionMode === 'cookie' && attemptedSessionKey && currentSessionKey === attemptedSessionKey &&
              credentialCoordinator.getEpoch() === startEpoch && currentAccessToken === refreshedTokens!.token) {
            recordInRuntimeRotation(attemptedAccessToken, currentAccessToken, startEpoch)
            return { token: currentAccessToken, source: 'refreshed' }
          }
          if (
            credentialCoordinator.getEpoch() === startEpoch &&
            currentAccessToken &&
            currentAccessToken !== attemptedAccessToken &&
            isSameAccount(attemptedAccountIdentity, currentAccountIdentity)
          ) {
            return { token: currentAccessToken, source: 'external' }
          }
          throw new Error('Session changed while refreshing credentials.')
        }

        if (refresh) {
          await refresh.persistTokens(refreshedTokens!)
        }

        // If an explicit login/logout bumped the epoch while async
        // persistTokens() was suspended, that newer transition is queued right
        // behind this barrier and will establish the authoritative credentials;
        // do not retry the stale operation under the old token.
        if (credentialCoordinator.getEpoch() !== startEpoch) {
          throw new Error('Session changed while persisting refreshed credentials.')
        }

        recordInRuntimeRotation(attemptedAccessToken, refreshedTokens!.token, startEpoch)
        return { token: refreshedTokens!.token, source: 'refreshed' }
      })

      return resolvedOutcome
    })().finally(() => {
      if (refreshPromises.get(refreshKey) === promise) {
        refreshPromises.delete(refreshKey)
      }
    })

    refreshPromises.set(refreshKey, promise)
    return promise
  }

  const createErrorLink = (clientId: string) => onError(
    ({ graphQLErrors, networkError, response, operation, forward }) => {
      if (server) return

      const statusCode =
        (networkError as any)?.statusCode ??
        (networkError as any)?.result?.status
      // HTTP 403 and GraphQL FORBIDDEN are authorization outcomes for the
      // current operation. Only an authentication failure may refresh or end
      // the shared session here. Temporary network errors / HTTP 5xx never
      // stash or remove credentials.
      const networkAuthenticationFailure = statusCode === 401

      const authenticationFailure = graphQLErrors?.some(
        (error) => {
          const code = error.extensions?.code
          return code === 'UNAUTHENTICATED' ||
            (!code && error.message === 'Unauthorized')
        }
      ) || networkAuthenticationFailure

      if (!authenticationFailure) return

      const operationContext = operation.getContext()
      if (operationContext?.vueApolloSkipRefresh) return

      const requestToken = String(operationContext?.vueApolloRequestToken || '')
      const requestAccountIdentity =
        (operationContext?.vueApolloRequestAccountIdentity as string | null | undefined) ?? null
      const requestSessionKey =
        (operationContext?.vueApolloRequestSessionKey as string | null | undefined) ?? null
      const requestEpoch =
        typeof operationContext?.vueApolloRequestEpoch === 'number'
          ? operationContext.vueApolloRequestEpoch
          : credentialCoordinator.getEpoch()
      const alreadyRetried = Boolean(operationContext?.vueApolloRetriedAfterRefresh)
      const currentToken = readToken() || ''
      const currentAccountIdentity = resolveAccountIdentity(currentToken)

      // If an explicit session transition (logout / login) occurred after this
      // operation was dispatched, reject the stale operation instead of
      // retrying it under a newer session — even for the same account.
      if (credentialCoordinator.getEpoch() !== requestEpoch) {
        return
      }

      const isMutation = isMutationOperation(operation)
      // The server must explicitly attest to pre-execution rejection. A 401,
      // a field error, or missing data alone says nothing about prior writes.
      if (isMutation && operationContext.vueApolloIdempotent !== true) {
        const rejectedBeforeExecution = !operationContext.vueApolloExecutionObserved && response?.data == null && !!graphQLErrors?.length &&
          graphQLErrors.every(error => !error.path && error.extensions?.code === 'UNAUTHENTICATED' &&
            error.extensions?.executionStarted === false)
        if (!rejectedBeforeExecution) {
          if (currentToken === requestToken && !alreadyRetried && (refresh ? readRefreshToken() : refreshToken && currentToken)) {
            return fromPromise(runRefresh(clientId).catch(() => undefined)).flatMap(() => new Observable(observer => {
              if (networkError || credentialCoordinator.getEpoch() !== requestEpoch ||
                  resolveApolloSessionCacheKey(readSessionSource() ?? null) !== requestSessionKey) {
                observer.error(networkError ?? new Error('Session changed before mutation recovery completed.'))
              } else {
                observer.next(response ?? { errors: graphQLErrors })
                observer.complete()
              }
            }))
          }
          return
        }
      }

      // If credentials changed while this operation was in flight (e.g. rotated
      // or re-logged in by another tab/app with no explicit transition here):
      // - If THIS runtime rotated `requestToken -> currentToken` in the same
      //   epoch, session continuity is proven for both queries and mutations.
      // - Otherwise, matching account IDs alone do NOT prove session
      //   continuity (another app could have logged out and re-logged in to the
      //   same account), so never replay a stale mutation under externally
      //   replaced credentials.
      if (currentToken !== requestToken) {
        const sameRuntimeRotation = hasInRuntimeContinuity(
          requestToken,
          currentToken,
          requestEpoch
        )
        if (
          !alreadyRetried &&
          credentialCoordinator.getEpoch() === requestEpoch &&
          currentToken &&
          (sameRuntimeRotation || (!isMutation && isSameAccount(requestAccountIdentity, currentAccountIdentity)))
        ) {
          operation.setContext(({ headers = {} }) => ({
            vueApolloRetriedAfterRefresh: true,
            vueApolloRequestToken: currentToken,
            vueApolloRequestAccountIdentity: currentAccountIdentity,
            vueApolloRequestEpoch: requestEpoch,
            headers: {
              ...headers,
              authorization: formatToken(currentToken),
            },
          }))
          return forward(operation)
        }
        return
      }

      const canRefresh = refresh
        ? Boolean(readRefreshToken())
        : Boolean(refreshToken && readToken())

      if (!canRefresh) {
        if (readToken() || readRefreshToken()) {
          const expectedRefresh = readRefreshToken() || ''
          return new Observable((observer) => {
            const finish = () => {
              if (networkError) {
                observer.error(networkError)
              } else {
                observer.next(response ?? { errors: graphQLErrors })
                observer.complete()
              }
            }
            clearSessionIfCurrent({
              accessToken: requestToken,
              refreshToken: expectedRefresh,
              sessionKey: requestSessionKey,
              epoch: requestEpoch,
            }).then(finish, finish)
          })
        }
        return
      }

      if (alreadyRetried) {
        return
      }

      return fromPromise(runRefresh(clientId)).flatMap((outcome) => {
        // Reject the stale operation if an explicit logout/login occurred
        // while refresh was in flight.
        if (credentialCoordinator.getEpoch() !== requestEpoch) {
          throw new Error('Session changed while retrying authenticated operation.')
        }
        // Never replay a previously dispatched mutation under externally
        // replaced credentials whose session continuity cannot be established.
        if (isMutation && outcome.source !== 'refreshed') {
          throw new Error('Credentials were replaced externally while retrying mutation.')
        }
        const nextToken = String(outcome.token)
        const nextAccountIdentity = resolveAccountIdentity(nextToken)
        // Guard against forwarding a stale operation if account identity
        // changed between refresh completion and retry dispatch.
        if (
          requestAccountIdentity &&
          nextAccountIdentity &&
          requestAccountIdentity !== nextAccountIdentity &&
          !hasInRuntimeContinuity(requestToken, nextToken, requestEpoch)
        ) {
          throw new Error('Account changed while retrying authenticated operation.')
        }
        operation.setContext(({ headers = {} }) => ({
          vueApolloRetriedAfterRefresh: true,
          vueApolloRequestToken: nextToken,
          vueApolloRequestAccountIdentity: nextAccountIdentity,
          vueApolloRequestEpoch: requestEpoch,
          headers: {
            ...headers,
            authorization: formatToken(nextToken),
          },
        }))
        return forward(operation)
      })
    }
  )

  // Apollo writes a successful result into its normalized cache after the
  // links return. Reject results belonging to a departed login before that write.
  const responseOwner = new ApolloLink((operation, forward) => {
    const owner = operation.getContext()
    return forward(operation).map(result => {
      if (isMutationOperation(operation) && (result.data != null || 'incremental' in result || 'items' in result)) {
        operation.setContext({ vueApolloExecutionObserved: true })
      }
      if (!server && (!result.errors?.length || result.data != null || 'incremental' in result || 'items' in result) && (
        owner.vueApolloRequestEpoch !== credentialCoordinator.getEpoch() ||
        owner.vueApolloRequestSessionKey !== resolveApolloSessionCacheKey(readSessionSource() ?? null)
      )) throw new Error('Session changed before the response arrived.')
      return result
    })
  })

  const runtimeFetch = createRuntimeFetch(runtime)
  for (const [clientId, endpoint] of Object.entries(endPoints)) {
    const uploadHeaders = {
      'Apollo-Require-Preflight': 'true',
      ...(apolloUploadConfig?.headers as Record<string, string> | undefined),
      ...runtime.headers,
    }
    // @types/apollo-upload-client nests its own @apollo/client types; cast to
    // the app's ApolloLink so `from()` does not see incompatible duplicates.
    const httpLink = createUploadLink({
      ...apolloUploadConfig,
      uri: endpoint,
      fetch: runtimeFetch,
      credentials:
        credentials ??
        (sessionMode === 'cookie' ? 'include' : apolloUploadConfig?.credentials),
      useGETForQueries:
        useGETForQueries ?? apolloUploadConfig?.useGETForQueries,
      headers: uploadHeaders,
    }) as unknown as ApolloLink
    const cache = new InMemoryCache(memoryConfig)
    const initialCache = runtime.initialState?.[clientId]
    if (initialCache) cache.restore(initialCache)

    const clientConfig = apolloClientConfig
      ? { ...apolloClientConfig }
      : {}
    clients[clientId] = new ApolloClient({
      ...clientConfig,
      cache,
      link: from([createErrorLink(clientId), authLink, responseOwner, httpLink]),
      ssrMode: server,
      // Apollo temporarily honors restored SSR data even when a generated
      // composable requests a force-fetch policy during initial hydration.
      ssrForceFetchDelay:
        !server && initialCache ? clientConfig.ssrForceFetchDelay ?? 100 : 0,
    })
  }

  return clients
}
