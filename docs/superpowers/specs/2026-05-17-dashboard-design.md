# Dashboard Avançado — Design Spec

**Data:** 2026-05-17
**Status:** Aprovado
**Escopo:** Backend (novo DashboardModule) + Frontend (substituir placeholder + Recharts)

---

## Contexto

O `DashboardPage` atual exibe zeros estáticos. Este spec descreve o dashboard avançado com KPIs reais, gráficos Recharts e listas de eventos recentes para um sistema de aluguel de equipamentos.

---

## Backend — `GET /dashboard/summary`

### Novo módulo

```
backend/src/modules/dashboard/
  dashboard.module.ts
  dashboard.controller.ts
  dashboard.service.ts
```

Registrar em `AppModule`.

### Roles

`admin`, `financial`, `attendant` — todos acessam. O que retorna varia conforme a role (ver campo `permissions`).

### Estrutura completa da resposta

```ts
{
  period: {
    currentMonth: string        // "2026-05"
    historyMonths: number       // 6
    startDate: string           // "2025-12-01" (6 meses atrás, 1º dia)
    endDate: string             // "2026-05-31" (último dia do mês atual)
  }

  permissions: {
    canViewFinancial: boolean      // admin, financial — seção financeira e gráficos de receita
    canViewOperational: boolean    // admin, attendant, financial — seções de locações e estoque (cards)
    canViewInventory: boolean      // admin, attendant, financial — seção de estoque (cards)
    canViewOperationalCharts: boolean // admin, attendant — gráficos operacionais (RentalStatusPie, InventoryOccupancyBar)
  }

  financial: {                  // null se !canViewFinancial
    totalIncome: number         // soma income && !isVoided no mês atual
    totalExpense: number        // soma expense && !isVoided no mês atual
    balance: number             // totalIncome - totalExpense
    recentPayments: {
      id: string
      rentalId: string
      contractNumber: string
      customerName: string
      amount: number
      method: string            // 'cash' | 'pix' | 'card' | 'transfer'
      paidAt: string
    }[]                         // últimos 5 pagamentos
  } | null

  rentals: {                    // sempre retornado
    active: number              // status=active e expectedReturn >= hoje
    overdue: number             // status=active e expectedReturn < hoje
    returned: number            // status=returned
    canceled: number            // status=canceled
    byStatus: {
      active: number
      overdue: number
      returned: number
      canceled: number
    }
    upcomingReturns: {          // expectedReturn entre hoje e +7 dias, status=active
      id: string
      contractNumber: string
      customerName: string
      expectedReturn: string
    }[]
    overdueReturns: {           // status=active e expectedReturn < hoje
      id: string
      contractNumber: string
      customerName: string
      expectedReturn: string
      daysOverdue: number
    }[]
  }

  inventory: {                  // sempre retornado
    totalItems: number          // soma de totalQty de todos os itens ativos
    availableItems: number      // soma de availableQty
    rentedItems: number         // soma de rentedQty
    maintenanceItems: number    // soma de maintenanceQty
    occupancyRate: number       // rentedItems / totalItems * 100 (0 se totalItems=0)
  }

  monthlyHistory: {             // exatamente 6 entradas, mesmo sem dados
    month: string               // "2026-01"
    income: number              // soma income !isVoided no mês
    expense: number             // soma expense !isVoided no mês
    balance: number             // income - expense
    cumulativeIncome: number    // acumulado de income desde o primeiro mês do histórico
  }[]
}
```

### Regras de negócio

- `overdue` = `status=active` AND `expectedReturn < today` (computed, não persistido)
- `active` = `status=active` AND `expectedReturn >= today`
- Totais financeiros: sempre ignorar `isVoided=true`
- `recentPayments`: busca direto de `Payment`, não de `FinancialTransaction`
- `upcomingReturns`: `expectedReturn` entre hoje (inclusive) e hoje+7 dias, `status=active`
- `overdueReturns`: `status=active` AND `expectedReturn < today`
- `occupancyRate`: se `totalItems=0`, retornar 0
- `monthlyHistory`: 6 entradas fixas (mês atual + 5 anteriores); meses sem dados → income=0, expense=0, balance=0
- `cumulativeIncome`: acumulado crescente de income ao longo dos 6 meses
- `permissions`: calculado a partir da role do usuário logado
  - `canViewFinancial`: admin, financial
  - `canViewOperational`: admin, attendant, financial (financial vê locações como contexto)
  - `canViewInventory`: admin, attendant, financial (financial vê estoque como contexto)
  - `canViewOperationalCharts`: admin, attendant (gráficos operacionais — donut e ocupação)

### Performance

Usar `Promise.all()` para queries independentes:
```ts
const [financialKpis, rentalsData, inventoryData, recentPayments, monthlyData] =
  await Promise.all([...])
```
Queries que dependem de resultados anteriores não vão no mesmo `Promise.all`.

---

## Frontend

### Instalação

```bash
npm install recharts
```

### Estrutura de arquivos

```
frontend/src/features/dashboard/
  hooks/
    useDashboardSummary.ts
  components/
    FinancialSection.tsx
    RentalsSection.tsx
    InventorySection.tsx
    RevenueBarChart.tsx
    CumulativeLineChart.tsx
    RentalStatusPieChart.tsx
    InventoryOccupancyBar.tsx
    RecentPaymentsList.tsx
    UpcomingReturnsList.tsx
    OverdueReturnsList.tsx

frontend/src/lib/api/dashboard.api.ts
frontend/src/pages/DashboardPage.tsx   # substituir placeholder
frontend/src/tests/dashboard/DashboardPage.test.tsx
```

### `useDashboardSummary`

```ts
useQuery({
  queryKey: ['dashboard', 'summary'],
  queryFn: () => dashboardApi.getSummary(),
  staleTime: 5 * 60 * 1000,   // 5 minutos
  refetchOnWindowFocus: false,
  retry: 1,
})
```

### `DashboardPage` — layout

```
<h2>Dashboard</h2>

{canViewFinancial && <FinancialSection />}
{canViewOperational && <RentalsSection />}
{canViewInventory && <InventorySection />}

{/* Gráficos — grid 2 colunas desktop, 1 mobile */}
<div className="grid gap-6 md:grid-cols-2">
  {canViewFinancial && <RevenueBarChart />}
  {canViewFinancial && <CumulativeLineChart />}
  {canViewOperationalCharts && <RentalStatusPieChart />}
  {canViewOperationalCharts && <InventoryOccupancyBar />}
</div>

{/* Listas — grid 3 colunas desktop, 1 mobile */}
<div className="grid gap-6 md:grid-cols-3">
  {canViewFinancial && <RecentPaymentsList />}
  {canViewOperational && <UpcomingReturnsList />}
  {canViewOperational && <OverdueReturnsList />}
</div>
```

### Seções de KPIs

**FinancialSection** — 3 cards: Receita (verde), Despesas (vermelho), Saldo (azul)

**RentalsSection** — 4 cards: Ativas, Vencidas (laranja), Retornadas, Canceladas

**InventorySection** — 4 cards: Total, Disponíveis (verde), Alugados, Manutenção + badge de ocupação

### Gráficos Recharts

| Componente | Tipo | Dados | Roles |
|---|---|---|---|
| `RevenueBarChart` | `BarChart` agrupado | `monthlyHistory[].{income, expense}` | admin, financial |
| `CumulativeLineChart` | `LineChart` com área | `monthlyHistory[].cumulativeIncome` | admin, financial |
| `RentalStatusPieChart` | `PieChart` (donut) | `rentals.byStatus` | admin, attendant |
| `InventoryOccupancyBar` | Barras de progresso | `inventory.*` | admin, attendant |

**Regras comuns dos gráficos:**
- Se sem dados (todos zeros), mostrar `EmptyState`
- Tooltips com valores formatados (`formatCurrency`, porcentagem)
- Meses formatados: `"2026-01"` → `"Jan/26"` 
- Cores distintas para dark/light mode via variáveis CSS

### Listas

| Componente | Dados | Link |
|---|---|---|
| `RecentPaymentsList` | `financial.recentPayments` (5 itens) | `/rentals/:rentalId` |
| `UpcomingReturnsList` | `rentals.upcomingReturns` | `/rentals/:id` |
| `OverdueReturnsList` | `rentals.overdueReturns` | `/rentals/:id` |

Cada item com link clicável para `/rentals/:rentalId`.

### Formatação

Usar helpers existentes:
- `formatCurrency(value)` — valores monetários
- `formatDate(date)` — datas
- Porcentagem: `${value.toFixed(1)}%`
- Método de pagamento: mapeamento local `{ cash: 'Dinheiro', pix: 'PIX', card: 'Cartão', transfer: 'Transferência' }`

### Tipos novos em `src/types/index.ts`

```ts
DashboardSummary, DashboardPeriod, DashboardPermissions,
DashboardFinancial, DashboardRentals, DashboardInventory,
DashboardMonthlyHistory, DashboardRecentPayment,
DashboardUpcomingReturn, DashboardOverdueReturn
```

---

## RBAC

| Seção/Gráfico | admin | financial | attendant |
|---|---|---|---|
| FinancialSection | ✅ | ✅ | ❌ |
| RentalsSection | ✅ | ✅ (contexto) | ✅ |
| InventorySection | ✅ | ✅ (resumido) | ✅ |
| RevenueBarChart | ✅ | ✅ | ❌ |
| CumulativeLineChart | ✅ | ✅ | ❌ |
| RentalStatusPieChart | ✅ | ❌ | ✅ |
| InventoryOccupancyBar | ✅ | ❌ | ✅ |
| RecentPaymentsList | ✅ | ✅ | ❌ |
| UpcomingReturnsList | ✅ | ❌ | ✅ |
| OverdueReturnsList | ✅ | ❌ | ✅ |

Renderização controlada pelos flags `canViewFinancial`, `canViewOperational`, `canViewInventory` retornados pelo backend.

---

## Testes

**`src/tests/dashboard/DashboardPage.test.tsx`** — 10 cenários:

1. Renderiza loading state enquanto carrega
2. Renderiza error state com retry
3. Admin vê todas as seções (financial, rentals, inventory)
4. Financial vê FinancialSection mas não RentalStatusPieChart
5. Attendant não vê FinancialSection
6. FinancialSection exibe receita, despesas e saldo
7. RentalsSection exibe active, overdue, returned, canceled
8. InventorySection exibe occupancyRate
9. RecentPaymentsList renderiza pagamentos com link
10. OverdueReturnsList renderiza devoluções atrasadas com daysOverdue

---

## Decisões fora de escopo

- Calendário (FullCalendar) — próxima feature
- Code splitting (React.lazy) — próxima feature
- Endpoint `/dashboard/summary` por role separado — não necessário agora
- Atualização em tempo real (WebSocket/polling) — não necessário
