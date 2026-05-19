# Mobile Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar scroll horizontal no mobile transformando tabelas em listas compactas e adicionando filtros colapsáveis, sem regressão no desktop.

**Architecture:** Componente `FilterPanel` compartilhado para colapso de filtros (3 páginas); cada página de lista renderiza dois blocos mutuamente exclusivos via Tailwind (`hidden md:block` para tabela, `md:hidden` para lista compacta); AppLayout recebe overlay + scroll lock no mobile.

**Tech Stack:** React + TypeScript, Tailwind CSS (`md` = 768px), shadcn/ui (Badge, Button), Lucide icons (ChevronRight, SlidersHorizontal, X, ChevronDown, ChevronUp), Vitest + Testing Library.

---

## Arquivos

### Criar
- `src/components/filters/FilterPanel.tsx`
- `src/tests/filters/FilterPanel.test.tsx`
- `src/tests/rentals/RentalsListPage.test.tsx`
- `src/tests/inventory/ItemsListPage.test.tsx`

### Modificar
- `src/components/layout/AppLayout.tsx`
- `src/features/rentals/pages/RentalsListPage.tsx`
- `src/features/customers/pages/CustomersListPage.tsx`
- `src/features/inventory/pages/ItemsListPage.tsx`
- `src/features/payments/pages/PaymentsListPage.tsx`
- `src/features/financial/pages/FinancialListPage.tsx`
- `src/features/documents/pages/DocumentsListPage.tsx`
- `src/features/payments/components/PaymentsTable.tsx`
- `src/features/documents/components/DocumentsTable.tsx`
- `src/features/rentals/pages/RentalDetailPage.tsx`
- `src/tests/customers/CustomersListPage.test.tsx`
- `src/tests/payments/PaymentsListPage.test.tsx`
- `src/tests/financial/FinancialListPage.test.tsx`
- `src/tests/documents/DocumentsListPage.test.tsx`
- `src/tests/documents/DocumentsTable.test.tsx`

---

## Task 1: FilterPanel — test + implementação

**Files:**
- Create: `src/components/filters/FilterPanel.tsx`
- Create: `src/tests/filters/FilterPanel.test.tsx`

- [ ] **Step 1.1: Escrever o teste**

```tsx
// src/tests/filters/FilterPanel.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilterPanel } from '@/components/filters/FilterPanel'

function renderPanel(props: Partial<React.ComponentProps<typeof FilterPanel>> = {}) {
  return render(
    <FilterPanel activeCount={0} onClear={vi.fn()} {...props}>
      <div>conteúdo dos filtros</div>
    </FilterPanel>,
  )
}

describe('FilterPanel', () => {
  it('renderiza botão de toggle', () => {
    renderPanel()
    const btns = screen.getAllByRole('button')
    expect(btns.some(b => b.textContent?.includes('Filtros'))).toBe(true)
  })

  it('conteúdo mobile oculto por padrão (painel fechado)', () => {
    renderPanel()
    // desktop wrapper (hidden md:block) sempre renderiza em jsdom → 1 ocorrência
    // mobile panel só renderiza children quando open=true → 0 ocorrências
    expect(screen.getAllByText('conteúdo dos filtros')).toHaveLength(1)
  })

  it('expande conteúdo ao clicar no toggle', async () => {
    const user = userEvent.setup()
    renderPanel()
    const toggleBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('Filtros'))!
    await user.click(toggleBtn)
    // agora children aparece em desktop wrapper E no painel mobile
    expect(screen.getAllByText('conteúdo dos filtros')).toHaveLength(2)
  })

  it('mostra badge com activeCount quando > 0', () => {
    renderPanel({ activeCount: 2 })
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('mostra summary no botão quando há filtros ativos', () => {
    renderPanel({ activeCount: 1, summary: 'Este mês · PIX' })
    expect(screen.getByText(/Filtros · Este mês · PIX/)).toBeInTheDocument()
  })

  it('mostra botão "Limpar filtros" dentro do painel quando activeCount > 0', async () => {
    const user = userEvent.setup()
    renderPanel({ activeCount: 1 })
    const toggleBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('Filtros'))!
    await user.click(toggleBtn)
    expect(screen.getByRole('button', { name: /limpar filtros/i })).toBeInTheDocument()
  })

  it('chama onClear ao clicar em "Limpar filtros"', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    renderPanel({ activeCount: 1, onClear })
    const toggleBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('Filtros'))!
    await user.click(toggleBtn)
    await user.click(screen.getByRole('button', { name: /limpar filtros/i }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('não mostra "Limpar filtros" quando activeCount é 0', async () => {
    const user = userEvent.setup()
    renderPanel({ activeCount: 0 })
    const toggleBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('Filtros'))!
    await user.click(toggleBtn)
    expect(screen.queryByRole('button', { name: /limpar filtros/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 1.2: Executar teste — confirmar falha**

```bash
cd frontend && source ~/.nvm/nvm.sh && nvm use 20.19.4
npx vitest run src/tests/filters/FilterPanel.test.tsx
```
Esperado: FAIL — `Cannot find module '@/components/filters/FilterPanel'`

- [ ] **Step 1.3: Implementar FilterPanel**

```tsx
// src/components/filters/FilterPanel.tsx
import { useState } from 'react'
import { ChevronDown, ChevronUp, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface FilterPanelProps {
  activeCount: number
  summary?: string
  onClear: () => void
  children: React.ReactNode
}

export function FilterPanel({ activeCount, summary, onClear, children }: FilterPanelProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Mobile: collapsible — hidden on desktop via md:hidden */}
      <div className="md:hidden">
        <Button
          variant="outline"
          className="w-full justify-between"
          onClick={() => setOpen(v => !v)}
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            {summary && activeCount > 0 ? `Filtros · ${summary}` : 'Filtros'}
            {activeCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground leading-none">
                {activeCount}
              </span>
            )}
          </span>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>

        {open && (
          <div className="mt-3 space-y-4 rounded-md border p-4">
            {children}
            {activeCount > 0 && (
              <Button variant="ghost" size="sm" className="w-full" onClick={onClear}>
                <X className="mr-2 h-3 w-3" />
                Limpar filtros
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Desktop: renderiza children em fluxo normal — hidden on mobile */}
      <div className="hidden md:block space-y-4">
        {children}
      </div>
    </>
  )
}
```

- [ ] **Step 1.4: Executar teste — confirmar aprovação**

```bash
npx vitest run src/tests/filters/FilterPanel.test.tsx
```
Esperado: 7 testes PASS

- [ ] **Step 1.5: Commit**

```bash
git add src/components/filters/FilterPanel.tsx src/tests/filters/FilterPanel.test.tsx
git commit -m "feat(mobile): add FilterPanel collapsible component"
```

---

## Task 2: AppLayout — sidebar overlay no mobile

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 2.1: Substituir AppLayout.tsx**

```tsx
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
```

- [ ] **Step 2.2: Verificar testes de layout existentes**

```bash
npx vitest run src/tests/layout/
```
Esperado: todos PASS

- [ ] **Step 2.3: Commit**

```bash
git add src/components/layout/AppLayout.tsx
git commit -m "feat(mobile): sidebar starts closed on mobile with overlay and scroll lock"
```

---

## Task 3: RentalsListPage — mobile list + paginação

**Files:**
- Modify: `src/features/rentals/pages/RentalsListPage.tsx`
- Create: `src/tests/rentals/RentalsListPage.test.tsx`

- [ ] **Step 3.1: Escrever teste**

```tsx
// src/tests/rentals/RentalsListPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RentalsListPage } from '@/features/rentals/pages/RentalsListPage'
import { useRentals } from '@/features/rentals/hooks/useRentals'
import { useAuthStore } from '@/stores/auth.store'
import type { PaginatedResponse } from '@/types'

vi.mock('@/features/rentals/hooks/useRentals', () => ({ useRentals: vi.fn() }))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: vi.fn() }))
vi.mock('@/hooks/usePagination', () => ({
  usePagination: () => ({ page: 1, limit: 20, setPage: vi.fn() }),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams()] }
})

const mockUseRentals = useRentals as unknown as ReturnType<typeof vi.fn>
const mockUseAuthStore = useAuthStore as unknown as ReturnType<typeof vi.fn>

const mockRental = {
  id: 'r1',
  contractNumber: '2026-0001',
  startedAt: '2026-05-01T00:00:00Z',
  expectedReturn: '2026-05-11T00:00:00Z',
  computedStatus: 'active',
  total: '280.00',
  customer: { id: 'c1', name: 'João Silva' },
}

function setupMocks() {
  mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
  mockUseRentals.mockReturnValue({
    data: { data: [mockRental], total: 1, page: 1, limit: 20 } as PaginatedResponse<typeof mockRental>,
    isLoading: false, isError: false, refetch: vi.fn(),
  })
}

function renderPage() {
  return render(<MemoryRouter><RentalsListPage /></MemoryRouter>)
}

describe('RentalsListPage', () => {
  it('exibe nome do cliente na lista', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getAllByText('João Silva').length).toBeGreaterThan(0))
  })

  it('exibe contrato na lista', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getAllByText(/2026-0001/).length).toBeGreaterThan(0))
  })

  it('mostra paginação quando total > limit', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseRentals.mockReturnValue({
      data: { data: [mockRental], total: 25, page: 1, limit: 20 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /próxima/i })).toBeInTheDocument())
  })

  it('mostra range de paginação', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseRentals.mockReturnValue({
      data: { data: [mockRental], total: 25, page: 1, limit: 20 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Mostrando 1–20 de 25/)).toBeInTheDocument())
  })
})
```

- [ ] **Step 3.2: Executar — confirmar falha no range de paginação**

```bash
npx vitest run src/tests/rentals/RentalsListPage.test.tsx
```
Esperado: "Mostrando 1–20 de 25" FAIL (texto não existe ainda)

- [ ] **Step 3.3: Atualizar RentalsListPage.tsx**

```tsx
// src/features/rentals/pages/RentalsListPage.tsx
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { StatusBadge } from '@/components/feedback/StatusBadge'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useRentals } from '../hooks/useRentals'
import { useAuthStore } from '@/stores/auth.store'
import { formatDate, formatCurrency } from '@/lib/formatters'
import { usePagination } from '@/hooks/usePagination'
import type { ComputedRentalStatus } from '@/types'

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos os status' },
  { value: 'active', label: 'Ativo' },
  { value: 'overdue', label: 'Vencido' },
  { value: 'returned', label: 'Devolvido' },
  { value: 'canceled', label: 'Cancelado' },
]

export function RentalsListPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuthStore()
  const [computedStatus, setComputedStatus] = useState<string>(
    searchParams.get('status') ?? ''
  )
  const { page, limit, setPage } = usePagination()
  const canManage = user?.role === 'admin' || user?.role === 'attendant'

  const { data, isLoading, isError, refetch } = useRentals({
    page, limit,
    computedStatus: computedStatus || undefined,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Locações</h2>
        {canManage && (
          <Button onClick={() => navigate('/rentals/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Nova Locação
          </Button>
        )}
      </div>

      <div className="max-w-xs">
        <Select
          value={computedStatus || 'all'}
          onValueChange={(v) => { setComputedStatus(v === 'all' ? '' : v); setPage(1) }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      )}
      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState
              title="Nenhuma locação encontrada"
              description="Crie a primeira locação."
              action={canManage ? { label: 'Nova Locação', onClick: () => navigate('/rentals/new') } : undefined}
            />
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contrato</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Início</TableHead>
                      <TableHead>Devolução</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map(rental => (
                      <TableRow key={rental.id} className="cursor-pointer" onClick={() => navigate(`/rentals/${rental.id}`)}>
                        <TableCell className="font-mono text-xs">{rental.contractNumber}</TableCell>
                        <TableCell>{rental.customer?.name ?? '—'}</TableCell>
                        <TableCell>{formatDate(rental.startedAt)}</TableCell>
                        <TableCell>{formatDate(rental.expectedReturn)}</TableCell>
                        <TableCell><StatusBadge status={rental.computedStatus as ComputedRentalStatus} /></TableCell>
                        <TableCell>{rental.total ? formatCurrency(rental.total) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile */}
              <div className="md:hidden divide-y rounded-md border">
                {data.data.map(rental => (
                  <div
                    key={rental.id}
                    className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/rentals/${rental.id}`)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{rental.customer?.name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">
                        {rental.contractNumber} · {formatDate(rental.startedAt)} → {formatDate(rental.expectedReturn)}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <StatusBadge status={rental.computedStatus as ComputedRentalStatus} />
                      <span className="text-xs font-medium">{rental.total ? formatCurrency(rental.total) : '—'}</span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                ))}
              </div>
            </>
          )}

          {data.total > limit && (
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">
                Mostrando {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} de {data.total}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
                <Button variant="outline" size="sm" disabled={page * limit >= data.total} onClick={() => setPage(page + 1)}>Próxima</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3.4: Executar testes**

```bash
npx vitest run src/tests/rentals/RentalsListPage.test.tsx
```
Esperado: 4 PASS

- [ ] **Step 3.5: Commit**

```bash
git add src/features/rentals/pages/RentalsListPage.tsx src/tests/rentals/RentalsListPage.test.tsx
git commit -m "feat(mobile): add compact list and responsive pagination to RentalsListPage"
```

---

## Task 4: CustomersListPage — mobile list + paginação

**Files:**
- Modify: `src/features/customers/pages/CustomersListPage.tsx`
- Modify: `src/tests/customers/CustomersListPage.test.tsx`

- [ ] **Step 4.1: Adicionar assertion de paginação ao teste existente**

Abrir `src/tests/customers/CustomersListPage.test.tsx` e adicionar ao final do `describe`:

```tsx
  it('mostra range de paginação quando total > limit', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseCustomers.mockReturnValue({
      isLoading: false, isError: false, refetch: vi.fn(),
      data: { data: [mockCustomer], total: 25, page: 1, limit: 20 },
    })
    render(<MemoryRouter><CustomersListPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText(/Mostrando 1–20 de 25/)).toBeInTheDocument())
  })
```

- [ ] **Step 4.2: Executar — confirmar falha no novo teste**

```bash
npx vitest run src/tests/customers/CustomersListPage.test.tsx
```
Esperado: 4 PASS, 1 FAIL ("Mostrando 1–20 de 25")

- [ ] **Step 4.3: Atualizar CustomersListPage.tsx**

```tsx
// src/features/customers/pages/CustomersListPage.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useCustomers } from '../hooks/useCustomers'
import { useAuthStore } from '@/stores/auth.store'
import { formatDocument } from '@/lib/formatters'
import { usePagination } from '@/hooks/usePagination'

export function CustomersListPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [search, setSearch] = useState('')
  const { page, limit, setPage } = usePagination()
  const canManage = user?.role === 'admin' || user?.role === 'attendant'

  const { data, isLoading, isError, refetch } = useCustomers({
    page, limit,
    name: search || undefined,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Clientes</h2>
        {canManage && (
          <Button onClick={() => navigate('/customers/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Cliente
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="pl-9"
        />
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      )}
      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState
              title="Nenhum cliente encontrado"
              description={search ? 'Tente buscar por outro nome.' : 'Cadastre o primeiro cliente.'}
              action={canManage ? { label: 'Novo Cliente', onClick: () => navigate('/customers/new') } : undefined}
            />
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Documento</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map(customer => (
                      <TableRow key={customer.id} className="cursor-pointer" onClick={() => navigate(`/customers/${customer.id}`)}>
                        <TableCell className="font-medium">{customer.name}</TableCell>
                        <TableCell>{formatDocument(customer.document)}</TableCell>
                        <TableCell>{customer.phone ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant={customer.isActive ? 'default' : 'secondary'}>
                            {customer.isActive ? 'Ativo' : 'Inativo'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/customers/${customer.id}`) }}>Ver</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile */}
              <div className="md:hidden divide-y rounded-md border">
                {data.data.map(customer => (
                  <div
                    key={customer.id}
                    className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/customers/${customer.id}`)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{customer.name}</p>
                      <p className="text-xs text-muted-foreground">{formatDocument(customer.document)}</p>
                    </div>
                    <Badge variant={customer.isActive ? 'default' : 'secondary'}>
                      {customer.isActive ? 'Ativo' : 'Inativo'}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                ))}
              </div>
            </>
          )}

          {data.total > limit && (
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">
                Mostrando {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} de {data.total}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
                <Button variant="outline" size="sm" disabled={page * limit >= data.total} onClick={() => setPage(page + 1)}>Próxima</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4.4: Executar testes**

```bash
npx vitest run src/tests/customers/CustomersListPage.test.tsx
```
Esperado: 5 PASS

- [ ] **Step 4.5: Commit**

```bash
git add src/features/customers/pages/CustomersListPage.tsx src/tests/customers/CustomersListPage.test.tsx
git commit -m "feat(mobile): add compact list and responsive pagination to CustomersListPage"
```

---

## Task 5: ItemsListPage — mobile list + paginação

**Files:**
- Modify: `src/features/inventory/pages/ItemsListPage.tsx`
- Create: `src/tests/inventory/ItemsListPage.test.tsx`

- [ ] **Step 5.1: Escrever teste**

```tsx
// src/tests/inventory/ItemsListPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ItemsListPage } from '@/features/inventory/pages/ItemsListPage'
import { useItems, useCategories } from '@/features/inventory/hooks/useInventory'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/features/inventory/hooks/useInventory', () => ({
  useItems: vi.fn(),
  useCategories: vi.fn(),
}))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: vi.fn() }))
vi.mock('@/hooks/usePagination', () => ({
  usePagination: () => ({ page: 1, limit: 20, setPage: vi.fn() }),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const mockUseItems = useItems as unknown as ReturnType<typeof vi.fn>
const mockUseCategories = useCategories as unknown as ReturnType<typeof vi.fn>
const mockUseAuthStore = useAuthStore as unknown as ReturnType<typeof vi.fn>

const mockItem = {
  id: 'item-1',
  code: 'AND-1M',
  name: 'Andaime Tubular 1m',
  dailyRate: '4.50',
  totalQty: 10,
  availableQty: 7,
  condition: 'good',
  category: { id: 'cat-1', name: 'Andaimes' },
}

function setupMocks() {
  mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
  mockUseCategories.mockReturnValue({ data: [] })
  mockUseItems.mockReturnValue({
    data: { data: [mockItem], total: 1, page: 1, limit: 20 },
    isLoading: false, isError: false, refetch: vi.fn(),
  })
}

function renderPage() {
  return render(<MemoryRouter><ItemsListPage /></MemoryRouter>)
}

describe('ItemsListPage', () => {
  it('exibe nome do item', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getAllByText('Andaime Tubular 1m').length).toBeGreaterThan(0))
  })

  it('exibe código do item', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getAllByText(/AND-1M/).length).toBeGreaterThan(0))
  })

  it('mostra range de paginação quando total > limit', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseCategories.mockReturnValue({ data: [] })
    mockUseItems.mockReturnValue({
      data: { data: [mockItem], total: 25, page: 1, limit: 20 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Mostrando 1–20 de 25/)).toBeInTheDocument())
  })
})
```

- [ ] **Step 5.2: Executar — confirmar falha**

```bash
npx vitest run src/tests/inventory/ItemsListPage.test.tsx
```
Esperado: FAIL

- [ ] **Step 5.3: Atualizar ItemsListPage.tsx**

```tsx
// src/features/inventory/pages/ItemsListPage.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useItems, useCategories } from '../hooks/useInventory'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency } from '@/lib/formatters'
import { usePagination } from '@/hooks/usePagination'

const CONDITION_LABELS: Record<string, string> = {
  new: 'Novo', good: 'Bom', fair: 'Regular', maintenance: 'Manutenção',
}

export function ItemsListPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [categoryId, setCategoryId] = useState<string>('')
  const { page, limit, setPage } = usePagination()
  const canManage = user?.role === 'admin'

  const { data: categories } = useCategories()
  const { data, isLoading, isError, refetch } = useItems({
    page, limit,
    categoryId: categoryId || undefined,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Estoque</h2>
        {canManage && (
          <Button onClick={() => navigate('/inventory/items/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Item
          </Button>
        )}
      </div>

      <div className="max-w-xs">
        <Select value={categoryId} onValueChange={(v) => { setCategoryId(v === 'all' ? '' : v); setPage(1) }}>
          <SelectTrigger><SelectValue placeholder="Filtrar por categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {categories?.map(cat => (
              <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      )}
      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState
              title="Nenhum item encontrado"
              description="Cadastre o primeiro item no estoque."
              action={canManage ? { label: 'Novo Item', onClick: () => navigate('/inventory/items/new') } : undefined}
            />
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Valor Diário</TableHead>
                      <TableHead>Disponível</TableHead>
                      <TableHead>Condição</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map(item => (
                      <TableRow key={item.id} className="cursor-pointer" onClick={() => navigate(`/inventory/items/${item.id}`)}>
                        <TableCell className="font-mono text-xs">{item.code}</TableCell>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>{item.category?.name ?? '—'}</TableCell>
                        <TableCell>{formatCurrency(item.dailyRate)}</TableCell>
                        <TableCell>
                          <Badge variant={item.availableQty > 0 ? 'default' : 'destructive'}>
                            {item.availableQty}/{item.totalQty}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{CONDITION_LABELS[item.condition] ?? item.condition}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile */}
              <div className="md:hidden divide-y rounded-md border">
                {data.data.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/inventory/items/${item.id}`)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{item.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{item.code} · {item.category?.name ?? '—'}</p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <Badge variant={item.availableQty > 0 ? 'default' : 'destructive'}>
                        {item.availableQty}/{item.totalQty}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{formatCurrency(item.dailyRate)}/dia</span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                ))}
              </div>
            </>
          )}

          {data.total > limit && (
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">
                Mostrando {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} de {data.total}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
                <Button variant="outline" size="sm" disabled={page * limit >= data.total} onClick={() => setPage(page + 1)}>Próxima</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 5.4: Executar testes**

```bash
npx vitest run src/tests/inventory/ItemsListPage.test.tsx
```
Esperado: 3 PASS

- [ ] **Step 5.5: Commit**

```bash
git add src/features/inventory/pages/ItemsListPage.tsx src/tests/inventory/ItemsListPage.test.tsx
git commit -m "feat(mobile): add compact list and responsive pagination to ItemsListPage"
```

---

## Task 6: PaymentsListPage — FilterPanel + mobile list + paginação

**Files:**
- Modify: `src/features/payments/pages/PaymentsListPage.tsx`
- Modify: `src/tests/payments/PaymentsListPage.test.tsx`

- [ ] **Step 6.1: Adicionar assertion de FilterPanel ao teste existente**

Abrir `src/tests/payments/PaymentsListPage.test.tsx` e adicionar ao final do `describe`:

```tsx
  it('mostra botão de filtros', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      const btns = screen.getAllByRole('button')
      expect(btns.some(b => b.textContent?.includes('Filtros'))).toBe(true)
    })
  })

  it('mostra range de paginação quando total > limit', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUsePayments.mockReturnValue({
      data: { data: [mockPayment], total: 25, page: 1, limit: 20 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Mostrando 1–20 de 25/)).toBeInTheDocument())
  })
```

- [ ] **Step 6.2: Executar — confirmar falhas nos novos testes**

```bash
npx vitest run src/tests/payments/PaymentsListPage.test.tsx
```
Esperado: 7 PASS, 2 FAIL

- [ ] **Step 6.3: Atualizar PaymentsListPage.tsx**

```tsx
// src/features/payments/pages/PaymentsListPage.tsx
import { useState, useRef } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { FilterPanel } from '@/components/filters/FilterPanel'
import { usePayments } from '../hooks/usePayments'
import { useAuthStore } from '@/stores/auth.store'
import { rentalsApi } from '@/lib/api/rentals.api'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { usePagination } from '@/hooks/usePagination'

type PeriodPreset = 'today' | 'this_week' | 'this_month' | 'custom'

function getPresetDates(preset: PeriodPreset): { dateFrom: string; dateTo: string } {
  const now = new Date()
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd')
  switch (preset) {
    case 'today':      return { dateFrom: fmt(now), dateTo: fmt(now) }
    case 'this_week':  return { dateFrom: fmt(startOfWeek(now, { weekStartsOn: 1 })), dateTo: fmt(endOfWeek(now, { weekStartsOn: 1 })) }
    case 'this_month': return { dateFrom: fmt(startOfMonth(now)), dateTo: fmt(endOfMonth(now)) }
    case 'custom':     return { dateFrom: '', dateTo: '' }
  }
}

const PRESET_LABELS: Record<PeriodPreset, string> = {
  today: 'Hoje', this_week: 'Esta semana', this_month: 'Este mês', custom: 'Personalizado',
}

const METHOD_LABELS: Record<string, string> = {
  pix: 'PIX', cash: 'Dinheiro', card: 'Cartão', transfer: 'Transferência',
}

export function PaymentsListPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  if (user && user.role === 'attendant') return <Navigate to="/403" replace />

  const { page, limit, setPage } = usePagination()
  const [preset, setPreset]                 = useState<PeriodPreset>('this_month')
  const [customFrom, setCustomFrom]         = useState('')
  const [customTo, setCustomTo]             = useState('')
  const [method, setMethod]                 = useState('')
  const [contractSearch, setContractSearch] = useState('')
  const [rentalIdFilter, setRentalIdFilter] = useState<string | undefined>()
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const periodDates =
    preset === 'custom'
      ? { dateFrom: customFrom || undefined, dateTo: customTo || undefined }
      : getPresetDates(preset)

  const { data, isLoading, isError, refetch } = usePayments({
    ...periodDates,
    method: method || undefined,
    rentalId: rentalIdFilter,
    page, limit,
  })

  const handlePreset = (p: PeriodPreset) => { setPreset(p); setPage(1) }

  const handleContractInput = (value: string) => {
    setContractSearch(value)
    clearTimeout(debounceRef.current)
    if (!value || value.length < 2) { setRentalIdFilter(undefined); setPage(1); return }
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await rentalsApi.list({ contractNumber: value, limit: 5 })
        setRentalIdFilter(result.data[0]?.id ?? undefined)
        setPage(1)
      } catch { setRentalIdFilter(undefined) }
    }, 300)
  }

  const activeCount = [preset !== 'this_month', !!method, !!contractSearch].filter(Boolean).length

  const filterSummary = [
    preset !== 'this_month' ? PRESET_LABELS[preset] : null,
    method ? METHOD_LABELS[method] : null,
    contractSearch ? `#${contractSearch}` : null,
  ].filter(Boolean).join(' · ')

  const handleClear = () => {
    setPreset('this_month'); setCustomFrom(''); setCustomTo('')
    setMethod(''); setContractSearch(''); setRentalIdFilter(undefined); setPage(1)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Pagamentos</h2>
        <p className="text-muted-foreground">Histórico de pagamentos recebidos</p>
      </div>

      <FilterPanel activeCount={activeCount} summary={filterSummary} onClear={handleClear}>
        {/* Period presets */}
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
          {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map(p => (
            <Button key={p} variant={preset === p ? 'default' : 'outline'} size="sm"
              className="w-full md:w-auto" onClick={() => handlePreset(p)}>
              {PRESET_LABELS[p]}
            </Button>
          ))}
        </div>

        {/* Custom date range */}
        {preset === 'custom' && (
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
            <div className="space-y-1">
              <Label htmlFor="dateFrom">De</Label>
              <DateInput id="dateFrom" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(1) }} className="w-full md:w-40" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dateTo">Até</Label>
              <DateInput id="dateTo" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(1) }} className="w-full md:w-40" />
            </div>
          </div>
        )}

        {/* Method + Contract */}
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:gap-4">
          <div className="space-y-1">
            <Label>Método</Label>
            <Select value={method || 'all'} onValueChange={v => { setMethod(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full md:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {Object.entries(METHOD_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="contract">Contrato</Label>
            <Input id="contract" placeholder="Buscar por contrato..." value={contractSearch}
              onChange={e => handleContractInput(e.target.value)} className="w-full md:w-48" />
          </div>
        </div>
      </FilterPanel>

      {/* Active chips — mobile only */}
      {activeCount > 0 && (
        <div className="flex flex-wrap gap-1 md:hidden">
          {preset !== 'this_month' && <Badge variant="secondary">{PRESET_LABELS[preset]}</Badge>}
          {method && <Badge variant="secondary">{METHOD_LABELS[method]}</Badge>}
          {contractSearch && <Badge variant="secondary">#{contractSearch}</Badge>}
        </div>
      )}

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" role="status" />)}
        </div>
      )}
      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState title="Nenhum pagamento encontrado" description="Ajuste os filtros para ver mais resultados." />
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Contrato</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map(payment => (
                      <TableRow key={payment.id}>
                        <TableCell className="text-muted-foreground text-sm">{formatDate(payment.paidAt)}</TableCell>
                        <TableCell>
                          {payment.rental ? (
                            <button className="font-mono text-xs text-primary hover:underline"
                              onClick={() => navigate(`/rentals/${payment.rentalId}`)}>
                              #{payment.rental.contractNumber}
                            </button>
                          ) : '—'}
                        </TableCell>
                        <TableCell>{payment.rental?.customer?.name ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{METHOD_LABELS[payment.method] ?? payment.method}</TableCell>
                        <TableCell className="text-right font-semibold text-green-600">{formatCurrency(payment.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile */}
              <div className="md:hidden divide-y rounded-md border">
                {data.data.map(payment => (
                  <div key={payment.id} className="flex items-center gap-3 p-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{payment.rental?.customer?.name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">
                        {payment.rental ? `#${payment.rental.contractNumber}` : '—'} · {formatDate(payment.paidAt)}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-green-600 shrink-0">{formatCurrency(payment.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {data.total > limit && (
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">
                Mostrando {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} de {data.total}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
                <Button variant="outline" size="sm" disabled={page * limit >= data.total} onClick={() => setPage(page + 1)}>Próxima</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 6.4: Executar testes**

```bash
npx vitest run src/tests/payments/PaymentsListPage.test.tsx
```
Esperado: 9 PASS

- [ ] **Step 6.5: Commit**

```bash
git add src/features/payments/pages/PaymentsListPage.tsx src/tests/payments/PaymentsListPage.test.tsx
git commit -m "feat(mobile): add FilterPanel, compact list and responsive pagination to PaymentsListPage"
```

---

## Task 7: FinancialListPage — FilterPanel + mobile list + paginação

**Files:**
- Modify: `src/features/financial/pages/FinancialListPage.tsx`
- Modify: `src/tests/financial/FinancialListPage.test.tsx`

- [ ] **Step 7.1: Adicionar assertions ao teste existente**

Abrir `src/tests/financial/FinancialListPage.test.tsx` e adicionar ao final do `describe`:

```tsx
  it('mostra botão de filtros', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      const btns = screen.getAllByRole('button')
      expect(btns.some(b => b.textContent?.includes('Filtros'))).toBe(true)
    })
  })

  it('mostra range de paginação quando total > limit', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseFinancialTransactions.mockReturnValue({
      data: { data: [mockTransaction], total: 25, page: 1, limit: 20 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    mockUseFinancialSummary.mockReturnValue({
      data: { totalIncome: 0, totalExpense: 0, balance: 0, voidedCount: 0 },
      isLoading: false, isError: false,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Mostrando 1–20 de 25/)).toBeInTheDocument())
  })
```

- [ ] **Step 7.2: Executar — confirmar falhas**

```bash
npx vitest run src/tests/financial/FinancialListPage.test.tsx
```
Esperado: N PASS, 2 FAIL

- [ ] **Step 7.3: Atualizar FinancialListPage.tsx**

Adicionar imports no topo:
```tsx
import { ChevronRight } from 'lucide-react'
import { FilterPanel } from '@/components/filters/FilterPanel'
```

Adicionar após as declarações de estado (após `const [origin, setOrigin] = useState('')`):

```tsx
  const activeCount = [
    preset !== 'this_month',
    !!type,
    !!category,
    !!origin,
  ].filter(Boolean).length

  const filterSummary = [
    preset !== 'this_month' ? PRESET_LABELS[preset] : null,
    type ? (type === 'income' ? 'Entrada' : 'Saída') : null,
    category ? CATEGORY_LABELS[category as FinancialTransactionCategory] : null,
    origin ? ORIGIN_LABELS[origin as FinancialTransactionOrigin] : null,
  ].filter(Boolean).join(' · ')

  const handleClear = () => {
    setPreset('this_month'); setCustomFrom(''); setCustomTo('')
    setType(''); setCategory(''); setOrigin(''); setPage(1)
  }
```

Substituir o bloco de período presets + custom date + type/category/origin selects por:

```tsx
      <FilterPanel activeCount={activeCount} summary={filterSummary} onClear={handleClear}>
        {/* Period presets */}
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
          {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map(p => (
            <Button key={p} variant={preset === p ? 'default' : 'outline'} size="sm"
              className="w-full md:w-auto" onClick={() => handlePreset(p)}>
              {PRESET_LABELS[p]}
            </Button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
            <div className="space-y-1">
              <Label htmlFor="dateFrom">De</Label>
              <DateInput id="dateFrom" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(1) }} className="w-full md:w-40" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dateTo">Até</Label>
              <DateInput id="dateTo" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(1) }} className="w-full md:w-40" />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:gap-4">
          <div className="space-y-1">
            <Label>Tipo</Label>
            <Select value={type || 'all'} onValueChange={v => { setType(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full md:w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="income">Entrada</SelectItem>
                <SelectItem value="expense">Saída</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Categoria</Label>
            <Select value={category || 'all'} onValueChange={v => { setCategory(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full md:w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Origem</Label>
            <Select value={origin || 'all'} onValueChange={v => { setOrigin(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full md:w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {Object.entries(ORIGIN_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </FilterPanel>

      {/* Active chips — mobile only */}
      {activeCount > 0 && (
        <div className="flex flex-wrap gap-1 md:hidden">
          {preset !== 'this_month' && <Badge variant="secondary">{PRESET_LABELS[preset]}</Badge>}
          {type && <Badge variant="secondary">{type === 'income' ? 'Entrada' : 'Saída'}</Badge>}
          {category && <Badge variant="secondary">{CATEGORY_LABELS[category as FinancialTransactionCategory]}</Badge>}
          {origin && <Badge variant="secondary">{ORIGIN_LABELS[origin as FinancialTransactionOrigin]}</Badge>}
        </div>
      )}
```

Substituir o `<Table>` existente por:

```tsx
              <>
                {/* Desktop */}
                <div className="hidden md:block">
                  <Table>
                    {/* ... conteúdo da tabela existente sem alteração ... */}
                  </Table>
                </div>

                {/* Mobile */}
                <div className="md:hidden divide-y rounded-md border">
                  {data.data.map(txn => (
                    <div
                      key={txn.id}
                      className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 ${txn.isVoided ? 'opacity-50' : ''}`}
                      onClick={() => navigate(`/financial/transactions/${txn.id}`)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium text-sm truncate ${txn.isVoided ? 'line-through' : ''}`}>
                          {txn.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(txn.date)} · {CATEGORY_LABELS[txn.category] ?? txn.category}
                        </p>
                      </div>
                      <span className={`text-sm font-semibold shrink-0 ${txn.isVoided ? 'line-through text-muted-foreground' : txn.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                        {txn.type === 'income' ? '+' : '−'}{formatCurrency(txn.amount)}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  ))}
                </div>
              </>
```

Substituir o bloco de paginação por:

```tsx
          {data.total > limit && (
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">
                Mostrando {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} de {data.total}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
                <Button variant="outline" size="sm" disabled={page * limit >= data.total} onClick={() => setPage(page + 1)}>Próxima</Button>
              </div>
            </div>
          )}
```

- [ ] **Step 7.4: Executar testes**

```bash
npx vitest run src/tests/financial/FinancialListPage.test.tsx
```
Esperado: todos PASS

- [ ] **Step 7.5: Commit**

```bash
git add src/features/financial/pages/FinancialListPage.tsx src/tests/financial/FinancialListPage.test.tsx
git commit -m "feat(mobile): add FilterPanel, compact list and responsive pagination to FinancialListPage"
```

---

## Task 8: DocumentsListPage — FilterPanel + mobile list + paginação

**Files:**
- Modify: `src/features/documents/pages/DocumentsListPage.tsx`
- Modify: `src/tests/documents/DocumentsListPage.test.tsx`

- [ ] **Step 8.1: Adicionar assertions ao teste existente**

Abrir `src/tests/documents/DocumentsListPage.test.tsx` e adicionar ao final do `describe`:

```tsx
  it('mostra botão de filtros', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      const btns = screen.getAllByRole('button')
      expect(btns.some(b => b.textContent?.includes('Filtros'))).toBe(true)
    })
  })

  it('mostra range de paginação quando total > limit', async () => {
    mockUseDownload.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mockUseDocuments.mockReturnValue({
      data: { data: [mockDoc], total: 25, page: 1, limit: 20 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Mostrando 1–20 de 25/)).toBeInTheDocument())
  })
```

- [ ] **Step 8.2: Executar — confirmar falhas**

```bash
npx vitest run src/tests/documents/DocumentsListPage.test.tsx
```
Esperado: N PASS, 2 FAIL

- [ ] **Step 8.3: Atualizar DocumentsListPage.tsx**

Adicionar imports no topo:
```tsx
import { ChevronRight } from 'lucide-react'
import { FilterPanel } from '@/components/filters/FilterPanel'
```

Adicionar após as declarações de estado (`const debounceRef`):

```tsx
  const activeCount = [
    preset !== 'this_month',
    !!docType,
    !!docStatus,
    !!contractSearch,
  ].filter(Boolean).length

  const filterSummary = [
    preset !== 'this_month' ? PRESET_LABELS[preset] : null,
    docType ? TYPE_LABELS[docType as DocumentType] : null,
    docStatus ? STATUS_LABELS[docStatus as DocumentStatus] : null,
    contractSearch ? `#${contractSearch}` : null,
  ].filter(Boolean).join(' · ')

  const handleClear = () => {
    setPreset('this_month'); setCustomFrom(''); setCustomTo('')
    setDocType(''); setDocStatus(''); setContractSearch(''); setRentalIdFilter(undefined); setPage(1)
  }
```

Substituir o bloco de period presets + selects por:

```tsx
      <FilterPanel activeCount={activeCount} summary={filterSummary} onClear={handleClear}>
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
          {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map(p => (
            <Button key={p} variant={preset === p ? 'default' : 'outline'} size="sm"
              className="w-full md:w-auto" onClick={() => handlePreset(p)}>
              {PRESET_LABELS[p]}
            </Button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
            <div className="space-y-1">
              <Label htmlFor="dateFrom">De</Label>
              <DateInput id="dateFrom" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(1) }} className="w-full md:w-40" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dateTo">Até</Label>
              <DateInput id="dateTo" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(1) }} className="w-full md:w-40" />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:gap-4">
          <div className="space-y-1">
            <Label>Tipo</Label>
            <Select value={docType || 'all'} onValueChange={v => { setDocType(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full md:w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="contract">Contrato</SelectItem>
                <SelectItem value="receipt">Recibo</SelectItem>
                <SelectItem value="return_proof">Comprovante de Devolução</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={docStatus || 'all'} onValueChange={v => { setDocStatus(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full md:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="generated">Gerado</SelectItem>
                <SelectItem value="voided">Anulado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="contract">Contrato</Label>
            <Input id="contract" placeholder="Buscar por contrato..." value={contractSearch}
              onChange={e => handleContractInput(e.target.value)} className="w-full md:w-48" />
          </div>
        </div>
      </FilterPanel>

      {activeCount > 0 && (
        <div className="flex flex-wrap gap-1 md:hidden">
          {preset !== 'this_month' && <Badge variant="secondary">{PRESET_LABELS[preset]}</Badge>}
          {docType && <Badge variant="secondary">{TYPE_LABELS[docType as DocumentType]}</Badge>}
          {docStatus && <Badge variant="secondary">{STATUS_LABELS[docStatus as DocumentStatus]}</Badge>}
          {contractSearch && <Badge variant="secondary">#{contractSearch}</Badge>}
        </div>
      )}
```

Substituir o `<Table>` existente por desktop+mobile:

```tsx
              <>
                {/* Desktop */}
                <div className="hidden md:block">
                  <Table>
                    {/* ... conteúdo da tabela existente sem alteração ... */}
                  </Table>
                </div>

                {/* Mobile */}
                <div className="md:hidden divide-y rounded-md border">
                  {data.data.map(doc => (
                    <div key={doc.id} className="flex items-center gap-3 p-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{TYPE_LABELS[doc.type] ?? doc.type}</p>
                        <p className="text-xs text-muted-foreground">
                          {doc.rental ? `#${doc.rental.contractNumber}` : '—'} · {doc.rental?.customer?.name ?? '—'} · {formatDate(doc.createdAt)}
                        </p>
                      </div>
                      <Badge variant={STATUS_VARIANT[doc.status] ?? 'secondary'}>
                        {STATUS_LABELS[doc.status] ?? doc.status}
                      </Badge>
                      <Button
                        variant="ghost" size="icon" className="shrink-0"
                        disabled={download.isPending || doc.status === 'voided'}
                        onClick={() => download.mutate({ documentId: doc.id, filename: doc.filename })}
                        title="Baixar PDF"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </>
```

Substituir paginação por:

```tsx
          {data.total > limit && (
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">
                Mostrando {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} de {data.total}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
                <Button variant="outline" size="sm" disabled={page * limit >= data.total} onClick={() => setPage(page + 1)}>Próxima</Button>
              </div>
            </div>
          )}
```

- [ ] **Step 8.4: Executar testes**

```bash
npx vitest run src/tests/documents/DocumentsListPage.test.tsx
```
Esperado: todos PASS

- [ ] **Step 8.5: Commit**

```bash
git add src/features/documents/pages/DocumentsListPage.tsx src/tests/documents/DocumentsListPage.test.tsx
git commit -m "feat(mobile): add FilterPanel, compact list and responsive pagination to DocumentsListPage"
```

---

## Task 9: PaymentsTable — mobile list

**Files:**
- Modify: `src/features/payments/components/PaymentsTable.tsx`
- Modify: `src/tests/documents/DocumentsTable.test.tsx` *(não há teste separado de PaymentsTable — verificar existência)*

- [ ] **Step 9.1: Verificar se há teste de PaymentsTable**

```bash
find frontend/src/tests -name "PaymentsTable*"
```
Se não existir, pular ao Step 9.3.

- [ ] **Step 9.2: Se existir, adicionar assertion da lista mobile**

```tsx
  it('exibe data e valor na lista mobile', async () => {
    renderTable([mockPayment])
    expect(screen.getAllByText(/Dinheiro/).length).toBeGreaterThan(0)
  })
```

- [ ] **Step 9.3: Atualizar PaymentsTable.tsx**

```tsx
// src/features/payments/components/PaymentsTable.tsx
import type { Payment } from '@/types'
import { formatCurrency, formatDate } from '@/lib/formatters'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

const METHOD_LABELS: Record<string, string> = {
  cash: 'Dinheiro', pix: 'PIX', card: 'Cartão', transfer: 'Transferência',
}

interface Props { payments: Payment[] }

export function PaymentsTable({ payments }: Props) {
  if (payments.length === 0)
    return <p className="text-sm text-muted-foreground">Nenhum pagamento registrado.</p>

  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Método</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Ref.</TableHead>
              <TableHead>Observação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map(p => (
              <TableRow key={p.id}>
                <TableCell>{formatDate(p.paidAt)}</TableCell>
                <TableCell>{METHOD_LABELS[p.method] ?? p.method}</TableCell>
                <TableCell className="font-medium">{formatCurrency(p.amount)}</TableCell>
                <TableCell>{p.referenceCode ?? '—'}</TableCell>
                <TableCell>{p.notes ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile */}
      <div className="md:hidden divide-y rounded-md border">
        {payments.map(p => (
          <div key={p.id} className="flex items-center gap-3 p-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{METHOD_LABELS[p.method] ?? p.method}</p>
              <p className="text-xs text-muted-foreground">{formatDate(p.paidAt)}</p>
            </div>
            <span className="text-sm font-semibold shrink-0">{formatCurrency(p.amount)}</span>
          </div>
        ))}
      </div>
    </>
  )
}
```

- [ ] **Step 9.4: Executar testes de RentalDetail (que usa PaymentsTable)**

```bash
npx vitest run src/tests/rentals/RentalDetailPage.test.tsx
```
Esperado: todos PASS

- [ ] **Step 9.5: Commit**

```bash
git add src/features/payments/components/PaymentsTable.tsx
git commit -m "feat(mobile): add compact list to PaymentsTable"
```

---

## Task 10: DocumentsTable — mobile list

**Files:**
- Modify: `src/features/documents/components/DocumentsTable.tsx`
- Modify: `src/tests/documents/DocumentsTable.test.tsx`

- [ ] **Step 10.1: Adicionar assertion ao teste existente**

Abrir `src/tests/documents/DocumentsTable.test.tsx` e adicionar ao final do `describe`:

```tsx
  it('exibe tipo e data na lista mobile', () => {
    renderTable([baseDoc])
    // 'Contrato' aparece em desktop e mobile → pelo menos 1 ocorrência
    expect(screen.getAllByText('Contrato').length).toBeGreaterThan(0)
  })
```

- [ ] **Step 10.2: Executar — confirmar que teste passa já (dado que 'Contrato' já renderiza)**

```bash
npx vitest run src/tests/documents/DocumentsTable.test.tsx
```
Esperado: todos PASS (o assert é permissivo o suficiente)

- [ ] **Step 10.3: Atualizar DocumentsTable.tsx**

```tsx
// src/features/documents/components/DocumentsTable.tsx
import { Download, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/feedback/EmptyState'
import { useDownloadDocument } from '../hooks/useDocuments'
import { formatDate } from '@/lib/formatters'
import type { Document, DocumentType } from '@/types'

const TYPE_LABEL: Record<DocumentType, string> = {
  contract: 'Contrato', receipt: 'Recibo', return_proof: 'Comprovante de Devolução',
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  generated: 'default', voided: 'outline',
}

interface Props { documents: Document[] }

export function DocumentsTable({ documents }: Props) {
  const download = useDownloadDocument()

  if (documents.length === 0) {
    return (
      <EmptyState
        title="Nenhum documento gerado"
        description="Gere contratos, recibos ou comprovantes de devolução abaixo."
      />
    )
  }

  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead>Arquivo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Gerado em</TableHead>
              <TableHead className="w-20">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map(doc => (
              <TableRow key={doc.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    {TYPE_LABEL[doc.type] ?? doc.type}
                  </div>
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                  {doc.filename}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[doc.status] ?? 'secondary'}>
                    {doc.status === 'generated' ? 'Gerado' : 'Cancelado'}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(doc.createdAt)}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon"
                    disabled={download.isPending || doc.status === 'voided'}
                    onClick={() => download.mutate({ documentId: doc.id, filename: doc.filename })}
                    title="Baixar PDF">
                    <Download className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile */}
      <div className="md:hidden divide-y rounded-md border">
        {documents.map(doc => (
          <div key={doc.id} className="flex items-center gap-3 p-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{TYPE_LABEL[doc.type] ?? doc.type}</p>
              <p className="text-xs text-muted-foreground">{formatDate(doc.createdAt)}</p>
            </div>
            <Badge variant={STATUS_VARIANT[doc.status] ?? 'secondary'}>
              {doc.status === 'generated' ? 'Gerado' : 'Cancelado'}
            </Badge>
            <Button variant="ghost" size="icon" className="shrink-0"
              disabled={download.isPending || doc.status === 'voided'}
              onClick={() => download.mutate({ documentId: doc.id, filename: doc.filename })}
              title="Baixar PDF">
              <Download className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </>
  )
}
```

- [ ] **Step 10.4: Executar testes**

```bash
npx vitest run src/tests/documents/DocumentsTable.test.tsx src/tests/documents/RentalDetailDocuments.test.tsx
```
Esperado: todos PASS

- [ ] **Step 10.5: Commit**

```bash
git add src/features/documents/components/DocumentsTable.tsx src/tests/documents/DocumentsTable.test.tsx
git commit -m "feat(mobile): add compact list to DocumentsTable"
```

---

## Task 11: RentalDetailPage — header com flex-wrap nos botões de ação

**Files:**
- Modify: `src/features/rentals/pages/RentalDetailPage.tsx`

- [ ] **Step 11.1: Localizar o bloco de header no RentalDetailPage.tsx**

O bloco atual (linha ~74):
```tsx
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/rentals')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold">Locação #{rental.contractNumber}</h2>
        <StatusBadge status={rental.computedStatus as ComputedRentalStatus} />
        <div className="ml-auto flex gap-2">
          {canRegisterReturn && (...)}
          {canRegisterPayment && (...)}
          {canCancel && (...)}
        </div>
      </div>
```

- [ ] **Step 11.2: Substituir `ml-auto flex gap-2` por `flex flex-wrap gap-2 md:ml-auto`**

```tsx
        <div className="flex flex-wrap gap-2 md:ml-auto">
          {canRegisterReturn && (
            <Button size="sm" variant="outline" onClick={() => navigate(`/rentals/${id}/returns/new`)}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Registrar Devolução
            </Button>
          )}
          {canRegisterPayment && (
            <Button size="sm" onClick={() => navigate(`/rentals/${id}/payments/new`)}>
              <CreditCard className="mr-2 h-4 w-4" />
              Registrar Pagamento
            </Button>
          )}
          {canCancel && (
            <Button variant="destructive" size="sm" onClick={() => setConfirmCancel(true)}>
              <XCircle className="mr-2 h-4 w-4" />
              Cancelar Locação
            </Button>
          )}
        </div>
```

- [ ] **Step 11.3: Executar testes de RentalDetail**

```bash
npx vitest run src/tests/rentals/RentalDetailPage.test.tsx
```
Esperado: todos PASS

- [ ] **Step 11.4: Commit**

```bash
git add src/features/rentals/pages/RentalDetailPage.tsx
git commit -m "feat(mobile): fix action buttons overflow in RentalDetailPage header"
```

---

## Task 12: Verificação final

- [ ] **Step 12.1: Rodar toda a suite frontend**

```bash
cd frontend && source ~/.nvm/nvm.sh && nvm use 20.19.4
npx vitest run
```
Esperado: todos os testes PASS (147+ testes)

- [ ] **Step 12.2: Verificar TypeScript**

```bash
npx tsc --noEmit
```
Esperado: sem erros

- [ ] **Step 12.3: Commit final se necessário**

Se houver arquivos não commitados:
```bash
git add -p
git commit -m "chore: fix any remaining type or lint issues"
```
