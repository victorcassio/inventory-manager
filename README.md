# Inventory Manager

Sistema web completo de gestão de locação de equipamentos e materiais. Cobre o ciclo de vida de ponta a ponta: controle de estoque, criação e acompanhamento de locações, devoluções parciais ou totais, pagamentos, lançamentos financeiros, geração de documentos PDF e calendário operacional de devoluções.

Projetado para empresas que trabalham com aluguel de andaimes, ferramentas, geradores, equipamentos de construção e similares.

---

## Sumário

- [Stack](#stack)
- [Funcionalidades](#funcionalidades)
- [Screenshots](#screenshots)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Como rodar](#como-rodar)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Banco de dados e Prisma](#banco-de-dados-e-prisma)
- [Scripts disponíveis](#scripts-disponíveis)
- [Testes](#testes)
- [Autenticação e RBAC](#autenticação-e-rbac)
- [Responsividade mobile](#responsividade-mobile)
- [Otimizações de performance](#otimizações-de-performance)
- [Segurança](#segurança)
- [Decisões técnicas](#decisões-técnicas)
- [Roadmap](#roadmap)
- [Autor](#autor)

---

## Stack

### Frontend

| Tecnologia | Versão | Função |
|---|---|---|
| React | 18.3 | UI |
| TypeScript | 5.7 | Tipagem |
| Vite | 6.0 | Build e dev server |
| React Router | 6.28 | Roteamento SPA |
| TanStack Query | 5.62 | Server state e cache |
| Zustand | 5.0 | Auth state global |
| React Hook Form | 7.54 | Formulários |
| Zod | 3.24 | Validação de schema |
| Tailwind CSS | 3.4 | Estilização |
| shadcn/ui + Radix | — | Componentes acessíveis |
| Recharts | 3.8 | Gráficos do dashboard |
| FullCalendar | 6.1 | Calendário operacional |
| Axios | 1.7 | HTTP client |
| date-fns | 4.1 | Manipulação de datas |
| Lucide React | 0.468 | Ícones |
| Sonner | 1.7 | Notificações toast |

### Backend

| Tecnologia | Versão | Função |
|---|---|---|
| Node.js | 20.x | Runtime |
| NestJS | 10.4 | Framework HTTP |
| Prisma | 7.8 | ORM |
| PostgreSQL | 16 | Banco de dados |
| JWT + Passport | — | Autenticação |
| PDFKit | — | Geração de PDFs |
| Helmet | — | Headers de segurança |
| class-validator | — | Validação de DTOs |

### Infra e tooling

| Tecnologia | Função |
|---|---|
| Docker Compose | PostgreSQL local |
| Vitest | Testes frontend |
| Jest | Testes backend |
| React.lazy + Suspense | Code splitting |

---

## Funcionalidades

### Auth e RBAC

- Login com e-mail e senha, JWT com refresh token rotativo
- 3 perfis de acesso com permissões granulares:
  - **Admin** — acesso total
  - **Atendente** — operações de locação, devolução, estoque e documentos
  - **Financeiro** — dashboard, pagamentos, lançamentos financeiros e documentos
- Guards em todos os endpoints sensíveis do backend
- Proteção de rotas no frontend com redirect automático

### Dashboard

- KPIs em tempo real: receita do mês, locações ativas, vencidas, inadimplência
- Gráfico de barras com receita e despesas dos últimos 6 meses
- Gráfico de pizza com distribuição de status das locações
- Barra de ocupação do estoque (disponível, alugado, em manutenção)
- Lista de devoluções próximas e locações com atraso
- Permissões por role: financeiro não vê dados operacionais de clientes

### Clientes

- Cadastro de PF (CPF) e PJ (CNPJ) com validação de documento
- Busca por nome com debounce
- Listagem paginada, detalhe e edição
- Histórico de locações por cliente

### Estoque

- Itens com código único, categoria, valor diário, quantidade total/disponível/alugada/manutenção
- Categorias de equipamentos
- Controle automático de disponibilidade a cada locação e devolução
- Movimentações de inventário auditadas

### Locações

- Criação de contrato com múltiplos itens e quantidades
- Numeração sequencial automática por ano (ex: `2026-0042`)
- Cálculo de total: `(valor_diário × dias × quantidade) − desconto + extras`
- Status computado: **Ativo**, **Vencido** (automático, sem campo DB), **Devolvido**, **Cancelado**
- Filtro por status, cliente, datas
- Cancelamento com reversão automática do estoque

### Devoluções

- Devolução parcial ou total por item
- Registro de condição (bom estado, danificado, extraviado)
- Taxa de dano automática por item
- Cálculo de dias de atraso e multa

### Pagamentos

- Registro de pagamentos por locação (dinheiro, PIX, cartão, transferência)
- Histórico global de pagamentos com filtros de período e método
- Saldo em aberto calculado em tempo real
- Geração automática de lançamento financeiro ao pagar

### Financeiro

- Lançamentos manuais de entrada e saída (aluguel, estoque, manutenção, transporte, etc.)
- Lançamentos automáticos gerados pelos pagamentos de locação
- Filtros por tipo, categoria, origem e período (hoje, semana, mês, mês passado, ano, custom)
- Sumário de entradas, saídas, saldo e lançamentos anulados
- Anulação de lançamentos com registro de motivo

### Documentos

- Geração de PDF server-side via PDFKit:
  - **Contrato de locação** — dados do cliente, itens, período, valor
  - **Recibo de pagamento** — comprovante com método e referência
  - **Comprovante de devolução** — itens devolvidos, condições, taxas
- Listagem global com filtros por tipo, status, contrato e período
- Download direto do PDF

### Calendário

- Visão mensal e lista das devoluções previstas de locações ativas
- Código de cores por urgência:
  - 🔴 Atrasado
  - 🟠 Vence hoje
  - 🟡 Próximos 1–3 dias
  - 🟢 Futuro
- Clique no evento navega para o contrato
- Toolbar customizada no mobile (dois níveis)
- ResizeObserver para recalcular layout ao abrir/fechar sidebar

### Mobile

- Todas as tabelas convertidas em listas compactas no mobile (`< 768px`)
- `FilterPanel` colapsável com chips de filtros ativos
- Sidebar com overlay e scroll lock no mobile
- Paginação responsiva (`Mostrando X–Y de Z`)
- Desktop sem regressão

---

## Screenshots

> *Adicione capturas de tela do sistema aqui.*

| Dashboard | Locações |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Locações](docs/screenshots/rentals.png) |

| Financeiro | Calendário |
|---|---|
| ![Financeiro](docs/screenshots/financial.png) | ![Calendário](docs/screenshots/calendar.png) |

---

## Estrutura do projeto

```
inventory-manager/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # Modelos e índices
│   │   ├── migrations/            # Histórico de migrations
│   │   ├── seed.ts                # Seed de produção (usuários admin)
│   │   └── seed-demo.ts           # Seed de desenvolvimento com dados completos
│   └── src/
│       ├── common/                # Pipes, filtros, tipos compartilhados
│       ├── prisma/                # PrismaService
│       └── modules/
│           ├── auth/              # JWT, login, refresh token
│           ├── users/             # Gestão de usuários
│           ├── audit/             # Audit log de mutações
│           ├── customers/         # Clientes PF/PJ
│           ├── inventory/         # Itens, categorias, movimentações
│           ├── rentals/           # Contratos de locação
│           ├── returns/           # Devoluções parciais/totais
│           ├── payments/          # Pagamentos por locação
│           ├── financial/         # Lançamentos financeiros
│           ├── documents/         # Geração e listagem de PDFs
│           └── dashboard/         # KPIs e gráficos
├── frontend/
│   └── src/
│       ├── app/                   # Providers, router, layout raiz
│       ├── components/
│       │   ├── ui/                # shadcn/ui components
│       │   ├── layout/            # AppLayout, Sidebar, Header
│       │   ├── feedback/          # EmptyState, ErrorState, StatusBadge
│       │   └── filters/           # FilterPanel (colapsável mobile)
│       ├── features/              # Uma pasta por domínio
│       │   ├── auth/
│       │   ├── dashboard/
│       │   ├── customers/
│       │   ├── inventory/
│       │   ├── rentals/
│       │   ├── returns/
│       │   ├── payments/
│       │   ├── financial/
│       │   ├── documents/
│       │   └── calendar/
│       ├── hooks/                 # usePagination, etc.
│       ├── lib/                   # API client, formatters, permissions, utils
│       ├── stores/                # Auth store (Zustand)
│       └── types/                 # Tipos globais TypeScript
└── docker-compose.dev.yml         # PostgreSQL local
```

---

## Como rodar

### Pré-requisitos

- Node.js 20.x
- Docker e Docker Compose
- `nvm` (recomendado)

```bash
# Clonar o repositório
git clone https://github.com/victorcassio/inventory-manager.git
cd inventory-manager
```

### 1. Banco de dados

```bash
# Subir PostgreSQL via Docker
docker compose -f docker-compose.dev.yml up -d postgres
```

### 2. Backend

```bash
cd backend

# Usar a versão correta do Node
nvm use 20

# Instalar dependências
npm install

# Copiar e configurar variáveis de ambiente
cp .env.example .env
# editar DATABASE_URL, JWT_SECRET, etc.

# Aplicar migrations
npx prisma migrate dev

# Popular banco com dados de demonstração
npx ts-node prisma/seed-demo.ts

# Iniciar servidor de desenvolvimento (porta 3003)
npm run start:dev
```

### 3. Frontend

```bash
cd frontend

# Instalar dependências
npm install

# Copiar e configurar variáveis de ambiente
cp .env.example .env
# editar VITE_API_URL=http://localhost:3003/api/v1

# Iniciar dev server (porta 5173)
npm run dev
```

### Credenciais de desenvolvimento

| Usuário | E-mail | Senha | Role |
|---|---|---|---|
| Administrador | `admin@inventory.local` | `Admin@123456` | admin |
| Atendente | `atendente@inventory.local` | `Admin@123456` | attendant |
| Financeiro | `financeiro@inventory.local` | `Admin@123456` | financial |

---

## Variáveis de ambiente

### Backend (`backend/.env`)

```env
# Banco de dados
DATABASE_URL="postgresql://inventory_user:inventory_pass_dev@localhost:5440/inventory_db"

# JWT
JWT_SECRET="sua-chave-secreta-aqui"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_SECRET="sua-chave-refresh-aqui"
JWT_REFRESH_EXPIRES_IN="7d"

# App
PORT=3003
FRONTEND_URL="http://localhost:5173"
```

### Frontend (`frontend/.env`)

```env
VITE_API_URL=http://localhost:3003/api/v1
```

---

## Banco de dados e Prisma

### Modelos principais

```
User → RefreshToken
Customer → Rental → RentalItem → Item → ItemCategory
                 → Return → ReturnItem
                 → Payment → FinancialTransaction
                 → Document
InventoryMovement (rastreia toda movimentação de estoque)
AuditLog (rastreia toda mutação com userId, entity, payload)
ContractCounter (sequência de contratos por ano)
```

### Índices de performance

Adicionados via migration `20260520174259_add_performance_indexes`:

| Tabela | Campos indexados |
|---|---|
| `rentals` | `(status, expected_return)`, `(customer_id)` |
| `payments` | `(rental_id)`, `(paid_at)` |
| `financial_transactions` | `(is_voided, date)`, `(user_id, date)` |
| `items` | `(category_id)`, `(is_active)` |
| `rental_items` | `(rental_id)`, `(item_id)` |

### Comandos Prisma

```bash
# Desenvolvimento — criar e aplicar migration
npx prisma migrate dev --name nome_da_migration

# Produção — aplicar migrations sem alterar schema
npx prisma migrate deploy

# Inspecionar banco no navegador
npx prisma studio

# Gerar tipos do Prisma Client
npx prisma generate

# Seed de demonstração (desenvolvimento)
npx ts-node prisma/seed-demo.ts

# Reset completo (apenas dev — APAGA TODOS OS DADOS)
npx prisma migrate reset --force
```

### Migrations aplicadas

| Migration | Descrição |
|---|---|
| `20260515045555_init` | Schema inicial completo |
| `20260515144724_plan2_core_modules` | Enums, novos módulos, ContractCounter |
| `20260515150000_add_payment_id_to_financial_transaction` | Associação pagamento → lançamento |
| `20260515151000_add_void_fields_to_financial_transaction` | Campos de anulação de lançamento |
| `20260520174259_add_performance_indexes` | 10 índices de performance |

---

## Scripts disponíveis

### Backend

```bash
npm run start:dev     # Dev server com hot reload
npm run start:prod    # Produção
npm run build         # Compilar TypeScript
npm run test          # Rodar suite de testes
npm run test:watch    # Testes em modo watch
npm run test:cov      # Testes com cobertura
npm run lint          # ESLint
npm run prisma:migrate  # prisma migrate dev
npm run prisma:studio   # Prisma Studio
```

### Frontend

```bash
npm run dev           # Dev server (Vite)
npm run build         # Build de produção
npm run preview       # Preview do build
npm run test          # Vitest (modo CI)
npm run test:watch    # Vitest modo watch
npm run test:coverage # Cobertura de testes
npm run lint          # ESLint
```

---

## Testes

### Frontend — Vitest + Testing Library

```bash
cd frontend && npm run test
```

- **183 testes** em 25 suites
- Padrão: `vi.mock` + `setupMocks()` + `renderPage()`
- Cobertura: todos os componentes de feature, hooks, utils e helpers

```
src/tests/
├── auth/
├── calendar/          # CalendarPage + eventUrgency + calendarHelpers
├── customers/
├── dashboard/
├── documents/
├── feedback/
├── financial/
├── filters/           # FilterPanel
├── inventory/
├── layout/
├── payments/
└── rentals/
```

### Backend — Jest

```bash
cd backend && npm run test
```

- **190 testes** em 10 suites (193 total, 3 pré-existentes com falha conhecida em `auth.service.spec`)
- Testes unitários com mocks do PrismaService e dependências
- Cobertura: todos os services, guards e controllers

```
src/modules/
├── auth/auth.service.spec.ts
├── customers/customers.service.spec.ts
├── inventory/inventory.service.spec.ts
├── rentals/rentals.service.spec.ts
├── returns/returns.service.spec.ts
├── payments/payments.service.spec.ts
├── financial/financial.service.spec.ts
├── documents/documents.service.spec.ts
├── dashboard/dashboard.service.spec.ts
└── audit/audit.service.spec.ts
```

---

## Autenticação e RBAC

### Fluxo de autenticação

```
POST /auth/login
  → valida credenciais
  → retorna accessToken (15min) + refreshToken (7d)

POST /auth/refresh
  → valida refreshToken
  → retorna novo par de tokens (rotação)

POST /auth/logout
  → revoga refreshToken

Axios interceptor (frontend)
  → injeta accessToken no header Authorization
  → em 401, tenta refresh automático
  → se refresh falhar, redireciona para /login
```

### Papéis e permissões

| Recurso | Admin | Atendente | Financeiro |
|---|---|---|---|
| Dashboard | ✅ completo | ✅ operacional | ✅ financeiro |
| Clientes | ✅ CRUD | ✅ CRUD | 👁️ read |
| Estoque | ✅ CRUD | ✅ read | 👁️ read |
| Locações | ✅ CRUD | ✅ criar/ver | 👁️ read |
| Devoluções | ✅ | ✅ | ❌ |
| Pagamentos | ✅ | ❌ | ✅ |
| Financeiro | ✅ | ❌ | ✅ |
| Documentos | ✅ | ✅ | ✅ |
| Calendário | ✅ | ✅ | ❌ |

---

## Responsividade mobile

O layout foi construído mobile-first com duas estratégias complementares:

### Tabelas → listas compactas

Todas as páginas de listagem renderizam dois blocos via Tailwind:

```tsx
{/* Desktop: tabela completa */}
<div className="hidden md:block">
  <Table>...</Table>
</div>

{/* Mobile: lista compacta uma linha por registro */}
<div className="md:hidden divide-y rounded-md border">
  {data.map(item => (
    <div className="flex items-center gap-3 p-3">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{item.primary}</p>
        <p className="text-xs text-muted-foreground">{item.secondary}</p>
      </div>
      <span>{item.value}</span>
      <ChevronRight className="h-4 w-4" />
    </div>
  ))}
</div>
```

### FilterPanel colapsável

Componente compartilhado pelas páginas com múltiplos filtros (Financeiro, Pagamentos, Documentos):

- Desktop: filtros sempre visíveis em layout horizontal
- Mobile: filtros ocultos atrás de um botão `Filtros` com chips dos filtros ativos
- Botão "Limpar filtros" aparece quando há filtros ativos
- Selects com `w-full md:w-{tamanho}` para evitar overflow

### Sidebar mobile

- Inicia fechada em telas pequenas (`window.innerWidth < 768`)
- Ao abrir: overlay semitransparente clicável + scroll lock no body
- Sidebar é `fixed` (overlay) no mobile e `relative` (in-flow) no desktop

### Calendário responsivo

- Toolbar nativa do FullCalendar substituída por toolbar customizada no mobile (dois níveis)
- `ResizeObserver` chama `updateSize()` ao sidebar abrir/fechar
- Legenda em grid 2×2 compacto no mobile

---

## Otimizações de performance

### Frontend

**Code splitting com React.lazy**

Todas as rotas são lazy-loaded. O bundle inicial carrega apenas o shell:

```tsx
const DashboardPage = lazy(() => import('@/features/dashboard/...'))
const CalendarPage  = lazy(() => import('@/features/calendar/...'))
// ... todas as demais rotas
```

**manualChunks no Vite**

Vendors separados em chunks cacheáveis independentemente:

| Chunk | Conteúdo | Gzip |
|---|---|---|
| `react-vendor` | react, react-dom, react-router | ~52 kB |
| `query-vendor` | @tanstack/react-query | ~15 kB |
| `form-vendor` | react-hook-form, zod, resolvers | ~24 kB |
| `charts-vendor` | recharts | ~118 kB |
| `calendar-vendor` | @fullcalendar/* | ~61 kB |
| `date-vendor` | date-fns | ~6 kB |
| `index.js` (app) | código da aplicação | ~45 kB |

> O bundle principal caiu de **420 kB → 134 kB** gzip (-68%).

**TanStack Query**

```ts
defaultOptions: {
  queries: {
    retry: 1,
    staleTime: 30_000,   // dados frescos por 30s
    gcTime: 5 * 60_000,  // removidos da memória após 5min sem uso
  },
}
```

### Backend

**Aggregate no lugar de findMany + reduce**

```ts
// Antes: carregava todos os itens em memória
const items = await this.prisma.item.findMany({ where: { isActive: true }, select: {...} })
const total = items.reduce(...)

// Depois: query de agregação no banco
const agg = await this.prisma.item.aggregate({
  where: { isActive: true },
  _sum: { totalQty: true, availableQty: true, rentedQty: true, maintenanceQty: true },
})
```

**Remoção de N+1 na criação de locação**

```ts
// Antes: N queries para N itens
for (const ri of dto.items) {
  const item = await tx.item.findUnique({ where: { id: ri.itemId } })
}

// Depois: 1 query para todos
const items = await tx.item.findMany({
  where: { id: { in: dto.items.map(r => r.itemId) } },
})
const itemMap = new Map(items.map(i => [i.id, i]))
```

**10 índices de banco adicionados** para os filtros mais frequentes (ver seção [Banco de dados](#banco-de-dados-e-prisma)).

---

## Segurança

### Camadas de proteção

| Camada | Mecanismo |
|---|---|
| Transporte | Helmet (headers HTTP seguros) |
| Autenticação | JWT com refresh rotation, bcrypt no hash de senha |
| Autorização | Guards NestJS por role em todos os endpoints |
| Validação de entrada | `class-validator` nos DTOs (backend) + Zod nos forms (frontend) |
| CORS | Allowlist explícita de origens (`FRONTEND_URL`) |
| Audit log | Registro de todas as mutações com userId, entity, payload, IP |

### Proteção por profundidade

- **Frontend**: rotas protegidas com `ProtectedRoute` e `RoleGuard`
- **Backend**: guards validam JWT e role antes de qualquer handler
- **Banco**: queries usam IDs gerados pelo servidor (UUID v4), nunca IDs do cliente

---

## Decisões técnicas

| Decisão | Motivação |
|---|---|
| **Prisma 7** com `prisma.config.ts` | API nova com `defineConfig()` + `@prisma/adapter-pg`; o `schema.prisma` não usa `datasource url` diretamente |
| **Status computado** no rental | `overdue` não é salvo no banco — calculado em runtime comparando `expectedReturn` com hoje; evita inconsistência e queries de atualização em batch |
| **Dual-render mobile** (tabela + lista) | Mais simples e flexível que um `<ResponsiveTable>` genérico — cada página tem render específico |
| **FilterPanel** como abstração | A lógica de expand/collapse e chips é idêntica nas 3 páginas com filtros complexos |
| **PDFKit server-side** | Geração de PDF no backend garante template consistente e sem dependência do browser |
| **Aggregate no dashboard** | Evita carregar N itens em memória para apenas somar quantidades |
| **ResizeObserver no calendário** | FullCalendar só escuta `window.resize`, não mudanças de container — o observer resolve a sidebar toggle |
| **gcTime no QueryClient** | Sem esse parâmetro, queries antigas ficam em memória indefinidamente |
| **manualChunks separados** | Vendors pesados (Recharts, FullCalendar) não bloqueiam o carregamento inicial |

---

## Roadmap

- [ ] **TypeScript strict mode** no backend (`strictNullChecks`, `noImplicitAny`)
- [ ] **Notificações in-app** para devoluções próximas do vencimento
- [ ] **Relatórios exportáveis** (CSV/Excel) com os mesmos filtros das telas
- [ ] **Upload real de PDFs** para storage (S3/MinIO) em vez de geração on-demand
- [ ] **Multi-tenant** — isolamento de dados por empresa
- [ ] **Integração PIX** via API (Mercado Pago / PagSeguro)
- [ ] **Configurações de empresa** — taxas padrão, carência, logo no PDF
- [ ] **Range loading no calendário** — filtrar por período diretamente na view
- [ ] **CI/CD** — GitHub Actions com lint, testes, build e deploy automatizado
- [ ] **Testes E2E** com Playwright (fluxo locação → pagamento → devolução)
- [ ] **PWA** — suporte offline básico para consultas em campo

---

## Autor

**Victor Cassio**
- GitHub: [@victorcassio](https://github.com/victorcassio)
- E-mail: victorcassiolol@gmail.com

---

*Projeto desenvolvido como sistema completo de gestão operacional e financeira para empresas de aluguel de equipamentos.*
