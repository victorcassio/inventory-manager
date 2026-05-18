# Calendar Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a página `/calendar` com FullCalendar mostrando devoluções previstas de locações ativas, com destaque visual por urgência (semáforo), acessível para admin e attendant.

**Architecture:** Um hook `useCalendarRentals` busca todas as locações ativas (`GET /rentals?status=active&limit=500`). Uma função `getEventUrgency` mapeia `expectedReturn` para status/cor/label. A `CalendarPage` combina os dois, renderiza FullCalendar com views `dayGridMonth` + `listMonth`, legenda de cores e guard de role (financial → /403).

**Tech Stack:** React 18, FullCalendar 6 (`@fullcalendar/react`, `@fullcalendar/daygrid`, `@fullcalendar/list`, `@fullcalendar/core`), TanStack Query 5, shadcn/ui, Vitest + Testing Library.

---

## Mapa de arquivos

| Arquivo | Ação |
|---|---|
| `frontend/package.json` | Modificar: adicionar dependências FullCalendar |
| `frontend/src/lib/permissions.ts` | Modificar: adicionar `calendar.view` |
| `frontend/src/components/layout/Sidebar.tsx` | Modificar: adicionar item "Calendário" |
| `frontend/src/features/calendar/utils/eventUrgency.ts` | Criar: `getEventUrgency()` |
| `frontend/src/features/calendar/hooks/useCalendarRentals.ts` | Criar: hook TanStack Query |
| `frontend/src/features/calendar/pages/CalendarPage.tsx` | Criar: página principal |
| `frontend/src/app/routes.tsx` | Modificar: adicionar rota `/calendar` |
| `frontend/src/tests/calendar/eventUrgency.test.ts` | Criar: unit tests `getEventUrgency` |
| `frontend/src/tests/calendar/CalendarPage.test.tsx` | Criar: testes da página |

---

## Task 1: Instalar FullCalendar + permissions + Sidebar

**Files:**
- Modify: `frontend/package.json` (via npm install)
- Modify: `frontend/src/lib/permissions.ts`
- Modify: `frontend/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Instalar pacotes FullCalendar**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npm install @fullcalendar/react @fullcalendar/daygrid @fullcalendar/list @fullcalendar/core
```

Esperado: pacotes adicionados ao `package.json` e `node_modules` sem erros.

- [ ] **Step 2: Adicionar permissão `calendar` em `frontend/src/lib/permissions.ts`**

Localizar o objeto `PERMISSIONS` e adicionar após `documents`:

```typescript
  calendar: {
    view: ['admin', 'attendant'] as UserRole[],
  },
```

O arquivo completo ficará:

```typescript
import type { UserRole } from '@/types'

export const PERMISSIONS = {
  customers: {
    view: ['admin', 'attendant', 'financial'] as UserRole[],
    manage: ['admin', 'attendant'] as UserRole[],
    delete: ['admin'] as UserRole[],
  },
  inventory: {
    view: ['admin', 'attendant', 'financial'] as UserRole[],
    manage: ['admin'] as UserRole[],
  },
  rentals: {
    view: ['admin', 'attendant', 'financial'] as UserRole[],
    manage: ['admin', 'attendant'] as UserRole[],
    cancel: ['admin'] as UserRole[],
  },
  returns: {
    view: ['admin', 'attendant', 'financial'] as UserRole[],
    manage: ['admin', 'attendant'] as UserRole[],
  },
  payments: {
    view: ['admin', 'attendant', 'financial'] as UserRole[],
    manage: ['admin', 'financial'] as UserRole[],
  },
  financial: {
    view: ['admin', 'financial'] as UserRole[],
    manage: ['admin', 'financial'] as UserRole[],
  },
  documents: {
    view: ['admin', 'attendant', 'financial'] as UserRole[],
    generateContract: ['admin', 'attendant'] as UserRole[],
    generateReceipt: ['admin', 'financial'] as UserRole[],
    generateProof: ['admin', 'attendant'] as UserRole[],
  },
  calendar: {
    view: ['admin', 'attendant'] as UserRole[],
  },
} as const

export function hasPermission(role: UserRole, resource: keyof typeof PERMISSIONS, action: string): boolean {
  const resourcePerms = PERMISSIONS[resource] as Record<string, UserRole[]>
  return resourcePerms[action]?.includes(role) ?? false
}

export function canAccess(role: UserRole, resource: keyof typeof PERMISSIONS): boolean {
  return hasPermission(role, resource, 'view')
}
```

- [ ] **Step 3: Adicionar item "Calendário" ao Sidebar**

Em `frontend/src/components/layout/Sidebar.tsx`, adicionar `Calendar` ao import de `lucide-react` e o item ao array `navItems` após "Locações":

```typescript
import {
  LayoutDashboard,
  Users,
  Package,
  FileText,
  CreditCard,
  TrendingUp,
  RotateCcw,
  LogOut,
  ClipboardList,
  Calendar,
} from 'lucide-react'
```

```typescript
const navItems: NavItem[] = [
  { label: 'Dashboard',    href: '/dashboard',               icon: LayoutDashboard, roles: ['admin', 'attendant', 'financial'] },
  { label: 'Clientes',     href: '/customers',               icon: Users,           roles: ['admin', 'attendant', 'financial'] },
  { label: 'Estoque',      href: '/inventory/items',         icon: Package,         roles: ['admin', 'attendant', 'financial'] },
  { label: 'Locações',     href: '/rentals',                 icon: ClipboardList,   roles: ['admin', 'attendant', 'financial'] },
  { label: 'Calendário',   href: '/calendar',                icon: Calendar,        roles: ['admin', 'attendant'] },
  { label: 'Devoluções',   href: '/rentals?status=returned', icon: RotateCcw,       roles: ['admin', 'attendant'] },
  { label: 'Pagamentos',   href: '/payments',                icon: CreditCard,      roles: ['admin', 'financial'] },
  { label: 'Financeiro',   href: '/financial',               icon: TrendingUp,      roles: ['admin', 'financial'] },
  { label: 'Documentos',   href: '/documents',               icon: FileText,        roles: ['admin', 'attendant', 'financial'] },
]
```

- [ ] **Step 4: Confirmar que os testes existentes continuam passando**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx vitest run 2>&1 | tail -8
```

Esperado: 128/128 passando (19 suites), zero regressões.

- [ ] **Step 5: Commit**

```bash
cd /home/userterras/Documents/inventory-manager
git add frontend/package.json frontend/package-lock.json frontend/src/lib/permissions.ts frontend/src/components/layout/Sidebar.tsx
git commit -m "feat(calendar): install FullCalendar, add calendar permission and sidebar item"
```

---

## Task 2: getEventUrgency utility — TDD

**Files:**
- Create: `frontend/src/features/calendar/utils/eventUrgency.ts`
- Create: `frontend/src/tests/calendar/eventUrgency.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Criar `frontend/src/tests/calendar/eventUrgency.test.ts`:

```typescript
import { getEventUrgency } from '@/features/calendar/utils/eventUrgency'

function dateOffset(days: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

describe('getEventUrgency', () => {
  it('retorna overdue para expectedReturn ontem', () => {
    const result = getEventUrgency(dateOffset(-1))
    expect(result.status).toBe('overdue')
    expect(result.color).toBe('#ef4444')
    expect(result.label).toBe('Atrasado')
  })

  it('retorna overdue para expectedReturn 30 dias atrás', () => {
    const result = getEventUrgency(dateOffset(-30))
    expect(result.status).toBe('overdue')
    expect(result.color).toBe('#ef4444')
  })

  it('retorna today para expectedReturn hoje', () => {
    const result = getEventUrgency(dateOffset(0))
    expect(result.status).toBe('today')
    expect(result.color).toBe('#f97316')
    expect(result.label).toBe('Vence hoje')
  })

  it('retorna soon para expectedReturn amanhã (1 dia)', () => {
    const result = getEventUrgency(dateOffset(1))
    expect(result.status).toBe('soon')
    expect(result.color).toBe('#eab308')
    expect(result.label).toBe('Próximos 1–3 dias')
  })

  it('retorna soon para expectedReturn em 3 dias', () => {
    const result = getEventUrgency(dateOffset(3))
    expect(result.status).toBe('soon')
    expect(result.color).toBe('#eab308')
  })

  it('retorna future para expectedReturn em 4 dias', () => {
    const result = getEventUrgency(dateOffset(4))
    expect(result.status).toBe('future')
    expect(result.color).toBe('#22c55e')
    expect(result.label).toBe('Futuro')
  })

  it('retorna future para expectedReturn em 30 dias', () => {
    const result = getEventUrgency(dateOffset(30))
    expect(result.status).toBe('future')
    expect(result.color).toBe('#22c55e')
  })

  it('aceita datetime string e usa apenas a parte da data', () => {
    const datetime = dateOffset(0) + 'T23:00:00.000Z'
    const result = getEventUrgency(datetime)
    expect(result.status).toBe('today')
  })
})
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx vitest run src/tests/calendar/eventUrgency.test.ts 2>&1 | tail -10
```

Esperado: FAIL — "Cannot find module '@/features/calendar/utils/eventUrgency'"

- [ ] **Step 3: Implementar `getEventUrgency`**

Criar `frontend/src/features/calendar/utils/eventUrgency.ts`:

```typescript
export type EventUrgencyStatus = 'overdue' | 'today' | 'soon' | 'future'

export interface EventUrgency {
  status: EventUrgencyStatus
  label: string
  color: string
}

export function getEventUrgency(expectedReturn: string): EventUrgency {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const returnDate = new Date(expectedReturn.slice(0, 10))
  returnDate.setHours(0, 0, 0, 0)
  const diff = Math.round((returnDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diff < 0)   return { status: 'overdue', label: 'Atrasado',          color: '#ef4444' }
  if (diff === 0) return { status: 'today',   label: 'Vence hoje',         color: '#f97316' }
  if (diff <= 3)  return { status: 'soon',    label: 'Próximos 1–3 dias',  color: '#eab308' }
  return                 { status: 'future',  label: 'Futuro',             color: '#22c55e' }
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx vitest run src/tests/calendar/eventUrgency.test.ts --reporter=verbose 2>&1 | tail -15
```

Esperado: PASS — 8 testes passando.

- [ ] **Step 5: Commit**

```bash
cd /home/userterras/Documents/inventory-manager
git add frontend/src/features/calendar/utils/eventUrgency.ts frontend/src/tests/calendar/eventUrgency.test.ts
git commit -m "feat(calendar): add getEventUrgency utility with unit tests"
```

---

## Task 3: Hook useCalendarRentals

**Files:**
- Create: `frontend/src/features/calendar/hooks/useCalendarRentals.ts`

Não há teste separado para este hook — ele será exercitado pelos testes de integração da `CalendarPage` na Task 5.

- [ ] **Step 1: Criar o hook**

Criar `frontend/src/features/calendar/hooks/useCalendarRentals.ts`:

```typescript
import { useQuery } from '@tanstack/react-query'
import { rentalsApi } from '@/lib/api/rentals.api'

// MVP: busca todas as locações ativas de uma vez (limit=500).
// Evolução futura: substituir por busca por range visível do calendário
// usando startDate/expectedReturnDate via callback datesSet do FullCalendar.
export function useCalendarRentals() {
  return useQuery({
    queryKey: ['calendar', 'rentals'],
    queryFn: () => rentalsApi.list({ status: 'active', limit: 500 }),
  })
}
```

A resposta é `PaginatedResponse<Rental>` com shape `{ data: Rental[], total, page, limit }`.
Os rentals estão em `response.data`, não na raiz do objeto.

---

## Task 4: Testes da CalendarPage — escrever antes da implementação

**Files:**
- Create: `frontend/src/tests/calendar/CalendarPage.test.tsx`

- [ ] **Step 1: Criar o arquivo de testes**

Criar `frontend/src/tests/calendar/CalendarPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { CalendarPage } from '@/features/calendar/pages/CalendarPage'
import { useCalendarRentals } from '@/features/calendar/hooks/useCalendarRentals'
import { useAuthStore } from '@/stores/auth.store'

// Mock FullCalendar — renderiza eventos como botões clicáveis para testes
vi.mock('@fullcalendar/react', () => ({
  default: ({ events, eventClick }: any) => (
    <div data-testid="fullcalendar">
      {(events ?? []).map((event: any) => (
        <button
          key={event.id}
          data-event-id={event.id}
          data-color={event.backgroundColor}
          onClick={() => eventClick?.({ event: { id: event.id } })}
        >
          {event.title}
        </button>
      ))}
    </div>
  ),
}))
vi.mock('@fullcalendar/daygrid', () => ({ default: {} }))
vi.mock('@fullcalendar/list', () => ({ default: {} }))
vi.mock('@fullcalendar/core/locales/pt-br', () => ({ default: {} }))

vi.mock('@/features/calendar/hooks/useCalendarRentals', () => ({
  useCalendarRentals: vi.fn(),
}))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const mockUseCalendarRentals = useCalendarRentals as unknown as ReturnType<typeof vi.fn>
const mockUseAuthStore = useAuthStore as unknown as ReturnType<typeof vi.fn>

const mockRental = {
  id: 'rental-1',
  contractNumber: '2026-0001',
  expectedReturn: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  status: 'active' as const,
  computedStatus: 'active' as const,
  customer: { id: 'cust-1', name: 'João Silva', document: '12345678901' },
  daysOverdue: 0,
}

const mockRentalOverdue = {
  ...mockRental,
  id: 'rental-2',
  contractNumber: '2026-0002',
  expectedReturn: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  computedStatus: 'overdue' as const,
  daysOverdue: 2,
}

function setupMocks(role = 'admin') {
  mockUseAuthStore.mockReturnValue({ user: { role } })
  mockUseCalendarRentals.mockReturnValue({
    data: { data: [mockRental], total: 1, page: 1, limit: 500 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
}

function renderPage() {
  return render(<MemoryRouter><CalendarPage /></MemoryRouter>)
}

describe('CalendarPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
  })

  it('renderiza loading state', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseCalendarRentals.mockReturnValue({ isLoading: true, isError: false, data: undefined })
    renderPage()
    await waitFor(() => expect(screen.getAllByRole('status').length).toBeGreaterThan(0))
  })

  it('renderiza error state com botão retry', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseCalendarRentals.mockReturnValue({ isLoading: false, isError: true, data: undefined, refetch: vi.fn() })
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument())
  })

  it('renderiza empty state quando sem locações ativas', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseCalendarRentals.mockReturnValue({
      data: { data: [], total: 0, page: 1, limit: 500 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/nenhuma locação/i)).toBeInTheDocument())
  })

  it('renderiza título do evento com contractNumber e customer.name', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Contrato 2026-0001 · João Silva')).toBeInTheDocument()
    })
  })

  it('legenda visível com os 4 status', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Atrasado')).toBeInTheDocument()
      expect(screen.getByText('Vence hoje')).toBeInTheDocument()
      expect(screen.getByText('Próximos 1–3 dias')).toBeInTheDocument()
      expect(screen.getByText('Futuro')).toBeInTheDocument()
    })
  })

  it('ao clicar em evento, navega para /rentals/:rentalId', async () => {
    const user = userEvent.setup()
    setupMocks()
    renderPage()
    await waitFor(() => screen.getByText('Contrato 2026-0001 · João Silva'))
    await user.click(screen.getByText('Contrato 2026-0001 · João Silva'))
    expect(mockNavigate).toHaveBeenCalledWith('/rentals/rental-1')
  })

  it('evento futuro (5 dias) recebe cor verde', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => screen.getByText('Contrato 2026-0001 · João Silva'))
    const eventEl = screen.getByText('Contrato 2026-0001 · João Silva')
    expect(eventEl).toHaveAttribute('data-color', '#22c55e')
  })

  it('evento atrasado recebe cor vermelha', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'admin' } })
    mockUseCalendarRentals.mockReturnValue({
      data: { data: [mockRentalOverdue], total: 1, page: 1, limit: 500 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => screen.getByText('Contrato 2026-0002 · João Silva'))
    const eventEl = screen.getByText('Contrato 2026-0002 · João Silva')
    expect(eventEl).toHaveAttribute('data-color', '#ef4444')
  })

  it('admin acessa sem redirect', async () => {
    setupMocks('admin')
    renderPage()
    await waitFor(() => expect(screen.getByText('Calendário')).toBeInTheDocument())
  })

  it('attendant acessa sem redirect', async () => {
    setupMocks('attendant')
    renderPage()
    await waitFor(() => expect(screen.getByText('Calendário')).toBeInTheDocument())
  })

  it('financial é redirecionado para /403', async () => {
    mockUseAuthStore.mockReturnValue({ user: { role: 'financial' } })
    mockUseCalendarRentals.mockReturnValue({ isLoading: false, isError: false, data: undefined })
    renderPage()
    await waitFor(() => expect(screen.queryByText('Calendário')).not.toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx vitest run src/tests/calendar/CalendarPage.test.tsx 2>&1 | tail -10
```

Esperado: FAIL — "Cannot find module '@/features/calendar/pages/CalendarPage'"

---

## Task 5: Implementar CalendarPage + rota

**Files:**
- Create: `frontend/src/features/calendar/pages/CalendarPage.tsx`
- Modify: `frontend/src/app/routes.tsx`

- [ ] **Step 1: Criar a CalendarPage**

Criar `frontend/src/features/calendar/pages/CalendarPage.tsx`:

```tsx
import { Navigate, useNavigate } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import ptBrLocale from '@fullcalendar/core/locales/pt-br'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useCalendarRentals } from '../hooks/useCalendarRentals'
import { useAuthStore } from '@/stores/auth.store'
import { getEventUrgency } from '../utils/eventUrgency'

const LEGEND_ITEMS = [
  { label: 'Atrasado',          color: '#ef4444' },
  { label: 'Vence hoje',        color: '#f97316' },
  { label: 'Próximos 1–3 dias', color: '#eab308' },
  { label: 'Futuro',            color: '#22c55e' },
]

export function CalendarPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  if (user && user.role === 'financial') {
    return <Navigate to="/403" replace />
  }

  const { data, isLoading, isError, refetch } = useCalendarRentals()

  const events = (data?.data ?? []).map(rental => {
    const urgency = getEventUrgency(rental.expectedReturn)
    return {
      id: rental.id,
      title: `Contrato ${rental.contractNumber} · ${rental.customer?.name ?? '—'}`,
      date: rental.expectedReturn.slice(0, 10),
      allDay: true,
      backgroundColor: urgency.color,
      borderColor: urgency.color,
      textColor: '#ffffff',
    }
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Calendário</h2>
        <p className="text-muted-foreground">Devoluções previstas de locações ativas</p>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap gap-4">
        {LEGEND_ITEMS.map(item => (
          <div key={item.label} className="flex items-center gap-2">
            <span
              className="h-3 w-3 flex-shrink-0 rounded-sm"
              style={{ backgroundColor: item.color }}
              aria-hidden="true"
            />
            <span className="text-sm text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Estados */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" role="status" />
          ))}
        </div>
      )}

      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && data && data.data.length === 0 && (
        <EmptyState
          title="Nenhuma locação com devolução prevista"
          description="Não há locações ativas no momento."
        />
      )}

      {!isLoading && !isError && data && data.data.length > 0 && (
        <FullCalendar
          plugins={[dayGridPlugin, listPlugin]}
          initialView="dayGridMonth"
          locale={ptBrLocale}
          firstDay={1}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,listMonth',
          }}
          buttonText={{ today: 'Hoje', month: 'Mês', list: 'Lista' }}
          events={events}
          eventClick={({ event }) => navigate(`/rentals/${event.id}`)}
          eventDisplay="block"
          dayMaxEvents={3}
          height="auto"
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Adicionar a rota `/calendar` em `frontend/src/app/routes.tsx`**

Adicionar o import:

```typescript
import { CalendarPage } from '@/features/calendar/pages/CalendarPage'
```

Adicionar a rota dentro do `<Route element={<AppLayout />}>`, após a rota `/rentals/:id/payments/new`:

```tsx
<Route path="/calendar" element={<CalendarPage />} />
```

- [ ] **Step 3: Rodar os testes da CalendarPage**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx vitest run src/tests/calendar/CalendarPage.test.tsx --reporter=verbose 2>&1 | tail -25
```

Esperado: PASS — 11 testes passando.

- [ ] **Step 4: Confirmar TypeScript sem erros**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx tsc --noEmit 2>&1 | head -20
```

Esperado: zero erros.

- [ ] **Step 5: Rodar a suite completa do frontend**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx vitest run 2>&1 | tail -8
```

Esperado: 128 + 8 (eventUrgency) + 11 (CalendarPage) = 147+ testes passando, zero regressões.

- [ ] **Step 6: Commit final**

```bash
cd /home/userterras/Documents/inventory-manager
git add \
  frontend/src/features/calendar/hooks/useCalendarRentals.ts \
  frontend/src/features/calendar/pages/CalendarPage.tsx \
  frontend/src/app/routes.tsx \
  frontend/src/tests/calendar/CalendarPage.test.tsx
git commit -m "feat(calendar): implement CalendarPage with FullCalendar, urgency colors and role guard"
```

---

## Self-review

### Cobertura do spec

| Requisito | Task |
|---|---|
| Rota `/calendar` | Task 5 |
| Roles admin + attendant, financial → /403 | Task 5 (guard) + Task 4 (testes) |
| GET /rentals?status=active&limit=500 | Task 3 |
| PaginatedResponse — rentals em `data.data` | Task 3 |
| Eventos allDay, YYYY-MM-DD | Task 5 |
| Título: `Contrato XXXX · Nome` | Task 5 |
| Cores semáforo (4 níveis) | Task 2 |
| `getEventUrgency` exportada e testável | Task 2 |
| Click → `/rentals/:id` | Task 5 + Task 4 |
| Views dayGridMonth + listMonth | Task 5 |
| firstDay: 1 (segunda-feira) | Task 5 |
| Locale pt-br | Task 5 |
| Legenda visível (4 items) | Task 5 + Task 4 |
| Loading state (skeletons) | Task 5 + Task 4 |
| Error state com retry | Task 5 + Task 4 |
| Empty state | Task 5 + Task 4 |
| Sidebar item "Calendário" (admin+attendant) | Task 1 |
| `calendar.view` em permissions.ts | Task 1 |
| Nota de evolução limit=500 | Task 3 (comentário) |

### Scan de placeholders

Nenhum "TBD" ou "TODO" encontrado. Todos os steps têm código completo.

### Consistência de tipos

- `getEventUrgency(expectedReturn: string)` definida na Task 2 e usada na Task 5 — assinatura idêntica.
- `useCalendarRentals()` retorna `PaginatedResponse<Rental>` — acessado via `data?.data` na Task 5.
- `mockUseCalendarRentals` nos testes retorna `{ data: { data: [...], total, page, limit } }` — bate com `PaginatedResponse<Rental>`.
- Mock do FullCalendar renderiza `event.backgroundColor` como `data-color` — testes 7 e 8 usam `toHaveAttribute('data-color', ...)` — consistente.
