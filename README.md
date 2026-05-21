# Inventory Manager

> 🌐 **English** | [Versão em Português](README.pt-BR.md)

A full-featured web application for managing equipment and material rentals. Covers the entire lifecycle end-to-end: inventory control, rental contract creation and tracking, partial or full returns, payments, financial entries, PDF document generation, and an operational returns calendar.

Designed for companies that rent scaffolding, tools, generators, construction equipment, and similar items.

---

## Table of Contents

- [Stack](#stack)
- [Features](#features)
- [Screenshots](#screenshots)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database and Prisma](#database-and-prisma)
- [Available Scripts](#available-scripts)
- [Testing](#testing)
- [Authentication and RBAC](#authentication-and-rbac)
- [Mobile Responsiveness](#mobile-responsiveness)
- [Performance Optimizations](#performance-optimizations)
- [Security](#security)
- [Deploy](#deploy)
- [Technical Decisions](#technical-decisions)
- [Roadmap](#roadmap)
- [Author](#author)

---

## Stack

### Frontend

| Technology | Version | Purpose |
|---|---|---|
| React | 18.3 | UI library |
| TypeScript | 5.7 | Static typing |
| Vite | 6.0 | Build tool and dev server |
| React Router | 6.28 | SPA routing |
| TanStack Query | 5.62 | Server state and caching |
| Zustand | 5.0 | Global auth state |
| React Hook Form | 7.54 | Form handling |
| Zod | 3.24 | Schema validation |
| Tailwind CSS | 3.4 | Styling |
| shadcn/ui + Radix | — | Accessible component primitives |
| Recharts | 3.8 | Dashboard charts |
| FullCalendar | 6.1 | Operational calendar |
| Axios | 1.7 | HTTP client |
| date-fns | 4.1 | Date manipulation |
| Lucide React | 0.468 | Icon library |
| Sonner | 1.7 | Toast notifications |

### Backend

| Technology | Version | Purpose |
|---|---|---|
| Node.js | 20.x | Runtime |
| NestJS | 10.4 | HTTP framework |
| Prisma | 7.8 | ORM |
| PostgreSQL | 16 | Database |
| JWT + Passport | — | Authentication |
| PDFKit | — | Server-side PDF generation |
| Helmet | — | HTTP security headers |
| class-validator | — | DTO validation |

### Infrastructure and Tooling

| Technology | Purpose |
|---|---|
| Docker Compose | Local PostgreSQL |
| Vitest | Frontend testing |
| Jest | Backend testing |
| React.lazy + Suspense | Code splitting |

---

## Features

### Auth and RBAC

- Email and password login with rotating JWT refresh tokens
- 3 access roles with granular permissions:
  - **Admin** — full access
  - **Attendant** — rental operations, returns, inventory, and documents
  - **Financial** — dashboard, payments, financial entries, and documents
- Guards on all sensitive backend endpoints
- Frontend route protection with automatic redirects

### Dashboard

- Real-time KPIs: monthly revenue, active rentals, overdue, delinquency
- Bar chart: revenue vs. expenses for the last 6 months
- Pie chart: rental status distribution
- Inventory occupancy bar (available, rented, under maintenance)
- Upcoming returns list and overdue rentals list
- Role-based visibility: financial role does not see operational customer data

### Customers

- Individual (CPF) and company (CNPJ) registration with document validation
- Name search with debounce
- Paginated listing, detail view, and editing
- Rental history per customer

### Inventory

- Items with unique code, category, daily rate, and quantity tracking (total/available/rented/maintenance)
- Equipment categories
- Automatic availability control on every rental and return
- Audited inventory movements

### Rentals

- Contract creation with multiple items and quantities
- Automatic sequential numbering per year (e.g., `2026-0042`)
- Total calculation: `(daily_rate × days × quantity) − discount + extras`
- Computed status: **Active**, **Overdue** (automatic, no DB field), **Returned**, **Cancelled**
- Filtering by status, customer, and dates
- Cancellation with automatic stock reversal

### Returns

- Partial or full return per item
- Condition tracking (good, damaged, lost)
- Automatic damage fee per item
- Late days and late fee calculation

### Payments

- Payment registration per rental (cash, PIX, card, bank transfer)
- Global payment history with period and method filters
- Outstanding balance calculated in real time
- Automatic financial entry creation on payment

### Financial

- Manual income and expense entries (rental, inventory, maintenance, transport, etc.)
- Automatic entries generated from rental payments
- Filters by type, category, origin, and period (today, week, month, last month, year, custom)
- Summary of income, expenses, balance, and voided entries
- Entry voiding with reason tracking

### Documents

- Server-side PDF generation via PDFKit:
  - **Rental contract** — customer data, items, period, and total
  - **Payment receipt** — proof with method and reference code
  - **Return proof** — returned items, conditions, and fees
- Global listing with filters by type, status, contract, and period
- Direct PDF download

### Calendar

- Monthly and list views of expected returns for active rentals
- Color-coded urgency:
  - 🔴 Overdue
  - 🟠 Due today
  - 🟡 Next 1–3 days
  - 🟢 Future
- Click on event navigates to the contract
- Custom two-level toolbar on mobile
- ResizeObserver recalculates layout on sidebar open/close

### Mobile

- All tables converted to compact lists on mobile (`< 768px`)
- Collapsible `FilterPanel` with active filter chips
- Sidebar with overlay and body scroll lock on mobile
- Responsive pagination (`Showing X–Y of Z`)
- Desktop layout unchanged

---

## Screenshots

### Dashboard

![Dashboard — KPIs](docs/screenshots/dashboard-kpis.png)
*Financial KPIs, rental status, and real-time inventory overview*

![Dashboard — Charts](docs/screenshots/dashboard-charts.png)
*Revenue vs. Expenses (6 months), cumulative revenue, rental status pie, and inventory occupancy*

![Dashboard — Operational Lists](docs/screenshots/dashboard-lists.png)
*Recent payments, upcoming returns, and overdue returns*

---

### Customers and Inventory

| Customers | New Customer |
|---|---|
| ![Customers](docs/screenshots/customers.png) | ![New Customer](docs/screenshots/customer-form.png) |

| Inventory | New Item |
|---|---|
| ![Inventory](docs/screenshots/inventory.png) | ![New Item](docs/screenshots/inventory-form.png) |

---

### Rentals and Payments

![Rentals](docs/screenshots/rentals.png)
*Listing with computed status: Active, Overdue, Returned, Cancelled*

| New Rental | Payments |
|---|---|
| ![New Rental](docs/screenshots/rental-form.png) | ![Payments](docs/screenshots/payments.png) |

---

### Financial

![Financial](docs/screenshots/financial.png)
*Entries with income/expense KPIs, balance, and period filters*

![New Entry](docs/screenshots/financial-form.png)
*Manual entry form with visual type selector (income/expense)*

---

### Documents and PDFs

![Documents](docs/screenshots/documents.png)
*Global listing of contracts, receipts, and return proofs with direct download*

| Rental Contract (PDF) | Payment Receipt (PDF) |
|---|---|
| ![PDF Contract](docs/screenshots/pdf-contract.png) | ![PDF Receipt](docs/screenshots/pdf-receipt.png) |

---

### Operational Calendar

![Calendar — Month View](docs/screenshots/calendar-month.png)
*Monthly view with color-coded return urgency events*

![Calendar — List View](docs/screenshots/calendar-list.png)
*Agenda view with all contracts and return dates*

---

## Project Structure

```
inventory-manager/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # Models and indexes
│   │   ├── migrations/            # Migration history
│   │   ├── seed.ts                # Production seed (admin users)
│   │   └── seed-demo.ts           # Development seed with full demo data
│   └── src/
│       ├── common/                # Shared pipes, filters, and types
│       ├── prisma/                # PrismaService
│       └── modules/
│           ├── auth/              # JWT, login, refresh token
│           ├── users/             # User management
│           ├── audit/             # Mutation audit log
│           ├── customers/         # Individual and company customers
│           ├── inventory/         # Items, categories, movements
│           ├── rentals/           # Rental contracts
│           ├── returns/           # Partial and full returns
│           ├── payments/          # Payments per rental
│           ├── financial/         # Financial entries
│           ├── documents/         # PDF generation and listing
│           └── dashboard/         # KPIs and charts
├── frontend/
│   └── src/
│       ├── app/                   # Providers, router, root layout
│       ├── components/
│       │   ├── ui/                # shadcn/ui components
│       │   ├── layout/            # AppLayout, Sidebar, Header
│       │   ├── feedback/          # EmptyState, ErrorState, StatusBadge
│       │   └── filters/           # FilterPanel (collapsible mobile)
│       ├── features/              # One folder per domain
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
│       └── types/                 # Global TypeScript types
└── docker-compose.dev.yml         # Local PostgreSQL
```

---

## Getting Started

### Prerequisites

- Node.js 20.x
- Docker and Docker Compose
- `nvm` (recommended)

```bash
# Clone the repository
git clone https://github.com/victorcassio/inventory-manager.git
cd inventory-manager
```

### 1. Database

```bash
# Start PostgreSQL via Docker
docker compose -f docker-compose.dev.yml up -d postgres
```

### 2. Backend

```bash
cd backend

# Use the correct Node version
nvm use 20

# Install dependencies
npm install

# Copy and configure environment variables
cp .env.example .env
# edit DATABASE_URL, JWT_SECRET, etc.

# Apply migrations
npx prisma migrate dev

# Seed the database with demo data
npx ts-node prisma/seed-demo.ts

# Start the development server (port 3003)
npm run start:dev
```

### 3. Frontend

```bash
cd frontend

# Install dependencies
npm install

# Copy and configure environment variables
cp .env.example .env
# edit VITE_API_URL=http://localhost:3003/api/v1

# Start the dev server (port 5173)
npm run dev
```

### Development Credentials

| User | Email | Password | Role |
|---|---|---|---|
| Administrator | `admin@inventory.local` | `Admin@123456` | admin |
| Attendant | `atendente@inventory.local` | `Admin@123456` | attendant |
| Financial | `financeiro@inventory.local` | `Admin@123456` | financial |

---

## Environment Variables

### Backend (`backend/.env`)

```env
# Database
DATABASE_URL="postgresql://inventory_user:inventory_pass_dev@localhost:5440/inventory_db"

# JWT
JWT_SECRET="your-secret-key-here"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_SECRET="your-refresh-secret-here"
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

## Database and Prisma

### Main Models

```
User → RefreshToken
Customer → Rental → RentalItem → Item → ItemCategory
                 → Return → ReturnItem
                 → Payment → FinancialTransaction
                 → Document
InventoryMovement (tracks all stock movements)
AuditLog (tracks all mutations with userId, entity, payload)
ContractCounter (sequential contract numbering per year)
```

### Performance Indexes

Added via migration `20260520174259_add_performance_indexes`:

| Table | Indexed Columns |
|---|---|
| `rentals` | `(status, expected_return)`, `(customer_id)` |
| `payments` | `(rental_id)`, `(paid_at)` |
| `financial_transactions` | `(is_voided, date)`, `(user_id, date)` |
| `items` | `(category_id)`, `(is_active)` |
| `rental_items` | `(rental_id)`, `(item_id)` |

### Prisma Commands

```bash
# Development — create and apply migration
npx prisma migrate dev --name migration_name

# Production — apply migrations without changing schema
npx prisma migrate deploy

# Inspect the database in the browser
npx prisma studio

# Regenerate Prisma Client types
npx prisma generate

# Demo seed (development only)
npx ts-node prisma/seed-demo.ts

# Full reset (dev only — DESTROYS ALL DATA)
npx prisma migrate reset --force
```

### Applied Migrations

| Migration | Description |
|---|---|
| `20260515045555_init` | Full initial schema |
| `20260515144724_plan2_core_modules` | Enums, new modules, ContractCounter |
| `20260515150000_add_payment_id_to_financial_transaction` | Payment → financial entry association |
| `20260515151000_add_void_fields_to_financial_transaction` | Entry voiding fields |
| `20260520174259_add_performance_indexes` | 10 performance indexes |

---

## Available Scripts

### Backend

```bash
npm run start:dev     # Dev server with hot reload
npm run start:prod    # Production server
npm run build         # Compile TypeScript
npm run test          # Run test suite
npm run test:watch    # Tests in watch mode
npm run test:cov      # Tests with coverage report
npm run lint          # ESLint
npm run prisma:migrate  # prisma migrate dev
npm run prisma:studio   # Prisma Studio
```

### Frontend

```bash
npm run dev           # Vite dev server
npm run build         # Production build
npm run preview       # Preview production build
npm run test          # Vitest (CI mode)
npm run test:watch    # Vitest watch mode
npm run test:coverage # Coverage report
npm run lint          # ESLint
```

---

## Testing

### Frontend — Vitest + Testing Library

```bash
cd frontend && npm run test
```

- **183 tests** across 25 suites (183/183 passing)
- Pattern: `vi.mock` + `setupMocks()` + `renderPage()`
- Coverage: all feature components, hooks, utils, and helpers

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

- **215 tests** across 11 suites (215/215 passing)
- Unit tests with PrismaService and dependency mocks
- Coverage: all services, guards, and controllers

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
├── health/health.controller.spec.ts
└── audit/audit.service.spec.ts
```

---

## Authentication and RBAC

### Authentication Flow

```
POST /auth/login
  → validates credentials
  → returns accessToken (15min) + refreshToken (7d)

POST /auth/refresh
  → validates refreshToken
  → returns new token pair (rotation)

POST /auth/logout
  → revokes refreshToken

Axios interceptor (frontend)
  → injects accessToken in Authorization header
  → on 401, attempts automatic refresh
  → if refresh fails, redirects to /login
```

### Roles and Permissions

| Resource | Admin | Attendant | Financial |
|---|---|---|---|
| Dashboard | ✅ full | ✅ operational | ✅ financial |
| Customers | ✅ CRUD | ✅ CRUD | 👁️ read |
| Inventory | ✅ CRUD | ✅ read | 👁️ read |
| Rentals | ✅ CRUD | ✅ create/view | 👁️ read |
| Returns | ✅ | ✅ | ❌ |
| Payments | ✅ | ❌ | ✅ |
| Financial | ✅ | ❌ | ✅ |
| Documents | ✅ | ✅ | ✅ |
| Calendar | ✅ | ✅ | ❌ |

---

## Mobile Responsiveness

The layout uses two complementary mobile-first strategies:

### Tables → Compact Lists

All listing pages render two mutually exclusive blocks via Tailwind:

```tsx
{/* Desktop: full table */}
<div className="hidden md:block">
  <Table>...</Table>
</div>

{/* Mobile: compact one-row-per-record list */}
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

### Collapsible FilterPanel

Shared component used by pages with multiple filters (Financial, Payments, Documents):

- Desktop: filters always visible in horizontal layout
- Mobile: filters hidden behind a `Filters` button with active filter chips
- "Clear filters" button appears when filters are active
- Selects use `w-full md:w-{size}` to prevent overflow

### Mobile Sidebar

- Starts closed on small screens (`window.innerWidth < 768`)
- When opened: clickable semi-transparent overlay + body scroll lock
- Sidebar is `fixed` (overlay) on mobile and `relative` (in-flow) on desktop

### Responsive Calendar

- FullCalendar's native toolbar replaced by a custom two-level toolbar on mobile
- `ResizeObserver` calls `updateSize()` when the sidebar opens/closes
- Legend rendered in a compact 2×2 grid on mobile

---

## Performance Optimizations

### Frontend

**Code splitting with React.lazy**

All routes are lazy-loaded. The initial bundle only loads the app shell:

```tsx
const DashboardPage = lazy(() => import('@/features/dashboard/...'))
const CalendarPage  = lazy(() => import('@/features/calendar/...'))
// ... all other routes
```

**Vite manualChunks**

Vendors split into independently cacheable chunks:

| Chunk | Contents | Gzip |
|---|---|---|
| `react-vendor` | react, react-dom, react-router | ~52 kB |
| `query-vendor` | @tanstack/react-query | ~15 kB |
| `form-vendor` | react-hook-form, zod, resolvers | ~24 kB |
| `charts-vendor` | recharts | ~118 kB |
| `calendar-vendor` | @fullcalendar/* | ~61 kB |
| `date-vendor` | date-fns | ~6 kB |
| `index.js` (app) | application code | ~45 kB |

> Main bundle reduced from **420 kB → 134 kB** gzip (-68%).

**TanStack Query**

```ts
defaultOptions: {
  queries: {
    retry: 1,
    staleTime: 30_000,   // data considered fresh for 30s
    gcTime: 5 * 60_000,  // removed from memory after 5min of inactivity
  },
}
```

### Backend

**Aggregate instead of findMany + reduce**

```ts
// Before: loaded all items into memory
const items = await this.prisma.item.findMany({ where: { isActive: true }, select: {...} })
const total = items.reduce(...)

// After: database aggregation query
const agg = await this.prisma.item.aggregate({
  where: { isActive: true },
  _sum: { totalQty: true, availableQty: true, rentedQty: true, maintenanceQty: true },
})
```

**N+1 removal in rental creation**

```ts
// Before: N queries for N items
for (const ri of dto.items) {
  const item = await tx.item.findUnique({ where: { id: ri.itemId } })
}

// After: 1 query for all items
const items = await tx.item.findMany({
  where: { id: { in: dto.items.map(r => r.itemId) } },
})
const itemMap = new Map(items.map(i => [i.id, i]))
```

**10 database indexes added** for the most frequently queried fields (see [Database and Prisma](#database-and-prisma)).

---

## Security

### Defense in Depth

| Layer | Mechanism |
|---|---|
| Transport | Helmet (secure HTTP headers: CSP, HSTS, X-Frame, X-Content-Type) |
| Authentication | JWT with refresh rotation, bcrypt password hashing |
| Authorization | NestJS role guards on all endpoints |
| Input validation | `class-validator` on DTOs (backend) + Zod on forms (frontend) |
| CORS | Explicit origin allowlist (`FRONTEND_URL`) — unknown origins blocked |
| Rate limiting | Login: 10/min · Refresh: 15/min · Global: 100/min |
| Audit log | All mutations logged with userId, entity, payload, and IP |
| Token cleanup | Expired and revoked refresh tokens purged on every login |

### Additional Protections

- **Frontend**: routes protected with `ProtectedRoute` and `RoleGuard`; `ReactQueryDevtools` disabled in production
- **Backend**: guards validate JWT and role before any handler runs; filesystem paths never exposed in API responses; auth error messages are generic to prevent enumeration
- **Database**: queries use server-generated UUIDs; filesystem paths never returned in responses
- **Startup validation**: app refuses to start in `NODE_ENV=production` if JWT secrets are absent or contain weak placeholder values

### Deploy Security Checklist

Before every production deploy, follow the checklist at [`docs/security-checklist-deploy.md`](docs/security-checklist-deploy.md). It covers secrets rotation, environment variables, database safety, CORS/headers validation, and a pre-go-live sign-off checklist.

---

## Deploy

### Recommended free stack (zero cost for testing)

| Layer | Service | Cost |
|---|---|---|
| Frontend | [Vercel](https://vercel.com) | Free |
| Backend (NestJS) | [Render](https://render.com) | Free (cold start ~30s after 15min idle) |
| Database (PostgreSQL) | [Neon](https://neon.tech) | Free (0.5 GB) |
| Keep-alive | [UptimeRobot](https://uptimerobot.com) | Free (ping every 5min → prevents cold start) |
| Domain / SSL | Free subdomains from each platform | Free |

> For production with consistent uptime, upgrade to Railway (~$5/month for backend + DB) and keep Vercel free for the frontend.

### Deploy steps

#### 1. Database — Neon

1. Create account at `neon.tech`
2. Create a new project → copy the `DATABASE_URL`
3. Set in Render environment variables

#### 2. Backend — Render

```bash
# Build command (in Render dashboard)
npm install && npm run build

# Start command
node dist/main

# Environment variables to set:
NODE_ENV=production
DATABASE_URL=<neon-connection-string>
JWT_ACCESS_SECRET=<openssl rand -hex 64>
JWT_REFRESH_SECRET=<openssl rand -hex 64>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
PORT=3003
FRONTEND_URL=https://your-app.vercel.app
```

After first deploy, run migrations via Render shell:
```bash
npx prisma migrate deploy
```

#### 3. Frontend — Vercel

```bash
# Build command (auto-detected or set manually)
npm run build

# Output directory
dist

# Environment variables to set:
VITE_API_URL=https://your-api.onrender.com/api/v1
```

#### 4. UptimeRobot (optional, prevents cold start)

1. Create a free monitor at `uptimerobot.com`
2. Type: HTTP(s)
3. URL: `https://your-api.onrender.com/api/v1/health`
4. Interval: 5 minutes

> `GET /api/v1/health` requires no authentication and is excluded from rate limiting — ideal for uptime monitors.

### Production smoke test

After deploy, verify the golden path:

```
1. Open https://your-app.vercel.app
2. Log in with production credentials
3. Create a customer
4. Create a rental with 2 items
5. Register a payment
6. Download the generated PDF receipt
7. Check the dashboard for updated KPIs
```

---

## Technical Decisions

| Decision | Rationale |
|---|---|
| **Prisma 7** with `prisma.config.ts` | New API with `defineConfig()` + `@prisma/adapter-pg`; `schema.prisma` no longer holds the datasource URL directly |
| **Computed rental status** | `overdue` is not stored in the DB — calculated at runtime by comparing `expectedReturn` with today; avoids inconsistency and batch update queries |
| **Dual-render mobile** (table + list) | Simpler and more flexible than a generic `<ResponsiveTable>` — each page has its own specific render logic |
| **FilterPanel abstraction** | Expand/collapse logic and chip display are identical across the 3 pages with complex filters |
| **Server-side PDFKit** | Backend PDF generation ensures consistent templates without browser dependency |
| **Aggregate in dashboard** | Avoids loading N items into memory just to sum quantities |
| **ResizeObserver in calendar** | FullCalendar only listens to `window.resize`, not DOM mutations — the observer handles sidebar toggle layout changes |
| **gcTime in QueryClient** | Without this parameter, unused queries remain in memory indefinitely |
| **Separate manualChunks** | Heavy vendors (Recharts, FullCalendar) don't block the initial page load |

---

## Roadmap

- [ ] **TypeScript strict mode** in the backend (`strictNullChecks`, `noImplicitAny`)
- [ ] **In-app notifications** for rentals approaching their return date
- [ ] **Exportable reports** (CSV/Excel) using the same filters as the list pages
- [ ] **Real PDF storage** to S3/MinIO instead of on-demand generation
- [ ] **Multi-tenant** — data isolation per company
- [ ] **PIX payment integration** via API (Mercado Pago / PagSeguro)
- [ ] **Company settings** — default rates, grace periods, logo in PDF
- [ ] **Calendar range loading** — filter by period directly in the view
- [ ] **CI/CD** — GitHub Actions pipeline with lint, tests, build, and deploy
- [ ] **E2E tests** with Playwright (full rental → payment → return flow)
- [ ] **PWA** — basic offline support for field use

---

## Author

**Victor Cassio**
- GitHub: [@victorcassio](https://github.com/victorcassio)
- Email: victorcassiov@gmail.com

---

*A complete operational and financial management system for equipment rental companies.*
