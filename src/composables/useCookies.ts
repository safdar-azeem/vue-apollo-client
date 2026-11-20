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

const normalizeCookieDomain = (domain?: string): string | undefined => {
	const normalized = domain?.trim().toLowerCase().replace(/^\.+/, '')
	return normalized || undefined
}

/**
 * Read one cookie from an HTTP Cookie header without touching browser globals.
 * This is intentionally separate from `getToken()`, whose js-cookie backing
 * store is browser-only.
 */
export const getCookieValueFromHeader = (
	header: string | undefined,
	key: string,
): string | undefined => {
	if (!header || !key) return undefined
	for (const segment of header.split(';')) {
		const separator = segment.indexOf('=')
		if (separator <= 0) continue
		if (segment.slice(0, separator).trim() !== key) continue
		const raw = segment.slice(separator + 1).trim()
		try {
			return decodeURIComponent(raw.replace(/^"|"$/g, ''))
		} catch {
			return raw
		}
	}
	return undefined
}

const getLegacyDomainRemovalOptions = (
	options: CookieAttributes = {},
): CookieAttributes[] => {
	if (typeof window === 'undefined') return []

	const baseOptions = getCookieOptions(options)
	const activeDomain = normalizeCookieDomain(baseOptions.domain)
	return getParentDomainCandidates(window.location.hostname)
		.filter((domain) => normalizeCookieDomain(domain) !== activeDomain)
		.map((domain) => ({
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
 * - configured `tokenCookie` attributes are applied before per-call overrides.
 *
 * Pass `overrides` to override any field. SameSite=None requires
 * Secure=true, so it's coerced automatically.
 */
export const getCookieOptions = (overrides: CookieAttributes = {}): CookieAttributes => {
	const configuredOptions = getGlobalConfig().tokenCookie || {}
	if (typeof window === 'undefined') {
		return { path: '/', ...configuredOptions, ...overrides }
	}

	const hostname = window.location.hostname
	const isHttps = window.location.protocol === 'https:'

	const secure = isHttps && !isLocalhost(hostname)
	const sameSite: 'Lax' | 'None' = secure ? 'None' : 'Lax'

	return {
		path: '/',
		secure,
		sameSite,
		...configuredOptions,
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

	// Resolve environment and configured defaults; per-call overrides win.
	const finalOptions: CookieAttributes = {
		...getCookieOptions(),
		...options, // User options override defaults
		expires: EXPIRATION_MINUTES,
	}

	// SameSite=None requires Secure=true in all modern browsers
	if (String(finalOptions.sameSite).toLowerCase() === 'none' && !finalOptions.secure) {
		finalOptions.secure = true
	}

	// Use the key properly by checking config
	const tokenKey = getKey(key)
	// When writing a shared parent-domain cookie, clear any host-only shadow
	// cookie so the browser does not continue sending a stale host-only value
	// ahead of the shared domain cookie. Never delete parent-domain cookies
	// when writing a host-only cookie.
	if (normalizeCookieDomain(finalOptions.domain)) {
		const hostOnlyOptions: CookieAttributes = { ...finalOptions, domain: undefined }
		Cookies.remove(tokenKey, hostOnlyOptions)
		Cookies.remove(`${tokenKey}_refresh`, hostOnlyOptions)
	}

	Cookies.set(tokenKey, token, finalOptions)

	if (refreshToken) {
		const refreshTokenKey = `${tokenKey}_refresh`
		Cookies.set(refreshTokenKey, refreshToken, finalOptions)
	}
}

export const getToken = (key = '', _options?: CookieAttributes) => {
	const tokenKey = getKey(key)
	return Cookies.get(tokenKey)
}

export const getRefreshToken = (key = '', _options?: CookieAttributes) => {
	const tokenKey = getKey(key)
	return Cookies.get(`${tokenKey}_refresh`)
}

/**
 * Remove the auth tokens. Both the configured cookie scope and any host-only
 * or legacy parent-domain variants are cleared on explicit sign-out so stale
 * cookies cannot survive termination.
 */
export const removeToken = (key = '', options?: CookieAttributes) => {
	const tokenKey = getKey(key)
	const finalOptions = getCookieOptions(options)
	Cookies.remove(tokenKey, finalOptions)
	Cookies.remove(`${tokenKey}_refresh`, finalOptions)
	if (normalizeCookieDomain(finalOptions.domain)) {
		const hostOnlyOptions: CookieAttributes = { ...finalOptions, domain: undefined }
		Cookies.remove(tokenKey, hostOnlyOptions)
		Cookies.remove(`${tokenKey}_refresh`, hostOnlyOptions)
	}
	removeLegacyDomainCookies(tokenKey, options)
}

export const stashToken = (key = '', options?: CookieAttributes) => {
	const tokenKey = getKey(key)
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
	const tempToken = Cookies.get(`temp_${tokenKey}`)
	const tempRefresh = Cookies.get(`temp_${tokenKey}_refresh`)

	if (!tempToken && !tempRefresh) return

	const activeToken = Cookies.get(tokenKey)
	const activeRefresh = Cookies.get(`${tokenKey}_refresh`)

	// Never overwrite an already active session with legacy stashed cookies.
	if (!activeToken && !activeRefresh && tempToken) {
		setToken({ key, token: tempToken, refreshToken: tempRefresh || '', options })
	}

	const removalOptions = getCookieOptions(options)
	Cookies.remove(`temp_${tokenKey}`, removalOptions)
	Cookies.remove(`temp_${tokenKey}_refresh`, removalOptions)
	if (normalizeCookieDomain(removalOptions.domain)) {
		const hostOnlyOptions: CookieAttributes = { ...removalOptions, domain: undefined }
		Cookies.remove(`temp_${tokenKey}`, hostOnlyOptions)
		Cookies.remove(`temp_${tokenKey}_refresh`, hostOnlyOptions)
	}
	for (const legacyOptions of getLegacyDomainRemovalOptions(options)) {
		Cookies.remove(`temp_${tokenKey}`, legacyOptions)
		Cookies.remove(`temp_${tokenKey}_refresh`, legacyOptions)
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
