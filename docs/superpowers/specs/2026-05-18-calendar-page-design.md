# Calendar Page Design

**Data:** 2026-05-18  
**Status:** Aprovado

---

## Objetivo

Implementar a página `/calendar` — visualização de devoluções previstas de locações ativas, com destaque visual por urgência. Tela operacional para admin e attendant acompanharem quais locações vencem ou estão atrasadas.

---

## Rota e Acesso

| Campo | Valor |
|---|---|
| Rota | `/calendar` |
| Roles com acesso | `admin`, `attendant` |
| Role bloqueada | `financial` → redireciona para `/403` |
| Proteção | Guard inline na página (padrão do projeto) |

**Nota:** O padrão do projeto é guard inline no componente (`if (user.role === 'financial') return <Navigate to="/403" />`). Não há route-level RBAC no router. Toda proteção de role é feita dentro da página, consistente com `PaymentsListPage` e demais telas.

---

## Dados

### Fonte

`GET /rentals?status=active&limit=500`

Retorna todas as locações com `status = 'active'` (inclui ativas e atrasadas, já que locações atrasadas mantêm `status = active` no banco, apenas `computedStatus` muda para `overdue`).

### Campos necessários por locação

- `id`
- `contractNumber`
- `expectedReturn`
- `customer.name`
- `computedStatus`

O endpoint `/rentals` já inclui `customer` via `include` e retorna `computedStatus` via `enrichRental`.

### Nota de evolução (limit=500)

Para o MVP, `limit=500` é suficiente. Se o volume de locações ativas crescer:
- Exibir aviso na tela quando `total > 500` ("Exibindo os 500 primeiros vencimentos")
- Evolução futura: substituir a chamada única por busca por range visível do calendário, usando os parâmetros `startDate` e `expectedReturnDate` já suportados pelo backend, acionados pelo callback `datesSet` do FullCalendar

---

## FullCalendar

### Pacotes a instalar

```bash
npm install @fullcalendar/react @fullcalendar/daygrid @fullcalendar/list @fullcalendar/core
```

Não instalar `@fullcalendar/interaction` no MVP (sem drag/drop, dateClick ou seleção).

### Configuração

```tsx
<FullCalendar
  plugins={[dayGridPlugin, listPlugin]}
  initialView="dayGridMonth"
  locale={ptBrLocale}
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
/>
```

- `dayGridMonth` é a visão padrão
- `listMonth` é a visão lista (cronológica)
- `dayMaxEvents={3}` exibe "+N mais" quando um dia tiver muitos eventos

### Mapeamento rental → evento

```typescript
function toCalendarEvent(rental: Rental) {
  return {
    id: rental.id,
    title: `Contrato ${rental.contractNumber} · ${rental.customer?.name ?? '—'}`,
    date: rental.expectedReturn.slice(0, 10), // YYYY-MM-DD — evita problemas de timezone
    allDay: true,
    backgroundColor: getEventColor(rental.expectedReturn),
    borderColor: getEventColor(rental.expectedReturn),
    textColor: '#ffffff',
  }
}
```

Usar `date` (string `YYYY-MM-DD`) e `allDay: true`. `expectedReturn` é uma data operacional, sem horário relevante.

---

## Lógica de Cores (Semáforo)

```typescript
function getEventColor(expectedReturn: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const returnDate = new Date(expectedReturn.slice(0, 10))
  returnDate.setHours(0, 0, 0, 0)
  const diff = Math.round(
    (returnDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  )
  if (diff < 0)  return '#ef4444' // Atrasado
  if (diff === 0) return '#f97316' // Vence hoje
  if (diff <= 3) return '#eab308' // Próximos 1–3 dias
  return '#22c55e'                // Futuro (4+ dias)
}
```

| Status | Condição | Cor |
|---|---|---|
| Atrasado | `expectedReturn < hoje` | `#ef4444` vermelho |
| Vence hoje | `expectedReturn === hoje` | `#f97316` laranja |
| Próximos 1–3 dias | `expectedReturn` em 1–3 dias | `#eab308` amarelo |
| Futuro | `expectedReturn` em 4+ dias | `#22c55e` verde |

---

## Layout da Página

```
┌─────────────────────────────────────────────────────┐
│ Calendário                                           │
│ Devoluções previstas de locações ativas              │
├─────────────────────────────────────────────────────┤
│ [Legenda] ● Atrasado  ● Vence hoje  ● 1-3 dias  ● Futuro │
├─────────────────────────────────────────────────────┤
│                                                     │
│   [FullCalendar — dayGridMonth / listMonth]         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

- Header padrão (título + subtítulo)
- Legenda de cores em linha, abaixo do header
- FullCalendar ocupa o restante da área

### Estados

| Estado | Componente |
|---|---|
| Carregando | `<Skeleton>` cobrindo área do calendário |
| Erro | `<ErrorState onRetry={refetch} />` |
| Sem dados | `<EmptyState>` — "Nenhuma locação ativa com devolução prevista" |

---

## Arquivos

### Criar

| Arquivo | Responsabilidade |
|---|---|
| `frontend/src/features/calendar/pages/CalendarPage.tsx` | Página principal — guard de role, estados, FullCalendar |
| `frontend/src/features/calendar/hooks/useCalendarRentals.ts` | Hook TanStack Query para GET /rentals?status=active |

### Modificar

| Arquivo | Mudança |
|---|---|
| `frontend/src/lib/permissions.ts` | Adicionar `calendar: { view: ['admin', 'attendant'] }` |
| `frontend/src/components/layout/Sidebar.tsx` | Adicionar item "Calendário" com icon `Calendar`, roles `['admin', 'attendant']` |
| `frontend/src/app/routes.tsx` | Adicionar rota `/calendar` + import `CalendarPage` |
| `frontend/package.json` | Instalar pacotes FullCalendar |

---

## Hook

```typescript
// useCalendarRentals.ts
export function useCalendarRentals() {
  return useQuery({
    queryKey: ['calendar', 'rentals'],
    queryFn: () => rentalsApi.list({ status: 'active', limit: 500 }),
  })
}
```

Sem filtros adicionais no MVP. A query key `['calendar', 'rentals']` é isolada das queries de listagem de locações.

---

## Testes

Arquivo: `frontend/src/tests/calendar/CalendarPage.test.tsx`

FullCalendar será mockado via `vi.mock('@fullcalendar/react')` para evitar problemas de renderização em jsdom. O mock retorna um componente simples que renderiza os eventos como lista.

| # | Teste |
|---|---|
| 1 | renderiza loading state (skeletons) |
| 2 | renderiza error state com botão retry |
| 3 | renderiza empty state quando sem locações ativas |
| 4 | renderiza título do evento com contractNumber e customer.name |
| 5 | admin acessa sem redirect |
| 6 | attendant acessa sem redirect |
| 7 | financial é redirecionado para /403 |
| 8 | legenda é visível com os 4 status de cor |
| 9 | ao clicar em evento, navega para /rentals/:rentalId |
| 10 | evento atrasado recebe cor vermelha (`#ef4444`) |
| 11 | evento de hoje recebe cor laranja (`#f97316`) |
| 12 | evento em 2 dias recebe cor amarela (`#eab308`) |
| 13 | evento em 5 dias recebe cor verde (`#22c55e`) |

Os testes 10–13 testam a função `getEventColor` diretamente (unit test), sem depender da renderização do FullCalendar.

---

## Dependências Externas

- `@fullcalendar/react` — componente React
- `@fullcalendar/daygrid` — plugin visão mês
- `@fullcalendar/list` — plugin visão lista
- `@fullcalendar/core` — locale pt-br

Sem `@fullcalendar/interaction` no MVP.
