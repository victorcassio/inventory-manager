import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Package, FileText, CreditCard,
  TrendingUp, LogOut, ClipboardList, Calendar,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '@/stores/auth.store'
import { authApi } from '@/lib/api/auth.api'
import type { UserRole } from '@/types'

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  roles: UserRole[]
}

const navItems: NavItem[] = [
  { label: 'Dashboard',    href: '/dashboard',                  icon: LayoutDashboard, roles: ['admin', 'attendant', 'financial'] },
  { label: 'Calendário',   href: '/calendar',                   icon: Calendar,        roles: ['admin', 'attendant'] },
  { label: 'Clientes',     href: '/customers',                  icon: Users,           roles: ['admin', 'attendant', 'financial'] },
  { label: 'Estoque',      href: '/inventory/items',            icon: Package,         roles: ['admin', 'attendant', 'financial'] },
  { label: 'Locações',     href: '/rentals',                    icon: ClipboardList,   roles: ['admin', 'attendant', 'financial'] },
  { label: 'Pagamentos',   href: '/payments',                   icon: CreditCard,      roles: ['admin', 'financial'] },
  { label: 'Financeiro',   href: '/financial',                  icon: TrendingUp,      roles: ['admin', 'financial'] },
  { label: 'Documentos',   href: '/documents',                  icon: FileText,        roles: ['admin', 'attendant', 'financial'] },
]

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  attendant: 'Atendente',
  financial: 'Financeiro',
}

interface SidebarProps {
  onClose?: () => void
}

export function Sidebar({ onClose }: SidebarProps) {
  const { user, clearAuth } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = async () => {
    const { refreshToken } = useAuthStore.getState()
    try {
      if (refreshToken) await authApi.logout(refreshToken)
    } catch {
      // ignore
    } finally {
      clearAuth()
      navigate('/login', { replace: true })
    }
  }

  const filteredItems = navItems.filter(item =>
    user ? item.roles.includes(user.role) : false,
  )

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-background">
      {/* Logo */}
      <div className="flex h-16 items-center border-b px-6">
        <h1 className="text-lg font-bold text-primary">Inventory Manager</h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {filteredItems.map((item) => {
            const Icon = item.icon
            return (
              <li key={item.href}>
                <NavLink
                  to={item.href}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* User footer */}
      <div className="border-t px-3 py-4">
        {user && (
          <div className="mb-3 px-3">
            <p className="text-sm font-medium">{user.name}</p>
            <Badge variant="secondary" className="mt-1 text-xs">
              {ROLE_LABELS[user.role]}
            </Badge>
          </div>
        )}
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-muted-foreground"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          Sair
        </Button>
      </div>
    </aside>
  )
}
