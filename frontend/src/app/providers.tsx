import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Toaster } from 'sonner'
import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import { setTokens } from '@/lib/api/client'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, gcTime: 5 * 60 * 1000 },
  },
})

function AuthHydration({ children }: { children: React.ReactNode }) {
  const { accessToken, refreshToken, clearAuth } = useAuthStore()

  useEffect(() => {
    // Rehydrate tokens into axios client on mount
    if (accessToken && refreshToken) setTokens(accessToken, refreshToken)
  }, [accessToken, refreshToken])

  useEffect(() => {
    const handleLogout = () => { clearAuth() }
    const handleRefresh = (e: Event) => {
      const { accessToken: at, refreshToken: rt } = (e as CustomEvent).detail
      useAuthStore.getState().updateTokens(at, rt)
    }
    window.addEventListener('auth:logout', handleLogout)
    window.addEventListener('auth:tokens-refreshed', handleRefresh)
    return () => {
      window.removeEventListener('auth:logout', handleLogout)
      window.removeEventListener('auth:tokens-refreshed', handleRefresh)
    }
  }, [clearAuth])

  return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthHydration>
        {children}
        <Toaster position="top-right" richColors />
        <ReactQueryDevtools initialIsOpen={false} />
      </AuthHydration>
    </QueryClientProvider>
  )
}
