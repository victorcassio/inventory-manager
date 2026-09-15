# Gerenciamento de Usuários e Senhas — Design Spec

**Data:** 2026-09-15
**Status:** Aguardando revisão do usuário
**Escopo:** Backend (`backend/`) + Frontend (`frontend/`) + documentação
**Branch prevista:** `feat/users-password-management` (worktree isolado, commits faseados)

---

## Contexto

O projeto é um sistema de gestão de aluguel de equipamentos. Hoje:

- Autenticação JWT com access token (15m) e refresh token rotativo (7d), tabela `refresh_tokens`.
- Hash de senha: **bcrypt** (`auth.service.ts:38`).
- `UsersModule` possui apenas `findByEmail` e `findById`. Não existe controller.
- Usuários são criados exclusivamente por seed (`prisma/seed.ts`, `prisma/seed-demo.ts`).
- Perfis: `admin`, `attendant`, `financial`. RBAC via `RolesGuard` + `@Roles()`.
- Auditoria de mutações via `AuditService.log()`, aceitando `tx` para participar de transações.

Este spec adiciona: criação de usuários por convite (admin nunca define senha), ativação de conta
pelo próprio usuário, recuperação de senha, troca de senha autenticada, e substituição do bcrypt por
Argon2id com pepper — preservando o login de usuários bcrypt existentes via migração progressiva.

### Descobertas da análise que moldaram o design

1. **`JwtStrategy.validate()` já recarrega o usuário do banco** (`jwt.strategy.ts:26-31`) e rejeita
   `!isActive`. Portanto `req.user` é sempre a linha atual do banco e o `RolesGuard` lê
   `user.role` **do banco, não do claim do JWT**. Desativação e troca de perfil passam a valer na
   requisição seguinte, não após a expiração do access token. O claim `role` do access token é
   informativo e nunca é consultado para autorização.
2. **Todos os usuários existentes têm `email_verified_at` NULL** (a coluna não existe ainda). Um gate
   de login exigindo e-mail verificado tranca 100% das contas atuais se a migration não fizer
   backfill. O backfill é parte obrigatória da migration, não um passo manual.
3. **`npm run test` (backend) nunca toca o banco** (`jest.config.ts`: `rootDir: src`,
   `testRegex: .*\.spec\.ts$`). Testes que dependem de transação, unicidade e uso único de token
   precisam de um spec e2e separado, rodado contra o Postgres do docker-compose.
4. **Seeds e o e2e atual criam usuários com bcrypt.** A regra "nenhum fluxo novo produz bcrypt"
   também se aplica a eles.
5. **`providers.tsx:24-26` restaura tokens sem guarda** no listener `auth:tokens-refreshed`, o que
   permite a um refresh em voo ressuscitar uma sessão já encerrada. Corrigido neste escopo.

---

## Decisões de arquitetura

Adotada a decomposição **A**: módulos de infraestrutura independentes + serviço de tokens
compartilhado + serviços focados por fluxo.

| Módulo | Responsabilidade |
|---|---|
| `modules/hashing` | Derivação HMAC+pepper, hash/verify Argon2id, detecção de bcrypt, política de senha |
| `modules/mail` | Abstração de envio (`MAIL_SERVICE`), driver SMTP, driver fake, templates pt-BR |
| `modules/user-action-tokens` | Emissão, consumo atômico, revogação e retenção de tokens de ação |
| `modules/users` | CRUD administrativo + orquestração de convites |
| `modules/auth` | Login/refresh/logout (existente) + ativação, forgot, reset, change-password |

**Alternativas descartadas:** (B) um único `AccountModule` — quebra a convenção de um módulo por
domínio e o `AuthModule` continuaria dependendo dele; (C) lógica de token duplicada por fluxo —
convite e reset diferem apenas em TTL e finalidade, e duplicar "hash, valida expiração/uso/revogação,
consome atomicamente" é exatamente como um dos dois fluxos acaba mais fraco que o outro.

---

## Estrutura de arquivos

### Backend — novos

```
src/modules/hashing/
  hashing.module.ts
  hashing.service.ts              # HashingService
  hashing.service.spec.ts
  password-policy.ts              # validatePasswordPolicy + blocklist
  password-policy.spec.ts
  is-strong-password.validator.ts # decorator class-validator
  is-equal-to.validator.ts        # confirmação de senha

src/modules/mail/
  mail.module.ts
  mail.service.ts                 # interface MailService + token MAIL_SERVICE
  smtp-mail.service.ts            # nodemailer
  fake-mail.service.ts            # dev/test
  fake-mail.service.spec.ts
  templates/invitation.template.ts
  templates/password-reset.template.ts
  templates/templates.spec.ts

src/modules/user-action-tokens/
  user-action-tokens.module.ts
  user-action-tokens.service.ts
  user-action-tokens.service.spec.ts

src/modules/users/
  users.controller.ts
  users.controller.spec.ts
  users.service.spec.ts
  invitations.service.ts
  invitations.service.spec.ts
  user-response.mapper.ts
  dto/create-user.dto.ts
  dto/update-user.dto.ts
  dto/update-user-status.dto.ts
  dto/list-users.dto.ts

src/modules/auth/
  password.service.ts             # forgot / reset / change
  password.service.spec.ts
  dto/activate-account.dto.ts
  dto/forgot-password.dto.ts
  dto/reset-password.dto.ts
  dto/change-password.dto.ts

test/users-passwords.e2e-spec.ts
```

### Backend — modificados

| Arquivo | Mudança |
|---|---|
| `prisma/schema.prisma` | `password` nullable, 3 timestamps, enum + model `UserActionToken` |
| `src/config/app.config.ts` | `PASSWORD_PEPPER` obrigatório, validação de força, config de mail |
| `src/modules/auth/auth.service.ts` | Gate de login, rehash bcrypt→Argon2id, gate no `refreshTokens()` |
| `src/modules/auth/auth.controller.ts` | 4 rotas novas |
| `src/modules/auth/auth.module.ts` | Importa Hashing, Mail, UserActionTokens, Audit |
| `src/modules/auth/strategies/jwt.strategy.ts` | Gate completo (ativo + verificado + com senha) |
| `src/modules/users/users.service.ts` | CRUD administrativo, listagem paginada, guardas |
| `src/modules/users/users.module.ts` | Controller + imports |
| `src/app.module.ts` | Registro dos módulos novos |
| `src/common/filters/global-exception.filter.ts` | `SENSITIVE_PATHS` estendido |
| `prisma/seed.ts`, `prisma/seed-demo.ts` | Argon2id + `SEED_ADMIN_PASSWORD` do ambiente |
| `test/auth.e2e-spec.ts` | Usuário de teste com Argon2id + campos de verificação |
| `package.json` | `+argon2`, `+nodemailer`, `+@types/nodemailer`. **`bcrypt` e `@types/bcrypt` permanecem** — são necessários para verificar hashes legados durante a migração progressiva; deixam de ser usados para gerar hashes |

### Frontend — novos

```
src/features/users/
  pages/UsersListPage.tsx
  pages/UserNewPage.tsx
  pages/UserEditPage.tsx
  components/UserForm.tsx
  components/InvitationStatusBadge.tsx
  hooks/useUsers.ts

src/features/auth/
  pages/ActivateAccountPage.tsx
  pages/ForgotPasswordPage.tsx
  pages/ResetPasswordPage.tsx
  components/PasswordInput.tsx
  components/PasswordRequirements.tsx
  hooks/useFragmentToken.ts
  hooks/usePasswordFlows.ts

src/features/account/
  pages/AccountSecurityPage.tsx
  hooks/useChangePassword.ts

src/lib/api/users.api.ts
src/schemas/user.schema.ts
src/schemas/password.schema.ts

src/tests/users/UsersListPage.test.tsx
src/tests/users/UserForm.test.tsx
src/tests/auth/ActivateAccountPage.test.tsx
src/tests/auth/ForgotPasswordPage.test.tsx
src/tests/auth/ResetPasswordPage.test.tsx
src/tests/auth/PasswordInput.test.tsx
src/tests/account/AccountSecurityPage.test.tsx
src/tests/schemas/password.schema.test.ts
```

### Frontend — modificados

| Arquivo | Mudança |
|---|---|
| `index.html` | `<meta name="referrer" content="no-referrer">` |
| `src/app/routes.tsx` | 3 rotas públicas, 3 admin sob `ProtectedRoute` + `RoleGuard`, `/account/security` |
| `src/app/providers.tsx` | Guarda em `handleRefresh` contra sessão já limpa |
| `src/components/layout/Sidebar.tsx` | Itens "Usuários" (admin) e "Minha conta" (todos) |
| `src/components/feedback/ConfirmDialog.tsx` | `onOpenChange` → `onCancel` (Esc fecha) |
| `src/lib/api/auth.api.ts` | 4 métodos novos |
| `src/lib/permissions.ts` | `users: { view: ['admin'], manage: ['admin'] }` |
| `src/types/index.ts` | `InvitationStatus`, `AdminUser`, campos novos em `User` |
| `src/pages/LoginPage.tsx` / `LoginForm.tsx` | Link "Esqueci minha senha" |
| `src/tests/layout/Sidebar.test.tsx` | Expectativas dos itens novos |

---

## Hashing

### Parâmetros

Centralizados em `hashing.service.ts` como constante exportada:

```ts
export const ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 65536,   // KiB
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;
```

### Derivação com pepper

Uma única função privada `deriveMaterial(password)` é usada por `hash()` **e** `verify()`, de modo
que as duas não podem divergir:

```ts
createHmac('sha256', pepper)
  .update('inventory-manager:password:v1')
  .update(password, 'utf8')
  .digest();
```

O salt é gerado pela própria lib `argon2`, é aleatório e distinto por senha, e permanece embutido na
string PHC (`$argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>`). **Não existe coluna de salt.**

### API do serviço

| Método | Comportamento |
|---|---|
| `hash(password)` | Valida política, deriva material, retorna PHC Argon2id |
| `verify(storedHash, password)` | `{ valid, needsRehash }`. Detecta bcrypt por prefixo (`$2a$`, `$2b$`, `$2y$`) e verifica com bcrypt; Argon2id verifica com `argon2.verify`. `needsRehash: true` somente para bcrypt |
| `isBcryptHash(hash)` | Predicado puro |
| `verifyDummy(password)` | Verifica contra o hash dummy de startup. Sempre falha. Existe para igualar o custo de tempo dos caminhos sem senha elegível |

O serviço **não escreve no banco** e **não registra em log** qual algoritmo uma linha usa.

### Hash dummy para mitigação de timing

`HashingService.onModuleInit()` computa **uma única vez, no startup**, um hash Argon2id sobre um
valor aleatório de 32 bytes (`crypto.randomBytes`), usando exatamente o mesmo caminho de código:
mesmos `ARGON2_PARAMS`, mesma derivação HMAC, mesmo label `inventory-manager:password:v1` e o mesmo
pepper configurado. O hash fica em memória do processo, **nunca vai ao banco** e **nunca é
registrado em log**. Nunca é recomputado por requisição — isso apenas moveria o custo para o lugar
errado.

### Pepper

- Fonte exclusiva: `PASSWORD_PEPPER`. Obrigatório em **todos** os ambientes — sem default, sem
  fallback, e **nunca gerado aleatoriamente no startup** (isso invalidaria todas as senhas
  armazenadas a cada reinício).
- Em produção: recusa iniciar se ausente, com menos de 32 caracteres, ou se casar com os padrões de
  placeholder já usados para os segredos JWT (`app.config.ts:25`).
- Testes injetam um valor fixo, exclusivo de teste, via mock do `ConfigService` (unit) e via `.env`
  de teste (e2e).
- Nunca vai ao banco, ao frontend, a logs, a auditoria, a exceções ou à documentação.

### Rotação da derivação

O label `inventory-manager:password:v1` é versionado de propósito e **não deve ser alterado
silenciosamente**: trocar `v1` invalida todos os hashes existentes. Uma rotação futura de pepper ou
de derivação exige estratégia explícita — coluna `password_hash_version` no `User`, janela de
verificação dupla (tenta a versão nova, cai para a antiga) e rehash oportunista no login válido.
Documentado como requisito; não implementado neste escopo.

### Política de senha

`password-policy.ts`, usada pelo backend (autoritativa) e espelhada no frontend (apenas UX):

- Mínimo 12 caracteres, máximo 128 — contados na string bruta.
- Espaços e Unicode aceitos. **Sem `trim()`**, sem truncamento silencioso.
- Blocklist de senhas comuns, incluindo `123456`, `password`, `Admin@123456`.
- **Sem** exigência de combinação de maiúscula/minúscula/número/símbolo.
- Frases-senha longas permitidas.
- Confirmação idêntica à senha (validada no DTO e revalidada no service).
- A senha recebida nunca é registrada em log, auditoria, exceção ou resposta.

---

## Modelo de dados

### `User` — alterações

```prisma
password          String?   @db.VarChar(255)
emailVerifiedAt   DateTime? @map("email_verified_at")
passwordSetAt     DateTime? @map("password_set_at")
passwordChangedAt DateTime? @map("password_changed_at")

actionTokens      UserActionToken[]
```

`VarChar(255)` continua suficiente: um PHC Argon2id nesses parâmetros tem ~96 caracteres.

### `UserActionToken` — novo

```prisma
enum UserActionTokenType {
  invitation
  password_reset
}

model UserActionToken {
  id        String              @id @default(uuid())
  userId    String              @map("user_id")
  type      UserActionTokenType
  tokenHash String              @unique @map("token_hash") @db.VarChar(64)
  expiresAt DateTime            @map("expires_at")
  usedAt    DateTime?           @map("used_at")
  revokedAt DateTime?           @map("revoked_at")
  createdAt DateTime            @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, type])
  @@index([expiresAt])
  @@map("user_action_tokens")
}
```

`tokenHash` guarda o digest SHA-256 em hex (64 chars) e seu índice único é o ponto de lookup do
`consume()`.

### Deliberadamente ausentes

- **Coluna `invitationStatus`** — derivada por requisição. Status persistido precisa ser mantido em
  sincronia com expiração de token e eventualmente mente.
- **Coluna de salt** — o salt vive dentro da string PHC.
- **`invitedById`** — a auditoria já registra qual admin executou a ação; adicionar o campo seria
  inventar funcionalidade não pedida.

---

## Migration

Um único diretório novo: `prisma/migrations/<timestamp>_user_invitations_and_password_tokens/`.
**Nenhuma migration antiga é editada.**

O Prisma Migrate executa cada arquivo de migration dentro de uma transação no PostgreSQL, então a
sequência inteira é atômica — o que exige que o arquivo não contenha nada que não possa rodar em
transação (portanto `CREATE UNIQUE INDEX` simples, **nunca** `CONCURRENTLY`). O índice adquire um
lock exclusivo breve em `users`, aceitável no tamanho desta tabela.

Ordem das instruções:

1. **Guarda de duplicatas normalizadas** — aborta a migration inteira com mensagem legível, sem
   estado parcial. Não faz merge nem remove usuários:

   ```sql
   DO $$
   DECLARE conflicting TEXT;
   BEGIN
     SELECT string_agg(e, ', ') INTO conflicting
     FROM (
       SELECT lower(btrim("email")) AS e
       FROM "users"
       GROUP BY lower(btrim("email"))
       HAVING count(*) > 1
     ) dups;

     IF conflicting IS NOT NULL THEN
       RAISE EXCEPTION
         'Migration abortada: e-mails que colidem apos normalizacao (lower+btrim): %. Resolva manualmente antes de aplicar.',
         conflicting;
     END IF;
   END $$;
   ```

2. **Normalização dos registros existentes:**

   ```sql
   UPDATE "users"
      SET "email" = lower(btrim("email"))
    WHERE "email" <> lower(btrim("email"));
   ```

3. `ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;`

4. Três colunas novas, todas nullable (sem rewrite de tabela, sem default).

5. **Backfill dos usuários existentes** — a razão pela qual a ordem importa:

   ```sql
   UPDATE "users"
      SET "email_verified_at" = "created_at",
          "password_set_at"   = "created_at"
    WHERE "password" IS NOT NULL;
   ```

   `password_changed_at` permanece NULL: essas contas nunca tiveram uma *troca* de senha, e o gate
   de login não lê essa coluna.

6. `CREATE TYPE "UserActionTokenType"` + `CREATE TABLE "user_action_tokens"` com FK
   `ON DELETE CASCADE` e os dois índices.

7. **Índice único funcional normalizado:**

   ```sql
   CREATE UNIQUE INDEX "users_email_normalized_key"
       ON "users" (lower(btrim("email")));
   ```

   O nome diz o que o índice garante (case **e** espaços), não apenas case. O `@unique` do Prisma em
   `email` é mantido: fica ligeiramente redundante após a normalização, mas o Prisma precisa dele
   para `findUnique`, enquanto o índice funcional protege o banco contra escritas não normalizadas
   futuras. O Prisma não expressa índices funcionais em `schema.prisma`, então ele é SQL bruto na
   migration e `prisma db pull` não faz round-trip dele — registrado na documentação.

### Ordem de deploy (bloqueante)

1. Aplicar a migration (`prisma migrate deploy`).
2. **Se a migration falhar, parar o release.** O backend novo **nunca** deve subir contra o schema
   antigo — o gate de login rejeita `email_verified_at IS NULL` e, sem o backfill, todas as contas
   existentes ficam trancadas.
3. Configurar `PASSWORD_PEPPER` e as variáveis SMTP **antes** de iniciar o backend (a app recusa
   iniciar sem elas).
4. Subir o backend, depois o frontend.

---

## Fluxos de backend

### Gate de login e migração bcrypt

`AuthService.validateUser()`, sem nenhum caminho que chegue a uma verificação com hash nulo:

```ts
if (!user || !user.isActive || !user.password || !user.emailVerifiedAt) {
  await this.hashing.verifyDummy(password);  // custo equivalente; sempre falha
  return null;
}

const { valid, needsRehash } = await this.hashing.verify(user.password, password);
if (!valid) return null;

if (needsRehash) {
  await this.prisma.user.updateMany({
    where: { id: user.id, password: user.password },  // condicional: perde para troca concorrente
    data:  { password: await this.hashing.hash(password) },
  });
}
return user;
```

Toda rejeição retorna `null`, então o controller continua emitindo o mesmo
`401 Email ou senha inválidos` genérico de hoje — nenhuma mensagem distingue "inativo" de "nunca
ativado" de "senha errada".

**Mitigação de timing.** Todo caminho sem senha armazenada elegível — usuário inexistente, conta
inativa, e-mail não verificado, conta sem senha — executa uma verificação contra o hash dummy de
startup antes de retornar a falha genérica. Sem isso, um usuário inexistente responde em
microssegundos enquanto um usuário válido paga ~50–100ms de Argon2id, e a diferença enumera contas.
Com isso, os quatro caminhos pagam aproximadamente o mesmo custo dominante.

Isto é **mitigação best-effort, não garantia de tempo de resposta constante**: a consulta ao banco,
o agendamento do processo, o custo de rede e o próprio ruído de medição continuam variando, e uma
conta inexistente evita a consulta de refresh tokens que um login bem-sucedido faz. O rate limit de
login existente (`@Throttle({ global: { ttl: 60_000, limit: 10 } })`) é mantido e continua sendo a
defesa primária contra enumeração por sondagem em volume. O rehash usa `updateMany` com o hash antigo no `where`, para que um
login concorrente com um reset de senha não sobrescreva o hash mais novo, e **não** mexe em
`passwordChangedAt`, porque um rehash transparente não é uma troca iniciada pelo usuário. Nada sobre
o algoritmo é registrado em log.

### `refreshTokens()` — gate de estado do usuário

A implementação atual valida apenas o registro do refresh token. Passa a validar o usuário (já
carregado via `include: { user: true }`):

```ts
if (!user.isActive || !user.emailVerifiedAt || !user.password) {
  await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
  throw new UnauthorizedException('Token de refresh inválido ou expirado');
}
```

O token apresentado é revogado na rejeição e a mensagem permanece a genérica existente.

### `JwtStrategy` — gate completo

Preserva o comportamento atual (recarrega do banco, rejeita inativo) e estende para
`!user.emailVerifiedAt || !user.password`. Como access tokens só são emitidos por login ou refresh —
ambos com gate — trata-se de defesa em profundidade. O efeito prático é que desativação e troca de
perfil valem na requisição seguinte.

### Consumo atômico de token

`UserActionTokensService.consume(rawToken, type, tx)` faz validação e escrita em uma única operação
condicional; um lookup prévio **não** é suficiente:

```ts
const tokenHash = createHash('sha256').update(rawToken).digest('hex');
const now = new Date();

const { count } = await client.userActionToken.updateMany({
  where: { tokenHash, type, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
  data:  { usedAt: now },
});

if (count !== 1) throw new BadRequestException('Link inválido ou expirado');
```

Sucesso exige exatamente uma linha atualizada, então duas requisições simultâneas com o mesmo token
resultam em exatamente um consumo. O `userId` é lido depois, pelo `tokenHash` já consumido.

### Emissão e retenção

`issue(userId, type, ttlMinutes, tx)` gera 32 bytes com `crypto.randomBytes` em base64url, grava
apenas o digest SHA-256, e retorna o token bruto **uma única vez** (apenas para montar o link do
e-mail). Na emissão, limpa tokens cujo timestamp **terminal** já passou do corte de 30 dias:

```ts
OR: [
  { usedAt:    { lt: cutoff } },
  { revokedAt: { lt: cutoff } },
  { AND: [{ usedAt: null }, { revokedAt: null }, { expiresAt: { lt: cutoff } }] },
]
```

Um token válido nunca é elegível, qualquer que seja seu `createdAt`. Mesmo padrão de limpeza
oportunista que `AuthService.login()` já usa para refresh tokens — sem introduzir cron.

### Precedência do status do convite

Derivado, avaliado nesta ordem, primeira correspondência vence:

1. `passwordSetAt != null` → **`accepted`** (independente de qualquer linha de token)
2. Existe token `invitation` com `usedAt IS NULL AND revokedAt IS NULL AND expiresAt > now()` → **`pending`**
3. Nenhum token `invitation` → **`none`**
4. Caso contrário, o token `invitation` mais recente por `createdAt`: `revokedAt != null` →
   **`revoked`**; senão → **`expired`**

Um reenvio após revogação lê `pending`, não `revoked`. A listagem busca os tokens de toda a página em
um único `findMany` com `userId IN (...)` e reduz em memória — sem N+1.

### Endpoints administrativos

`UsersController`, `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(UserRole.admin)` no nível da
classe. **Toda** resposta passa pelo `UserResponseMapper` sobre um `select` explícito — nenhuma
resposta depende de desestruturar um objeto `User` completo do Prisma.

| Endpoint | Body / query | Retorno | Guardas além de admin |
|---|---|---|---|
| `GET /users` | `page`, `limit`, `search`, `role`, `status=active\|inactive` | `PaginatedResult<UserResponse>` | — |
| `POST /users` | `{ name, email, role: attendant\|financial }` | 201 `{ user, invitationEmailSent }` | 409 e-mail duplicado |
| `GET /users/:id` | — | `UserResponse` | 404 |
| `PATCH /users/:id` | `{ name?, role? }` | `UserResponse` | rejeita `role: admin`, rejeita alvo `admin`, rejeita troca do próprio perfil |
| `PATCH /users/:id/status` | `{ isActive }` | `UserResponse` | 403 em si mesmo, 403 em alvo `admin`, guarda do último admin ativo |
| `POST /users/:id/resend-invitation` | — | `{ user, invitationEmailSent }` | 409 se `passwordSetAt != null`, 409 se inativo |
| `POST /users/:id/revoke-invitation` | — | 204 | 404 se não há convite pendente |

`UserResponse` expõe exatamente: `id`, `name`, `email`, `role`, `isActive`, `emailVerifiedAt`,
`passwordSetAt`, `lastLogin`, `createdAt`, `updatedAt`, `invitationStatus`,
`invitationExpiresAt`. Nunca `password`, `tokenHash`, digests ou refresh tokens.

`invitationExpiresAt` é o `expiresAt` do token de convite pendente e é `null` em qualquer outro
status — não expõe o `expiresAt` de tokens já expirados, usados ou revogados.

`GET /users` lista **todos** os usuários, inclusive os de perfil `admin`, porque o admin precisa ver
quem tem acesso ao sistema. Contas `admin` aparecem sem ações disponíveis (editar, ativar/desativar,
reenviar e revogar ficam desabilitados), coerente com os endpoints, que recusam alvos `admin`.

`role: 'admin'` é rejeitado pelo próprio DTO (`@IsIn(['attendant','financial'])`), então nunca chega
ao service — e o service revalida, porque um DTO não é fronteira de segurança.
`assertNotLastActiveAdmin()` é implementado e ligado ao caminho de desativação agora; fica
inalcançável enquanto alvos `admin` são recusados, o que é o objetivo — a guarda passa a valer no dia
em que o gerenciamento de admins for habilitado, em vez de ser um comentário prometendo isso.

**Desativação revoga sessões:** `PATCH /users/:id/status` com `isActive: false` revoga todos os
refresh tokens ativos do usuário **na mesma transação** da atualização de status. Sem isso, uma conta
desabilitada mantém sessões renováveis.

**Troca de perfil revoga sessões:** `PATCH /users/:id` alterando `role` revoga os refresh tokens do
usuário na mesma transação. O perfil efetivo já vem do banco a cada requisição (ver Descoberta 1),
então a autorização é imediata; a revogação existe para que o `role` em cache no store do frontend
não permaneça desatualizado na UI.

**Duplicidade de e-mail:** 409 tanto pela pré-checagem quanto por captura do `P2002` do Prisma sobre
o índice funcional — é a captura que fecha a corrida de dois admins submetendo ao mesmo tempo.

### Criação com falha de e-mail recuperável

Transação: cria o usuário (`password: null`, `isActive: true`, e-mail normalizado) → `issue(invitation, 24h)`
→ `audit.log('create_user', payload { role })`. Commit e **depois** envio do e-mail, fora da
transação. Em falha de envio: captura, `invitationEmailSent: false`, um
`audit.log('invitation_email_failed')` sem token e sem URL. A linha e seu token válido sobrevivem,
então o reenvio funciona no mesmo usuário e nenhum duplicado é criado. Resposta 201 com a flag em
`false` — **nunca** uma resposta que sugira entrega.

### Endpoints públicos e autenticados

Todos com throttle pelo throttler nomeado `global` já existente
(`@Throttle({ global: { ttl, limit } })`, mesmo padrão da rota de login atual).

**`POST /auth/activate-account`** — `{ token, password, passwordConfirmation }` → `204`.
Uma transação: `consume(token, invitation)` → grava `password`, `emailVerifiedAt`, `passwordSetAt` →
revoga os demais convites pendentes do usuário → `audit.log('activate_account')`. Qualquer defeito do
token (ausente, expirado, usado, revogado, tipo errado) produz o mesmo
`400 Link inválido ou expirado`. **Não** autentica o usuário e **não** emite tokens.

**`POST /auth/forgot-password`** — `{ email }` → sempre
`200 { message: 'Se o e-mail estiver cadastrado, enviaremos as instruções para redefinição da senha.' }`,
com corpo e status idênticos independentemente de a conta existir, estar ativa ou estar verificada.
Throttle por IP 5/15min; throttle por usuário via `countRecent(password_reset, 15min) >= 3` → não
envia, silenciosamente. Para usuário elegível: revoga tokens `password_reset` anteriores, emite um de
30 minutos, envia o e-mail. **Falha de SMTP não altera a resposta pública** — mesmo status, mesmo
corpo; a falha é registrada apenas operacionalmente, sem token, sem URL e sem dados sensíveis do
destinatário.

**`POST /auth/reset-password`** — `{ token, password, passwordConfirmation }` → `204`.
Uma transação: `consume(token, password_reset)` → grava `password` + `passwordChangedAt` →
`refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } })` →
`audit.log('reset_password')`. Mesmo `400` genérico para todo defeito de token.

**`POST /auth/change-password`** — `@UseGuards(JwtAuthGuard)`,
`{ currentPassword, newPassword, newPasswordConfirmation }` → `204`.
Rejeita usuário inativo, não verificado ou sem senha antes de tocar em qualquer hash, mesmo que
apresente um JWT válido. Verifica a senha atual via `HashingService` (para que um usuário da era
bcrypt consiga trocar a sua). A regra "nova senha diferente da atual" é decidida por
`HashingService.verify(storedHash, newPassword)` — comparação de texto puro permanece apenas como
checagem barata antecipada, **não** como regra autoritativa. Aplica a política, grava o hash
Argon2id + `passwordChangedAt`, revoga **todos** os refresh tokens incluindo a sessão atual do
chamador, `audit.log('change_password')`. A resposta não traz hash nem detalhe de validação interna;
senha atual incorreta é um `400 Senha atual incorreta` seco.

A confirmação de senha é checada por um decorator `@IsEqualTo('password')` do class-validator **e**
revalidada no service.

### Auditoria

Ações adicionadas: `create_user`, `update_user`, `update_user_status`, `resend_user_invitation`,
`revoke_user_invitation`, `invitation_email_failed`, `activate_account`, `reset_password`,
`change_password`. `entity: 'User'`, `entityId` = usuário alvo, payload limitado a
`role` / `isActive` / `invitationEmailSent`. Nunca senha, token, digest ou pepper.

**`request_password_reset` é deliberadamente omitido da auditoria.** `AuditLog.userId` é uma FK
não-nulável e representa o **ator** em todos os call sites existentes. Uma solicitação de
recuperação é anônima — qualquer pessoa pode tê-la disparado — e gravar o dono da conta como ator
afirmaria semanticamente que ele fez o pedido. Em vez de redefinir silenciosamente `userId` de "ator"
para "usuário afetado" nessa única ação, o rastro é: a própria linha em `user_action_tokens`
(`userId`, `type`, `createdAt`) e uma linha de log operacional com ação e IP, sem e-mail, token ou
URL. `activate_account` e `reset_password` continuam atribuídos ao dono da conta, porque concluir
qualquer um dos dois exige provar posse do token enviado por e-mail — ali o usuário é de fato o ator.

### `SENSITIVE_PATHS`

`global-exception.filter.ts` passa a incluir `/auth/activate-account`, `/auth/forgot-password`,
`/auth/reset-password`, `/auth/change-password`. O mecanismo é **redação de corpo de requisição em
logs e telemetria do servidor** — ele nunca reescreve uma resposta. Respostas de validação de
política de senha continuam chegando ao frontend com o texto das regras; o valor submetido nunca é
ecoado.

---

## Envio de e-mail

`MailService` é uma interface com token de injeção `MAIL_SERVICE`, permitindo trocar de provedor sem
tocar nos serviços de domínio:

```ts
export interface MailService {
  send(message: { to: string; subject: string; html: string; text: string }): Promise<void>;
}
```

| Driver | Quando | Comportamento |
|---|---|---|
| `SmtpMailService` | `MAIL_DRIVER=smtp` | nodemailer com host/port/secure/user/password/from do ambiente |
| `FakeMailService` | `MAIL_DRIVER=fake` | Guarda mensagens em memória **somente** quando `NODE_ENV === 'test'`. Em desenvolvimento, registra destinatário, assunto e nome do template — e **nada mais**: nunca token bruto nem URL sensível completa |

**Em produção a aplicação recusa iniciar se um driver real não estiver configurado** —
`MAIL_DRIVER=fake` com `NODE_ENV=production` é erro de inicialização, assim como SMTP incompleto.

O inspetor em memória do fake é o único meio de recuperar o link de ativação/reset, e existe apenas
em ambiente de teste. Nenhuma resposta HTTP, em nenhum ambiente, contém o token.

Templates em `modules/mail/templates/`, funções puras retornando `{ subject, html, text }`, em
português, sem senha provisória:

- **Convite / ativação** — nome do usuário, quem convidou não é exposto, link com validade de 24h.
- **Recuperação de senha** — link com validade de 30 minutos, aviso de que a solicitação pode ser
  ignorada se não foi feita pelo titular.

### Links com token no fragmento

```text
{FRONTEND_URL}/activate-account#token={rawToken}
{FRONTEND_URL}/reset-password#token={rawToken}
```

O fragmento **não é enviado ao servidor**: o token não aparece em log de acesso, em telemetria de
servidor, nem em `Referer` — nem mesmo se a meta tag de referrer falhasse.

---

## Frontend

### Peças compartilhadas

- **`PasswordInput.tsx`** — wrapper do `Input` com alternância olho/olho-riscado. `autoComplete`
  repassado (`new-password` em ativação/reset, `current-password` na troca).
- **`PasswordRequirements.tsx`** — checklist ao vivo (≥12 caracteres, ≤128, não pode ser uma senha
  comum, confirmação igual) alimentado pelo valor atual do campo. Renderiza as **regras**, nunca o
  valor.
- **`schemas/password.schema.ts`** — um `passwordFieldSchema` (min 12, max 128, blocklist,
  **sem `.trim()`**) reutilizado por `activateAccountSchema`, `resetPasswordSchema` e
  `changePasswordSchema`, cada um com `.superRefine` para a confirmação. Espelha a política do
  backend apenas para UX; o backend permanece autoritativo.
- **`schemas/user.schema.ts`** — `createUserSchema` (nome, e-mail, perfil restrito a
  `attendant | financial`), `updateUserSchema`.

### Token no fragmento

`useFragmentToken()` lê o token uma vez e remove o fragmento imediatamente:

```ts
const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
window.history.replaceState(
  window.history.state,
  document.title,
  window.location.pathname,
);
```

Sem `useSearchParams`. O token capturado fica **apenas em memória do componente** — nunca em
`localStorage`, `sessionStorage`, Zustand, logs, telemetria ou chave de TanStack Query. Vai somente
no corpo da mutation.

**Consequência documentada, não escondida:** removido o fragmento, um refresh da página perde o token
em memória de propósito. A página então renderiza o estado de link ausente/inválido (com link para
`/forgot-password`) e **não chama a API**, porque não há nada para validar.

`index.html` recebe `<meta name="referrer" content="no-referrer">`, cobrindo todo o SPA como defesa
em profundidade.

### Tratamento de erro — três vias, nunca texto arbitrário do backend

| Situação | O que a UI mostra |
|---|---|
| `400`/`422` com mensagens de política de senha | As mensagens controladas de política |
| Qualquer rejeição de token | Fixo: `Link inválido ou expirado` |
| Erro inesperado, `5xx`, rede, timeout | `Não foi possível processar a solicitação agora. Tente novamente.` |

Nenhuma exceção arbitrária do backend é renderizada verbatim.

### Rotas

Autenticação por fora, autorização por dentro — `RoleGuard` **não** substitui `ProtectedRoute`:

```tsx
<Route element={<AuthLayout />}>
  <Route path="/login" element={<LoginPage />} />
  <Route path="/activate-account" element={<ActivateAccountPage />} />
  <Route path="/forgot-password" element={<ForgotPasswordPage />} />
  <Route path="/reset-password" element={<ResetPasswordPage />} />
</Route>

<Route element={<ProtectedRoute />}>
  <Route element={<AppLayout />}>
    {/* ...rotas existentes... */}
    <Route element={<RoleGuard allowedRoles={['admin']} />}>
      <Route path="/users" element={<UsersListPage />} />
      <Route path="/users/new" element={<UserNewPage />} />
      <Route path="/users/:id/edit" element={<UserEditPage />} />
    </Route>
    <Route path="/account/security" element={<AccountSecurityPage />} />
  </Route>
</Route>
```

Todas lazy-loaded, seguindo a convenção `React.lazy` existente. O servidor recusa de todo modo; as
guardas do frontend são apenas UX.

### Lista de usuários

`UsersListPage.tsx` segue `CustomersListPage` exatamente: `usePagination`, `<Table>` desktop dentro
de `hidden md:block`, lista compacta `md:hidden divide-y`, `EmptyState` / `ErrorState` / `Skeleton`,
mesmo rodapé de paginação. Colunas: Nome, E-mail, Perfil, Status, Convite, E-mail verificado, Último
login, Ações. Busca por nome/e-mail mais um `FilterPanel` colapsável (o componente que as telas de
financeiro e locações já usam) com selects de perfil e status.

`InvitationStatusBadge` mapeia os cinco estados derivados para variantes de `Badge` com rótulos
pt-BR: Nenhum / Pendente / Expirado / Revogado / Aceito.

Ações por linha — Editar, Ativar/Desativar, Reenviar convite, Revogar convite — exibidas apenas
quando aplicáveis, com `ConfirmDialog` antes de desativar e antes de revogar.

### Cadastro e edição

`UserForm.tsx` compartilhado (React Hook Form + Zod + primitivas `Form` existentes). **Não existe
campo de senha neste formulário.** O select de perfil oferece apenas Atendente e Financeiro. Em
edição, nome e perfil são editáveis e o e-mail é somente leitura.

Sucesso na criação: *"Usuário criado. Um convite foi enviado para que ele valide o e-mail e defina
sua senha."* Quando a resposta traz `invitationEmailSent: false`, um toast de aviso substitui o de
sucesso: *"Usuário criado, mas o convite não pôde ser enviado. Use 'Reenviar convite' na lista."*
A UI nunca afirma uma entrega que a API não confirmou.

### Ativação e redefinição

Mesmo layout: senha + confirmação via `PasswordInput`, `PasswordRequirements`, e três estados
terminais — token ausente (renderiza o estado de link inválido **sem** chamar a API), rejeição da API
(mensagem genérica fixa + link para `/forgot-password`), e sucesso (toast e `navigate('/login')`,
nunca autenticado automaticamente).

### Esqueci minha senha

- **Resposta HTTP 2xx** → painel de confirmação independente da conta. Uma falha de SMTP permanece
  invisível porque o backend devolve a mesma resposta de sucesso.
- **Falha de rede, timeout ou backend indisponível** → `Não foi possível processar a solicitação
  agora. Tente novamente.` O painel de confirmação de envio **não** é exibido quando a requisição
  nunca chegou ao backend.
- **Resposta HTTP de erro (429 do rate limit, 400 de e-mail malformado, 5xx)** → também a mensagem de
  retry, e não o painel de confirmação: houve resposta, mas a solicitação não foi processada, e
  afirmar o contrário seria mentir para o usuário. O 429 não distingue conta existente de
  inexistente, então isso não reabre enumeração.

`/login` recebe o link "Esqueci minha senha".

### Minha conta — segurança

`/account/security`: senha atual, nova senha, confirmação, aviso explícito de que *todas as sessões
serão encerradas*, e no sucesso:

```ts
await queryClient.cancelQueries();   // nada em voo pode repovoar o cache
queryClient.clear();
clearAuth();                         // limpa store + tokens do axios
navigate('/login', { replace: true });
```

### Correção de corrida no refresh

`providers.tsx:24-26` hoje chama `useAuthStore.getState().updateTokens(at, rt)` a cada evento
`auth:tokens-refreshed` sem nenhuma guarda. Isso permite duas corridas distintas:

1. Um refresh que resolva **depois** de `clearAuth()` restaura os dois tokens e ressuscita a sessão.
2. Um refresh iniciado na sessão A que resolva **depois** de o usuário ter logado novamente como
   sessão B sobrescreve a sessão B com tokens antigos. Um guard de `isAuthenticated` **não** cobre
   este caso, porque nesse instante `isAuthenticated` é `true`.

A correção é tornar a atualização condicional à sessão que a originou. O refresh token usado pela
requisição viaja no evento como `sourceRefreshToken`, e só é aceito se ainda for o token armazenado:

```ts
const state = useAuthStore.getState();
if (!state.isAuthenticated || state.refreshToken !== event.detail.sourceRefreshToken) return;
state.updateTokens(event.detail.accessToken, event.detail.refreshToken);
```

**A mesma guarda é necessária em `client.ts`, não apenas no store.** O interceptor hoje chama
`setTokens(newAt, newRt)` (`client.ts:66`) sobre o estado de módulo do axios **antes** de despachar o
evento, então um refresh obsoleto envenena o cliente HTTP mesmo que o store rejeite o resultado. O
interceptor passa a capturar `rt` no início e a verificar, antes de `setTokens`, que o refresh token
de módulo atual ainda é aquele `rt`; se não for, aborta sem gravar tokens, sem despachar evento e
rejeitando a requisição original.

`clearAuth()` invalida todo refresh em voo por consequência das duas condições: `isAuthenticated`
vira `false` e `refreshToken` vira `null`, que nunca casa com um `sourceRefreshToken` não nulo.

Alternativa equivalente considerada: um identificador de geração de sessão monotônico capturado no
início do refresh e checado na conclusão. O requisito que importa em qualquer implementação é que
**uma resposta de uma sessão antiga nunca possa atualizar uma sessão mais nova**.

### Acessibilidade

- Botão de mostrar/ocultar senha com rótulo acessível e `aria-pressed` refletindo a visibilidade.
- Labels associados aos campos e erros descritos via `aria-describedby` (pelo `FormMessage` existente).
- `aria-live="polite"` nos painéis de feedback terminal (sucesso, link inválido, confirmação genérica).
- Diálogos e ações acessíveis por teclado. **Gap encontrado:** `ConfirmDialog` renderiza
  `<AlertDialog open={open}>` sem `onOpenChange`, então Esc não fecha — `onOpenChange` passa a ser
  ligado a `onCancel`.
- Foco no primeiro campo inválido após submissão.
- `autoComplete` correto por contexto (`email`, `current-password`, `new-password`).

### Tipos

`types/index.ts` ganha `InvitationStatus` e um `AdminUser` explícito. **Nenhum tipo de resposta do
frontend declara `password`, `tokenHash`, token de ação bruto ou refresh token** — os tipos espelham
exatamente o `UserResponse` do backend, de modo que um campo sensível adicionado por acidente no
backend não teria onde aterrissar no cliente.

---

## Testes

### Backend — unitários (`npm run test`, sem banco)

**Hashing:** gera hash Argon2id; a mesma senha produz hashes diferentes (salt); verificação correta;
senha incorreta rejeitada; falha controlada quando o pepper não existe; detecção de bcrypt por
prefixo; `verify` sinaliza `needsRehash` só para bcrypt; nenhum fluxo novo produz bcrypt.

**Política:** rejeita <12 e >128; aceita frase-senha longa com espaços e Unicode; não faz `trim`;
rejeita blocklist incluindo `Admin@123456`; não exige classes de caracteres.

**Tokens:** `issue` grava só o digest (token bruto ausente do banco); `consume` aceita token válido;
rejeita expirado, usado, revogado e tipo trocado com a mesma mensagem; `revokePending` invalida
anteriores; retenção não apaga token válido próximo do corte.

**Timing:** o caminho de verificação dummy roda para usuário inexistente e para as três condições
de inelegibilidade (inativo, não verificado, sem senha); nenhuma delas revela qual condição falhou —
mesma exceção, mesma mensagem, mesmo status; o hash dummy é computado uma vez no startup e não é
recomputado por requisição; o hash dummy nunca é persistido nem registrado em log.

**Auth:** gate de login rejeita inativo, sem e-mail verificado e sem senha; rehash bcrypt→Argon2id
após login válido; rehash condicional perde para troca concorrente; usuário desabilitado não faz
refresh; usuário sem senha ou não verificado não faz refresh; access token de usuário desabilitado é
rejeitado pela `JwtStrategy`; troca para a senha atual é rejeitada por verificação contra o hash
armazenado; sessões revogadas em reset e em change-password.

**Usuários:** admin cria `attendant` e `financial`; não-admin recebe 403; admin não cria outro admin;
e-mail duplicado → 409; admin não desativa a própria conta; desativação revoga refresh tokens na
mesma transação; troca de perfil revoga refresh tokens; nenhuma resposta contém `password` ou
`tokenHash`; reenvio recusa usuário inativo e nunca altera `isActive`.

**Mail:** falha de envio na criação mantém usuário e token e devolve `invitationEmailSent: false`;
falha no forgot-password preserva a resposta pública genérica; fake não registra token nem URL fora
de teste.

**Auditoria:** senha, token e pepper ausentes de todo payload; requisição anônima de reset não é
atribuída ao usuário-alvo como ator autenticado.

### Backend — e2e (`npm run test:e2e`, Postgres do docker-compose)

`test/users-passwords.e2e-spec.ts`: convite → ativação → login ponta a ponta; token expirado, usado e
revogado rejeitados com mensagem idêntica; reenvio invalida o token anterior; **duas tentativas
concorrentes de ativação/reset resultam em exatamente um consumo bem-sucedido**; forgot-password
devolve a mesma resposta para e-mail existente e inexistente; reset válido troca a senha e revoga
refresh tokens; reset inválido não altera a senha; rate limit aplicado; RBAC dos sete endpoints;
desativação impede login; unicidade case-insensitive de e-mail via índice funcional; migração bcrypt
a partir de um hash bcrypt inserido diretamente.

### Frontend (`npm run test`)

Rotas públicas renderizam e submetem; `/users` exige autenticação **e** perfil admin (não-admin →
`/403`, não autenticado → `/login`); `/account/security` exige autenticação; `UserForm` rejeita
e-mail inválido e não oferece `admin`; schemas rejeitam <12 caracteres, confirmação divergente e
senha da blocklist, e aceitam frase-senha de 60 caracteres com espaços; estados de carregamento,
sucesso e erro em lista e mutations; lista compacta mobile renderiza; falha de envio do convite exibe
o aviso em vez do sucesso.

Específicos das correções desta revisão:

- Token do fragmento é capturado e **imediatamente removido da URL**.
- Token bruto nunca entra em storage persistente nem em chave de query (asserção sobre
  `localStorage`/`sessionStorage` e sobre as keys do `QueryClient`).
- Token ausente **não** chama a API.
- Refresh após remoção do fragmento renderiza o estado de link ausente.
- Falha de rede no forgot-password **não** afirma que a solicitação foi processada.
- Texto arbitrário de exceção do backend não é renderizado.
- Controles de visibilidade de senha acessíveis por teclado, com `aria-pressed` correto.
- Campos sensíveis ausentes dos objetos de resposta mapeados.

Corrida de refresh:

- Refresh que resolve após o logout **não** restaura a autenticação.
- Refresh da sessão A que resolve após login na sessão B **não** sobrescreve a sessão B.
- Refresh da sessão atual **continua** atualizando os tokens normalmente.
- `clearAuth()` invalida todo resultado de refresh em voo — inclusive o estado de módulo do axios,
  que não pode ficar com tokens de uma sessão encerrada.

### Comandos

```bash
cd backend  && npm run test && npm run build
cd frontend && npm run test && npm run build && npm run lint
# e2e (exige Postgres na 5440)
cd backend  && npm run test:e2e
```

Node 20 é obrigatório: `source ~/.nvm/nvm.sh && nvm use 20.19.4`.

---

## Variáveis de ambiente

Novas em `backend/.env.example` (sem valores reais):

```env
PASSWORD_PEPPER=
MAIL_DRIVER=fake
SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
SEED_ADMIN_PASSWORD=
```

`FRONTEND_URL` já existe e passa a ser usada para montar os links dos e-mails.

Geração do pepper, documentada no README:

```bash
openssl rand -base64 48
```

Nenhum valor real de pepper aparece em qualquer arquivo versionado ou documentação.

### Seeds

`prisma/seed.ts` e `prisma/seed-demo.ts` passam a usar Argon2id com pepper e leem
`SEED_ADMIN_PASSWORD` do ambiente, abortando com instrução clara se estiver ausente ou se falhar a
política. O `Admin@123456` atual precisa ser substituído porque a blocklist da nova política o
bloqueia. Nenhuma credencial real é adicionada ao repositório. Os usuários semeados recebem
`emailVerifiedAt` e `passwordSetAt` preenchidos, para poderem logar sob o novo gate.

---

## Documentação a atualizar

| Arquivo | Mudança |
|---|---|
| `README.md` | Linha 718 (`bcrypt password hashing`) → Argon2id; seções de auth/RBAC, env vars, fluxos de senha, credenciais de dev |
| `README.pt-BR.md` | Linha 718 equivalente + mesmas seções |
| `backend/.env.example` | Chaves novas, vazias |
| `docs/security-checklist-deploy.md` | `PASSWORD_PEPPER` na seção 2 (bloqueante), ordem de deploy da migration, driver de mail obrigatório em produção, tokens de ação na seção de refresh tokens |

O texto deve explicar: senhas novas usam Argon2id; o salt está embutido no hash; o pepper vem de
variável de ambiente; usuários bcrypt existentes são migrados progressivamente após login válido; o
admin envia convites e nunca define senhas; existem fluxos de troca e de recuperação; e a estratégia
exigida para uma futura rotação de pepper.

---

## Pendências e limitações conhecidas

1. **Rotação de pepper não implementada.** Requer `password_hash_version` e janela de verificação
   dupla. Documentada como requisito para quem fizer a rotação.
2. **Throttle de IP em memória — decisão explícita de manter.** O `ThrottlerModule` atual usa
   storage em memória e **Redis não será adicionado agora**. Consequências documentadas:
   - É suficiente para o deployment atual, de instância única.
   - **Não é** um rate limiter distribuído: o limite por IP é contado por processo.
   - Redis, ou outro store compartilhado, passa a ser **obrigatório** antes de rodar múltiplas
     réplicas do backend — caso contrário o limite efetivo por IP é multiplicado pelo número de
     réplicas.
   - O limite por usuário no forgot-password é derivado do banco (`countRecent`) e **permanece
     efetivo entre réplicas**, independentemente do store do throttler.
3. **`prisma db pull` não faz round-trip do índice funcional** `users_email_normalized_key`.
   Um `prisma migrate diff` pode sugerir removê-lo; não remover.
4. **Gerenciamento de administradores fora de escopo.** `POST /users` e `PATCH /users/:id` recusam o
   perfil `admin`. A guarda do último admin ativo existe e está ligada, mas inalcançável até que esse
   fluxo seja habilitado.
5. **Timing de login — mitigado, não eliminado.** Os caminhos sem senha elegível executam uma
   verificação contra o hash dummy de startup, igualando o custo dominante. Resta variação
   residual (consulta ao banco, agendamento, rede, e a consulta de refresh tokens que só o login
   bem-sucedido faz), então trata-se de mitigação best-effort e não de tempo de resposta constante.
   O rate limit de login segue como defesa primária.
6. **6 vulnerabilidades dev-only** do frontend (cadeia vitest/vite/esbuild) permanecem, conforme
   decisão do PR #4.

---

## Passos manuais necessários

1. Gerar e configurar `PASSWORD_PEPPER` (`openssl rand -base64 48`) em cada ambiente, guardado no
   gerenciador de segredos — nunca no repositório.
2. Configurar SMTP real em produção (`MAIL_DRIVER=smtp` + host, porta, secure, usuário, senha,
   remetente) e validar com um envio de teste antes do go-live.
3. Definir `SEED_ADMIN_PASSWORD` para rodar os seeds de desenvolvimento.
4. Aplicar a migration **antes** de subir o backend novo; se ela falhar, parar o release.
5. Conferir que `FRONTEND_URL` aponta para o domínio público correto, já que compõe os links dos
   e-mails.
