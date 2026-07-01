import Cookies from 'js-cookie'
import { getGlobalConfig } from '../configStore'
import { onMounted, onUnmounted } from 'vue'

export interface CookieAttributes {
	expires?: number | Date | undefined
	path?: string | undefined
	domain?: string | undefined
	secure?: boolean | undefined
	sameSite?: 'strict' | 'Strict' | 'lax' | 'Lax' | 'none' | 'None' | undefined
	[property: string]: any
}

export type TokenParams = {
	key?: string
	token: string
	refreshToken?: string
	options?: CookieAttributes
}

const getKey = (key: string) => {
	const config = getGlobalConfig()
	return key || config?.tokenKey || 'token'
}

const isIpAddress = (hostname: string): boolean => /^\d+\.\d+\.\d+\.\d+$/.test(hostname)

const isLocalhost = (hostname: string): boolean =>
	hostname === 'localhost' || hostname === '127.0.0.1'

const getParentDomainCandidates = (hostname: string): string[] => {
	if (isLocalhost(hostname) || isIpAddress(hostname)) return []

	const parts = hostname.toLowerCase().split('.').filter(Boolean)
	if (parts.length < 3) return []

	const domains = new Set<string>()
	for (let index = 0; index < parts.length - 1; index += 1) {
		const domain = parts.slice(index).join('.')
		domains.add(`.${domain}`)
		domains.add(domain)
	}

	return Array.from(domains)
}

const getLegacyDomainRemovalOptions = (
	options: CookieAttributes = {},
): CookieAttributes[] => {
	if (typeof window === 'undefined') return []

	const baseOptions = getCookieOptions(options)
	return getParentDomainCandidates(window.location.hostname).map((domain) => ({
		...baseOptions,
		domain,
	}))
}

const removeLegacyDomainCookies = (tokenKey: string, options?: CookieAttributes) => {
	for (const removalOptions of getLegacyDomainRemovalOptions(options)) {
		Cookies.remove(tokenKey, removalOptions)
		Cookies.remove(`${tokenKey}_refresh`, removalOptions)
		Cookies.remove(`temp_${tokenKey}`, removalOptions)
		Cookies.remove(`temp_${tokenKey}_refresh`, removalOptions)
	}
}

/**
 * Resolve the best cookie options for the current environment.
 *
 * - `path`:    '/'
 * - `secure`:  true on HTTPS (false on localhost so dev works)
 * - `sameSite`: 'None' on HTTPS, 'Lax' on localhost / HTTP
 * - `domain`:  undefined by default so cookies are host-only.
 *              Pass `overrides.domain` only when an app intentionally
 *              wants auth cookies shared across subdomains.
 *
 * Pass `overrides` to override any field. SameSite=None requires
 * Secure=true, so it's coerced automatically.
 */
export const getCookieOptions = (overrides: CookieAttributes = {}): CookieAttributes => {
	if (typeof window === 'undefined') {
		return { path: '/', ...overrides }
	}

	const hostname = window.location.hostname
	const isHttps = window.location.protocol === 'https:'

	const secure = isHttps && !isLocalhost(hostname)
	const sameSite: 'Lax' | 'None' = secure ? 'None' : 'Lax'

	return {
		path: '/',
		secure,
		sameSite,
		...overrides,
	}
}

export const setToken = (
	...args: [TokenParams] | [string, string?, CookieAttributes?] | [string | undefined]
): void => {
	let key = ''
	let token = ''
	let refreshToken = ''
	let options: CookieAttributes = {}

	if (typeof args[0] === 'object' && args[0] !== null) {
		// Case 1: setToken({ key, token, options })
		const params = args[0] as TokenParams
		key = params.key || ''
		token = params.token
		refreshToken = params.refreshToken || ''
		options = params.options || {}
	} else if (args.length === 1 && typeof args[0] === 'string') {
		// Case 2: setToken(token) -> Use default key
		token = args[0]
	} else if (args.length > 1) {
		// Case 3: setToken(token, key, options)
		token = args[0] as string
		key = (args[1] as string) || ''
		options = (args[2] as CookieAttributes) || {}
	} else if (args.length === 1 && args[0] === undefined) {
		return
	}

	if (!token) return

	const config = getGlobalConfig()

	const EXPIRATION_MINUTES =
		options?.expires || config?.tokenExpiration || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // Default 30 days

	// Auto-detect defaults from the current environment; user overrides win
	const finalOptions: CookieAttributes = {
		...getCookieOptions(),
		...options, // User options override defaults
		expires: EXPIRATION_MINUTES,
	}

	// SameSite=None requires Secure=true in all modern browsers
	if (finalOptions.sameSite === 'None' && !finalOptions.secure) {
		finalOptions.secure = true
	}

	// Use the key properly by checking config
	const tokenKey = getKey(key)
	removeLegacyDomainCookies(tokenKey, options)

	Cookies.set(tokenKey, token, finalOptions)

	if (refreshToken) {
		const refreshTokenKey = `${tokenKey}_refresh`
		Cookies.set(refreshTokenKey, refreshToken, finalOptions)
	}
}

export const getToken = (key = '') => {
	const tokenKey = getKey(key)
	removeLegacyDomainCookies(tokenKey)
	return Cookies.get(tokenKey)
}

export const getRefreshToken = (key = '') => {
	const tokenKey = getKey(key)
	removeLegacyDomainCookies(tokenKey)
	return Cookies.get(`${tokenKey}_refresh`)
}

/**
 * Remove the auth tokens. Host-only cookies are removed first, then
 * legacy parent-domain variants are cleared so old shared cookies
 * cannot leak between the main portal and workspace subdomains.
 */
export const removeToken = (key = '', options?: CookieAttributes) => {
	const tokenKey = getKey(key)
	const finalOptions = getCookieOptions(options)
	Cookies.remove(tokenKey, finalOptions)
	Cookies.remove(`${tokenKey}_refresh`, finalOptions)
	removeLegacyDomainCookies(tokenKey, options)
}

export const stashToken = (key = '', options?: CookieAttributes) => {
	const tokenKey = getKey(key)
	removeLegacyDomainCookies(tokenKey, options)
	const token = Cookies.get(tokenKey)
	const refresh = Cookies.get(`${tokenKey}_refresh`)

	if (token) {
		const config = getGlobalConfig()
		const EXPIRATION_MINUTES =
			options?.expires || config?.tokenExpiration || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

		const finalOptions: CookieAttributes = {
			...getCookieOptions(options),
			expires: EXPIRATION_MINUTES,
		}

		Cookies.set(`temp_${tokenKey}`, token, finalOptions)
		if (refresh) {
			Cookies.set(`temp_${tokenKey}_refresh`, refresh, finalOptions)
		}
		removeToken(key, options)
	}
}

export const restoreStashedToken = (key = '', options?: CookieAttributes) => {
	const tokenKey = getKey(key)
	removeLegacyDomainCookies(tokenKey, options)
	const tempToken = Cookies.get(`temp_${tokenKey}`)
	const tempRefresh = Cookies.get(`temp_${tokenKey}_refresh`)

	if (tempToken) {
		setToken({ key, token: tempToken, refreshToken: tempRefresh || '', options })
		Cookies.remove(`temp_${tokenKey}`, getCookieOptions(options))
		Cookies.remove(`temp_${tokenKey}_refresh`, getCookieOptions(options))
	}
}

const ACTIVITY_EVENTS = ['click', 'mousemove', 'keydown', 'scroll']

export const useKeepCookieAlive = (debounceInterval = 10000) => {
	const DEBOUNCE_INTERVAL_MS = debounceInterval

	let lastRun = 0
	let timeout: any = null

	const refreshToken = () => {
		const now = Date.now()
		const elapsed = now - lastRun

		if (elapsed >= DEBOUNCE_INTERVAL_MS) {
			const token = getToken()
			if (token) {
				setToken(token) // Keeps cookie alive by re-setting it
				lastRun = now
			}
		} else if (!timeout) {
			timeout = setTimeout(() => {
				const token = getToken()
				if (token) {
					setToken(token)
					lastRun = Date.now()
				}
				timeout = null
			}, DEBOUNCE_INTERVAL_MS - elapsed)
		}
	}

	const registerListeners = () => {
		ACTIVITY_EVENTS.forEach((event) =>
			window.addEventListener(event, refreshToken, { passive: true })
		)
	}

	const removeListeners = () => {
		ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, refreshToken))
		if (timeout) {
			clearTimeout(timeout)
			timeout = null
		}
	}

	onMounted(() => {
		if (typeof window !== 'undefined') {
			registerListeners()
		}
	})

	onUnmounted(() => {
		if (typeof window !== 'undefined') {
			removeListeners()
		}
	})
}
