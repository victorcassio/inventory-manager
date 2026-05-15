# Inventory Manager — Plano 2: Core Business Modules

> **Status:** Aprovado — pronto para implementação
> **Data:** 2026-05-15
> **Baseado em:** Sessão de brainstorming com aprovações seção a seção

---

## 1. Visão Geral do Sistema

O Inventory Manager é um sistema de gestão de aluguel de equipamentos (andaimes, ferramentas, ferragens) com controle de estoque, clientes, contratos, devoluções e financeiro.

O Plano 2 implementa todos os módulos de negócio centrais sobre a base de autenticação e RBAC do Plano 1. Ao final do Plano 2, o sistema será operacionalmente completo para o fluxo principal: cadastrar cliente → criar locação → devolver equipamentos → registrar pagamento → emitir documentos.

### Fluxo principal

```
Customer → Rental (+ RentalItems) → Returns (parcial/total) → Payments → Documents
                                        ↓                          ↓
                                 InventoryMovement         FinancialTransaction
                                        ↓                          ↓
                                    AuditLog                   AuditLog
```

---

## 2. Stack Técnica

| Componente | Tecnologia |
|---|---|
| Framework | NestJS 10 |
| ORM | Prisma 7 (adapter-pg) |
| Banco de dados | PostgreSQL 16 |
| Geração de PDF | PDFKit |
| Validação | class-validator + class-transformer |
| Autenticação | JWT (já implementado no Plano 1) |
| Testes | Jest + Supertest |
| Infraestrutura local | Docker Compose (porta 5440) |

---

## 3. Arquitetura dos Módulos

### Módulos do Plano 2

```
src/modules/
├── audit/          — shared, sem controller, exporta AuditService
├── customers/
├── inventory/      — ItemCategory + Item + InventoryMovement
├── rentals/        — Rental + RentalItem + ContractCounter
├── returns/        — Return + ReturnItem
├── payments/       — Payment
├── financial/      — FinancialTransaction
└── documents/      — Document + geração PDF via PDFKit
```

### Grafo de dependências (sem dependências circulares)

```
AuditModule         ← sem dependências externas
CustomersModule     ← AuditModule
InventoryModule     ← AuditModule
RentalsModule       ← CustomersModule, InventoryModule, AuditModule
ReturnsModule       ← RentalsModule, InventoryModule, AuditModule
PaymentsModule      ← RentalsModule, FinancialModule, AuditModule
FinancialModule     ← AuditModule
DocumentsModule     ← RentalsModule, CustomersModule, AuditModule
```

**Regra:** Se módulo A importa módulo B, módulo B não pode importar módulo A. Evitar `forwardRef` exceto se absolutamente necessário.

---

## 4. Regras de Transação entre Services

### Princípio

O service responsável pelo caso de uso abre a `prisma.$transaction()`. Services auxiliares chamados dentro dela recebem `tx?: Prisma.TransactionClient` e nunca abrem outra transação.

### Padrão de assinatura

```typescript
// Service auxiliar — aceita tx opcional
async debitStock(itemId: string, qty: number, tx?: Prisma.TransactionClient): Promise<void> {
  const client = tx ?? this.prisma;
  // operações usando client
}

// Service orquestrador — abre a transação
async createRental(dto: CreateRentalDto, userId: string): Promise<Rental> {
  return this.prisma.$transaction(async (tx) => {
    // chama services auxiliares passando tx
    await this.inventoryService.debitStock(itemId, qty, tx);
    await this.auditService.log({ ... }, tx);
  });
}
```

### Quem abre transações

| Service | Operações com transação |
|---|---|
| `RentalsService` | `createRental`, `cancelRental` |
| `ReturnsService` | `registerReturn` |
| `PaymentsService` | `registerPayment` |
| `InventoryService` | `adjustStock` (manual) |
| `FinancialService` | `createManualTransaction` |

Services auxiliares (`InventoryService`, `FinancialService`, `AuditService`) aceitam `tx` em todos os métodos que escrevem no banco.

---

## 5. RBAC e Permissões

### Roles

| Role | Descrição |
|---|---|
| `admin` | Acesso total a todos os módulos e operações |
| `attendant` | Opera clientes, estoque (leitura), locações, devoluções e documentos operacionais |
| `financial` | Opera pagamentos, financeiro e documentos financeiros; visualiza clientes e locações como contexto |

### Permissões por módulo

#### CustomersModule

| Endpoint | admin | attendant | financial |
|---|---|---|---|
| POST /customers | ✅ | ✅ | ❌ |
| GET /customers | ✅ | ✅ | ✅ |
| GET /customers/:id | ✅ | ✅ | ✅ |
| PATCH /customers/:id | ✅ | ✅ | ❌ |
| DELETE /customers/:id | ✅ | ❌ | ❌ |

#### InventoryModule

| Endpoint | admin | attendant | financial |
|---|---|---|---|
| POST /inventory/categories | ✅ | ❌ | ❌ |
| GET /inventory/categories | ✅ | ✅ | ✅ |
| PATCH /inventory/categories/:id | ✅ | ❌ | ❌ |
| DELETE /inventory/categories/:id | ✅ | ❌ | ❌ |
| POST /inventory/items | ✅ | ❌ | ❌ |
| GET /inventory/items | ✅ | ✅ | ✅ |
| GET /inventory/items/:id | ✅ | ✅ | ✅ |
| PATCH /inventory/items/:id | ✅ | ❌ | ❌ |
| POST /inventory/items/:id/adjust | ✅ | ❌ | ❌ |
| DELETE /inventory/items/:id | ✅ | ❌ | ❌ |

#### RentalsModule

| Endpoint | admin | attendant | financial |
|---|---|---|---|
| POST /rentals | ✅ | ✅ | ❌ |
| GET /rentals | ✅ | ✅ | ✅ |
| GET /rentals/:id | ✅ | ✅ | ✅ |
| PATCH /rentals/:id | ✅ | ✅ | ❌ |
| POST /rentals/:id/cancel | ✅ | ❌ | ❌ |

#### ReturnsModule

| Endpoint | admin | attendant | financial |
|---|---|---|---|
| POST /rentals/:id/returns | ✅ | ✅ | ❌ |
| GET /rentals/:id/returns | ✅ | ✅ | ✅ |
| GET /returns/:id | ✅ | ✅ | ✅ |

#### PaymentsModule

| Endpoint | admin | attendant | financial |
|---|---|---|---|
| POST /rentals/:id/payments | ✅ | ❌ | ✅ |
| GET /rentals/:id/payments | ✅ | ✅ | ✅ |
| GET /payments/:id | ✅ | ✅ | ✅ |
| GET /payments | ✅ | ❌ | ✅ |

#### FinancialModule

| Endpoint | admin | attendant | financial |
|---|---|---|---|
| POST /financial/transactions | ✅ | ❌ | ✅ |
| GET /financial/transactions | ✅ | ❌ | ✅ |
| GET /financial/transactions/:id | ✅ | ❌ | ✅ |
| PATCH /financial/transactions/:id | ✅ | ❌ | ✅ |
| DELETE /financial/transactions/:id | ✅ | ❌ | ❌ |

#### DocumentsModule

| Endpoint | admin | attendant | financial |
|---|---|---|---|
| POST /rentals/:id/documents/contract | ✅ | ✅ | ❌ |
| POST /payments/:id/documents/receipt | ✅ | ❌ | ✅ |
| POST /returns/:id/documents/proof | ✅ | ✅ | ❌ |
| GET /rentals/:id/documents | ✅ | ✅ | ✅ |
| GET /documents/:id/download | ✅ | ✅ | ✅ |

### Implementação

Permissões validadas por `JwtAuthGuard` + `RolesGuard` via decorator `@Roles(UserRole.admin, ...)` em cada endpoint. Nunca validar roles apenas no frontend.

---

## 6. Schema Prisma Final

### Modelos existentes (sem alteração)

`User`, `RefreshToken`, `ItemCategory`, `Item`, `RentalItem`, `ReturnItem`, `AuditLog` — sem mudanças de estrutura.

### Enums atualizados

```prisma
enum InventoryMovementType {
  initial_stock
  rental_out
  rental_return
  rental_reversal    // cancela locação — reverte estoque
  manual_adjustment
  maintenance_in
  maintenance_out
  deactivation
}

enum FinancialTransactionOrigin {
  manual
  payment
  adjustment
}
```

### Modelos com alterações

```prisma
model Rental {
  // campos existentes...
  paidAmount    Decimal  @default(0) @map("paid_amount") @db.Decimal(10, 2)
  // relações existentes...
}

model FinancialTransaction {
  // campos existentes...
  origin    FinancialTransactionOrigin @default(manual)
  isVoided  Boolean  @default(false) @map("is_voided")
  // relações existentes...
}

model Document {
  id          String       @id @default(uuid())
  type        DocumentType
  filename    String       @db.VarChar(255)
  path        String       @db.VarChar(500)
  status      String       @default("generated")
  // relacionamentos opcionais por tipo de documento
  rentalId    String?  @map("rental_id")
  customerId  String?  @map("customer_id")
  paymentId   String?  @map("payment_id")
  returnId    String?  @map("return_id")
  userId      String   @map("user_id")
  createdAt   DateTime @default(now()) @map("created_at")

  rental   Rental?   @relation(fields: [rentalId], references: [id])
  customer Customer? @relation(fields: [customerId], references: [id])
  payment  Payment?  @relation(fields: [paymentId], references: [id])
  return   Return?   @relation(fields: [returnId], references: [id])
  user     User      @relation(fields: [userId], references: [id])

  @@map("documents")
}
```

### Novo modelo

```prisma
model ContractCounter {
  year    Int @id
  lastSeq Int @default(0) @map("last_seq")

  @@map("contract_counters")
}
```

---

## 7. Endpoints por Módulo

### AuditModule
Sem endpoints públicos. `AuditService` é chamado internamente.

### CustomersModule — `/customers`

| Método | Rota | Descrição |
|---|---|---|
| POST | `/customers` | Criar cliente |
| GET | `/customers` | Listar (paginado, filtro por nome/documento/status) |
| GET | `/customers/:id` | Detalhe + locações ativas |
| PATCH | `/customers/:id` | Atualizar dados |
| DELETE | `/customers/:id` | Soft delete (isActive: false) |

### InventoryModule — `/inventory`

| Método | Rota | Descrição |
|---|---|---|
| POST | `/inventory/categories` | Criar categoria |
| GET | `/inventory/categories` | Listar categorias |
| PATCH | `/inventory/categories/:id` | Atualizar categoria |
| DELETE | `/inventory/categories/:id` | Soft delete categoria |
| POST | `/inventory/items` | Criar item |
| GET | `/inventory/items` | Listar itens (filtro por categoria, condição, disponibilidade) |
| GET | `/inventory/items/:id` | Detalhe + movimentos recentes |
| PATCH | `/inventory/items/:id` | Atualizar dados/preço |
| POST | `/inventory/items/:id/adjust` | Ajuste manual de estoque |
| DELETE | `/inventory/items/:id` | Soft delete item |

### RentalsModule — `/rentals`

| Método | Rota | Descrição |
|---|---|---|
| POST | `/rentals` | Criar locação |
| GET | `/rentals` | Listar (filtro por status, cliente, data) |
| GET | `/rentals/:id` | Detalhe completo (itens, pagamentos, devoluções) |
| PATCH | `/rentals/:id` | Atualizar notas, datas, desconto |
| POST | `/rentals/:id/cancel` | Cancelar locação |

### ReturnsModule — `/rentals/:id/returns` e `/returns`

| Método | Rota | Descrição |
|---|---|---|
| POST | `/rentals/:id/returns` | Registrar devolução |
| GET | `/rentals/:id/returns` | Listar devoluções da locação |
| GET | `/returns/:id` | Detalhe de devolução |

### PaymentsModule — `/rentals/:id/payments` e `/payments`

| Método | Rota | Descrição |
|---|---|---|
| POST | `/rentals/:id/payments` | Registrar pagamento |
| GET | `/rentals/:id/payments` | Listar pagamentos da locação |
| GET | `/payments/:id` | Detalhe do pagamento |
| GET | `/payments` | Listar todos os pagamentos |

### FinancialModule — `/financial/transactions`

| Método | Rota | Descrição |
|---|---|---|
| POST | `/financial/transactions` | Lançamento manual |
| GET | `/financial/transactions` | Listar (filtro por tipo, categoria, data) |
| GET | `/financial/transactions/:id` | Detalhe |
| PATCH | `/financial/transactions/:id` | Editar lançamento manual |
| DELETE | `/financial/transactions/:id` | Void/cancelamento lógico |

### DocumentsModule

| Método | Rota | Descrição |
|---|---|---|
| POST | `/rentals/:id/documents/contract` | Gerar termo de retirada |
| POST | `/payments/:id/documents/receipt` | Gerar recibo de pagamento |
| POST | `/returns/:id/documents/proof` | Gerar comprovante de devolução |
| GET | `/rentals/:id/documents` | Listar documentos da locação |
| GET | `/documents/:id/download` | Download do PDF |

---

## 8. Fluxos Críticos

### 8.1 Criar Locação

```
POST /rentals
prisma.$transaction(async (tx) => {
  1. Verificar customer existe e isActive === true
  2. Gerar contractNumber:
     a. Upsert ContractCounter para o ano atual, incrementar lastSeq com SELECT FOR UPDATE
     b. Formatar: `${ano}-${lastSeq.toString().padStart(4, '0')}`
  3. Para cada item no DTO:
     a. Buscar Item — validar isActive e availableQty >= quantity solicitada
  4. Criar Rental { contractNumber, customerId, userId, status: active, ... }
  5. Criar RentalItems { rentalId, itemId, quantity, unitPrice: item.dailyRate }
  6. Calcular subtotal = sum(qty × unitPrice × diffDays(startedAt, expectedReturn))
     total = subtotal - discount + extraCosts  (deposit é caução separada, fora do total)
     Atualizar Rental.subtotal e Rental.total
  7. Para cada item:
     item.availableQty -= quantity
     item.rentedQty    += quantity
  8. Criar InventoryMovement { type: rental_out, itemId, rentalId, userId, quantity }
  9. AuditLog { action: create_rental, entity: Rental, entityId: rental.id }
})
```

### 8.2 Cancelar Locação

```
POST /rentals/:id/cancel
prisma.$transaction(async (tx) => {
  1. Buscar Rental — validar status === 'active'
  2. Validar que não existe Payment confirmado para esta locação
  3. Validar que não existe Return registrado para esta locação
  4. Para cada RentalItem:
     item.availableQty += quantity
     item.rentedQty    -= quantity
  5. Criar InventoryMovement { type: rental_reversal } por item
  6. Rental.status = 'cancelled'
  7. AuditLog { action: cancel_rental }
})
```

### 8.3 Registrar Devolução (parcial ou total)

```
POST /rentals/:id/returns
prisma.$transaction(async (tx) => {
  1. Buscar Rental com RentalItems — validar status === 'active'
  2. Para cada item devolvido no DTO:
     a. Localizar RentalItem correspondente
     b. Validar qty devolvida <= (rentalItem.quantity - rentalItem.returnedQty)
  3. Calcular lateDays = max(0, hoje - rental.expectedReturn)
     lateFeeThisReturn = lateDays > 0 ? lateDays × sum(qty × unitPrice) : 0
  4. Criar Return { rentalId, userId, isPartial (calculado), lateDays, lateFee: lateFeeThisReturn }
  5. Para cada item devolvido:
     a. Criar ReturnItem { returnId, rentalItemId, quantity, condition, damageFee }
     b. Incrementar RentalItem.returnedQty += quantity
     c. Decrementar Item.rentedQty -= quantity
     d. Conforme condition:
        - good     → Item.availableQty += quantity
                     InventoryMovement { type: rental_return }
        - damaged  → Item.maintenanceQty += quantity
                     InventoryMovement { type: maintenance_in }
        - lost     → Item.totalQty -= quantity
                     InventoryMovement { type: deactivation }
        (damageFee obrigatório para damaged e lost)
  6. Acumular Rental.lateFee += lateFeeThisReturn
  7. Verificar completude: todos RentalItems com returnedQty === quantity?
     → sim: Rental.status = 'returned', Rental.returnedAt = hoje, Return.isPartial = false
     → não: Return.isPartial = true
  8. AuditLog { action: register_return, payload: { isPartial, lateDays, lateFee, items } }
})
```

### 8.4 Registrar Pagamento (parcial ou total)

```
POST /rentals/:id/payments
prisma.$transaction(async (tx) => {
  1. Buscar Rental — validar status !== 'cancelled'
  2. Calcular balanceAmount:
     totalDamageFees = sum(ReturnItem.damageFee) para esta locação
     balanceAmount   = rental.total + rental.lateFee + totalDamageFees - rental.paidAmount
  3. Validar amount > 0 e amount <= balanceAmount
  4. Criar Payment { rentalId, userId, amount, method, paidAt, referenceCode?, notes? }
  5. Rental.paidAmount += amount
  6. Criar FinancialTransaction automaticamente:
     { type: income, category: rental_income, origin: payment, amount, rentalId, description }
  7. AuditLog { action: register_payment, payload: { amount, method, financialTransactionId } }
})
```

### 8.5 Gerar Documentos

```
// Termo de retirada
POST /rentals/:id/documents/contract
  1. Buscar Rental com RentalItems, Customer
  2. Validar rental.status === 'active'
  3. Gerar PDF via PDFKit (template: contract)
  4. Salvar em storage/documents/{rentalId}/contract-{timestamp}.pdf
  5. Criar Document { type: contract, rentalId, customerId, userId, filename, path }
  6. AuditLog { action: generate_document, payload: { type: contract } }

// Recibo de pagamento
POST /payments/:id/documents/receipt
  1. Buscar Payment com Rental, Customer
  2. Gerar PDF via PDFKit (template: receipt)
  3. Salvar em storage/documents/{rentalId}/receipt-{timestamp}.pdf
  4. Criar Document { type: receipt, rentalId, customerId, paymentId, userId, filename, path }
  5. AuditLog { action: generate_document, payload: { type: receipt } }

// Comprovante de devolução
POST /returns/:id/documents/proof
  1. Buscar Return com ReturnItems, Rental, Customer
  2. Gerar PDF via PDFKit (template: return-proof)
  3. Salvar em storage/documents/{rentalId}/return-proof-{timestamp}.pdf
  4. Criar Document { type: return_proof, rentalId, customerId, returnId, userId, filename, path }
  5. AuditLog { action: generate_document, payload: { type: return_proof } }
```

### 8.6 Criar Lançamento Financeiro Manual

```
POST /financial/transactions
prisma.$transaction(async (tx) => {
  1. Validar campos do DTO
  2. Criar FinancialTransaction { origin: manual, type, category, amount, description, date, rentalId? }
  3. AuditLog { action: create_financial_transaction }
})
```

---

## 9. Regras de Estoque

1. `availableQty = totalQty - rentedQty - maintenanceQty` — invariante que deve ser mantida em toda operação.
2. `availableQty` nunca pode ser menor que 0.
3. `totalQty` nunca pode ser menor que `rentedQty + maintenanceQty`.
4. `rentedQty` só é alterado por criação/cancelamento de locação ou devolução.
5. `maintenanceQty` só é alterado por devoluções com `condition: damaged` ou ajuste autorizado.
6. Todo ajuste manual exige `type`, `quantity`, `reason` (obrigatório) e `notes` (opcional).
7. Todo ajuste manual gera `InventoryMovement { type: manual_adjustment }` e `AuditLog`.
8. Ajustes manuais ocorrem dentro de `prisma.$transaction()`.
9. Soft delete em itens e categorias — nunca exclusão física.
10. Item com `rentedQty > 0` não pode ser desativado.

### Tipos de `InventoryMovement` e efeito no estoque

| type | availableQty | rentedQty | maintenanceQty | totalQty |
|---|---|---|---|---|
| `initial_stock` | +qty | — | — | +qty |
| `rental_out` | -qty | +qty | — | — |
| `rental_return` | +qty | -qty | — | — |
| `rental_reversal` | +qty | -qty | — | — |
| `manual_adjustment` | ±qty | — | — | ±qty |
| `maintenance_in` | — | -qty | +qty | — |
| `maintenance_out` | +qty | — | -qty | — |
| `deactivation` | — | -qty | — | -qty |

---

## 10. Regras Financeiras

1. `FinancialTransaction` com `origin: payment` é criada automaticamente por `PaymentsService`. Não pode ser editada nem removida diretamente via `FinancialModule`.
2. `FinancialTransaction` com `origin: manual` pode ser editada e cancelada (soft void: `isVoided: true`) por `admin` ou `financial`.
3. Cancelamento financeiro é lógico (`isVoided: true`), nunca exclusão física.
4. `balanceAmount` é calculado na camada de leitura: `total + lateFee + totalDamageFees - paidAmount`.
5. Pagamento só é aceito se `amount <= balanceAmount` e `rental.status !== 'cancelled'`.
6. Locações `active` e `returned` podem receber pagamentos (saldo em aberto).
7. `deposit` é caução — registrado no Rental mas não entra no cálculo de `total`. Tratamento contábil do depósito fica para o Plano 3.
8. `lateFee` no Rental é o acumulado de todas as devoluções com atraso.

---

## 11. Regras de Documentos

1. Cada tipo de documento tem um endpoint de geração próprio e um template PDFKit dedicado.
2. PDFs são salvos em `storage/documents/{rentalId}/{type}-{timestamp}.pdf` no servidor.
3. `Document` no banco armazena apenas metadados — nunca o conteúdo binário.
4. Relacionamentos opcionais por tipo:
   - `contract` → `rentalId` + `customerId`
   - `receipt` → `paymentId` + `rentalId` + `customerId`
   - `return_proof` → `returnId` + `rentalId` + `customerId`
5. `status` inicia como `generated`. Cancelamento lógico pode marcar como `voided` no futuro.
6. Geração de documento cria `AuditLog { action: generate_document }`.
7. Download disponível para `admin`, `attendant` e `financial` via `GET /documents/:id/download`.

---

## 12. Audit Logs

Ações que obrigatoriamente geram `AuditLog`:

| Módulo | action | Quando |
|---|---|---|
| customers | `create_customer` | Criação de cliente |
| customers | `update_customer` | Atualização de cliente |
| customers | `deactivate_customer` | Soft delete de cliente |
| inventory | `create_item` | Criação de item |
| inventory | `update_item` | Atualização de item |
| inventory | `adjust_stock` | Ajuste manual de estoque |
| inventory | `deactivate_item` | Soft delete de item |
| rentals | `create_rental` | Criação de locação |
| rentals | `update_rental` | Atualização de locação |
| rentals | `cancel_rental` | Cancelamento de locação |
| returns | `register_return` | Registro de devolução (parcial/total) |
| payments | `register_payment` | Registro de pagamento |
| financial | `create_financial_transaction` | Lançamento manual |
| financial | `update_financial_transaction` | Edição de lançamento manual |
| financial | `void_financial_transaction` | Cancelamento lógico |
| documents | `generate_document` | Geração de qualquer PDF |

`AuditService.log()` aceita `tx?: Prisma.TransactionClient` para participar de transações atômicas.

---

## 13. Segurança e Defesa em Profundidade

1. **Autenticação:** JWT access token (15 min) + refresh token rotation (7 dias) — implementado no Plano 1.
2. **Autorização:** `JwtAuthGuard` + `RolesGuard` em todos os endpoints do Plano 2. Permissões validadas exclusivamente no backend.
3. **Validação de entrada:** `ValidationPipe` global com `whitelist: true` e `forbidNonWhitelisted: true`. DTOs com `class-validator`.
4. **Proteção contra injeção:** Prisma ORM em todas as queries — sem SQL raw exceto quando estritamente necessário (e.g., `SELECT ... FOR UPDATE` no ContractCounter).
5. **Rate limiting:** `@nestjs/throttler` global já configurado (100 req/min).
6. **Helmet:** headers de segurança já configurados no Plano 1.
7. **Soft delete:** nenhum dado operacional é removido fisicamente do banco.
8. **Integridade transacional:** operações multi-tabela sempre em `prisma.$transaction()`.
9. **Rastreabilidade:** `AuditLog` obrigatório para todas as ações sensíveis.
10. **CPF/CNPJ:** normalizado para dígitos apenas no banco; validação de dígitos verificadores no DTO.

---

## 14. Estratégia de Testes

### Unitários (`*.service.spec.ts`)

- `PrismaService` mockado via `jest.mock` ou `@golevelup/nestjs-testing`.
- Cobrir: `computedStatus`, cálculo de `lateFee`, `balanceAmount`, invariantes de estoque.
- Cada service orquestrador deve ter ao menos:
  - 1 teste do caminho feliz
  - 1 teste de falha por validação de negócio (estoque insuficiente, locação cancelada, saldo negativo, etc.)

### Integração (E2E — `test/*.e2e-spec.ts`)

- DB real via Docker Compose (porta 5440).
- Fluxo completo validado:
  1. Criar categoria e item
  2. Criar cliente
  3. Criar locação → validar `contractNumber` gerado e estoque debitado
  4. Registrar devolução parcial → validar estoque parcialmente retornado
  5. Registrar devolução total → validar `rental.status === returned`
  6. Registrar pagamento → validar `paidAmount` atualizado e `FinancialTransaction` criada
- Usar `beforeEach` com limpeza de tabelas ou seed mínimo por teste.

### Meta de cobertura

- Services críticos (`RentalsService`, `ReturnsService`, `PaymentsService`): ≥ 80% de cobertura de branches.
- Demais services: ≥ 70%.

---

## 15. Estrutura de Pastas Final

```
inventory-manager/
├── docker-compose.dev.yml
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          ← atualizado com novos campos e modelos
│   │   ├── prisma.config.ts
│   │   └── seed.ts
│   ├── storage/
│   │   └── documents/             ← PDFs gerados (gitignored)
│   └── src/
│       ├── app.module.ts          ← registrar todos os novos módulos
│       ├── common/
│       │   ├── decorators/
│       │   ├── filters/
│       │   └── guards/
│       ├── config/
│       ├── prisma/
│       └── modules/
│           ├── audit/
│           │   ├── audit.module.ts
│           │   └── audit.service.ts
│           ├── customers/
│           │   ├── customers.module.ts
│           │   ├── customers.controller.ts
│           │   ├── customers.service.ts
│           │   ├── customers.service.spec.ts
│           │   └── dto/
│           │       ├── create-customer.dto.ts
│           │       └── update-customer.dto.ts
│           ├── inventory/
│           │   ├── inventory.module.ts
│           │   ├── inventory.controller.ts
│           │   ├── inventory.service.ts
│           │   ├── inventory.service.spec.ts
│           │   └── dto/
│           │       ├── create-category.dto.ts
│           │       ├── update-category.dto.ts
│           │       ├── create-item.dto.ts
│           │       ├── update-item.dto.ts
│           │       └── adjust-stock.dto.ts
│           ├── rentals/
│           │   ├── rentals.module.ts
│           │   ├── rentals.controller.ts
│           │   ├── rentals.service.ts
│           │   ├── rentals.service.spec.ts
│           │   └── dto/
│           │       ├── create-rental.dto.ts
│           │       └── update-rental.dto.ts
│           ├── returns/
│           │   ├── returns.module.ts
│           │   ├── returns.controller.ts
│           │   ├── returns.service.ts
│           │   ├── returns.service.spec.ts
│           │   └── dto/
│           │       └── create-return.dto.ts
│           ├── payments/
│           │   ├── payments.module.ts
│           │   ├── payments.controller.ts
│           │   ├── payments.service.ts
│           │   ├── payments.service.spec.ts
│           │   └── dto/
│           │       └── create-payment.dto.ts
│           ├── financial/
│           │   ├── financial.module.ts
│           │   ├── financial.controller.ts
│           │   ├── financial.service.ts
│           │   ├── financial.service.spec.ts
│           │   └── dto/
│           │       ├── create-financial-transaction.dto.ts
│           │       └── update-financial-transaction.dto.ts
│           └── documents/
│               ├── documents.module.ts
│               ├── documents.controller.ts
│               ├── documents.service.ts
│               ├── documents.service.spec.ts
│               └── templates/
│                   ├── contract.template.ts
│                   ├── receipt.template.ts
│                   └── return-proof.template.ts
```

---

## 16. Roadmap

### MVP 1 — Foundation + Auth + RBAC ✅ CONCLUÍDO

- Monorepo configurado (NestJS + PostgreSQL + Prisma 7)
- Autenticação JWT com refresh token rotation
- RBAC com roles admin, attendant, financial
- Seed do admin
- Testes unitários e E2E de auth

### MVP 2 — Core Business Modules (este plano)

- CustomersModule
- InventoryModule (ItemCategory + Item + InventoryMovement)
- RentalsModule (ContractCounter, computedStatus, fluxo transacional)
- ReturnsModule (parcial/total, damaged/lost, lateFee acumulado)
- PaymentsModule (múltiplos pagamentos, validação de saldo)
- FinancialModule (lançamentos manuais + auto via payment)
- DocumentsModule (PDFKit: contrato, recibo, comprovante)
- AuditModule (shared service)
- Migrações Prisma para os novos campos e modelos
- Testes unitários e E2E dos fluxos críticos

### MVP 3 — Dashboard + Frontend + Relatórios (futuro)

- Dashboard com KPIs (locações ativas, vencidas, receita do mês)
- AuditLog interceptor global
- Relatórios financeiros exportáveis
- Frontend React + Vite
- Assinatura digital de documentos (avaliação futura)
- Templates customizáveis de PDF
- Upload de anexos
