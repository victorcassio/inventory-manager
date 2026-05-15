import axios from 'axios'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

let accessToken: string | null = null
let refreshToken: string | null = null

export function setTokens(at: string, rt: string) {
  accessToken = at
  refreshToken = rt
}

export function clearTokens() {
  accessToken = null
  refreshToken = null
}

export function getAccessToken() { return accessToken }
export function getRefreshToken() { return refreshToken }

const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

let isRefreshing = false
let failedQueue: Array<{ resolve: (value: string) => void; reject: (reason: unknown) => void }> = []

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)))
  failedQueue = []
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    if (error.response?.status !== 401 || originalRequest._retry) return Promise.reject(error)

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      }).then((token) => {
        originalRequest.headers.Authorization = `Bearer ${token}`
        return api(originalRequest)
      })
    }

    originalRequest._retry = true
    isRefreshing = true

    try {
      const rt = refreshToken
      if (!rt) throw new Error('No refresh token')
      const { data } = await axios.post(
        `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/auth/refresh`,
        { refreshToken: rt },
      )
      const newAt = data.accessToken
      const newRt = data.refreshToken
      setTokens(newAt, newRt)
      processQueue(null, newAt)
      originalRequest.headers.Authorization = `Bearer ${newAt}`
      // Persist new tokens
      const event = new CustomEvent('auth:tokens-refreshed', { detail: { accessToken: newAt, refreshToken: newRt } })
      window.dispatchEvent(event)
      return api(originalRequest)
    } catch (refreshError) {
      processQueue(refreshError, null)
      clearTokens()
      window.dispatchEvent(new Event('auth:logout'))
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  },
)

export default api
