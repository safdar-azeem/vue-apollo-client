
import Cookies from 'js-cookie'
import { getGlobalConfig } from '../configStore'

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
  options?: CookieAttributes
}

const getKey = (key: string) => {
  const config = getGlobalConfig()
  return key || config?.tokenKey || 'token'
}

export const setToken = (...args: [TokenParams] | [string, string?, CookieAttributes?]): void => {
  const {
    key = '',
    token,
    options = {},
  } = typeof args[0] === 'object'
    ? args[0]
    : { token: args[0], key: args[1] || '', options: args[2] || {} }

  const config = getGlobalConfig()
  
  const EXPIRATION_MINUTES =
    options?.expires ||
    config?.tokenExpiration ||
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  const finalOptions: CookieAttributes = { ...options, expires: EXPIRATION_MINUTES }

  // Use the key properly by checking config
  const tokenKey = getKey(key)
  
  Cookies.set(tokenKey, token, finalOptions)
}

export const getToken = (key = '') => {
  const tokenKey = getKey(key)
  return Cookies.get(tokenKey)
}

export const removeToken = (key = '', options?: CookieAttributes) => {
  const tokenKey = getKey(key)
  Cookies.remove(tokenKey, options)
}
