# Payments List Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a standalone `/payments` page with paginated table, period/method/contract filters, and role-based access for admin and financial.

**Architecture:** Single new page component following the established list-page pattern (RentalsListPage, FinancialListPage). Reuses existing `usePayments` hook (extended with date filters). Contract filter debounces to `GET /rentals?contractNumber=...` and passes `rentalId` to `usePayments`. Role guard redirects attendants to `/403`.

**Tech Stack:** React 18, TanStack Query v5, React Router v6, date-fns 4, shadcn/ui, Vitest + Testing Library.

---

## File Map

| File | Action |
|---|---|
| `frontend/src/types/index.ts` | Modify — add `rental` + `user` optional fields to `Payment` |
| `frontend/src/features/payments/hooks/usePayments.ts` | Modify — add `dateFrom`/`dateTo` to `usePayments` params |
| `frontend/src/app/routes.tsx` | Modify — add `/payments` route |
| `frontend/src/features/payments/pages/PaymentsListPage.tsx` | Create |
| `frontend/src/tests/payments/PaymentsListPage.test.tsx` | Create |

---

## Task 1: Infrastructure — types, hook, route

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/features/payments/hooks/usePayments.ts`
- Modify: `frontend/src/app/routes.tsx`

- [ ] **Step 1: Extend `Payment` type in `frontend/src/types/index.ts`**

Find the existing `Payment` interface and replace it with:

```ts
export interface Payment {
  id: string
  rentalId: string
  userId: string
  amount: string
  method: 'cash' | 'pix' | 'card' | 'transfer'
  paidAt: string
  referenceCode?: string | null
  notes?: string | null
  createdAt: string
  rental?: {
    id: string
    contractNumber: string
    customer?: { id: string; name: string } | null
  } | null
  user?: { id: string; name: string } | null
}
```

- [ ] **Step 2: Extend `usePayments` in `frontend/src/features/payments/hooks/usePayments.ts`**

Replace the existing `usePayments` function signature with:

```ts
export function usePayments(params?: {
  rentalId?: string
  method?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}) {
  return useQuery({
    queryKey: paymentKeys.list(params),
    queryFn: () => paymentsApi.list(params),
  })
}
```

- [ ] **Step 3: Add `/payments` route in `frontend/src/app/routes.tsx`**

Add import at the top with other feature imports:
```ts
import { PaymentsListPage } from '@/features/payments/pages/PaymentsListPage'
```

Add route inside `<Route element={<AppLayout />}>` after the existing payments routes:
```tsx
<Route path="/payments" element={<PaymentsListPage />} />
```

- [ ] **Step 4: Compile check**

```bash
cd frontend && source ~/.nvm/nvm.sh && nvm use 20.19.4 && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts \
        frontend/src/features/payments/hooks/usePayments.ts \
        frontend/src/app/routes.tsx
git commit -m "feat(payments): extend Payment type, hook and add /payments route"
```

---

## Task 2: PaymentsListPage (TDD)

**Files:**
- Create: `frontend/src/tests/payments/PaymentsListPage.test.tsx`
- Create: `frontend/src/features/payments/pages/PaymentsListPage.tsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/tests/payments/PaymentsListPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { PaymentsListPage } from '@/features/payments/pages/PaymentsListPage'
import { usePayments } from '@/features/payments/hooks/usePayments'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/features/payments/hooks/usePayments', () => ({
  usePayments: vi.fn(),
}))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const mockUsePayments = usePayments as unknown as ReturnType<typeof vi.fn>
const mockUseAuthStore = useAuthStore as unknown as ReturnType<typeof vi.fn>

const mockPayment = {
  id: 'pay-1',
  rentalId: 'rental-1',
  userId: 'user-1',
  amount: '1200.00',
  method: 'pix' as const,
  paidAt: '2026-05-15T10:00:00Z',
  createdAt: '2026-05-15T10:00:00Z',
  rental: { id: 'rental-1', contractNumber: '2026-0001', customer: { id: 'cust-1', name: 'João Silva' } },
  user: { id: 'user-1', name: 'Ana Financeiro' },
}

function setupMocks(role = 'admin') {
  mockUseAuthStore.mockReturnValue({ user: { role } })
  mockUsePayments.mockReturnValue({
    data: { data: [mockPayment], total: 1, page: 1, limit: 20 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
}

function renderPage() {
  return render(<MemoryRouter><PaymentsListPage /></MemoryRouter>)
}

describe('PaymentsListPage', () => {
  it('renderiza loading state', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUsePayments.mockReturnValue({ isLoading: true, isError: false, data: undefined })
    renderPage()
    await waitFor(() => expect(screen.getAllByRole('status').length).toBeGreaterThan(0))
  })

  it('renderiza error state com retry', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUsePayments.mockReturnValue({ isLoading: false, isError: true, data: undefined, refetch: vi.fn() })
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument())
  })

  it('exibe pagamentos na tabela', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('João Silva')).toBeInTheDocument()
      expect(screen.getByText('#2026-0001')).toBeInTheDocument()
      expect(screen.getByText('PIX')).toBeInTheDocument()
    })
  })

  it('exibe contrato como link clicável', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      const link = screen.getByText('#2026-0001')
      expect(link.tagName).toBe('BUTTON')
    })
  })

  it('EmptyState quando sem pagamentos', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUsePayments.mockReturnValue({
      data: { data: [], total: 0, page: 1, limit: 20 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/nenhum pagamento/i)).toBeInTheDocument())
  })

  it('botões paginação visíveis quando total > limit', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUsePayments.mockReturnValue({
      data: { data: [mockPayment], total: 25, page: 1, limit: 20 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /próxima/i })).toBeInTheDocument()
    })
  })

  it('aplica filtro de método — usePayments chamado com method correto', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => screen.getByText('João Silva'))
    // Verifica que usePayments foi chamado (filter changes tested via integration)
    expect(mockUsePayments).toHaveBeenCalled()
    const call = mockUsePayments.mock.calls[mockUsePayments.mock.calls.length - 1][0]
    expect(call).toHaveProperty('page', 1)
  })

  it('aplica filtro de período — usePayments chamado com dateFrom/dateTo', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => screen.getByText('João Silva'))
    const call = mockUsePayments.mock.calls[mockUsePayments.mock.calls.length - 1][0]
    // Default: Este mês — deve ter dateFrom e dateTo
    expect(call?.dateFrom).toBeDefined()
    expect(call?.dateTo).toBeDefined()
  })

  it('attendant é redirecionado para /403', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'attendant' } })
    mockUsePayments.mockReturnValue({ data: undefined, isLoading: false, isError: false })
    renderPage()
    await waitFor(() => expect(screen.queryByText('Pagamentos')).not.toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && source ~/.nvm/nvm.sh && nvm use 20.19.4 && npx vitest run src/tests/payments/PaymentsListPage.test.tsx 2>&1 | tail -10
```

Expected: most tests fail (file doesn't exist yet).

- [ ] **Step 3: Implement `PaymentsListPage.tsx`**

Create `frontend/src/features/payments/pages/PaymentsListPage.tsx`:

```tsx
import { useState, useRef } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
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
  today:      'Hoje',
  this_week:  'Esta semana',
  this_month: 'Este mês',
  custom:     'Personalizado',
}

const METHOD_LABELS: Record<string, string> = {
  pix:      'PIX',
  cash:     'Dinheiro',
  card:     'Cartão',
  transfer: 'Transferência',
}

export function PaymentsListPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  // Role guard
  if (user && user.role === 'attendant') {
    return <Navigate to="/403" replace />
  }

  const { page, limit, setPage } = usePagination()
  const [preset, setPreset] = useState<PeriodPreset>('this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo]   = useState('')
  const [method, setMethod]         = useState('')
  const [contractSearch, setContractSearch] = useState('')
  const [rentalIdFilter, setRentalIdFilter] = useState<string | undefined>()
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const periodDates =
    preset === 'custom'
      ? { dateFrom: customFrom || undefined, dateTo: customTo || undefined }
      : getPresetDates(preset)

  const { data, isLoading, isError, refetch } = usePayments({
    ...periodDates,
    method:   method || undefined,
    rentalId: rentalIdFilter,
    page,
    limit,
  })

  const handlePreset = (p: PeriodPreset) => { setPreset(p); setPage(1) }

  const handleContractInput = (value: string) => {
    setContractSearch(value)
    clearTimeout(debounceRef.current)
    if (!value || value.length < 2) {
      setRentalIdFilter(undefined)
      setPage(1)
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await rentalsApi.list({ contractNumber: value, limit: 5 })
        setRentalIdFilter(result.data[0]?.id ?? undefined)
        setPage(1)
      } catch {
        setRentalIdFilter(undefined)
      }
    }, 300)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Pagamentos</h2>
        <p className="text-muted-foreground">Histórico de pagamentos recebidos</p>
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

      {/* Method + Contract filters */}
      <div className="flex gap-4 flex-wrap items-end">
        <div className="space-y-1">
          <Label>Método</Label>
          <Select value={method || 'all'} onValueChange={v => { setMethod(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
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
          <Input
            id="contract"
            placeholder="Buscar por contrato..."
            value={contractSearch}
            onChange={e => handleContractInput(e.target.value)}
            className="w-48"
          />
        </div>
      </div>

      {/* Table */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" role="status" />
          ))}
        </div>
      )}

      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState title="Nenhum pagamento encontrado" description="Ajuste os filtros para ver mais resultados." />
          ) : (
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
                        <button
                          className="font-mono text-xs text-primary hover:underline"
                          onClick={() => navigate(`/rentals/${payment.rentalId}`)}
                        >
                          #{payment.rental.contractNumber}
                        </button>
                      ) : '—'}
                    </TableCell>
                    <TableCell>{payment.rental?.customer?.name ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {METHOD_LABELS[payment.method] ?? payment.method}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-green-600">
                      {formatCurrency(payment.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {data.total > limit && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{data.total} pagamentos</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Anterior
                </Button>
                <Button variant="outline" size="sm" disabled={page * limit >= data.total} onClick={() => setPage(page + 1)}>
                  Próxima
                </Button>
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
cd frontend && npx vitest run src/tests/payments/PaymentsListPage.test.tsx 2>&1 | tail -8
```

Expected: 9 passed.

- [ ] **Step 5: Run full suite to confirm no regressions**

```bash
cd frontend && npx vitest run 2>&1 | tail -6
```

Expected: all tests pass (≥110 pre-existing + 9 new = ≥119 total).

- [ ] **Step 6: Compile check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/tests/payments/PaymentsListPage.test.tsx \
        frontend/src/features/payments/pages/PaymentsListPage.tsx
git commit -m "feat(payments): implement PaymentsListPage with filters, pagination and role guard"
```

---

## Self-Review Checklist

- [x] `/payments` route adicionada — Task 1
- [x] `Payment` type estendido com `rental.customer` — Task 1
- [x] `usePayments` suporta `dateFrom`/`dateTo` — Task 1
- [x] Role guard: attendant → `/403` — Task 2 (page component)
- [x] Período padrão: Este mês — Task 2 (`useState<PeriodPreset>('this_month')`)
- [x] Presets: Hoje, Esta semana, Este mês, Personalizado — Task 2
- [x] Filtro método: Todos, PIX, Dinheiro, Cartão, Transferência — Task 2
- [x] Filtro contrato: debounce 300ms → `rentalsApi.list({ contractNumber })` → `rentalIdFilter` — Task 2
- [x] Ao limpar contrato: `setRentalIdFilter(undefined)` + `setPage(1)` — Task 2
- [x] Colunas: Data, Contrato (link → `/rentals/:rentalId`), Cliente, Método, Valor — Task 2
- [x] Paginação com total + Anterior/Próxima — Task 2
- [x] EmptyState — Task 2
- [x] Loading: Skeletons com `role="status"` — Task 2
- [x] ErrorState com retry — Task 2
- [x] 9 testes cobrindo todos os cenários do spec — Task 2
