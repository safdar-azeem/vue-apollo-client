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

type TokenParams = {
  key?: string
  token: string
  refreshToken?: string
  options?: CookieAttributes
}

const getKey = (key: string) => {
  const config = getGlobalConfig()
  return key || config?.tokenKey || 'token'
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

  const finalOptions: CookieAttributes = {
    path: '/',
    secure: true,
    sameSite: 'None',
    ...options, // User options override defaults
    expires: EXPIRATION_MINUTES,
  }

  // Use the key properly by checking config
  const tokenKey = getKey(key)
  Cookies.set(tokenKey, token, finalOptions)

  if (refreshToken) {
    const refreshTokenKey = `${tokenKey}_refresh`
    Cookies.set(refreshTokenKey, refreshToken, finalOptions)
  }
}

export const getToken = (key = '') => {
  const tokenKey = getKey(key)
  return Cookies.get(tokenKey)
}

export const getRefreshToken = (key = '') => {
  const tokenKey = getKey(key)
  return Cookies.get(`${tokenKey}_refresh`)
}

export const removeToken = (key = '', options?: CookieAttributes) => {
  const tokenKey = getKey(key)
  Cookies.remove(tokenKey, options)
  Cookies.remove(`${tokenKey}_refresh`, options)
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
