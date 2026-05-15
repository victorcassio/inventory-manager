import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { cn } from '@/lib/utils'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/customers': 'Clientes',
  '/customers/new': 'Novo Cliente',
  '/inventory/items': 'Estoque',
  '/inventory/items/new': 'Novo Item',
  '/inventory/categories': 'Categorias',
  '/rentals': 'Locações',
  '/rentals/new': 'Nova Locação',
  '/payments': 'Pagamentos',
  '/financial/transactions': 'Financeiro',
  '/documents': 'Documentos',
  '/403': 'Acesso Negado',
}

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]
  if (pathname.match(/\/customers\/[^/]+\/edit$/)) return 'Editar Cliente'
  if (pathname.match(/\/customers\/[^/]+$/)) return 'Detalhes do Cliente'
  if (pathname.match(/\/inventory\/items\/[^/]+$/)) return 'Detalhes do Item'
  if (pathname.match(/\/rentals\/[^/]+$/)) return 'Detalhes da Locação'
  return 'Inventory Manager'
}

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const title = getPageTitle(location.pathname)

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:flex md:flex-shrink-0">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 flex">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          title={title}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <main className={cn('flex-1 overflow-y-auto p-6')}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
