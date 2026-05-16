# Módulo Financeiro — Frontend Design Spec

**Data:** 2026-05-16
**Status:** Aprovado
**Escopo:** Frontend apenas — backend FinancialModule já implementado

---

## Contexto

O backend possui um `FinancialModule` completo com CRUD de transações financeiras. Este spec descreve a camada frontend: rotas, páginas, hooks, formulários e regras de negócio da interface.

O sistema é para gestão de aluguel de equipamentos (andaimes, ferramentas). Transações financeiras incluem receitas de pagamentos automáticos (`origin=payment`) e lançamentos manuais de despesas e ajustes (`origin=manual`).

---

## Rotas

| Rota | Componente | Roles |
|---|---|---|
| `/financial` | redirect → `/financial/transactions` | admin, financial |
| `/financial/transactions` | `FinancialListPage` | admin, financial |
| `/financial/transactions/new` | `FinancialNewPage` | admin, financial |
| `/financial/transactions/:id` | `FinancialDetailPage` | admin, financial |
| `/financial/transactions/:id/edit` | `FinancialEditPage` | admin, financial |

`attendant` não acessa nenhuma dessas rotas nem vê o item no Sidebar.

---

## Estrutura de arquivos

```
frontend/src/features/financial/
  hooks/
    useFinancialTransactions.ts   # listagem paginada
    useFinancialSummary.ts        # segunda requisição agregada para os cards
    useFinancialTransaction.ts    # detalhe de uma transação
    useCreateTransaction.ts       # POST /financial/transactions
    useUpdateTransaction.ts       # PATCH /financial/transactions/:id
    useVoidTransaction.ts         # DELETE /financial/transactions/:id
  pages/
    FinancialListPage.tsx
    FinancialNewPage.tsx
    FinancialDetailPage.tsx
    FinancialEditPage.tsx
  schemas/
    financialTransaction.schema.ts  # Zod: criação e edição
```

Tipos novos em `src/types/index.ts` (ou arquivo próprio):
- `FinancialTransaction`
- `FinancialTransactionType` (`income | expense`)
- `FinancialTransactionCategory` (`rental_income | stock_investment | maintenance | transport | fixed_cost | other`)
- `FinancialTransactionOrigin` (`manual | payment | adjustment`)
- `FinancialSummary`

---

## Backend disponível

```
GET    /financial/transactions        filtros: type, category, origin, isVoided,
                                              rentalId, paymentId, dateFrom, dateTo,
                                              page, limit
GET    /financial/transactions/:id    inclui: user, rental, payment
POST   /financial/transactions        body: CreateFinancialTransactionDto
PATCH  /financial/transactions/:id    body: UpdateFinancialTransactionDto (só manual, não anulado)
DELETE /financial/transactions/:id    body: { reason } (só admin, só manual, não anulado)
```

Roles no backend: listar/criar/editar → `admin, financial`; anular → `admin`.

---

## Página de Listagem — `FinancialListPage`

### Layout

1. **Header:** título "Financeiro" + subtítulo "Lançamentos financeiros" + botão "+ Novo Lançamento" (visível para `admin` e `financial`)
2. **Filtros** (topo, com labels visíveis):
   - Período: atalhos **Hoje / Esta semana / Este mês / Mês passado / Este ano** + opção "Personalizado…" que abre datepicker `dateFrom`/`dateTo`
   - Padrão ao carregar: **Este mês**
   - Selects com label: **Tipo** (`income | expense`), **Categoria** (6 opções), **Origem** (`manual | payment | adjustment`)
3. **Cards de resumo** (4 cards):
   - **Entradas** — soma de `amount` onde `type=income` e `isVoided=false`
   - **Saídas** — soma de `amount` onde `type=expense` e `isVoided=false`
   - **Saldo** — `totalIncome − totalExpense`
   - **Anulados** — contagem de transações com `isVoided=true` no período
4. **Tabela paginada** (colunas: Data, Descrição, Categoria, Origem, Locação, Valor, indicador `›`)
5. **Paginação** no rodapé: total de lançamentos + botões Anterior/Próxima

### Tabela

- Clique na linha → navega para `/financial/transactions/:id`
- Transações com `isVoided=true`: texto riscado + badge vermelho "anulado"
- Coluna **Locação**: exibe `contractNumber` clicável (`/rentals/:rentalId`) quando `rentalId` presente; caso contrário `—`
- Valores positivos (income) em verde com `+`; negativos (expense) em vermelho com `−`
- Badges coloridos para categoria e origem

### Cards de resumo — estratégia de cálculo

Dois requests paralelos com os **mesmos filtros de tipo/categoria/origem/período**:

1. **Request paginado** (tabela): `page=N, limit=20`
2. **Request agregado** (`useFinancialSummary`): `limit=10000`, sem filtro `isVoided`, para ter o universo completo

O hook `useFinancialSummary` recebe os dados do request agregado e computa client-side:
```ts
const totalIncome   = data.filter(t => t.type === 'income'  && !t.isVoided).reduce(sum, 0)
const totalExpense  = data.filter(t => t.type === 'expense' && !t.isVoided).reduce(sum, 0)
const balance       = totalIncome - totalExpense
const voidedCount   = data.filter(t => t.isVoided).length
```

> Evolução futura: substituir por `GET /financial/transactions/summary` quando o endpoint existir.

---

## Página de Criação — `FinancialNewPage`

Rota: `/financial/transactions/new`. Roles: `admin`, `financial`.

### Formulário

| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| `type` | cards visuais Entrada/Saída | sim | destaca card selecionado |
| `category` | select | sim | ordem: Receita de Locação · Investimento em Estoque · Manutenção · Transporte · Custo Fixo · Outro |
| `amount` | número positivo | sim | `> 0`, sem sinal (type define direção) |
| `transactionDate` | date | sim | padrão: hoje |
| `description` | texto | sim | — |
| `rentalId` | autocomplete opcional | não | busca por `GET /rentals?contractNumber=...`; helper: "Use apenas quando este lançamento estiver ligado a uma locação existente." |

`origin` é sempre `manual` — definido no backend, não exposto no form.

### Comportamento

- Submit com sucesso → toast de sucesso → redireciona para `/financial/transactions/:id`
- Erro → mantém usuário no formulário com mensagem amigável
- Cancelar → volta para `/financial/transactions`

### Validação Zod

```ts
type: z.enum(['income', 'expense'])
category: z.enum(['rental_income', 'stock_investment', 'maintenance', 'transport', 'fixed_cost', 'other'])
amount: z.number().positive()
transactionDate: z.string().date()   // formato YYYY-MM-DD, igual ao @IsDateString() do backend
description: z.string().min(1)
rentalId: z.string().uuid().optional()
```

---

## Página de Detalhe — `FinancialDetailPage`

Rota: `/financial/transactions/:id`. Roles: `admin`, `financial`.

### Estados

**1. Lançamento manual ativo**
- Botão **Editar** visível: `origin === 'manual' && !isVoided`; roles `admin`, `financial`
- Botão **Anular** visível: `origin === 'manual' && !isVoided && role === 'admin'`

**2. `origin === 'payment'` (somente leitura)**
- Badge "somente leitura"
- Sem botões Editar/Anular
- Se `rentalId`: link "Contrato #XXXX →" → `/rentals/:rentalId`
- Se `paymentId`: link "Ver pagamento na locação →" → `/rentals/:rentalId` (sem página própria de pagamento)

**3. `isVoided === true`**
- Banner vermelho com motivo da anulação, nome do anulador e data/hora
- Campos e valor com texto riscado
- Sem botões Editar/Anular
- Mensagem: "Lançamentos anulados não podem ser editados"

### Ação Anular

Abre `ConfirmDialog` com:
- Campo **Motivo** obrigatório (`string().min(1)`)
- Chama `DELETE /financial/transactions/:id` com `{ reason }`
- Toast de sucesso → atualiza detalhe na mesma página (invalidar query)

### Campos exibidos

Data, Tipo, Categoria, Origem, Valor (em destaque), Descrição, Criado por, Criado em, Locação relacionada, Pagamento relacionado.

---

## Página de Edição — `FinancialEditPage`

Rota: `/financial/transactions/:id/edit`. Roles: `admin`, `financial`.

### Guards de bloqueio

Antes de renderizar o form, verificar:

- `origin !== 'manual'` → exibe mensagem: _"Este lançamento foi gerado automaticamente e não pode ser editado diretamente."_
- `isVoided === true` → exibe mensagem: _"Este lançamento está anulado e não pode ser editado."_

### Formulário preenchido

Mesma estrutura do `FinancialNewPage`, com valores atuais da transação. Campos editáveis:

`type`, `category`, `amount`, `description`, `transactionDate`, `rentalId`

`origin` exibido como informação somente leitura (não é campo do form).

### Comportamento

- Submit com sucesso → toast → redireciona para `/financial/transactions/:id`
- Cancelar → volta para `/financial/transactions/:id`
- Sucesso invalida queries: detalhe, listagem (`useFinancialTransactions`) e resumo (`useFinancialSummary`)

---

## Sidebar

Item "Financeiro" no Sidebar visível apenas para `admin` e `financial`.
Link aponta para `/financial` (que redireciona para `/financial/transactions`).

---

## Enums e labels — mapeamento para exibição

```ts
// Tipo
income  → "Entrada"
expense → "Saída"

// Categoria (ordem no select)
rental_income    → "Receita de Locação"
stock_investment → "Investimento em Estoque"
maintenance      → "Manutenção"
transport        → "Transporte"
fixed_cost       → "Custo Fixo"
other            → "Outro"

// Origem
manual      → "manual"
payment     → "payment"
adjustment  → "adjustment"
```

---

## Decisões fora de escopo

- Endpoint de agregação `GET /financial/transactions/summary` — futura evolução
- Página própria de pagamento (`/payments/:id`) — futura evolução; por ora, link aponta para a locação
