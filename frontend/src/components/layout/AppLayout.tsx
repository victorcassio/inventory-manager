// src/components/layout/AppLayout.tsx
import { Suspense, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { PageLoader } from './PageLoader'
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
  '/financial': 'Financeiro',
  '/financial/transactions': 'Financeiro',
  '/financial/transactions/new': 'Novo Lançamento',
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
  const [sidebarVisible, setSidebarVisible] = useState(() => window.innerWidth >= 768)
  const location = useLocation()
  const title = getPageTitle(location.pathname)

  useEffect(() => {
    const isMobile = window.innerWidth < 768
    if (isMobile && sidebarVisible) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [sidebarVisible])

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Backdrop — mobile only, fecha sidebar ao tocar fora */}
      {sidebarVisible && (
        <div
          className="fixed inset-0 z-10 bg-black/40 md:hidden"
          onClick={() => setSidebarVisible(false)}
        />
      )}

      {/* Sidebar — fixed no mobile (overlay), relative no desktop (flex) */}
      <div
        className={cn(
          'flex-shrink-0 transition-all duration-200',
          'fixed inset-y-0 left-0 z-20 flex',
          'md:relative md:z-auto',
          sidebarVisible ? 'w-64' : 'w-0 overflow-hidden',
        )}
      >
        <Sidebar onClose={() => setSidebarVisible(false)} />
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          title={title}
          onMenuClick={() => setSidebarVisible(v => !v)}
        />
        <main className="flex-1 overflow-y-auto p-6">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
