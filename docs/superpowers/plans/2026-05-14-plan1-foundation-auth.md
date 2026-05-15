# Inventory Manager — Plano 1: Foundation, Auth & RBAC

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo com backend NestJS + PostgreSQL totalmente configurado, autenticação JWT com refresh token rotation e RBAC funcional — base segura para todos os módulos seguintes.

**Architecture:** Monorepo `/frontend` + `/backend` co-localizados. Backend NestJS com módulos por domínio. Docker Compose sobe PostgreSQL localmente. Auth usa access_token (15min) + refresh_token (7d) armazenado em banco com rotação a cada uso. Refresh tokens revogados no logout.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL 16, passport-local + passport-jwt, bcrypt (salt 12), @nestjs/throttler, Helmet, class-validator, class-transformer, Jest, Supertest

---

## File Map

```
inventory-manager/
├── .gitignore
├── .env.example
├── docker-compose.yml
├── docker-compose.dev.yml
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.build.json
│   ├── nest-cli.json
│   ├── jest.config.ts
│   ├── .env.example
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seed.ts
│   └── src/
│       ├── main.ts
│       ├── app.module.ts
│       ├── config/
│       │   └── app.config.ts
│       ├── prisma/
│       │   ├── prisma.module.ts
│       │   └── prisma.service.ts
│       ├── common/
│       │   ├── filters/
│       │   │   └── global-exception.filter.ts
│       │   ├── guards/
│       │   │   ├── jwt-auth.guard.ts
│       │   │   └── roles.guard.ts
│       │   └── decorators/
│       │       ├── roles.decorator.ts
│       │       └── current-user.decorator.ts
│       └── modules/
│           ├── users/
│           │   ├── users.module.ts
│           │   └── users.service.ts
│           └── auth/
│               ├── auth.module.ts
│               ├── auth.controller.ts
│               ├── auth.service.ts
│               ├── auth.service.spec.ts
│               ├── dto/
│               │   ├── login.dto.ts
│               │   └── refresh-token.dto.ts
│               └── strategies/
│                   ├── local.strategy.ts
│                   ├── jwt.strategy.ts
│                   └── jwt-refresh.strategy.ts
└── test/
    └── auth.e2e-spec.ts
```

---

### Task 1: Monorepo root — estrutura de pastas e arquivos de configuração

**Files:**
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Criar `.gitignore` na raiz:**

```
node_modules/
dist/
.env
*.log
.DS_Store
coverage/
.superpowers/
```

- [ ] **Criar `.env.example` na raiz** (documenta o formato, nunca tem segredos):

```
# Copie para .env e preencha os valores reais
POSTGRES_USER=inventory_user
POSTGRES_PASSWORD=change_me
POSTGRES_DB=inventory_db
```

- [ ] **Criar pasta `backend/` e `frontend/` vazias** (frontend será preenchido no Plano 3):

```bash
mkdir -p backend frontend
```

- [ ] **Commit:**

```bash
git init
git add .gitignore .env.example
git commit -m "chore: monorepo root scaffold"
```

---

### Task 2: Docker Compose com PostgreSQL

**Files:**
- Create: `docker-compose.yml`
- Create: `docker-compose.dev.yml`

- [ ] **Criar `docker-compose.yml`** (base — usado em produção e CI):

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:16-alpine
    container_name: inventory_postgres
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - '5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}']
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  pgdata:
```

- [ ] **Criar `docker-compose.dev.yml`** (adiciona pgAdmin para dev local):

```yaml
version: '3.9'

services:
  postgres:
    extends:
      file: docker-compose.yml
      service: postgres

  pgadmin:
    image: dpage/pgadmin4:8
    container_name: inventory_pgadmin
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@local.dev
      PGADMIN_DEFAULT_PASSWORD: admin
    ports:
      - '5050:80'
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pgdata:
```

- [ ] **Criar `.env`** na raiz (não commitado):

```
POSTGRES_USER=inventory_user
POSTGRES_PASSWORD=inventory_pass_dev
POSTGRES_DB=inventory_db
```

- [ ] **Subir postgres:**

```bash
docker compose -f docker-compose.dev.yml up -d
```

- [ ] **Verificar que está healthy:**

```bash
docker compose ps
```

Expected: `inventory_postgres` com status `healthy`.

- [ ] **Commit:**

```bash
git add docker-compose.yml docker-compose.dev.yml .env.example
git commit -m "chore: add docker compose with postgres"
```

---

### Task 3: Backend — dependências e configuração TypeScript

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/tsconfig.build.json`
- Create: `backend/nest-cli.json`
- Create: `backend/jest.config.ts`
- Create: `backend/.env.example`

- [ ] **Instalar dependências** (dentro de `backend/`):

```bash
cd backend

npm init -y

# Runtime
npm install @nestjs/common@^10 @nestjs/core@^10 @nestjs/platform-express@^10 \
  reflect-metadata rxjs

npm install @nestjs/config @nestjs/jwt @nestjs/passport @nestjs/throttler

npm install passport passport-local passport-jwt

npm install @prisma/client bcrypt helmet class-validator class-transformer uuid

# Dev
npm install -D @nestjs/cli @nestjs/schematics @nestjs/testing \
  typescript ts-node ts-jest jest \
  supertest \
  @types/node @types/bcrypt @types/passport-local @types/passport-jwt \
  @types/express @types/supertest @types/uuid \
  prisma
```

- [ ] **Criar `backend/tsconfig.json`:**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": false,
    "noImplicitAny": false,
    "strictBindCallApply": false,
    "forceConsistentCasingInFileNames": false,
    "noFallthroughCasesInSwitch": false
  }
}
```

- [ ] **Criar `backend/tsconfig.build.json`:**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*.spec.ts", "**/*.e2e-spec.ts"]
}
```

- [ ] **Criar `backend/nest-cli.json`:**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Criar `backend/jest.config.ts`:**

```typescript
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};

export default config;
```

- [ ] **Atualizar `backend/package.json`** com scripts:

```json
{
  "scripts": {
    "build": "nest build",
    "start": "node dist/main",
    "start:dev": "nest start --watch",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "test:e2e": "jest --config ./test/jest-e2e.config.ts",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio",
    "prisma:seed": "ts-node prisma/seed.ts"
  }
}
```

- [ ] **Criar `backend/.env.example`:**

```
DATABASE_URL=postgresql://inventory_user:inventory_pass_dev@localhost:5432/inventory_db
JWT_ACCESS_SECRET=min-32-chars-change-me-in-production
JWT_REFRESH_SECRET=different-secret-min-32-chars-change-me
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

- [ ] **Criar `backend/.env`** com os mesmos valores (não commitado).

- [ ] **Commit:**

```bash
git add backend/package.json backend/tsconfig.json backend/tsconfig.build.json \
  backend/nest-cli.json backend/jest.config.ts backend/.env.example
git commit -m "chore: backend nestjs project setup"
```

---

### Task 4: Prisma schema completo

**Files:**
- Create: `backend/prisma/schema.prisma`

- [ ] **Criar `backend/prisma/schema.prisma`:**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Enums ───────────────────────────────────────────────────────────────────

enum UserRole {
  admin
  attendant
  financial
}

enum CustomerDocumentType {
  cpf
  cnpj
}

enum ItemCondition {
  new
  good
  fair
  maintenance
}

enum InventoryMovementType {
  in
  out
  adjustment
  maintenance
  return
}

enum RentalStatus {
  active
  returned
  overdue
  cancelled
}

enum PricingType {
  daily
  fixed
  custom
}

enum PaymentMethod {
  cash
  pix
  card
  transfer
}

enum FinancialTransactionType {
  income
  expense
}

enum FinancialTransactionCategory {
  rental_income
  stock_investment
  maintenance
  transport
  fixed_cost
  other
}

enum ReturnItemCondition {
  good
  damaged
  lost
}

enum DocumentType {
  receipt
  contract
  return_proof
}

// ─── Usuários ────────────────────────────────────────────────────────────────

model User {
  id        String   @id @default(uuid())
  name      String   @db.VarChar(100)
  email     String   @unique @db.VarChar(150)
  password  String   @db.VarChar(255)
  role      UserRole
  isActive  Boolean  @default(true) @map("is_active")
  lastLogin DateTime? @map("last_login")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  refreshTokens         RefreshToken[]
  rentals               Rental[]
  inventoryMovements    InventoryMovement[]
  payments              Payment[]
  returns               Return[]
  financialTransactions FinancialTransaction[]
  documents             Document[]
  auditLogs             AuditLog[]

  @@map("users")
}

model RefreshToken {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  token     String   @unique @db.VarChar(500)
  expiresAt DateTime @map("expires_at")
  revoked   Boolean  @default(false)
  createdAt DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("refresh_tokens")
}

// ─── Clientes ────────────────────────────────────────────────────────────────

model Customer {
  id           String               @id @default(uuid())
  name         String               @db.VarChar(150)
  document     String               @unique @db.VarChar(18)
  documentType CustomerDocumentType @map("document_type")
  phone        String?              @db.VarChar(20)
  email        String?              @db.VarChar(150)
  address      Json?
  notes        String?
  isActive     Boolean              @default(true) @map("is_active")
  createdAt    DateTime             @default(now()) @map("created_at")
  updatedAt    DateTime             @updatedAt @map("updated_at")

  rentals Rental[]

  @@map("customers")
}

// ─── Estoque ─────────────────────────────────────────────────────────────────

model ItemCategory {
  id          String   @id @default(uuid())
  name        String   @db.VarChar(100)
  description String?
  createdAt   DateTime @default(now()) @map("created_at")

  items Item[]

  @@map("item_categories")
}

model Item {
  id             String        @id @default(uuid())
  categoryId     String        @map("category_id")
  name           String        @db.VarChar(150)
  description    String?
  code           String        @unique @db.VarChar(50)
  dailyRate      Decimal       @map("daily_rate") @db.Decimal(10, 2)
  totalQty       Int           @map("total_qty")
  availableQty   Int           @map("available_qty")
  rentedQty      Int           @default(0) @map("rented_qty")
  maintenanceQty Int           @default(0) @map("maintenance_qty")
  condition      ItemCondition @default(good)
  notes          String?
  isActive       Boolean       @default(true) @map("is_active")
  createdAt      DateTime      @default(now()) @map("created_at")
  updatedAt      DateTime      @updatedAt @map("updated_at")

  category           ItemCategory        @relation(fields: [categoryId], references: [id])
  rentalItems        RentalItem[]
  inventoryMovements InventoryMovement[]

  @@map("items")
}

model InventoryMovement {
  id        String                @id @default(uuid())
  itemId    String                @map("item_id")
  userId    String                @map("user_id")
  rentalId  String?               @map("rental_id")
  type      InventoryMovementType
  quantity  Int
  reason    String?
  createdAt DateTime              @default(now()) @map("created_at")

  item   Item    @relation(fields: [itemId], references: [id])
  user   User    @relation(fields: [userId], references: [id])
  rental Rental? @relation(fields: [rentalId], references: [id])

  @@map("inventory_movements")
}

// ─── Aluguéis ────────────────────────────────────────────────────────────────

model Rental {
  id             String       @id @default(uuid())
  customerId     String       @map("customer_id")
  userId         String       @map("user_id")
  contractNumber String       @unique @map("contract_number") @db.VarChar(20)
  status         RentalStatus @default(active)
  startedAt      DateTime     @map("started_at") @db.Date
  expectedReturn DateTime     @map("expected_return") @db.Date
  returnedAt     DateTime?    @map("returned_at") @db.Date
  pricingType    PricingType  @default(daily) @map("pricing_type")
  deposit        Decimal      @default(0) @db.Decimal(10, 2)
  discount       Decimal      @default(0) @db.Decimal(10, 2)
  lateFee        Decimal      @default(0) @map("late_fee") @db.Decimal(10, 2)
  extraCosts     Decimal      @default(0) @map("extra_costs") @db.Decimal(10, 2)
  subtotal       Decimal?     @db.Decimal(10, 2)
  total          Decimal?     @db.Decimal(10, 2)
  notes          String?
  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")

  customer              Customer              @relation(fields: [customerId], references: [id])
  user                  User                  @relation(fields: [userId], references: [id])
  rentalItems           RentalItem[]
  payments              Payment[]
  returns               Return[]
  inventoryMovements    InventoryMovement[]
  documents             Document[]
  financialTransactions FinancialTransaction[]

  @@map("rentals")
}

model RentalItem {
  id          String  @id @default(uuid())
  rentalId    String  @map("rental_id")
  itemId      String  @map("item_id")
  quantity    Int
  unitPrice   Decimal @map("unit_price") @db.Decimal(10, 2)
  returnedQty Int     @default(0) @map("returned_qty")

  rental      Rental       @relation(fields: [rentalId], references: [id], onDelete: Cascade)
  item        Item         @relation(fields: [itemId], references: [id])
  returnItems ReturnItem[]

  @@map("rental_items")
}

// ─── Devoluções ──────────────────────────────────────────────────────────────

model Return {
  id         String   @id @default(uuid())
  rentalId   String   @map("rental_id")
  userId     String   @map("user_id")
  returnedAt DateTime @default(now()) @map("returned_at")
  isPartial  Boolean  @default(false) @map("is_partial")
  lateDays   Int      @default(0) @map("late_days")
  lateFee    Decimal  @default(0) @map("late_fee") @db.Decimal(10, 2)
  notes      String?
  createdAt  DateTime @default(now()) @map("created_at")

  rental      Rental       @relation(fields: [rentalId], references: [id])
  user        User         @relation(fields: [userId], references: [id])
  returnItems ReturnItem[]

  @@map("returns")
}

model ReturnItem {
  id           String              @id @default(uuid())
  returnId     String              @map("return_id")
  rentalItemId String              @map("rental_item_id")
  quantity     Int
  condition    ReturnItemCondition @default(good)
  damageFee    Decimal             @default(0) @map("damage_fee") @db.Decimal(10, 2)
  notes        String?

  return     Return     @relation(fields: [returnId], references: [id], onDelete: Cascade)
  rentalItem RentalItem @relation(fields: [rentalItemId], references: [id])

  @@map("return_items")
}

// ─── Financeiro ──────────────────────────────────────────────────────────────

model Payment {
  id        String        @id @default(uuid())
  rentalId  String        @map("rental_id")
  userId    String        @map("user_id")
  amount    Decimal       @db.Decimal(10, 2)
  method    PaymentMethod
  paidAt    DateTime      @default(now()) @map("paid_at")
  notes     String?
  createdAt DateTime      @default(now()) @map("created_at")

  rental Rental @relation(fields: [rentalId], references: [id])
  user   User   @relation(fields: [userId], references: [id])

  @@map("payments")
}

model FinancialTransaction {
  id          String                       @id @default(uuid())
  userId      String                       @map("user_id")
  rentalId    String?                      @map("rental_id")
  type        FinancialTransactionType
  category    FinancialTransactionCategory
  amount      Decimal                      @db.Decimal(10, 2)
  description String
  date        DateTime                     @db.Date
  createdAt   DateTime                     @default(now()) @map("created_at")

  user   User    @relation(fields: [userId], references: [id])
  rental Rental? @relation(fields: [rentalId], references: [id])

  @@map("financial_transactions")
}

// ─── Documentos ──────────────────────────────────────────────────────────────

model Document {
  id        String       @id @default(uuid())
  rentalId  String       @map("rental_id")
  userId    String       @map("user_id")
  type      DocumentType
  filename  String       @db.VarChar(255)
  path      String       @db.VarChar(500)
  createdAt DateTime     @default(now()) @map("created_at")

  rental Rental @relation(fields: [rentalId], references: [id])
  user   User   @relation(fields: [userId], references: [id])

  @@map("documents")
}

// ─── Audit ───────────────────────────────────────────────────────────────────

model AuditLog {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  action    String   @db.VarChar(100)
  entity    String   @db.VarChar(50)
  entityId  String?  @map("entity_id")
  payload   Json?
  ipAddress String?  @map("ip_address") @db.VarChar(45)
  createdAt DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id])

  @@map("audit_logs")
}
```

- [ ] **Validar schema:**

```bash
cd backend && npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid`.

- [ ] **Commit:**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat: complete prisma schema with all 14 tables"
```

---

### Task 5: Primeira migration

**Files:**
- Create: `backend/prisma/migrations/` (auto-gerado pelo Prisma)

- [ ] **Rodar a migration:**

```bash
cd backend && npx prisma migrate dev --name init
```

Expected: `Your database is now in sync with your schema.`

- [ ] **Verificar tabelas no Prisma Studio:**

```bash
npx prisma studio
```

Abrir `http://localhost:5555` — deve mostrar todas as 14 tabelas.

- [ ] **Gerar o Prisma Client:**

```bash
npx prisma generate
```

- [ ] **Commit:**

```bash
git add backend/prisma/migrations
git commit -m "feat: initial database migration"
```

---

### Task 6: Config module com validação de ambiente

**Files:**
- Create: `backend/src/config/app.config.ts`

- [ ] **Criar `backend/src/config/app.config.ts`:**

```typescript
import { registerAs } from '@nestjs/config';

export default registerAs('app', () => {
  const required = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  if (
    process.env.JWT_ACCESS_SECRET &&
    process.env.JWT_ACCESS_SECRET.length < 32
  ) {
    throw new Error('JWT_ACCESS_SECRET must be at least 32 characters');
  }

  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET,
      refreshSecret: process.env.JWT_REFRESH_SECRET,
      accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    },
  };
});
```

- [ ] **Commit:**

```bash
git add backend/src/config/
git commit -m "feat: config module with env validation"
```

---

### Task 7: PrismaModule e PrismaService

**Files:**
- Create: `backend/src/prisma/prisma.service.ts`
- Create: `backend/src/prisma/prisma.module.ts`

- [ ] **Criar `backend/src/prisma/prisma.service.ts`:**

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

- [ ] **Criar `backend/src/prisma/prisma.module.ts`:**

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Commit:**

```bash
git add backend/src/prisma/
git commit -m "feat: prisma module and service"
```

---

### Task 8: Global Exception Filter

**Files:**
- Create: `backend/src/common/filters/global-exception.filter.ts`

- [ ] **Criar `backend/src/common/filters/global-exception.filter.ts`:**

```typescript
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // Nunca logar detalhes de erros internos em produção
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} — ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message:
        typeof message === 'string'
          ? message
          : (message as any).message ?? message,
    });
  }
}
```

- [ ] **Commit:**

```bash
git add backend/src/common/filters/
git commit -m "feat: global exception filter"
```

---

### Task 9: main.ts e app.module.ts

**Files:**
- Create: `backend/src/main.ts`
- Create: `backend/src/app.module.ts`

- [ ] **Criar `backend/src/main.ts`:**

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const configService = app.get(ConfigService);
  const frontendUrl = configService.get<string>('app.frontendUrl');
  const port = configService.get<number>('app.port') ?? 3000;

  // Segurança: headers HTTP
  app.use(helmet());

  // CORS restrito à origem do frontend
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Prefixo global da API
  app.setGlobalPrefix('api/v1');

  // Validação de DTOs: rejeita campos não declarados, transforma tipos
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Tratamento global de erros
  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.listen(port);
}

bootstrap();
```

- [ ] **Criar `backend/src/app.module.ts`:**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import appConfig from './config/app.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: '.env',
    }),
    // Rate limiting global: 100 req/min por IP
    ThrottlerModule.forRoot([
      {
        name: 'global',
        ttl: 60_000,
        limit: 100,
      },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
  ],
  providers: [
    // Aplica rate limiting globalmente
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
```

- [ ] **Testar que o app sobe:**

```bash
cd backend && npm run start:dev
```

Expected: `[NestApplication] Nest application successfully started` sem erros.

- [ ] **Commit:**

```bash
git add backend/src/main.ts backend/src/app.module.ts
git commit -m "feat: nestjs bootstrap with helmet, cors, validation, rate limit"
```

---

### Task 10: DTOs de autenticação

**Files:**
- Create: `backend/src/modules/auth/dto/login.dto.ts`
- Create: `backend/src/modules/auth/dto/refresh-token.dto.ts`

- [ ] **Criar `backend/src/modules/auth/dto/login.dto.ts`:**

```typescript
import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Email inválido' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Senha deve ter no mínimo 8 caracteres' })
  @MaxLength(100)
  password: string;
}
```

- [ ] **Criar `backend/src/modules/auth/dto/refresh-token.dto.ts`:**

```typescript
import { IsString, IsNotEmpty } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
```

- [ ] **Commit:**

```bash
git add backend/src/modules/auth/dto/
git commit -m "feat: auth DTOs with class-validator"
```

---

### Task 11: UsersModule — mínimo necessário para Auth

**Files:**
- Create: `backend/src/modules/users/users.service.ts`
- Create: `backend/src/modules/users/users.module.ts`

- [ ] **Criar `backend/src/modules/users/users.service.ts`:**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { User } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
```

- [ ] **Criar `backend/src/modules/users/users.module.ts`:**

```typescript
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Commit:**

```bash
git add backend/src/modules/users/
git commit -m "feat: users module with findByEmail and findById"
```

---

### Task 12: Escrever testes unitários falhando para AuthService

**Files:**
- Create: `backend/src/modules/auth/auth.service.spec.ts`

- [ ] **Criar `backend/src/modules/auth/auth.service.spec.ts`:**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockUser = {
  id: 'user-uuid-1',
  name: 'Admin User',
  email: 'admin@test.com',
  password: 'hashed-password',
  role: UserRole.admin,
  isActive: true,
  lastLogin: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockUsersService = {
  findByEmail: jest.fn(),
  findById: jest.fn(),
};

const mockPrisma = {
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  user: {
    update: jest.fn(),
  },
};

const mockJwtService = {
  signAsync: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string) => {
    const cfg: Record<string, string> = {
      'app.jwt.accessSecret': 'access-secret-32-chars-minimum!!',
      'app.jwt.refreshSecret': 'refresh-secret-32-chars-minimum!',
      'app.jwt.accessExpiresIn': '15m',
      'app.jwt.refreshExpiresIn': '7d',
    };
    return cfg[key];
  }),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  // ── validateUser ────────────────────────────────────────────────────────────

  describe('validateUser', () => {
    it('retorna null quando usuário não existe', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);

      const result = await service.validateUser('ghost@test.com', 'any');

      expect(result).toBeNull();
    });

    it('retorna null quando usuário está inativo', async () => {
      mockUsersService.findByEmail.mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      const result = await service.validateUser('admin@test.com', 'any');

      expect(result).toBeNull();
    });

    it('retorna null quando senha está errada', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => false);

      const result = await service.validateUser('admin@test.com', 'wrong');

      expect(result).toBeNull();
    });

    it('retorna o usuário quando credenciais são válidas', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);

      const result = await service.validateUser('admin@test.com', 'correct');

      expect(result).toEqual(mockUser);
    });
  });

  // ── login ───────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('retorna access e refresh tokens', async () => {
      mockJwtService.signAsync
        .mockResolvedValueOnce('access-token-xyz')
        .mockResolvedValueOnce('refresh-token-xyz');
      mockPrisma.refreshToken.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      const tokens = await service.login(mockUser as any);

      expect(tokens).toEqual({
        accessToken: 'access-token-xyz',
        refreshToken: 'refresh-token-xyz',
      });
    });

    it('salva o refresh token no banco com userId correto', async () => {
      mockJwtService.signAsync
        .mockResolvedValueOnce('at')
        .mockResolvedValueOnce('rt');
      mockPrisma.refreshToken.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      await service.login(mockUser as any);

      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: mockUser.id, token: 'rt' }),
        }),
      );
    });

    it('atualiza lastLogin do usuário', async () => {
      mockJwtService.signAsync.mockResolvedValue('token');
      mockPrisma.refreshToken.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      await service.login(mockUser as any);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockUser.id },
          data: expect.objectContaining({ lastLogin: expect.any(Date) }),
        }),
      );
    });
  });

  // ── refreshTokens ───────────────────────────────────────────────────────────

  describe('refreshTokens', () => {
    it('lança UnauthorizedException se token não existe', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refreshTokens('invalid')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('lança UnauthorizedException se token está revogado', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        revoked: true,
        expiresAt: new Date(Date.now() + 100_000),
        user: mockUser,
      });

      await expect(service.refreshTokens('revoked-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('lança UnauthorizedException se token está expirado', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        revoked: false,
        expiresAt: new Date(Date.now() - 1000), // passado
        user: mockUser,
      });

      await expect(service.refreshTokens('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('revoga o token antigo e emite novos tokens (rotação)', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-old',
        revoked: false,
        expiresAt: new Date(Date.now() + 100_000),
        user: mockUser,
      });
      mockPrisma.refreshToken.update.mockResolvedValue({});
      mockJwtService.signAsync
        .mockResolvedValueOnce('new-access')
        .mockResolvedValueOnce('new-refresh');
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.refreshTokens('old-refresh-token');

      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-old' },
        data: { revoked: true },
      });
      expect(result).toEqual({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      });
    });
  });

  // ── logout ──────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('revoga o refresh token informado', async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout('some-refresh-token');

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { token: 'some-refresh-token', revoked: false },
        data: { revoked: true },
      });
    });

    it('não lança erro se token já estava revogado', async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.logout('already-revoked')).resolves.not.toThrow();
    });
  });
});
```

- [ ] **Rodar os testes — devem FALHAR** (AuthService não existe ainda):

```bash
cd backend && npm test -- --testPathPattern=auth.service.spec
```

Expected: `Cannot find module './auth.service'`

- [ ] **Commit:**

```bash
git add backend/src/modules/auth/auth.service.spec.ts
git commit -m "test: auth service unit tests (red)"
```

---

### Task 13: Implementar AuthService

**Files:**
- Create: `backend/src/modules/auth/auth.service.ts`

- [ ] **Criar `backend/src/modules/auth/auth.service.ts`:**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface TokensDto {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.isActive) return null;

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return null;

    return user;
  }

  async login(user: User): Promise<TokensDto> {
    const tokens = await this.generateTokens(user);
    await this.saveRefreshToken(user.id, tokens.refreshToken);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });
    return tokens;
  }

  async refreshTokens(refreshToken: string): Promise<TokensDto> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!stored || stored.revoked || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Token de refresh inválido ou expirado');
    }

    // Rotação: revoga o token antigo antes de emitir o novo
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true },
    });

    const tokens = await this.generateTokens(stored.user);
    await this.saveRefreshToken(stored.user.id, tokens.refreshToken);
    return tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { token: refreshToken, revoked: false },
      data: { revoked: true },
    });
  }

  private async generateTokens(user: User): Promise<TokensDto> {
    const accessPayload = { sub: user.id, email: user.email, role: user.role };
    const refreshPayload = { sub: user.id };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.configService.get<string>('app.jwt.accessSecret'),
        expiresIn: this.configService.get<string>('app.jwt.accessExpiresIn'),
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.get<string>('app.jwt.refreshSecret'),
        expiresIn: this.configService.get<string>('app.jwt.refreshExpiresIn'),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async saveRefreshToken(userId: string, token: string): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await this.prisma.refreshToken.create({
      data: { userId, token, expiresAt },
    });
  }
}
```

- [ ] **Rodar os testes — devem PASSAR:**

```bash
npm test -- --testPathPattern=auth.service.spec
```

Expected: `Tests: 9 passed, 9 total`

- [ ] **Commit:**

```bash
git add backend/src/modules/auth/auth.service.ts
git commit -m "feat: auth service with login, refresh rotation and logout (green)"
```

---

### Task 14: Passport strategies

**Files:**
- Create: `backend/src/modules/auth/strategies/local.strategy.ts`
- Create: `backend/src/modules/auth/strategies/jwt.strategy.ts`
- Create: `backend/src/modules/auth/strategies/jwt-refresh.strategy.ts`

- [ ] **Criar `backend/src/modules/auth/strategies/local.strategy.ts`:**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'email' });
  }

  async validate(email: string, password: string) {
    const user = await this.authService.validateUser(email, password);
    if (!user) {
      throw new UnauthorizedException('Email ou senha inválidos');
    }
    return user;
  }
}
```

- [ ] **Criar `backend/src/modules/auth/strategies/jwt.strategy.ts`:**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('app.jwt.accessSecret'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuário não encontrado ou inativo');
    }
    return user;
  }
}
```

- [ ] **Criar `backend/src/modules/auth/strategies/jwt-refresh.strategy.ts`:**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('app.jwt.refreshSecret'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: { sub: string }) {
    const refreshToken = req.body?.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token ausente');
    }
    return { userId: payload.sub, refreshToken };
  }
}
```

- [ ] **Commit:**

```bash
git add backend/src/modules/auth/strategies/
git commit -m "feat: passport strategies (local, jwt, jwt-refresh)"
```

---

### Task 15: Guards e Decorators RBAC

**Files:**
- Create: `backend/src/common/guards/jwt-auth.guard.ts`
- Create: `backend/src/common/guards/roles.guard.ts`
- Create: `backend/src/common/decorators/roles.decorator.ts`
- Create: `backend/src/common/decorators/current-user.decorator.ts`

- [ ] **Criar `backend/src/common/guards/jwt-auth.guard.ts`:**

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

- [ ] **Criar `backend/src/common/decorators/roles.decorator.ts`:**

```typescript
import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```

- [ ] **Criar `backend/src/common/guards/roles.guard.ts`:**

```typescript
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Rota sem @Roles() é acessível a qualquer usuário autenticado
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Usuário não autenticado');

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        'Você não tem permissão para acessar este recurso',
      );
    }

    return true;
  }
}
```

- [ ] **Criar `backend/src/common/decorators/current-user.decorator.ts`:**

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@prisma/client';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): User => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

- [ ] **Commit:**

```bash
git add backend/src/common/
git commit -m "feat: jwt guard, roles guard, current-user and roles decorators"
```

---

### Task 16: AuthController

**Files:**
- Create: `backend/src/modules/auth/auth.controller.ts`

- [ ] **Criar `backend/src/modules/auth/auth.controller.ts`:**

```typescript
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { User } from '@prisma/client';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Rate limit agressivo apenas no login: 10 req/min por IP
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UseGuards(AuthGuard('local'))
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() _dto: LoginDto, @Request() req: any) {
    // LocalStrategy já validou o usuário e colocou em req.user
    return this.authService.login(req.user);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: User) {
    const { password, ...safeUser } = user;
    return safeUser;
  }
}
```

- [ ] **Commit:**

```bash
git add backend/src/modules/auth/auth.controller.ts
git commit -m "feat: auth controller (login, refresh, logout, me)"
```

---

### Task 17: AuthModule — montagem final

**Files:**
- Create: `backend/src/modules/auth/auth.module.ts`

- [ ] **Criar `backend/src/modules/auth/auth.module.ts`:**

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.register({}), // secrets configurados por strategy
  ],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, JwtStrategy, JwtRefreshStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Reiniciar o servidor e verificar que sobe sem erros:**

```bash
npm run start:dev
```

Expected: sem erros de módulo.

- [ ] **Commit:**

```bash
git add backend/src/modules/auth/auth.module.ts
git commit -m "feat: auth module assembled"
```

---

### Task 18: Seed script — criar usuário admin inicial

**Files:**
- Create: `backend/prisma/seed.ts`

- [ ] **Criar `backend/prisma/seed.ts`:**

```typescript
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findUnique({
    where: { email: 'admin@inventory.local' },
  });

  if (existing) {
    console.log('Admin user already exists — skipping seed');
    return;
  }

  const hashed = await bcrypt.hash('Admin@123456', 12);

  const admin = await prisma.user.create({
    data: {
      name: 'Administrador',
      email: 'admin@inventory.local',
      password: hashed,
      role: UserRole.admin,
    },
  });

  console.log(`Admin created: ${admin.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Adicionar ao `package.json`** o `prisma.seed`:

```json
{
  "prisma": {
    "seed": "ts-node prisma/seed.ts"
  }
}
```

- [ ] **Rodar o seed:**

```bash
npx prisma db seed
```

Expected: `Admin created: admin@inventory.local`

- [ ] **Commit:**

```bash
git add backend/prisma/seed.ts backend/package.json
git commit -m "feat: seed script with initial admin user"
```

---

### Task 19: Teste de integração — endpoints de auth

**Files:**
- Create: `backend/test/jest-e2e.config.ts`
- Create: `backend/test/auth.e2e-spec.ts`

- [ ] **Criar `backend/test/jest-e2e.config.ts`:**

```typescript
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.e2e-spec.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
};

export default config;
```

- [ ] **Criar `backend/test/auth.e2e-spec.ts`:**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import helmet from 'helmet';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.use(helmet());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());

    await app.init();

    prisma = module.get<PrismaService>(PrismaService);

    // Criar usuário de teste
    const hashed = await bcrypt.hash('Test@123456', 12);
    await prisma.user.upsert({
      where: { email: 'e2e-test@test.com' },
      update: {},
      create: {
        name: 'E2E Test User',
        email: 'e2e-test@test.com',
        password: hashed,
        role: 'admin',
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    // Limpa dados de teste
    await prisma.refreshToken.deleteMany({
      where: { user: { email: 'e2e-test@test.com' } },
    });
    await prisma.user.deleteMany({ where: { email: 'e2e-test@test.com' } });
    await app.close();
  });

  describe('POST /api/v1/auth/login', () => {
    it('retorna 200 com tokens quando credenciais são válidas', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'e2e-test@test.com', password: 'Test@123456' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
    });

    it('retorna 401 com senha errada', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'e2e-test@test.com', password: 'wrong-password' });

      expect(res.status).toBe(401);
    });

    it('retorna 400 com email inválido', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: '12345678' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('retorna novos tokens com refresh token válido', async () => {
      // 1. Login para obter tokens
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'e2e-test@test.com', password: 'Test@123456' });

      const { refreshToken } = loginRes.body;

      // 2. Usar o refresh token
      const refreshRes = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body).toHaveProperty('accessToken');
      expect(refreshRes.body).toHaveProperty('refreshToken');
      // O novo refresh token deve ser diferente (rotação)
      expect(refreshRes.body.refreshToken).not.toBe(refreshToken);
    });

    it('retorna 401 com refresh token inválido', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'fake-token' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('retorna dados do usuário autenticado', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'e2e-test@test.com', password: 'Test@123456' });

      const { accessToken } = loginRes.body;

      const meRes = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body).toHaveProperty('email', 'e2e-test@test.com');
      expect(meRes.body).not.toHaveProperty('password');
    });

    it('retorna 401 sem token', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('revoga o refresh token e retorna 204', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'e2e-test@test.com', password: 'Test@123456' });

      const { accessToken, refreshToken } = loginRes.body;

      const logoutRes = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken });

      expect(logoutRes.status).toBe(204);

      // Tentar usar o refresh token revogado deve falhar
      const refreshRes = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(refreshRes.status).toBe(401);
    });
  });
});
```

- [ ] **Rodar os testes E2E** (postgres precisa estar rodando):

```bash
npm run test:e2e
```

Expected: `Tests: 7 passed, 7 total`

- [ ] **Commit:**

```bash
git add backend/test/
git commit -m "test: auth e2e integration tests (all green)"
```

---

## Resultado Final do Plano 1

Ao concluir todas as 19 tasks, você terá:

- ✅ Monorepo com estrutura definida
- ✅ Docker Compose com PostgreSQL 16 saudável
- ✅ Schema Prisma com 14 tabelas e migrations
- ✅ NestJS com Helmet, CORS, ValidationPipe, Throttler (rate limit)
- ✅ GlobalExceptionFilter sem vazamento de informação
- ✅ AuthService testado (9 testes unitários verdes)
- ✅ JWT access token (15min) + refresh token com rotação
- ✅ Logout com revogação de refresh token
- ✅ RBAC com @Roles() decorator + RolesGuard
- ✅ @CurrentUser() decorator
- ✅ 7 testes E2E de auth todos verdes
- ✅ Seed script com usuário admin

**Próximos planos:**
- **Plano 2:** CustomersModule, InventoryModule, RentalsModule, ReturnsModule, PaymentsModule
- **Plano 3:** DashboardModule, AuditLog interceptor, Frontend React base
