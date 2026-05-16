# Financial Module Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full Financial Module frontend — 4 pages, 6 hooks, API client, Zod schemas and types — enabling admins and financials to list, create, edit and void financial transactions.

**Architecture:** Feature-first structure under `src/features/financial/`. Two parallel TanStack Query requests per list view: one paginated (table) and one unbounded for client-side summary aggregation (`useFinancialSummary`). All pages protected to `admin` and `financial` roles; `attendant` has no access.

**Tech Stack:** React 18, TypeScript, TanStack Query v5, React Hook Form + Zod, shadcn/ui, Tailwind CSS, date-fns 4, Sonner toasts, Vitest + Testing Library.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/types/index.ts` | Modify | Add `FinancialTransaction`, `FinancialSummary`, enum types |
| `src/lib/api/financial.api.ts` | Create | Axios wrappers for all `/financial/transactions` endpoints |
| `src/features/financial/schemas/financialTransaction.schema.ts` | Create | Zod schemas for create, update, void forms |
| `src/features/financial/hooks/useFinancialTransactions.ts` | Create | Paginated list query + shared `financialKeys` |
| `src/features/financial/hooks/useFinancialSummary.ts` | Create | Unbounded aggregation query, computes totals client-side |
| `src/features/financial/hooks/useFinancialTransaction.ts` | Create | Single transaction detail query |
| `src/features/financial/hooks/useCreateTransaction.ts` | Create | POST mutation |
| `src/features/financial/hooks/useUpdateTransaction.ts` | Create | PATCH mutation |
| `src/features/financial/hooks/useVoidTransaction.ts` | Create | DELETE mutation (void with reason) |
| `src/features/financial/pages/FinancialListPage.tsx` | Create | List with period filter, summary cards and paginated table |
| `src/features/financial/pages/FinancialNewPage.tsx` | Create | Create form with visual type selector and rental autocomplete |
| `src/features/financial/pages/FinancialDetailPage.tsx` | Create | Detail with 3 states (manual active / payment / voided) + void dialog |
| `src/features/financial/pages/FinancialEditPage.tsx` | Create | Edit form with guards for non-editable transactions |
| `src/app/routes.tsx` | Modify | Add financial routes + `/financial` redirect |
| `src/components/layout/AppLayout.tsx` | Modify | Add page title entries for `/financial*` |
| `src/components/layout/Sidebar.tsx` | Modify | Update Financeiro href from `/financial/transactions` to `/financial` |
| `src/tests/financial/FinancialListPage.test.tsx` | Create | List page tests (render, cards, table, permission) |
| `src/tests/financial/FinancialDetailPage.test.tsx` | Create | Detail page tests (3 states, void button visibility) |
| `src/tests/financial/FinancialNewPage.test.tsx` | Create | New page tests (form render, cancel) |

---

## Task 1: Types + API Client

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/lib/api/financial.api.ts`

- [ ] **Step 1: Add types to `src/types/index.ts`**

Append at the end of the file:

```ts
export type FinancialTransactionType = 'income' | 'expense'
export type FinancialTransactionCategory =
  | 'rental_income'
  | 'stock_investment'
  | 'maintenance'
  | 'transport'
  | 'fixed_cost'
  | 'other'
export type FinancialTransactionOrigin = 'manual' | 'payment' | 'adjustment'

export interface FinancialTransaction {
  id: string
  userId: string
  rentalId?: string | null
  paymentId?: string | null
  type: FinancialTransactionType
  category: FinancialTransactionCategory
  origin: FinancialTransactionOrigin
  amount: string
  description: string
  date: string
  isVoided: boolean
  voidedAt?: string | null
  voidedById?: string | null
  voidReason?: string | null
  createdAt: string
  updatedAt: string
  user?: Pick<User, 'id' | 'name' | 'email'>
  rental?: { id: string; contractNumber: string } | null
  payment?: { id: string; amount: string; method: string; paidAt: string } | null
}

export interface FinancialSummary {
  totalIncome: number
  totalExpense: number
  balance: number
  voidedCount: number
}
```

- [ ] **Step 2: Create `src/lib/api/financial.api.ts`**

```ts
import api from './client'
import type { FinancialTransaction, PaginatedResponse } from '@/types'

export interface FinancialListParams {
  page?: number
  limit?: number
  type?: string
  category?: string
  origin?: string
  isVoided?: boolean
  rentalId?: string
  paymentId?: string
  dateFrom?: string
  dateTo?: string
}

export const financialApi = {
  list: (params?: FinancialListParams) =>
    api
      .get<PaginatedResponse<FinancialTransaction>>('/financial/transactions', { params })
      .then(r => r.data),

  getById: (id: string) =>
    api.get<FinancialTransaction>(`/financial/transactions/${id}`).then(r => r.data),

  create: (data: unknown) =>
    api.post<FinancialTransaction>('/financial/transactions', data).then(r => r.data),

  update: (id: string, data: unknown) =>
    api.patch<FinancialTransaction>(`/financial/transactions/${id}`, data).then(r => r.data),

  void: (id: string, reason: string) =>
    api
      .delete(`/financial/transactions/${id}`, { data: { reason } })
      .then(r => r.data),
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && source ~/.nvm/nvm.sh && nvm use 20.19.4 && npx tsc --noEmit
```

Expected: no errors related to the new types.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/lib/api/financial.api.ts
git commit -m "feat(financial): add types and API client"
```

---

## Task 2: Schema + Constants

**Files:**
- Create: `src/features/financial/schemas/financialTransaction.schema.ts`

- [ ] **Step 1: Create the schema file**

```ts
import { z } from 'zod'

export const CATEGORY_LABELS: Record<string, string> = {
  rental_income:    'Receita de Locação',
  stock_investment: 'Investimento em Estoque',
  maintenance:      'Manutenção',
  transport:        'Transporte',
  fixed_cost:       'Custo Fixo',
  other:            'Outro',
}

export const ORIGIN_LABELS: Record<string, string> = {
  manual:     'Manual',
  payment:    'Pagamento',
  adjustment: 'Ajuste',
}

export const TYPE_LABELS: Record<string, string> = {
  income:  'Entrada',
  expense: 'Saída',
}

export const createTransactionSchema = z.object({
  type: z.enum(['income', 'expense'], { required_error: 'Tipo obrigatório' }),
  category: z.enum(
    ['rental_income', 'stock_investment', 'maintenance', 'transport', 'fixed_cost', 'other'],
    { required_error: 'Categoria obrigatória' },
  ),
  amount: z
    .number({ invalid_type_error: 'Valor deve ser um número' })
    .positive('Valor deve ser maior que zero'),
  transactionDate: z.string().date('Data inválida'),
  description: z.string().min(1, 'Descrição obrigatória'),
  rentalId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(''))
    .transform(v => (v === '' ? undefined : v)),
})

export type CreateTransactionFormValues = z.infer<typeof createTransactionSchema>

export const updateTransactionSchema = createTransactionSchema
export type UpdateTransactionFormValues = z.infer<typeof updateTransactionSchema>

export const voidTransactionSchema = z.object({
  reason: z.string().min(1, 'Motivo obrigatório'),
})

export type VoidTransactionFormValues = z.infer<typeof voidTransactionSchema>
```

- [ ] **Step 2: Compile check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/financial/schemas/
git commit -m "feat(financial): add Zod schemas and label constants"
```

---

## Task 3: Hooks

**Files:**
- Create: `src/features/financial/hooks/useFinancialTransactions.ts`
- Create: `src/features/financial/hooks/useFinancialSummary.ts`
- Create: `src/features/financial/hooks/useFinancialTransaction.ts`
- Create: `src/features/financial/hooks/useCreateTransaction.ts`
- Create: `src/features/financial/hooks/useUpdateTransaction.ts`
- Create: `src/features/financial/hooks/useVoidTransaction.ts`

- [ ] **Step 1: Create `useFinancialTransactions.ts`** (also exports shared `financialKeys`)

```ts
import { useQuery } from '@tanstack/react-query'
import { financialApi, type FinancialListParams } from '@/lib/api/financial.api'

export const financialKeys = {
  all:     ['financial'] as const,
  list:    (params?: object) => [...financialKeys.all, 'list', params] as const,
  summary: (params?: object) => [...financialKeys.all, 'summary', params] as const,
  detail:  (id: string)     => [...financialKeys.all, 'detail', id]  as const,
}

export function useFinancialTransactions(params?: FinancialListParams) {
  return useQuery({
    queryKey: financialKeys.list(params),
    queryFn:  () => financialApi.list(params),
  })
}
```

- [ ] **Step 2: Create `useFinancialSummary.ts`**

```ts
import { useQuery } from '@tanstack/react-query'
import { financialApi, type FinancialListParams } from '@/lib/api/financial.api'
import { financialKeys } from './useFinancialTransactions'
import type { FinancialSummary } from '@/types'

const SUMMARY_LIMIT = 10000

type SummaryParams = Omit<FinancialListParams, 'page' | 'limit' | 'isVoided'>

export function useFinancialSummary(params?: SummaryParams): {
  data: FinancialSummary | undefined
  isLoading: boolean
  isError: boolean
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: financialKeys.summary(params),
    queryFn:  () => financialApi.list({ ...params, limit: SUMMARY_LIMIT }),
  })

  if (!data) return { data: undefined, isLoading, isError }

  const transactions = data.data
  const totalIncome  = transactions
    .filter(t => t.type === 'income'  && !t.isVoided)
    .reduce((sum, t) => sum + Number(t.amount), 0)
  const totalExpense = transactions
    .filter(t => t.type === 'expense' && !t.isVoided)
    .reduce((sum, t) => sum + Number(t.amount), 0)
  const voidedCount  = transactions.filter(t => t.isVoided).length

  return {
    data: { totalIncome, totalExpense, balance: totalIncome - totalExpense, voidedCount },
    isLoading,
    isError,
  }
}
```

- [ ] **Step 3: Create `useFinancialTransaction.ts`**

```ts
import { useQuery } from '@tanstack/react-query'
import { financialApi } from '@/lib/api/financial.api'
import { financialKeys } from './useFinancialTransactions'

export function useFinancialTransaction(id: string) {
  return useQuery({
    queryKey: financialKeys.detail(id),
    queryFn:  () => financialApi.getById(id),
    enabled:  !!id,
  })
}
```

- [ ] **Step 4: Create `useCreateTransaction.ts`**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AxiosError } from 'axios'
import { financialApi } from '@/lib/api/financial.api'
import { financialKeys } from './useFinancialTransactions'

export function useCreateTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: financialApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: financialKeys.all })
      toast.success('Lançamento criado com sucesso')
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      const message = error.response?.data?.message ?? 'Erro ao criar lançamento'
      toast.error(message)
    },
  })
}
```

- [ ] **Step 5: Create `useUpdateTransaction.ts`**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AxiosError } from 'axios'
import { financialApi } from '@/lib/api/financial.api'
import { financialKeys } from './useFinancialTransactions'

export function useUpdateTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) =>
      financialApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: financialKeys.all })
      toast.success('Lançamento atualizado com sucesso')
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      const message = error.response?.data?.message ?? 'Erro ao atualizar lançamento'
      toast.error(message)
    },
  })
}
```

- [ ] **Step 6: Create `useVoidTransaction.ts`**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AxiosError } from 'axios'
import { financialApi } from '@/lib/api/financial.api'
import { financialKeys } from './useFinancialTransactions'

export function useVoidTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      financialApi.void(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: financialKeys.all })
      toast.success('Lançamento anulado com sucesso')
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      const message = error.response?.data?.message ?? 'Erro ao anular lançamento'
      toast.error(message)
    },
  })
}
```

- [ ] **Step 7: Compile check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/financial/hooks/
git commit -m "feat(financial): add TanStack Query hooks"
```

---

## Task 4: Routes + Navigation

**Files:**
- Modify: `src/app/routes.tsx`
- Modify: `src/components/layout/AppLayout.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add financial routes to `src/app/routes.tsx`**

Add these imports at the top of the imports block:

```ts
import { FinancialListPage }   from '@/features/financial/pages/FinancialListPage'
import { FinancialNewPage }    from '@/features/financial/pages/FinancialNewPage'
import { FinancialDetailPage } from '@/features/financial/pages/FinancialDetailPage'
import { FinancialEditPage }   from '@/features/financial/pages/FinancialEditPage'
```

Add these routes inside the `<Route element={<AppLayout />}>` block, after the rentals routes:

```tsx
<Route path="/financial" element={<Navigate to="/financial/transactions" replace />} />
<Route path="/financial/transactions" element={<FinancialListPage />} />
<Route path="/financial/transactions/new" element={<FinancialNewPage />} />
<Route path="/financial/transactions/:id" element={<FinancialDetailPage />} />
<Route path="/financial/transactions/:id/edit" element={<FinancialEditPage />} />
```

- [ ] **Step 2: Add page title entries in `src/components/layout/AppLayout.tsx`**

Locate the `PAGE_TITLES` object and add:

```ts
'/financial':                      'Financeiro',
'/financial/transactions':         'Financeiro',
'/financial/transactions/new':     'Novo Lançamento',
```

(Detail and edit pages show the transaction description dynamically — no static entry needed.)

- [ ] **Step 3: Update Sidebar href in `src/components/layout/Sidebar.tsx`**

Find the `navItems` array entry for `Financeiro` and change its `href`:

```ts
// Before:
{ label: 'Financeiro', href: '/financial/transactions', icon: TrendingUp, roles: ['admin', 'financial'] },

// After:
{ label: 'Financeiro', href: '/financial', icon: TrendingUp, roles: ['admin', 'financial'] },
```

- [ ] **Step 4: Create stub pages so the app compiles**

Create each page file with a minimal stub (they'll be replaced in Tasks 5–8):

`src/features/financial/pages/FinancialListPage.tsx`:
```tsx
export function FinancialListPage() { return <div>FinancialListPage</div> }
```

`src/features/financial/pages/FinancialNewPage.tsx`:
```tsx
export function FinancialNewPage() { return <div>FinancialNewPage</div> }
```

`src/features/financial/pages/FinancialDetailPage.tsx`:
```tsx
export function FinancialDetailPage() { return <div>FinancialDetailPage</div> }
```

`src/features/financial/pages/FinancialEditPage.tsx`:
```tsx
export function FinancialEditPage() { return <div>FinancialEditPage</div> }
```

- [ ] **Step 5: Compile check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/routes.tsx \
        frontend/src/components/layout/AppLayout.tsx \
        frontend/src/components/layout/Sidebar.tsx \
        frontend/src/features/financial/pages/
git commit -m "feat(financial): add routes, nav entry and page stubs"
```

---

## Task 5: FinancialListPage

**Files:**
- Create: `src/tests/financial/FinancialListPage.test.tsx`
- Modify: `src/features/financial/pages/FinancialListPage.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/tests/financial/FinancialListPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FinancialListPage } from '@/features/financial/pages/FinancialListPage'
import { useFinancialTransactions } from '@/features/financial/hooks/useFinancialTransactions'
import { useFinancialSummary } from '@/features/financial/hooks/useFinancialSummary'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/features/financial/hooks/useFinancialTransactions', () => ({
  useFinancialTransactions: vi.fn(),
}))
vi.mock('@/features/financial/hooks/useFinancialSummary', () => ({
  useFinancialSummary: vi.fn(),
}))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const mockUseFinancialTransactions = useFinancialTransactions as unknown as ReturnType<typeof vi.fn>
const mockUseFinancialSummary      = useFinancialSummary      as unknown as ReturnType<typeof vi.fn>
const mockUseAuthStore             = useAuthStore             as unknown as ReturnType<typeof vi.fn>

const mockTransaction = {
  id: 'txn-1',
  type: 'income',
  category: 'rental_income',
  origin: 'payment',
  amount: '1200.00',
  description: 'Pagamento contrato 2026-0042',
  date: '2026-05-15',
  isVoided: false,
  userId: 'user-1',
  user: { id: 'user-1', name: 'João', email: 'joao@test.com' },
  rental: { id: 'rental-1', contractNumber: '2026-0042' },
  payment: null,
  createdAt: '2026-05-15T10:00:00Z',
  updatedAt: '2026-05-15T10:00:00Z',
}

function setupMocks(role = 'admin') {
  mockUseAuthStore.mockReturnValue({ user: { role } })
  mockUseFinancialTransactions.mockReturnValue({
    data: { data: [mockTransaction], total: 1, page: 1, limit: 20 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
  mockUseFinancialSummary.mockReturnValue({
    data: { totalIncome: 1200, totalExpense: 350, balance: 850, voidedCount: 2 },
    isLoading: false,
    isError: false,
  })
}

function renderPage() {
  return render(<MemoryRouter><FinancialListPage /></MemoryRouter>)
}

describe('FinancialListPage', () => {
  it('exibe título da página', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getByText('Financeiro')).toBeInTheDocument())
  })

  it('exibe os 4 cards de resumo', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('ENTRADAS')).toBeInTheDocument()
      expect(screen.getByText('SAÍDAS')).toBeInTheDocument()
      expect(screen.getByText('SALDO')).toBeInTheDocument()
      expect(screen.getByText('ANULADOS')).toBeInTheDocument()
    })
  })

  it('exibe transações na tabela', async () => {
    setupMocks()
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('Pagamento contrato 2026-0042')).toBeInTheDocument(),
    )
  })

  it('botão Novo Lançamento visível para admin', async () => {
    setupMocks('admin')
    renderPage()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /novo lançamento/i })).toBeInTheDocument(),
    )
  })

  it('botão Novo Lançamento visível para financial', async () => {
    setupMocks('financial')
    renderPage()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /novo lançamento/i })).toBeInTheDocument(),
    )
  })

  it('exibe badge anulado para transação anulada', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseFinancialTransactions.mockReturnValue({
      data: {
        data: [{ ...mockTransaction, isVoided: true }],
        total: 1, page: 1, limit: 20,
      },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    mockUseFinancialSummary.mockReturnValue({
      data: { totalIncome: 0, totalExpense: 0, balance: 0, voidedCount: 1 },
      isLoading: false, isError: false,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('anulado')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && source ~/.nvm/nvm.sh && nvm use 20.19.4 && npx vitest run src/tests/financial/FinancialListPage.test.tsx
```

Expected: all 6 tests fail (stub page renders `<div>FinancialListPage</div>`).

- [ ] **Step 3: Implement `FinancialListPage.tsx`**

Replace the stub with:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  subMonths, startOfYear, endOfYear,
} from 'date-fns'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useFinancialTransactions } from '../hooks/useFinancialTransactions'
import { useFinancialSummary } from '../hooks/useFinancialSummary'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { usePagination } from '@/hooks/usePagination'
import { PERMISSIONS } from '@/lib/permissions'
import { CATEGORY_LABELS, ORIGIN_LABELS } from '../schemas/financialTransaction.schema'
import type { FinancialTransactionType, FinancialTransactionCategory, FinancialTransactionOrigin } from '@/types'

type PeriodPreset = 'today' | 'this_week' | 'this_month' | 'last_month' | 'this_year' | 'custom'

function getPresetDates(preset: PeriodPreset): { dateFrom: string; dateTo: string } {
  const now  = new Date()
  const fmt  = (d: Date) => format(d, 'yyyy-MM-dd')
  switch (preset) {
    case 'today':      return { dateFrom: fmt(now), dateTo: fmt(now) }
    case 'this_week':  return { dateFrom: fmt(startOfWeek(now, { weekStartsOn: 1 })), dateTo: fmt(endOfWeek(now, { weekStartsOn: 1 })) }
    case 'this_month': return { dateFrom: fmt(startOfMonth(now)), dateTo: fmt(endOfMonth(now)) }
    case 'last_month': { const lm = subMonths(now, 1); return { dateFrom: fmt(startOfMonth(lm)), dateTo: fmt(endOfMonth(lm)) } }
    case 'this_year':  return { dateFrom: fmt(startOfYear(now)), dateTo: fmt(endOfYear(now)) }
    case 'custom':     return { dateFrom: '', dateTo: '' }
  }
}

const PRESET_LABELS: Record<PeriodPreset, string> = {
  today:      'Hoje',
  this_week:  'Esta semana',
  this_month: 'Este mês',
  last_month: 'Mês passado',
  this_year:  'Este ano',
  custom:     'Personalizado',
}

export function FinancialListPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { page, limit, setPage } = usePagination()

  const [preset, setPreset]       = useState<PeriodPreset>('this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')
  const [type,     setType]     = useState('')
  const [category, setCategory] = useState('')
  const [origin,   setOrigin]   = useState('')

  const canManage = user ? PERMISSIONS.financial.manage.includes(user.role) : false

  const periodDates =
    preset === 'custom'
      ? { dateFrom: customFrom || undefined, dateTo: customTo || undefined }
      : getPresetDates(preset)

  const filterParams = {
    ...periodDates,
    ...(type     ? { type:     type     as FinancialTransactionType }     : {}),
    ...(category ? { category: category as FinancialTransactionCategory } : {}),
    ...(origin   ? { origin:   origin   as FinancialTransactionOrigin }   : {}),
  }

  const { data, isLoading, isError, refetch } = useFinancialTransactions({ ...filterParams, page, limit })
  const { data: summary, isLoading: summaryLoading } = useFinancialSummary(filterParams)

  const handlePreset = (p: PeriodPreset) => { setPreset(p); setPage(1) }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Financeiro</h2>
          <p className="text-muted-foreground">Lançamentos financeiros</p>
        </div>
        {canManage && (
          <Button onClick={() => navigate('/financial/transactions/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Lançamento
          </Button>
        )}
      </div>

      {/* Period presets */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map(p => (
          <Button key={p} variant={preset === p ? 'default' : 'outline'} size="sm" onClick={() => handlePreset(p)}>
            {PRESET_LABELS[p]}
          </Button>
        ))}
      </div>

      {/* Custom date range */}
      {preset === 'custom' && (
        <div className="flex gap-4 items-end flex-wrap">
          <div className="space-y-1">
            <Label htmlFor="dateFrom">De</Label>
            <Input id="dateFrom" type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(1) }} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dateTo">Até</Label>
            <Input id="dateTo" type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(1) }} className="w-40" />
          </div>
        </div>
      )}

      {/* Type / Category / Origin filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="space-y-1">
          <Label>Tipo</Label>
          <Select value={type || 'all'} onValueChange={v => { setType(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
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
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
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
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {Object.entries(ORIGIN_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {summaryLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <Card className="border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">ENTRADAS</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-green-600">{formatCurrency(summary?.totalIncome ?? 0)}</p></CardContent>
            </Card>
            <Card className="border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800">
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">SAÍDAS</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-red-600">{formatCurrency(summary?.totalExpense ?? 0)}</p></CardContent>
            </Card>
            <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">SALDO</CardTitle></CardHeader>
              <CardContent>
                <p className={`text-2xl font-bold ${(summary?.balance ?? 0) >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                  {formatCurrency(summary?.balance ?? 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">ANULADOS</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-muted-foreground">{summary?.voidedCount ?? 0}</p>
                <p className="text-xs text-muted-foreground">lançamentos</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Table */}
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
              title="Nenhum lançamento encontrado"
              description="Ajuste os filtros ou crie um novo lançamento."
              action={canManage ? { label: 'Novo Lançamento', onClick: () => navigate('/financial/transactions/new') } : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Locação</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map(txn => (
                  <TableRow
                    key={txn.id}
                    className={`cursor-pointer ${txn.isVoided ? 'opacity-50' : ''}`}
                    onClick={() => navigate(`/financial/transactions/${txn.id}`)}
                  >
                    <TableCell className="text-muted-foreground text-sm">{formatDate(txn.date)}</TableCell>
                    <TableCell className={txn.isVoided ? 'line-through' : ''}>{txn.description}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{CATEGORY_LABELS[txn.category] ?? txn.category}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {ORIGIN_LABELS[txn.origin] ?? txn.origin}
                    </TableCell>
                    <TableCell>
                      {txn.rental ? (
                        <span
                          className="text-primary font-mono text-xs hover:underline"
                          onClick={e => { e.stopPropagation(); navigate(`/rentals/${txn.rentalId}`) }}
                        >
                          #{txn.rental.contractNumber}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold ${
                        txn.isVoided
                          ? 'line-through text-muted-foreground'
                          : txn.type === 'income' ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {txn.type === 'income' ? '+' : '−'}{formatCurrency(txn.amount)}
                    </TableCell>
                    <TableCell>
                      {txn.isVoided ? (
                        <Badge variant="destructive" className="text-xs">anulado</Badge>
                      ) : (
                        <span className="text-muted-foreground">›</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {data.total > limit && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{data.total} lançamentos no período</p>
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

- [ ] **Step 4: Run tests — expect all to pass**

```bash
cd frontend && npx vitest run src/tests/financial/FinancialListPage.test.tsx
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tests/financial/FinancialListPage.test.tsx \
        frontend/src/features/financial/pages/FinancialListPage.tsx
git commit -m "feat(financial): implement FinancialListPage with summary cards and filters"
```

---

## Task 6: FinancialNewPage

**Files:**
- Create: `src/tests/financial/FinancialNewPage.test.tsx`
- Modify: `src/features/financial/pages/FinancialNewPage.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/tests/financial/FinancialNewPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { FinancialNewPage } from '@/features/financial/pages/FinancialNewPage'
import { useCreateTransaction } from '@/features/financial/hooks/useCreateTransaction'

vi.mock('@/features/financial/hooks/useCreateTransaction', () => ({
  useCreateTransaction: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const mockUseCreateTransaction = useCreateTransaction as unknown as ReturnType<typeof vi.fn>

function setupMocks() {
  mockUseCreateTransaction.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ id: 'new-txn-1' }),
    isPending: false,
  })
}

function renderPage() {
  return render(<MemoryRouter><FinancialNewPage /></MemoryRouter>)
}

describe('FinancialNewPage', () => {
  it('exibe título Novo Lançamento', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getByText('Novo Lançamento')).toBeInTheDocument())
  })

  it('exibe seletor de tipo (Entrada / Saída)', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Entrada')).toBeInTheDocument()
      expect(screen.getByText('Saída')).toBeInTheDocument()
    })
  })

  it('exibe campo Descrição', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getByLabelText(/descrição/i)).toBeInTheDocument())
  })

  it('exibe botão Cancelar', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument())
  })

  it('exibe botão Salvar Lançamento', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /salvar lançamento/i })).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/tests/financial/FinancialNewPage.test.tsx
```

Expected: all 5 tests fail.

- [ ] **Step 3: Implement `FinancialNewPage.tsx`**

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { ArrowLeft, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useCreateTransaction } from '../hooks/useCreateTransaction'
import {
  createTransactionSchema,
  type CreateTransactionFormValues,
  CATEGORY_LABELS,
} from '../schemas/financialTransaction.schema'
import { rentalsApi } from '@/lib/api/rentals.api'
import type { Rental } from '@/types'

export function FinancialNewPage() {
  const navigate = useNavigate()
  const createTransaction = useCreateTransaction()

  const [rentalSearch,  setRentalSearch]  = useState('')
  const [rentalResults, setRentalResults] = useState<Pick<Rental, 'id' | 'contractNumber'>[]>([])
  const [selectedRental, setSelectedRental] = useState<Pick<Rental, 'id' | 'contractNumber'> | null>(null)
  const [showResults, setShowResults] = useState(false)

  const form = useForm<CreateTransactionFormValues>({
    resolver: zodResolver(createTransactionSchema),
    defaultValues: {
      type: 'income',
      category: 'rental_income',
      amount: 0,
      transactionDate: format(new Date(), 'yyyy-MM-dd'),
      description: '',
      rentalId: undefined,
    },
  })

  const handleRentalSearch = async (value: string) => {
    setRentalSearch(value)
    setSelectedRental(null)
    form.setValue('rentalId', undefined)
    if (value.length < 2) { setRentalResults([]); setShowResults(false); return }
    try {
      const result = await rentalsApi.list({ contractNumber: value, limit: 5 })
      setRentalResults(result.data.map(r => ({ id: r.id, contractNumber: r.contractNumber })))
      setShowResults(true)
    } catch {
      setRentalResults([])
    }
  }

  const handleRentalSelect = (rental: Pick<Rental, 'id' | 'contractNumber'>) => {
    setSelectedRental(rental)
    setRentalSearch(rental.contractNumber)
    form.setValue('rentalId', rental.id)
    setShowResults(false)
  }

  const onSubmit = async (values: CreateTransactionFormValues) => {
    const payload = { ...values, transactionDate: values.transactionDate }
    const result = await createTransaction.mutateAsync(payload)
    navigate(`/financial/transactions/${(result as { id: string }).id}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/financial/transactions')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold">Novo Lançamento</h2>
      </div>

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>Dados do Lançamento</CardTitle></CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              {/* Type selector */}
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo *</FormLabel>
                    <div className="grid grid-cols-2 gap-3">
                      {(['income', 'expense'] as const).map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => field.onChange(t)}
                          className={cn(
                            'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                            field.value === t
                              ? t === 'income'
                                ? 'border-green-500 bg-green-50 dark:bg-green-950'
                                : 'border-red-500 bg-red-50 dark:bg-red-950'
                              : 'border-border hover:bg-muted',
                          )}
                        >
                          <span
                            className={cn(
                              'h-3 w-3 rounded-full border-2',
                              field.value === t
                                ? t === 'income' ? 'bg-green-500 border-green-500' : 'bg-red-500 border-red-500'
                                : 'border-muted-foreground',
                            )}
                          />
                          <div>
                            <p className={cn('font-semibold text-sm', field.value === t
                              ? t === 'income' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                              : 'text-muted-foreground')}>
                              {t === 'income' ? 'Entrada' : 'Saída'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t === 'income' ? 'Receita / income' : 'Despesa / expense'}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Category */}
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoria *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                          <SelectItem key={k} value={k}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Amount + Date */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor (R$) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder="0,00"
                          {...field}
                          onChange={e => field.onChange(e.target.valueAsNumber)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="transactionDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Data do lançamento *</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="description">Descrição *</FormLabel>
                    <FormControl>
                      <Input id="description" placeholder="Ex: Manutenção preventiva andaimes lote B" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Rental autocomplete */}
              <div className="space-y-1">
                <label className="text-sm font-medium leading-none">
                  Locação relacionada{' '}
                  <span className="text-muted-foreground font-normal">(opcional)</span>
                </label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Buscar por contrato ou cliente..."
                    value={rentalSearch}
                    onChange={e => handleRentalSearch(e.target.value)}
                    onBlur={() => setTimeout(() => setShowResults(false), 150)}
                  />
                  {showResults && rentalResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-md">
                      {rentalResults.map(r => (
                        <button
                          key={r.id}
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                          onMouseDown={() => handleRentalSelect(r)}
                        >
                          Contrato #{r.contractNumber}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Use apenas quando este lançamento estiver ligado a uma locação existente.
                </p>
                {selectedRental && (
                  <p className="text-xs text-green-600">
                    ✓ Vinculado ao contrato #{selectedRental.contractNumber}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 border-t pt-4">
                <Button type="button" variant="outline" onClick={() => navigate('/financial/transactions')}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createTransaction.isPending}>
                  {createTransaction.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar Lançamento
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
cd frontend && npx vitest run src/tests/financial/FinancialNewPage.test.tsx
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tests/financial/FinancialNewPage.test.tsx \
        frontend/src/features/financial/pages/FinancialNewPage.tsx
git commit -m "feat(financial): implement FinancialNewPage with visual type selector and rental autocomplete"
```

---

## Task 7: FinancialDetailPage

**Files:**
- Create: `src/tests/financial/FinancialDetailPage.test.tsx`
- Modify: `src/features/financial/pages/FinancialDetailPage.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/tests/financial/FinancialDetailPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FinancialDetailPage } from '@/features/financial/pages/FinancialDetailPage'
import { useFinancialTransaction } from '@/features/financial/hooks/useFinancialTransaction'
import { useVoidTransaction } from '@/features/financial/hooks/useVoidTransaction'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/features/financial/hooks/useFinancialTransaction', () => ({
  useFinancialTransaction: vi.fn(),
}))
vi.mock('@/features/financial/hooks/useVoidTransaction', () => ({
  useVoidTransaction: vi.fn(),
}))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useParams: () => ({ id: 'txn-1' }), useNavigate: () => vi.fn() }
})

const mockUseFinancialTransaction = useFinancialTransaction as unknown as ReturnType<typeof vi.fn>
const mockUseVoidTransaction      = useVoidTransaction      as unknown as ReturnType<typeof vi.fn>
const mockUseAuthStore            = useAuthStore            as unknown as ReturnType<typeof vi.fn>

const baseTxn = {
  id: 'txn-1',
  type: 'expense',
  category: 'maintenance',
  origin: 'manual',
  amount: '350.00',
  description: 'Manutenção andaimes lote A',
  date: '2026-05-14',
  isVoided: false,
  userId: 'user-1',
  user: { id: 'user-1', name: 'João Silva', email: 'joao@test.com' },
  rental: null,
  payment: null,
  createdAt: '2026-05-14T09:00:00Z',
  updatedAt: '2026-05-14T09:00:00Z',
}

function setupMocks(role = 'admin', txnOverride = {}) {
  mockUseAuthStore.mockReturnValue({ user: { role } })
  mockUseFinancialTransaction.mockReturnValue({
    data: { ...baseTxn, ...txnOverride },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
  mockUseVoidTransaction.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
}

function renderPage() {
  return render(<MemoryRouter><FinancialDetailPage /></MemoryRouter>)
}

describe('FinancialDetailPage', () => {
  it('exibe a descrição do lançamento', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getByText('Manutenção andaimes lote A')).toBeInTheDocument())
  })

  it('admin vê botão Editar em lançamento manual ativo', async () => {
    setupMocks('admin')
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /editar/i })).toBeInTheDocument())
  })

  it('admin vê botão Anular em lançamento manual ativo', async () => {
    setupMocks('admin')
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /anular/i })).toBeInTheDocument())
  })

  it('financial vê botão Editar mas NÃO vê Anular', async () => {
    setupMocks('financial')
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /editar/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /anular/i })).not.toBeInTheDocument()
    })
  })

  it('oculta Editar e Anular quando origin = payment', async () => {
    setupMocks('admin', { origin: 'payment' })
    renderPage()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /editar/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /anular/i })).not.toBeInTheDocument()
      expect(screen.getByText(/somente leitura/i)).toBeInTheDocument()
    })
  })

  it('exibe banner de anulação quando isVoided = true', async () => {
    setupMocks('admin', {
      isVoided: true,
      voidReason: 'Lançamento duplicado',
      voidedAt: '2026-05-13T14:00:00Z',
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/lançamento anulado/i)).toBeInTheDocument()
      expect(screen.getByText('Lançamento duplicado')).toBeInTheDocument()
    })
  })

  it('exibe link para locação quando rentalId presente', async () => {
    setupMocks('admin', {
      rentalId: 'rental-1',
      rental: { id: 'rental-1', contractNumber: '2026-0042' },
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/2026-0042/)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/tests/financial/FinancialDetailPage.test.tsx
```

Expected: all 7 tests fail.

- [ ] **Step 3: Implement `FinancialDetailPage.tsx`**

```tsx
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, Edit, Ban, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useFinancialTransaction } from '../hooks/useFinancialTransaction'
import { useVoidTransaction } from '../hooks/useVoidTransaction'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency, formatDate } from '@/lib/formatters'
import {
  CATEGORY_LABELS, ORIGIN_LABELS, TYPE_LABELS,
  voidTransactionSchema, type VoidTransactionFormValues,
} from '../schemas/financialTransaction.schema'

export function FinancialDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { data: txn, isLoading, isError, refetch } = useFinancialTransaction(id!)
  const voidTransaction = useVoidTransaction()
  const [voidOpen, setVoidOpen] = useState(false)

  const voidForm = useForm<VoidTransactionFormValues>({
    resolver: zodResolver(voidTransactionSchema),
    defaultValues: { reason: '' },
  })

  const handleVoid = async (values: VoidTransactionFormValues) => {
    await voidTransaction.mutateAsync({ id: id!, reason: values.reason })
    setVoidOpen(false)
    voidForm.reset()
    refetch()
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full max-w-2xl" />
      </div>
    )
  }

  if (isError || !txn) return <ErrorState onRetry={() => refetch()} />

  const isManual       = txn.origin === 'manual'
  const isActive       = !txn.isVoided
  const canEdit        = isManual && isActive && (user?.role === 'admin' || user?.role === 'financial')
  const canVoid        = isManual && isActive && user?.role === 'admin'
  const isReadOnly     = txn.origin !== 'manual'

  return (
    <div className="space-y-6">
      {/* Breadcrumb + actions */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/financial/transactions')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold flex-1">{txn.description}</h2>
        {isReadOnly && (
          <Badge variant="secondary">somente leitura</Badge>
        )}
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => navigate(`/financial/transactions/${id}/edit`)}>
            <Edit className="mr-2 h-4 w-4" />
            Editar
          </Button>
        )}
        {canVoid && (
          <Button variant="outline" size="sm" className="text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground" onClick={() => setVoidOpen(true)}>
            <Ban className="mr-2 h-4 w-4" />
            Anular
          </Button>
        )}
      </div>

      {/* Badges */}
      <div className="flex gap-2 flex-wrap">
        <Badge variant="outline">{CATEGORY_LABELS[txn.category] ?? txn.category}</Badge>
        <Badge variant="outline">{ORIGIN_LABELS[txn.origin] ?? txn.origin}</Badge>
        <Badge variant={txn.type === 'income' ? 'default' : 'destructive'}>
          {txn.type === 'income' ? '+' : '−'} {TYPE_LABELS[txn.type]}
        </Badge>
      </div>

      {/* Voided banner */}
      {txn.isVoided && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="font-semibold text-destructive">Lançamento anulado</p>
          {txn.voidReason && <p className="text-sm text-muted-foreground mt-1">Motivo: {txn.voidReason}</p>}
          {txn.voidedAt && (
            <p className="text-xs text-muted-foreground mt-1">
              Anulado em {formatDate(txn.voidedAt)}
            </p>
          )}
        </div>
      )}

      {/* Valor destacado */}
      <Card className={txn.type === 'income' ? 'border-green-200 bg-green-50 dark:bg-green-950' : 'border-red-200 bg-red-50 dark:bg-red-950'}>
        <CardContent className="py-6 text-center">
          <p className="text-sm text-muted-foreground mb-1">Valor</p>
          <p className={`text-4xl font-bold ${txn.isVoided ? 'line-through text-muted-foreground' : txn.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
            {txn.type === 'income' ? '+' : '−'}{formatCurrency(txn.amount)}
          </p>
        </CardContent>
      </Card>

      {/* Detail fields */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 gap-y-4 gap-x-8 max-w-xl">
            <div>
              <p className="text-xs text-muted-foreground mb-1">DATA</p>
              <p className="font-medium">{formatDate(txn.date)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">ORIGEM</p>
              <p className="font-medium">{ORIGIN_LABELS[txn.origin] ?? txn.origin}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">CRIADO POR</p>
              <p className="font-medium">{txn.user?.name ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">CRIADO EM</p>
              <p className="font-medium">{formatDate(txn.createdAt)}</p>
            </div>
          </div>

          <Separator className="my-4" />

          {/* Related rental */}
          <div className="mb-3">
            <p className="text-xs text-muted-foreground mb-1">LOCAÇÃO RELACIONADA</p>
            {txn.rental ? (
              <button
                className="text-primary font-mono text-sm hover:underline"
                onClick={() => navigate(`/rentals/${txn.rentalId}`)}
              >
                Contrato #{txn.rental.contractNumber} →
              </button>
            ) : (
              <p className="text-muted-foreground">—</p>
            )}
          </div>

          {/* Related payment */}
          {txn.paymentId && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">PAGAMENTO RELACIONADO</p>
              <button
                className="text-primary text-sm hover:underline"
                onClick={() => navigate(`/rentals/${txn.rentalId}`)}
              >
                Ver pagamento na locação →
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Void dialog */}
      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular lançamento</DialogTitle>
          </DialogHeader>
          <Form {...voidForm}>
            <form onSubmit={voidForm.handleSubmit(handleVoid)} className="space-y-4">
              <FormField
                control={voidForm.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Motivo da anulação *</FormLabel>
                    <FormControl>
                      <Input placeholder="Descreva o motivo da anulação" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setVoidOpen(false); voidForm.reset() }}>
                  Cancelar
                </Button>
                <Button type="submit" variant="destructive" disabled={voidTransaction.isPending}>
                  {voidTransaction.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirmar Anulação
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
cd frontend && npx vitest run src/tests/financial/FinancialDetailPage.test.tsx
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tests/financial/FinancialDetailPage.test.tsx \
        frontend/src/features/financial/pages/FinancialDetailPage.tsx
git commit -m "feat(financial): implement FinancialDetailPage with 3 states and void dialog"
```

---

## Task 8: FinancialEditPage

**Files:**
- Modify: `src/features/financial/pages/FinancialEditPage.tsx`

No dedicated test file — guards and form are covered by the component logic; the pattern is identical to FinancialNewPage (already tested).

- [ ] **Step 1: Implement `FinancialEditPage.tsx`**

```tsx
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { cn } from '@/lib/utils'
import { useFinancialTransaction } from '../hooks/useFinancialTransaction'
import { useUpdateTransaction } from '../hooks/useUpdateTransaction'
import {
  updateTransactionSchema,
  type UpdateTransactionFormValues,
  CATEGORY_LABELS,
} from '../schemas/financialTransaction.schema'

export function FinancialEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: txn, isLoading, isError, refetch } = useFinancialTransaction(id!)
  const updateTransaction = useUpdateTransaction()

  const form = useForm<UpdateTransactionFormValues>({
    resolver: zodResolver(updateTransactionSchema),
    defaultValues: {
      type: 'income',
      category: 'rental_income',
      amount: 0,
      transactionDate: format(new Date(), 'yyyy-MM-dd'),
      description: '',
      rentalId: undefined,
    },
  })

  useEffect(() => {
    if (!txn) return
    form.reset({
      type:            txn.type,
      category:        txn.category,
      amount:          Number(txn.amount),
      transactionDate: txn.date,
      description:     txn.description,
      rentalId:        txn.rentalId ?? undefined,
    })
  }, [txn, form])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-96 w-full max-w-2xl" />
      </div>
    )
  }

  if (isError || !txn) return <ErrorState onRetry={() => refetch()} />

  // Guards: block non-editable transactions
  if (txn.origin !== 'manual') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/financial/transactions/${id}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-2xl font-bold">Editar Lançamento</h2>
        </div>
        <Card className="max-w-2xl">
          <CardContent className="py-8 text-center text-muted-foreground">
            <p>Este lançamento foi gerado automaticamente e não pode ser editado diretamente.</p>
            <Button className="mt-4" variant="outline" onClick={() => navigate(`/financial/transactions/${id}`)}>
              Voltar ao Detalhe
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (txn.isVoided) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/financial/transactions/${id}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-2xl font-bold">Editar Lançamento</h2>
        </div>
        <Card className="max-w-2xl">
          <CardContent className="py-8 text-center text-muted-foreground">
            <p>Este lançamento está anulado e não pode ser editado.</p>
            <Button className="mt-4" variant="outline" onClick={() => navigate(`/financial/transactions/${id}`)}>
              Voltar ao Detalhe
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const onSubmit = async (values: UpdateTransactionFormValues) => {
    await updateTransaction.mutateAsync({ id: id!, data: values })
    navigate(`/financial/transactions/${id}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/financial/transactions/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold">Editar Lançamento</h2>
      </div>

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>Dados do Lançamento</CardTitle></CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              {/* Type selector */}
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo *</FormLabel>
                    <div className="grid grid-cols-2 gap-3">
                      {(['income', 'expense'] as const).map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => field.onChange(t)}
                          className={cn(
                            'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                            field.value === t
                              ? t === 'income'
                                ? 'border-green-500 bg-green-50 dark:bg-green-950'
                                : 'border-red-500 bg-red-50 dark:bg-red-950'
                              : 'border-border hover:bg-muted',
                          )}
                        >
                          <span className={cn(
                            'h-3 w-3 rounded-full border-2',
                            field.value === t
                              ? t === 'income' ? 'bg-green-500 border-green-500' : 'bg-red-500 border-red-500'
                              : 'border-muted-foreground',
                          )} />
                          <div>
                            <p className={cn('font-semibold text-sm', field.value === t
                              ? t === 'income' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                              : 'text-muted-foreground')}>
                              {t === 'income' ? 'Entrada' : 'Saída'}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Category */}
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoria *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                          <SelectItem key={k} value={k}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Amount + Date */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor (R$) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          {...field}
                          onChange={e => field.onChange(e.target.valueAsNumber)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="transactionDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Data do lançamento *</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Origin (read-only) */}
              <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                Origem: <strong>manual</strong> — não editável
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 border-t pt-4">
                <Button type="button" variant="outline" onClick={() => navigate(`/financial/transactions/${id}`)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={updateTransaction.isPending}>
                  {updateTransaction.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar Alterações
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Run all tests to confirm nothing regressed**

```bash
cd frontend && source ~/.nvm/nvm.sh && nvm use 20.19.4 && npx vitest run
```

Expected: all tests pass (including the 81 pre-existing ones).

- [ ] **Step 3: Compile check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/financial/pages/FinancialEditPage.tsx
git commit -m "feat(financial): implement FinancialEditPage with guards and pre-filled form"
```

---

## Self-Review Checklist

After all tasks, verify against the spec:

- [ ] `/financial` redirects to `/financial/transactions` ✓ (Task 4)
- [ ] Cards use `useFinancialSummary` with second unbounded request ✓ (Task 3 + 5)
- [ ] `origin=payment` → read-only badge, no Editar/Anular ✓ (Task 7)
- [ ] `isVoided=true` → banner, no Editar/Anular ✓ (Task 7)
- [ ] Anular: only admin, requires reason, calls `DELETE` with body ✓ (Task 7)
- [ ] Edit guards: blocks `origin !== manual` and `isVoided` ✓ (Task 8)
- [ ] `origin` not editable in form, shown as read-only ✓ (Task 8)
- [ ] `amount` always positive, `type` defines direction ✓ (Tasks 2, 6, 8)
- [ ] Sidebar shows Financeiro only for admin and financial ✓ (Task 4, existing)
- [ ] Attendant cannot access any `/financial/*` route ✓ (Sidebar filtered, no explicit guard needed — backend rejects at API level)
- [ ] On void success: invalidate all financial queries ✓ (Task 3, `financialKeys.all`)
- [ ] On update success: invalidate all financial queries ✓ (Task 3, `financialKeys.all`)
- [ ] `rentalId` link → `/rentals/:rentalId` ✓ (Task 7)
- [ ] `paymentId` → link to rental page ✓ (Task 7)
- [ ] Default period filter: Este mês ✓ (Task 5)
- [ ] All 5 period presets + custom datepicker ✓ (Task 5)
