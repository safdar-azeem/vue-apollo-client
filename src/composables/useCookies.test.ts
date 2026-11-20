// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://websites.builto.com/dashboard" }
import Cookies from 'js-cookie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setGlobalConfig } from '../configStore'
import {
  getRefreshToken,
  getToken,
  removeToken,
  restoreStashedToken,
  setToken,
} from './useCookies'

describe('useCookies domain ownership', () => {
  beforeEach(() => {
    setGlobalConfig({
      tokenKey: 'builto_token',
      tokenCookie: {},
    } as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setGlobalConfig({
      tokenKey: 'token',
      tokenCookie: {},
    } as any)
  })

  it('never deletes cookies when reading access or refresh tokens', () => {
    const removeSpy = vi.spyOn(Cookies, 'remove')
    const getSpy = vi.spyOn(Cookies, 'get').mockImplementation(((name?: string) => {
      if (name === 'builto_token') return 'shared-access'
      if (name === 'builto_token_refresh') return 'shared-refresh'
      return undefined
    }) as any)

    expect(getToken('builto_token')).toBe('shared-access')
    expect(getRefreshToken('builto_token')).toBe('shared-refresh')
    expect(removeSpy).not.toHaveBeenCalled()
    expect(getSpy).toHaveBeenCalledWith('builto_token')
    expect(getSpy).toHaveBeenCalledWith('builto_token_refresh')
  })

  it('does not remove parent-domain cookies when writing host-only cookies', () => {
    const removeSpy = vi.spyOn(Cookies, 'remove').mockImplementation(() => {})
    const setSpy = vi.spyOn(Cookies, 'set').mockImplementation(() => undefined)

    setToken({
      key: 'builto_token',
      token: 'host-access',
      refreshToken: 'host-refresh',
      options: { domain: undefined, sameSite: 'Lax', secure: true },
    })

    expect(removeSpy).not.toHaveBeenCalled()
    expect(setSpy).toHaveBeenCalledWith(
      'builto_token',
      'host-access',
      expect.objectContaining({ domain: undefined, path: '/' })
    )
    expect(setSpy).toHaveBeenCalledWith(
      'builto_token_refresh',
      'host-refresh',
      expect.objectContaining({ domain: undefined, path: '/' })
    )
  })

  it('clears host-only shadow cookies without removing the shared domain when writing a shared cookie', () => {
    const removeSpy = vi.spyOn(Cookies, 'remove').mockImplementation(() => {})
    const setSpy = vi.spyOn(Cookies, 'set').mockImplementation(() => undefined)

    setToken({
      key: 'builto_token',
      token: 'shared-access',
      refreshToken: 'shared-refresh',
      options: { domain: '.builto.com', sameSite: 'Lax', secure: true },
    })

    expect(removeSpy).toHaveBeenCalledWith(
      'builto_token',
      expect.objectContaining({ domain: undefined, path: '/' })
    )
    expect(removeSpy).toHaveBeenCalledWith(
      'builto_token_refresh',
      expect.objectContaining({ domain: undefined, path: '/' })
    )
    expect(removeSpy).not.toHaveBeenCalledWith(
      'builto_token',
      expect.objectContaining({ domain: '.builto.com' })
    )
    expect(setSpy).toHaveBeenCalledWith(
      'builto_token',
      'shared-access',
      expect.objectContaining({ domain: '.builto.com', path: '/' })
    )
  })

  it('removes configured and host-only cookies on explicit removeToken', () => {
    const removeSpy = vi.spyOn(Cookies, 'remove').mockImplementation(() => {})

    removeToken('builto_token', { domain: '.builto.com', sameSite: 'Lax', secure: true })

    expect(removeSpy).toHaveBeenCalledWith(
      'builto_token',
      expect.objectContaining({ domain: '.builto.com', path: '/' })
    )
    expect(removeSpy).toHaveBeenCalledWith(
      'builto_token_refresh',
      expect.objectContaining({ domain: '.builto.com', path: '/' })
    )
    expect(removeSpy).toHaveBeenCalledWith(
      'builto_token',
      expect.objectContaining({ domain: undefined, path: '/' })
    )
  })

  it('never overwrites an active Account B session with legacy temporary Account A cookies', () => {
    const store = new Map<string, string>([
      ['builto_token', 'account-b-access'],
      ['builto_token_refresh', 'account-b-refresh'],
      ['temp_builto_token', 'account-a-stashed-access'],
      ['temp_builto_token_refresh', 'account-a-stashed-refresh'],
    ])
    vi.spyOn(Cookies, 'get').mockImplementation(((name?: string) => (name ? store.get(name) : undefined)) as any)
    const setSpy = vi.spyOn(Cookies, 'set').mockImplementation(((name: string, value: string) => {
      store.set(name, value)
      return value
    }) as any)
    const removeSpy = vi.spyOn(Cookies, 'remove').mockImplementation(((name: string) => {
      store.delete(name)
    }) as any)

    restoreStashedToken('builto_token', { domain: '.builto.com', sameSite: 'Lax', secure: true })

    expect(setSpy).not.toHaveBeenCalled()
    expect(store.get('builto_token')).toBe('account-b-access')
    expect(store.get('builto_token_refresh')).toBe('account-b-refresh')
    expect(store.has('temp_builto_token')).toBe(false)
    expect(store.has('temp_builto_token_refresh')).toBe(false)
    expect(removeSpy).toHaveBeenCalledWith('temp_builto_token', expect.any(Object))
    expect(removeSpy).toHaveBeenCalledWith('temp_builto_token_refresh', expect.any(Object))
  })

  it('restores legacy temporary cookies when no active credentials exist', () => {
    const store = new Map<string, string>([
      ['temp_builto_token', 'stashed-access'],
      ['temp_builto_token_refresh', 'stashed-refresh'],
    ])
    vi.spyOn(Cookies, 'get').mockImplementation(((name?: string) => (name ? store.get(name) : undefined)) as any)
    vi.spyOn(Cookies, 'set').mockImplementation(((name: string, value: string) => {
      store.set(name, value)
      return value
    }) as any)
    vi.spyOn(Cookies, 'remove').mockImplementation(((name: string) => {
      store.delete(name)
    }) as any)

    restoreStashedToken('builto_token', { domain: '.builto.com', sameSite: 'Lax', secure: true })

    expect(store.get('builto_token')).toBe('stashed-access')
    expect(store.get('builto_token_refresh')).toBe('stashed-refresh')
    expect(store.has('temp_builto_token')).toBe(false)
    expect(store.has('temp_builto_token_refresh')).toBe(false)
  })
})
