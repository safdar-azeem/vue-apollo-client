import { getGlobalConfig } from '../configStore'
import { getToken, getRefreshToken, setToken, removeToken } from '../composables/useCookies'

let isRefreshing = false
let failedQueue: any[] = []

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error)
    } else {
      prom.resolve(token)
    }
  })

  failedQueue = []
}

export const refreshAuthToken = async () => {
  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      failedQueue.push({ resolve, reject })
    })
  }

  isRefreshing = true
  const config = getGlobalConfig()
  const refreshToken = getRefreshToken()

  if (!refreshToken || !config?.endPoints?.default) {
    isRefreshing = false
    return Promise.reject(new Error('No refresh token or endpoint available'))
  }

  try {
    const response = await fetch(config.endPoints.default, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 'Authorization': `Bearer ${getToken()}` // Some backends might need the expired token
      },
      body: JSON.stringify({
        query: `
          mutation RefreshToken($refreshToken: String!) {
            refreshToken(refreshToken: $refreshToken) {
                token
                refreshToken
            }
          }
        `,
        variables: {
          refreshToken,
        },
      }),
    })

    const { data, errors } = await response.json()

    if (errors || !data?.refreshToken?.token) {
      throw new Error('Failed to refresh token')
    }

    const { token: newToken, refreshToken: newRefreshToken } = data.refreshToken

    setToken({
      token: newToken,
      refreshToken: newRefreshToken,
    })

    processQueue(null, newToken)
    return newToken
  } catch (err) {
    processQueue(err, null)
    removeToken() // Log out user
    throw err
  } finally {
    isRefreshing = false
  }
}
