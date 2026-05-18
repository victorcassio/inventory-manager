# Code Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dividir o bundle inicial da aplicação convertendo 21 imports eager de páginas de feature para `React.lazy()` e adicionando um único `<Suspense>` no `AppLayout` em volta do `<Outlet />`.

**Architecture:** `PageLoader` centralizado como fallback visual. `Suspense` inserido no `AppLayout` preserva sidebar e header visíveis durante carregamento de chunks. Os 21 lazy imports são declarados no topo de `routes.tsx`, fora de qualquer componente. Todas as pages usam named exports, então o padrão é `.then((m) => ({ default: m.NomeDaPage }))`.

**Tech Stack:** React 18 `lazy`/`Suspense`, Vite (gera chunks automático por dynamic import), lucide-react `Loader2`.

---

## Mapa de arquivos

| Arquivo | Ação |
|---|---|
| `frontend/src/components/layout/PageLoader.tsx` | Criar: componente de fallback |
| `frontend/src/components/layout/AppLayout.tsx` | Modificar: adicionar `Suspense` + `PageLoader` em volta do `<Outlet />` |
| `frontend/src/app/routes.tsx` | Modificar: 21 imports eager → `React.lazy()` |

---

## Task 1: Criar PageLoader

**Files:**
- Create: `frontend/src/components/layout/PageLoader.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
// frontend/src/components/layout/PageLoader.tsx
import { Loader2 } from 'lucide-react'

export function PageLoader() {
  return (
    <div className="flex h-full min-h-[400px] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}
```

- [ ] **Step 2: Confirmar TypeScript sem erros**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx tsc --noEmit 2>&1 | head -10
```

Esperado: zero erros.

---

## Task 2: Adicionar Suspense no AppLayout

**Files:**
- Modify: `frontend/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Atualizar AppLayout.tsx**

Substituir o conteúdo completo do arquivo por:

```tsx
import { Suspense, useState } from 'react'
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
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const location = useLocation()
  const title = getPageTitle(location.pathname)

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar — toggled by ☰ button */}
      <div
        className={cn(
          'flex flex-shrink-0 transition-all duration-200',
          sidebarVisible ? 'w-64' : 'w-0 overflow-hidden',
        )}
      >
        <Sidebar />
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

- [ ] **Step 2: Confirmar TypeScript sem erros**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx tsc --noEmit 2>&1 | head -10
```

Esperado: zero erros.

- [ ] **Step 3: Rodar a suite de testes**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx vitest run 2>&1 | tail -8
```

Esperado: 147/147 passando — zero regressões. Se algum teste falhar por Suspense, envolver o render com `<Suspense fallback={null}>` no arquivo de teste afetado.

---

## Task 3: Converter routes.tsx para React.lazy

**Files:**
- Modify: `frontend/src/app/routes.tsx`

- [ ] **Step 1: Substituir o conteúdo completo de routes.tsx**

```tsx
import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import { AuthLayout } from '@/components/layout/AuthLayout'

// ─── Eager (pequenas/sempre necessárias) ──────────────────────────────────────
import { LoginPage }     from '@/pages/LoginPage'
import { NotFoundPage }  from '@/pages/NotFoundPage'
import { ForbiddenPage } from '@/pages/ForbiddenPage'

// ─── Lazy (feature pages — carregadas sob demanda) ───────────────────────────
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
)
const CustomersListPage = lazy(() =>
  import('@/features/customers/pages/CustomersListPage').then((m) => ({ default: m.CustomersListPage }))
)
const CustomerNewPage = lazy(() =>
  import('@/features/customers/pages/CustomerNewPage').then((m) => ({ default: m.CustomerNewPage }))
)
const CustomerDetailPage = lazy(() =>
  import('@/features/customers/pages/CustomerDetailPage').then((m) => ({ default: m.CustomerDetailPage }))
)
const CustomerEditPage = lazy(() =>
  import('@/features/customers/pages/CustomerEditPage').then((m) => ({ default: m.CustomerEditPage }))
)
const ItemsListPage = lazy(() =>
  import('@/features/inventory/pages/ItemsListPage').then((m) => ({ default: m.ItemsListPage }))
)
const ItemNewPage = lazy(() =>
  import('@/features/inventory/pages/ItemNewPage').then((m) => ({ default: m.ItemNewPage }))
)
const ItemDetailPage = lazy(() =>
  import('@/features/inventory/pages/ItemDetailPage').then((m) => ({ default: m.ItemDetailPage }))
)
const CategoriesPage = lazy(() =>
  import('@/features/inventory/pages/CategoriesPage').then((m) => ({ default: m.CategoriesPage }))
)
const RentalsListPage = lazy(() =>
  import('@/features/rentals/pages/RentalsListPage').then((m) => ({ default: m.RentalsListPage }))
)
const RentalNewPage = lazy(() =>
  import('@/features/rentals/pages/RentalNewPage').then((m) => ({ default: m.RentalNewPage }))
)
const RentalDetailPage = lazy(() =>
  import('@/features/rentals/pages/RentalDetailPage').then((m) => ({ default: m.RentalDetailPage }))
)
const CreateReturnPage = lazy(() =>
  import('@/features/returns/pages/CreateReturnPage').then((m) => ({ default: m.CreateReturnPage }))
)
const CreatePaymentPage = lazy(() =>
  import('@/features/payments/pages/CreatePaymentPage').then((m) => ({ default: m.CreatePaymentPage }))
)
const PaymentsListPage = lazy(() =>
  import('@/features/payments/pages/PaymentsListPage').then((m) => ({ default: m.PaymentsListPage }))
)
const FinancialListPage = lazy(() =>
  import('@/features/financial/pages/FinancialListPage').then((m) => ({ default: m.FinancialListPage }))
)
const FinancialNewPage = lazy(() =>
  import('@/features/financial/pages/FinancialNewPage').then((m) => ({ default: m.FinancialNewPage }))
)
const FinancialDetailPage = lazy(() =>
  import('@/features/financial/pages/FinancialDetailPage').then((m) => ({ default: m.FinancialDetailPage }))
)
const FinancialEditPage = lazy(() =>
  import('@/features/financial/pages/FinancialEditPage').then((m) => ({ default: m.FinancialEditPage }))
)
const DocumentsListPage = lazy(() =>
  import('@/features/documents/pages/DocumentsListPage').then((m) => ({ default: m.DocumentsListPage }))
)
const CalendarPage = lazy(() =>
  import('@/features/calendar/pages/CalendarPage').then((m) => ({ default: m.CalendarPage }))
)

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
        </Route>

        {/* Protected routes */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/403" element={<ForbiddenPage />} />
            <Route path="/customers" element={<CustomersListPage />} />
            <Route path="/customers/new" element={<CustomerNewPage />} />
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
            <Route path="/customers/:id/edit" element={<CustomerEditPage />} />
            <Route path="/inventory/items" element={<ItemsListPage />} />
            <Route path="/inventory/items/new" element={<ItemNewPage />} />
            <Route path="/inventory/items/:id" element={<ItemDetailPage />} />
            <Route path="/inventory/categories" element={<CategoriesPage />} />
            <Route path="/rentals" element={<RentalsListPage />} />
            <Route path="/rentals/new" element={<RentalNewPage />} />
            <Route path="/rentals/:id" element={<RentalDetailPage />} />
            <Route path="/rentals/:id/returns/new" element={<CreateReturnPage />} />
            <Route path="/rentals/:id/payments/new" element={<CreatePaymentPage />} />
            <Route path="/payments" element={<PaymentsListPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/documents" element={<DocumentsListPage />} />
            <Route path="/financial" element={<Navigate to="/financial/transactions" replace />} />
            <Route path="/financial/transactions" element={<FinancialListPage />} />
            <Route path="/financial/transactions/new" element={<FinancialNewPage />} />
            <Route path="/financial/transactions/:id" element={<FinancialDetailPage />} />
            <Route path="/financial/transactions/:id/edit" element={<FinancialEditPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
```

**Nota:** O `<Suspense>` está no `AppLayout`, não aqui. Não adicionar `<Suspense>` por rota.

- [ ] **Step 2: Confirmar TypeScript sem erros**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx tsc --noEmit 2>&1 | head -10
```

Esperado: zero erros.

- [ ] **Step 3: Rodar a suite completa de testes**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx vitest run 2>&1 | tail -8
```

Esperado: 147/147 passando. Se algum teste falhar por `React.lazy` + `Suspense`, o erro típico é:

```
Error: A React component suspended while rendering, but no fallback UI was specified.
```

Nesse caso, localizar o arquivo de teste afetado e adicionar `<Suspense fallback={null}>` em volta do `render(...)`:

```tsx
render(
  <Suspense fallback={null}>
    <MemoryRouter><ComponenteLazy /></MemoryRouter>
  </Suspense>
)
```

- [ ] **Step 4: Verificar chunks gerados pelo Vite**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx vite build 2>&1 | grep -E "\.js|chunks|kB" | tail -40
```

Esperado: múltiplos arquivos `.js` separados (chunks por página), em vez de um único bundle monolítico.

- [ ] **Step 5: Commit**

```bash
cd /home/userterras/Documents/inventory-manager
git add \
  frontend/src/components/layout/PageLoader.tsx \
  frontend/src/components/layout/AppLayout.tsx \
  frontend/src/app/routes.tsx
git commit -m "feat(perf): implement code splitting with React.lazy and Suspense"
```

---

## Self-review

### Cobertura do spec

| Requisito | Task |
|---|---|
| `React.lazy()` fora de componentes, no topo de routes.tsx | Task 3 |
| 21 pages lazy, 3 pages + layouts eager | Task 3 |
| Named exports → `.then((m) => ({ default: m.X }))` | Task 3 |
| `<Suspense>` no AppLayout, em volta do `<Outlet />` | Task 2 |
| `PageLoader` com Loader2, min-h-[400px] centralizado | Task 1 |
| `text-muted-foreground` (dark mode via CSS vars) | Task 1 |
| Sidebar e Header ficam visíveis durante carregamento | Task 2 (Suspense dentro de `<main>`) |
| Testes: verificar 147/147 | Tasks 2 e 3 |
| Sem Suspense individual por rota | Task 3 (nota explícita) |
| Sem lazy de hooks/APIs/schemas/componentes | Task 3 (apenas pages) |
| Sem mudança em paths/RBAC/comportamento | Tasks 1–3 |
| Nota futura: ErrorBoundary para chunk failures | Não implementado no MVP (conforme spec) |

### Scan de placeholders

Nenhum "TBD", "TODO" ou "similar à Task N" encontrado. Código completo em todos os steps.

### Consistência de tipos

- `PageLoader` exportado como named export `export function PageLoader()` — importado em `AppLayout.tsx` como `{ PageLoader }`. ✅
- 21 nomes de lazy vars batem exatamente com os nomes das funções exportadas nos arquivos de origem. ✅
- `Suspense` importado de `'react'` em `AppLayout.tsx`. `lazy` importado de `'react'` em `routes.tsx`. ✅
