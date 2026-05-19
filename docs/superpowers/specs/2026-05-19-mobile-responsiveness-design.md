# Mobile Responsiveness Design

**Data:** 2026-05-19  
**Status:** Aprovado

## Objetivo

Eliminar scroll horizontal no mobile e melhorar a leitura de dados em telas pequenas, sem regressão no layout desktop.

**Breakpoint mobile/desktop:** `md` (768px) — abaixo → mobile, acima → desktop.

---

## 1. AppLayout — Sidebar mobile com overlay

**Problema:** O sidebar começa visível (`sidebarVisible = true`) e ao ser exibido no mobile sobrepõe o conteúdo sem backdrop nem bloqueio de scroll.

**Solução:**

1. Inicializar fechada no mobile: `useState(() => window.innerWidth >= 768)`
2. No mobile (`< md`), quando aberta: renderizar overlay semitransparente clicável atrás do sidebar
3. Bloquear scroll do `<body>` enquanto sidebar estiver aberta no mobile

```tsx
// AppLayout.tsx
const isMobile = window.innerWidth < 768
const [sidebarVisible, setSidebarVisible] = useState(!isMobile)

// Bloquear scroll do body no mobile quando sidebar aberta
useEffect(() => {
  if (isMobile && sidebarVisible) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
  return () => { document.body.style.overflow = '' }
}, [sidebarVisible, isMobile])
```

```tsx
{/* Overlay — só visível no mobile quando sidebar aberta */}
{sidebarVisible && (
  <div
    className="fixed inset-0 z-10 bg-black/40 md:hidden"
    onClick={() => setSidebarVisible(false)}
  />
)}

{/* Sidebar — fixed no mobile (z-20), static no desktop */}
<div className={cn(
  'flex flex-shrink-0 transition-all duration-200',
  'md:relative md:z-auto',
  sidebarVisible
    ? 'fixed inset-y-0 left-0 z-20 w-64 md:w-64'
    : 'w-0 overflow-hidden',
)}>
  <Sidebar onClose={() => setSidebarVisible(false)} />
</div>
```

No desktop, comportamento é idêntico ao atual (toggle abre/fecha, sem overlay).

---

## 2. Listas — Tabela no desktop, lista compacta no mobile

**Padrão escolhido:** Lista compacta estilo C (uma linha por registro, dados condensados, `›` à direita).

**Princípio de legibilidade:** cada item destaca os 4 elementos mais relevantes, sem tentar reproduzir todas as colunas da tabela: entidade principal → status/badge → informação principal (valor/data) → ação principal.

**Implementação:** Cada página renderiza dois blocos mutuamente exclusivos via Tailwind:

```tsx
{/* Desktop */}
<div className="hidden md:block">
  <Table>...</Table>
</div>

{/* Mobile */}
<div className="md:hidden divide-y rounded-md border">
  {data.map(item => (
    <div key={item.id} className="flex items-center gap-3 p-3 cursor-pointer" onClick={...}>
      {/* linha compacta específica de cada tela */}
      <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
    </div>
  ))}
</div>
```

### Mapeamento por tela

| Tela | Entidade principal | Status/badge | Info principal | Ação |
|---|---|---|---|---|
| **RentalsListPage** | Nome cliente + contrato mono xs | StatusBadge | Valor + datas condensadas (dd/MM → dd/MM) | tap → detalhe |
| **CustomersListPage** | Nome | Badge ativo/inativo | Documento xs | tap → detalhe |
| **PaymentsListPage** | Nome cliente + contrato link mono | — | Valor verde + data | — |
| **FinancialListPage** | Descrição + data xs | Badge categoria | Valor +/− colorido | tap → detalhe |
| **DocumentsListPage** | Tipo + contrato link | Badge status | Data | botão download |
| **ItemsListPage** | Código mono + nome | Badge disponível/total | Valor diário | tap → detalhe |
| **PaymentsTable** (RentalDetail) | Data + método | — | Valor | — |
| **DocumentsTable** (RentalDetail) | Tipo | Badge status | Data | botão download |

### Estrutura visual do item compacto

```
┌────────────────────────────────────────────────────┐
│ [entidade principal]     [status/badge + info]    › │
│ [sublinha: detalhe xs em muted]                     │
└────────────────────────────────────────────────────┘
```

---

## 3. Filtros — `<FilterPanel>` compartilhado

Novo componente `src/components/filters/FilterPanel.tsx` para as 3 páginas com filtros complexos: Financial, Payments, Documents.

### API

```tsx
interface FilterPanelProps {
  activeCount: number          // número de filtros ativos (exclui preset padrão)
  summary?: string             // texto resumido para o botão (ex: "Este mês · PIX")
  onClear: () => void          // limpar todos os filtros
  children: React.ReactNode   // conteúdo dos filtros (renderizado dentro do painel)
}
```

### Comportamento

**Mobile (`md:hidden`):**
- Botão `"Filtros"` ou `"Filtros • Este mês · PIX"` (quando há filtros ativos)
- Click expande/colapsa painel abaixo do botão
- Chips de filtros ativos abaixo do botão (sempre visíveis, fechado ou aberto)
- Botão "Limpar filtros" dentro do painel quando `activeCount > 0`
- Painel começa **fechado** por padrão

**Desktop (`hidden md:block`):**
- Renderiza `children` diretamente, sem wrapper — layout atual preservado intacto

### Dentro do painel (mobile)

- Botões de período: `grid grid-cols-2 gap-2` (2 colunas)
- Selects e inputs: `w-full` (full-width)
- Labels acima de cada campo

### Cálculo de `activeCount`

Cada página calcula `activeCount` com base nos filtros não-padrão:
- Preset diferente de `this_month` = +1
- Cada select não-vazio = +1
- Campo de contrato preenchido = +1

### Chips de filtros ativos

```tsx
// Exemplo de chips abaixo do botão FilterPanel
<div className="flex flex-wrap gap-1 mt-2">
  {preset !== 'this_month' && <Badge variant="secondary">{PRESET_LABELS[preset]}</Badge>}
  {method && <Badge variant="secondary">{METHOD_LABELS[method]}</Badge>}
  {contractSearch && <Badge variant="secondary">Contrato: {contractSearch}</Badge>}
</div>
```

---

## 4. Botões de ação em páginas de detalhe

**Problema:** `RentalDetailPage` header tem botões com `ml-auto flex gap-2` que podem empurcar o status badge ou transbordar.

**Solução:** Adicionar `flex-wrap` ao container dos botões de ação, com margem zerada no mobile:

```tsx
<div className="flex flex-wrap items-center gap-4">
  <Button variant="ghost" size="icon" onClick={() => navigate('/rentals')}>
    <ArrowLeft className="h-4 w-4" />
  </Button>
  <h2 className="text-2xl font-bold">Locação #{rental.contractNumber}</h2>
  <StatusBadge status={rental.computedStatus as ComputedRentalStatus} />
  <div className="flex flex-wrap gap-2 md:ml-auto">
    {/* botões de ação */}
  </div>
</div>
```

`flex-wrap` no pai garante que os botões quebram para a linha seguinte em vez de transbordar.

---

## 5. Paginação no mobile

Atual: `flex items-center justify-between` — texto e botões ficam espremidos em telas pequenas.

Solução: empilhar em coluna no mobile, com texto "Mostrando X–Y de Z" mais informativo:

```tsx
<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
  <p className="text-sm text-muted-foreground">
    Mostrando {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} de {data.total}
  </p>
  <div className="flex gap-2">
    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
      Anterior
    </Button>
    <Button variant="outline" size="sm" disabled={page * limit >= data.total} onClick={() => setPage(page + 1)}>
      Próxima
    </Button>
  </div>
</div>
```

Aplicar em todas as páginas paginadas (Rentals, Customers, Payments, Financial, Documents, Items).

---

## 6. Larguras fixas nos filtros

Selects e inputs com larguras fixas dentro de `flex-col` no mobile continuam transbordando. Regra geral:

```tsx
// Antes
<SelectTrigger className="w-52">

// Depois
<SelectTrigger className="w-full md:w-52">
```

Campos a revisar:
- `FinancialListPage`: `w-32` (Tipo), `w-52` (Categoria), `w-36` (Origem), `w-40` (datas)
- `PaymentsListPage`: `w-40` (Método), `w-48` (Contrato), `w-40` (datas)
- `DocumentsListPage`: `w-52` (Tipo), `w-40` (Status), `w-48` (Contrato), `w-40` (datas)

Dentro do `<FilterPanel>`, no mobile todos esses campos recebem `w-full` automaticamente via classe no wrapper do painel. No desktop, mantêm suas larguras originais via `md:w-*`.

---

## 7. Telas que NÃO precisam de `FilterPanel`

As páginas abaixo têm filtro simples (1 campo) que não justifica o painel colapsável — mas ainda recebem a lista compacta mobile e a paginação empilhada.

- `RentalsListPage` — 1 select de status, já usa `max-w-xs` (funciona bem)
- `ItemsListPage` — 1 select de categoria, já usa `max-w-xs` (funciona bem)
- `CustomersListPage` — apenas search input, já responsivo

Telas que não precisam de **nenhuma alteração**:
- Formulários (new/edit) — inputs já empilham
- `CalendarPage` — FullCalendar tem responsividade própria
- `DashboardPage` — KPI cards já usam `grid-cols-2 lg:grid-cols-4`

---

## Arquivos a criar/modificar

### Novo
- `src/components/filters/FilterPanel.tsx`

### Modificados
- `src/components/layout/AppLayout.tsx` — `useState` inicial baseado em viewport
- `src/features/rentals/pages/RentalsListPage.tsx` — mobile list + paginação
- `src/features/customers/pages/CustomersListPage.tsx` — mobile list + paginação
- `src/features/payments/pages/PaymentsListPage.tsx` — FilterPanel + mobile list + paginação
- `src/features/financial/pages/FinancialListPage.tsx` — FilterPanel + mobile list + paginação
- `src/features/documents/pages/DocumentsListPage.tsx` — FilterPanel + mobile list + paginação
- `src/features/inventory/pages/ItemsListPage.tsx` — mobile list + paginação
- `src/features/rentals/pages/RentalDetailPage.tsx` — header/ações mobile
- `src/features/payments/components/PaymentsTable.tsx` — mobile list
- `src/features/documents/components/DocumentsTable.tsx` — mobile list

---

## 8. Testes

- Nenhum novo teste de unidade necessário (lógica existente não muda)
- Testes de snapshot existentes podem precisar de update para incluir a div mobile
- Verificação manual em viewport 375px (iPhone SE) e 768px (tablet)
- Regressão visual: testar as mesmas telas em 1280px após as mudanças
