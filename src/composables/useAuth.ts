import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { getClients } from '../configStore'
import { getToken, removeToken } from './useCookies'

export interface UseAuthOptions {
	/**
	 * The GraphQL document for fetching the current user.
	 * Typically `MeDocument` from generated hooks.
	 */
	meQuery: any

	/**
	 * Extract the user object from the query result.
	 * Defaults to `data => data?.me`.
	 */
	meSelector?: (data: any) => any

	/**
	 * Path to navigate to on logout / session expiry.
	 * Defaults to `/login`.
	 */
	loginRoute?: string

	/**
	 * Query string parameter name for session-expiry redirects.
	 * Defaults to `reason=session_expired`.
	 */
	sessionExpiredReason?: string

	/**
	 * Apollo client name to use. Defaults to `'default'`.
	 */
	clientId?: string
}

export interface AuthState {
	user: Ref<any | null>
	isAuthenticated: ComputedRef<boolean>
	loading: Ref<boolean>
	error: Ref<any | null>
	verify: () => Promise<boolean>
	logout: () => Promise<void>
	reset: () => void
}

interface AuthInternalState {
	user: Ref<any | null>
	loading: Ref<boolean>
	error: Ref<any | null>
	isAuthenticated: ComputedRef<boolean>
	_inflight: Promise<boolean> | null
	_tearingDown: boolean
}

let _state: AuthInternalState | null = null
let _router: any = null

/**
 * Inject the application's Vue Router instance so the auth composable
 * can do SPA navigation on logout. Call this once from your main.ts
 * after the router has been created.
 *
 * If you skip this, the composable falls back to a dynamic import
 * of `@/router`, then to `window.location.assign` as a last resort.
 *
 * @example
 *   import router from './router'
 *   import { setAuthRouter } from 'vue-apollo-client'
 *   setAuthRouter(router)
 */
export const setAuthRouter = (router: any) => {
	_router = router
}

const _isAuthError = (err: any): boolean => {
	const graphQLErrors: any[] = err?.graphQLErrors || []
	if (
		graphQLErrors.some(
			(e: any) =>
				e?.extensions?.code === 'UNAUTHENTICATED' ||
				e?.extensions?.code === 'FORBIDDEN' ||
				/unauthori[sz]ed/i.test(e?.message ?? '') ||
				/user not found/i.test(e?.message ?? ''),
		)
	) {
		return true
	}
	const statusCode = err?.networkError?.statusCode ?? err?.networkError?.result?.status
	return statusCode === 401 || statusCode === 403
}

const _navigate = async (path: string): Promise<void> => {
	if (typeof window === 'undefined') return

	// 1. Explicit router (preferred — no dynamic import needed)
	if (_router?.push) {
		try {
			await _router.push(path)
			return
		} catch {
			// fall through to dynamic import
		}
	}

	// 2. Dynamic import of @/router (Vite alias)
	try {
		const routerPath = '@/router'
		const mod: any = await import(/* @vite-ignore */ routerPath).catch(() => null)
		const r = mod?.default?.push ? mod.default : mod?.router?.push ? mod.router : null
		if (r) {
			await r.push(path)
			return
		}
	} catch {
		// fall through
	}

	// 3. Last resort: full-page navigation (no remount storm — just URL change)
	window.location.assign(path)
}

const _teardown = async (
	state: AuthInternalState,
	reason: 'session_expired' | 'logout',
	options: UseAuthOptions,
): Promise<void> => {
	// Latch true. Do NOT reset — any straggler call (in-flight query
	// response, cache observer) must bail for the rest of this page's life.
	if (state._tearingDown) return
	state._tearingDown = true

	// 1. Wipe the token (uses auto-detected cookie options)
	removeToken()

	// 2. Drop the Apollo store and cancel in-flight queries. Without
	//    this, a remount of a `useMeQuery` consumer would repopulate
	//    `user` from a cached `me` response and refire the query.
	try {
		const client = getClients()?.[options.clientId || 'default']
		await client?.clearStore().catch(() => {})
	} catch {
		// ignore
	}

	// 3. Reset local reactive state
	state.user.value = null
	state.error.value = null
	state._inflight = null

	// 4. SPA-navigate to login
	const loginRoute = options.loginRoute || '/login'
	if (reason === 'session_expired') {
		const sep = loginRoute.includes('?') ? '&' : '?'
		const reasonParam = options.sessionExpiredReason || 'session_expired'
		await _navigate(`${loginRoute}${sep}reason=${reasonParam}`)
	} else {
		await _navigate(loginRoute)
	}
}

/**
 * Built-in auth composable.
 *
 * Handles the common "me + token + logout" pattern out of the box:
 *   - `verify()` runs the `me` query once with `network-only`
 *   - any UNAUTHENTICATED / FORBIDDEN / 401 / 403 / "user not found"
 *     response tears the session down, clears the Apollo store, and
 *     SPA-navigates to the login route
 *   - `logout()` does the same teardown on demand
 *   - 5xx / offline errors are treated as transient — token is kept
 *     so a later retry can succeed
 *
 * The composable shares one reactive state across all calls, so any
 * component using `useAuth` sees the same `user` / `isAuthenticated`.
 *
 * @example
 *   import { useMeQuery } from './graphql/generated'
 *   const { user, isAuthenticated, verify, logout } = useAuth({
 *     meQuery: MeDocument,
 *     meSelector: (data) => data?.me,
 *     loginRoute: '/auth/login',
 *   })
 *
 *   // In your router guard:
 *   if (to.meta.requiresAuth) {
 *     const ok = await verify()
 *     if (!ok) return next('/auth/login')
 *   }
 */
export const useAuth = (options: UseAuthOptions): AuthState => {
	if (!options?.meQuery) {
		throw new Error('[useAuth] `meQuery` is required')
	}

	if (!_state) {
		_state = {
			user: ref(null),
			loading: ref(false),
			error: ref(null),
			isAuthenticated: computed(() => !!_state!.user.value),
			_inflight: null,
			_tearingDown: false,
		}
	}

	const state = _state

	const verify = (): Promise<boolean> => {
		// De-dupe concurrent calls
		if (state._inflight) return state._inflight

		const token = getToken()
		if (!token) {
			state.user.value = null
			return Promise.resolve(false)
		}

		// If a teardown was in progress but a fresh token is now present,
		// the user has re-authenticated. Clear the latch and proceed.
		if (state._tearingDown) {
			state._tearingDown = false
		}

		const client = getClients()?.[options.clientId || 'default']
		if (!client) {
			state.error.value = new Error('[useAuth] Apollo client not initialized')
			return Promise.resolve(false)
		}

		state.loading.value = true
		const promise = client
			.query({
				query: options.meQuery,
				fetchPolicy: 'network-only',
				// 'none' so any GraphQL error throws and lands in .catch().
				// 'all' would resolve with { data: { me: null }, errors: [...] }
				// and the success branch would treat it as "user has no profile".
				errorPolicy: 'none',
			})
			.then((result: any) => {
				const me = options.meSelector ? options.meSelector(result.data) : result.data?.me
				if (!me) {
					// Token valid but user is gone — same as session expired.
					return _teardown(state, 'session_expired', options).then(() => false)
				}
				state.user.value = me
				return true
			})
			.catch((err: any) => {
				state.error.value = err
				if (_isAuthError(err)) {
					return _teardown(state, 'session_expired', options).then(() => false)
				}
				// Non-auth error (5xx, offline, CORS) — preserve token, allow retry
				return false
			})
			.finally(() => {
				state.loading.value = false
				state._inflight = null
			})

		state._inflight = promise
		return promise
	}

	const logout = (): Promise<void> => _teardown(state, 'logout', options)

	const reset = (): void => {
		// Manual reset (e.g. before re-running verify after a fresh login)
		state.user.value = null
		state.error.value = null
		state._inflight = null
		state._tearingDown = false
	}

	return {
		user: state.user,
		isAuthenticated: state.isAuthenticated,
		loading: state.loading,
		error: state.error,
		verify,
		logout,
		reset,
	}
}
