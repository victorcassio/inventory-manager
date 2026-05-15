import { Navigate, Outlet } from 'react-router-dom'
import type { UserRole } from '@/types'
import { useAuthStore } from '@/stores/auth.store'

interface RoleGuardProps { allowedRoles: UserRole[] }

export function RoleGuard({ allowedRoles }: RoleGuardProps) {
  const { user } = useAuthStore()
  if (!user || !allowedRoles.includes(user.role)) return <Navigate to="/403" replace />
  return <Outlet />
}
