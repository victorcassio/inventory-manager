# Autenticação, Gestão de Usuários e RBAC

> Documentação técnica do módulo implementado em `feat/users-password-management`
> (spec: `docs/superpowers/specs/2026-09-15-users-password-management-design.md`).
> Este documento descreve o comportamento real do código — não um plano.
> Não contém credenciais, segredos ou valores reais.

---

## 1. Visão geral

Existem três formas de uma conta ganhar uma senha:

1. **Convite** (admin cria `attendant`/`financial`) → e-mail com link de ativação.
2. **Recuperação** (usuário esqueceu a senha) → e-mail com link de redefinição.
3. **Troca autenticada** (usuário logado quer trocar a senha) → `/account/security`.

Todas as três terminam no mesmo hash Argon2id (seção 3) e, exceto a ativação
(que ainda não tem sessão), todas encerram sessões existentes (seção 6).

`admin` nunca é criado por convite — apenas via seed (`prisma/seed.ts`), e
`INVITABLE_ROLES` no schema do frontend (`attendant`, `financial`) impede que o
formulário de criação sequer construa a opção `admin`. O backend
(`CreateUserDto`/`UsersService`) recusa a mesma tentativa de forma independente.

---

## 2. Criação de `attendant`/`financial` por convite

```
POST /users               (admin, JwtAuthGuard + RolesGuard(admin))
  → cria User com password=NULL, role ∈ {attendant, financial}
  → InvitationsService.sendInvitation():
      1. revoga qualquer convite pendente anterior para esse usuário
      2. emite um novo token (UserActionTokensService, tipo "invitation")
      3. envia e-mail com link `${FRONTEND_URL}/activate-account#token=<raw>`
  → resposta inclui invitationEmailSent: true/false
      (false = token válido e emitido, mas a entrega falhou — o admin
      reenvia via POST /users/:id/resend-invitation, não recria o usuário)
```

O e-mail de convite nunca é aguardado nesse fluxo em relação a timing público:
como é uma ação admin-autenticada, não existe oráculo de enumeração a
proteger (o admin já sabe que o usuário existe). `sendInvitation` é `await`ado
normalmente e o resultado booleano é honesto sobre se a entrega funcionou.

### Ativação

```
POST /auth/activate-account   { token, password, passwordConfirmation }
  → consome o token (single-use, ver seção 5)
  → define password (hash Argon2id, política aplicada)
  → define emailVerifiedAt = passwordSetAt = now()
  → revoga qualquer OUTRO convite pendente da mesma conta
  → tudo em UMA transação: se qualquer passo falhar, o token não é
    considerado usado e a senha não é definida
  → NÃO autentica — resposta 204, frontend redireciona para /login
```

### Reenvio e revogação de convite

```
POST /users/:id/resend-invitation   (admin)
  → revoga o convite pendente anterior e emite um novo (mesmo método
    sendInvitation), invalidando o link antigo
  → usar quando invitationEmailSent foi false, ou quando o link expirou
    e o usuário nunca ativou

POST /users/:id/revoke-invitation   (admin)
  → revoga o convite pendente sem emitir um novo
  → 404 se não havia convite pendente (nada a revogar)
  → usar para desistir de convidar alguém antes que ative a conta
```

`invitationStatus` exibido em `GET /users` é **derivado**, nunca persistido
(`deriveInvitationStatus`): `accepted` se `passwordSetAt` existe; senão
`pending`/`expired`/`revoked`/`none` conforme o token mais recente. Isso evita
que um status gravado fique desatualizado em relação à expiração real do token.

---

## 3. Hashing de senha — Argon2id

Parâmetros centralizados em `backend/src/modules/hashing/hashing.service.ts`
(`ARGON2_PARAMS`), documentados aqui para quem for auditar sem ler o código:

| Parâmetro | Valor |
|---|---|
| Algoritmo | Argon2id |
| `memoryCost` (m) | 65536 KiB (64 MiB) |
| `timeCost` (t) | 3 |
| `parallelism` (p) | 1 |
| `hashLength` | 32 bytes |
| Salt | aleatório, gerado pela própria biblioteca `argon2` a cada hash, **embutido no PHC string** resultante (não é armazenado em coluna separada) |

O hash final gravado em `users.password` é o PHC string completo (formato
`$argon2id$v=19$m=65536,t=3,p=1$<salt base64>$<hash base64>`) — ele já carrega
todos os parâmetros usados, então mudar `ARGON2_PARAMS` no futuro não invalida
hashes antigos: cada hash se auto-descreve e o `argon2.verify()` lê os
parâmetros do próprio PHC string, não do valor atual da constante.

### Pepper (HMAC-SHA-256)

Antes de chamar `argon2.hash`/`argon2.verify`, a senha passa por uma derivação
com HMAC-SHA-256, usando `PASSWORD_PEPPER` (variável de ambiente, nunca no
banco) como chave e um rótulo fixo como dado autenticado:

```
material = HMAC-SHA256(key = PASSWORD_PEPPER, label + password)
hash     = Argon2id(material, ARGON2_PARAMS)
```

- **Rótulo (label):** `inventory-manager:password:v1` — constante versionada
  de propósito. Ele é parte do domínio de derivação: mudar a string (inclusive
  o sufixo `v1`) muda o material derivado e invalida **todos** os hashes
  existentes, mesmo com o mesmo pepper. Uma futura mudança do label/algoritmo
  exige uma migração de re-hash em massa (login válido → rehash — ver seção 4
  — ou uma varredura administrativa), nunca uma troca silenciosa.
- **Por que HMAC e não concatenar o pepper na senha:** HMAC evita ataques de
  extensão de comprimento e trata o pepper como uma chave criptográfica de
  verdade, não como "mais um caractere secreto" colado no início/fim da senha.
- **Onde mora:** só em `PASSWORD_PEPPER` (variável de ambiente). Nunca é
  persistido no banco, nunca aparece em log (`HashingService.logFailure`
  registra apenas a mensagem de erro nativa do argon2/bcrypt, nunca a senha, o
  hash armazenado ou o pepper), e sua ausência é uma falha estrutural: se a
  variável não existir, `deriveMaterial()` lança antes de qualquer tentativa
  de hash/verificação — não existe fallback silencioso.

### Mitigação de timing (enumeração de contas)

`HashingService` pré-computa, no `onModuleInit()`, um "dummy hash" Argon2id de
uma senha aleatória descartável. Qualquer caminho de login onde não existe
senha elegível para comparar (usuário inexistente, inativo, e-mail não
verificado, sem senha definida) chama `verifyDummy()` contra esse dummy hash
em vez de simplesmente retornar `401` imediatamente — isso paga o mesmo custo
computacional do Argon2id que uma tentativa contra uma conta real pagaria,
para que o tempo de resposta não vaze se uma conta existe.

### Verificação: bcrypt legado vs Argon2id

`HashingService.verify(storedHash, password)` inspeciona o **prefixo** do hash
armazenado para decidir a estratégia — nunca assume o formato:

- `$2a$`/`$2b$`/`$2y$` → bcrypt legado. Comparado com `bcrypt.compare()`
  contra a senha **crua** (bcrypt legado nunca usou o pepper/HMAC — comparar
  do jeito que foi criado). Retorna `needsRehash: true` quando válido.
- `$argon2` → Argon2id atual. Comparado com `argon2.verify()` contra o
  material derivado (HMAC com pepper). `needsRehash` sempre `false` — só
  bcrypt precisa de migração.
- Qualquer outro formato (ou hash vazio/ausente) → inválido, sem distinção de
  motivo (mesma mensagem genérica de credenciais inválidas).

**Nenhum fluxo novo gera bcrypt.** `hash()` e `rehashLegacy()` só produzem
Argon2id. `bcrypt` permanece uma dependência **apenas para leitura** de hashes
que já existiam antes desta feature.

### Migração progressiva (bcrypt → Argon2id)

Não existe um job de migração em lote. A migração acontece **por login bem-
sucedido**: em `AuthService.validateUser()`, se `hashing.verify()` retornar
`needsRehash: true` (ou seja, a senha crua bateu contra um hash bcrypt), o
serviço chama `hashing.rehashLegacy(password)` — que gera um Argon2id
**sem reaplicar a política de senha** — e grava o novo hash antes de emitir os
tokens.

> ⚠️ `rehashLegacy()` **nunca** deve ser chamado de um fluxo onde o usuário
> ESCOLHE a senha (ativação, reset, troca). Só existe para reencodar uma senha
> já aceita no passado, no momento em que ela prova ser correta via login.
> Aplicar a política aqui rejeitaria credenciais corretas e trancaria o
> usuário fora do sistema — por isso ele ignora a política deliberadamente.

Efeito prático: uma senha antiga que já violaria a política atual (ex.:
`Admin@123456`, que está na lista de comuns) **continua funcionando para
login** — a política só é aplicada no momento em que uma senha é
**definida/trocada**, nunca retroativamente no login.

---

## 4. Recuperação de senha (forgot/reset)

```
POST /auth/forgot-password   { email }
  → SEMPRE responde com a MESMA mensagem genérica, com o MESMO formato,
    independentemente de o e-mail existir, estar ativo, verificado ou ter senha
  → limite de 3 tokens por usuário a cada 15 minutos (silencioso: além do
    limite, ainda responde a mensagem genérica, sem indicar rate limit)
  → envio de e-mail é fire-and-forget (não aguardado) — aguardar a resposta
    SMTP faria uma conta existente responder mais devagar que uma inexistente,
    vazando existência por timing
  → nenhum AuditLog é gravado (a requisição é anônima; AuditLog.userId
    significa "ator", e aqui não há ator autenticado)

POST /auth/reset-password   { token, password, passwordConfirmation }
  → consome o token (single-use)
  → define nova senha (Argon2id, política aplicada)
  → revoga TODOS os refresh tokens ativos do usuário
  → define passwordChangedAt = now() (mata access tokens antigos — seção 6)
  → grava AuditLog (aqui já há um ator: o próprio usuário, autenticado pelo token)
```

## 5. Troca de senha autenticada (`/account/security`)

Disponível para **as três roles** (`admin`, `attendant`, `financial`) —
deliberadamente **fora** da checagem de permissão administrativa de `/users`:
trocar a própria senha não é uma ação de gestão de usuários.

```
POST /auth/change-password   (JwtAuthGuard)
  { currentPassword, newPassword, newPasswordConfirmation }
  → confirma sessão ainda válida (usuário ativo, e-mail verificado, com senha)
  → confirma newPassword === newPasswordConfirmation
  → pré-checagem barata: newPassword !== currentPassword (string literal)
  → verifica currentPassword contra o hash armazenado (autoritativo)
  → verifica que newPassword NÃO bate com o hash armazenado (autoritativo —
    a pré-checagem acima pode não pegar todos os casos; esta é a regra real)
  → grava novo hash Argon2id + passwordChangedAt = now()
  → revoga TODOS os refresh tokens do usuário (inclusive o da própria sessão)
  → grava AuditLog
```

No frontend, o sucesso (ou um 401 que indica que a sessão já morreu de outra
forma durante a chamada) dispara, nesta ordem: parar qualquer refresh em
andamento → cancelar queries ativas do TanStack Query → limpar o cache →
revogar+limpar a sessão local → navegar para `/login` com `replace: true`,
carregando apenas um indicador não sensível (`'password-changed'` ou
`'session-expired'`) via `navigation state` — nunca um toast preso à página
autenticada que está prestes a desmontar.

---

## 6. Tokens de ação (convite e reset) — ciclo de vida

Implementados em `UserActionTokensService`, tabela `user_action_tokens`.

| Propriedade | Comportamento |
|---|---|
| Geração | `crypto.randomBytes(32)` → base64url (43 caracteres) |
| Armazenamento | **apenas o digest SHA-256** do token (`token_hash`, `VARCHAR(64)`, índice único) — o valor bruto nunca é persistido, só existe na memória do processo pelo tempo de montar o e-mail |
| Transporte na URL | fragmento (`#token=...`), nunca query string — o fragmento não é enviado ao servidor em nenhuma requisição HTTP nem aparece em logs de acesso ou `Referer` |
| TTL | convite: **24 horas**; redefinição de senha: **30 minutos** (`ACTION_TOKEN_TTL`) |
| Consumo | **uma única operação condicional** (`updateMany` com `usedAt: null, revokedAt: null, expiresAt: {gt: now}`) — duas requisições simultâneas com o mesmo token nunca conseguem as duas `count === 1`; a perdedora recebe a mesma mensagem genérica de token inválido |
| Revogação | emitir um novo convite/reset revoga qualquer anterior ainda pendente da mesma conta e do mesmo tipo |
| Mensagem de erro | uma única string fixa (`INVALID_TOKEN_MESSAGE = "Link inválido ou expirado"`) para token ausente, malformado, de tipo errado, expirado, já usado ou revogado — nunca diferenciada, para não vazar qual dessas condições se aplica |
| Retenção | tokens em estado terminal (usado, revogado, ou expirado) com mais de 30 dias são apagados oportunisticamente a cada nova emissão (`pruneTerminal`) — tokens ainda vivos nunca são elegíveis, qualquer que seja `createdAt` |

No frontend, o token nunca é persistido (não vai para `localStorage`, estado
global do Zustand, nem query key do TanStack Query) e é removido da URL assim
que a página monta (`useFragmentToken`, com salvaguardas contra remover uma
âncora legítima que não seja um token — ver `docs/superpowers/specs/2026-09-15-users-password-management-design.md`
e a nota "`useLocation().hash` fica desatualizado" na memória do projeto).

---

## 7. Revogação de sessões (refresh tokens)

Tanto `reset-password` quanto `change-password` revogam **todos** os refresh
tokens ativos do usuário na mesma transação que grava a nova senha, e ambos
atualizam `passwordChangedAt`. `JwtStrategy.validate()` rejeita qualquer
access token cujo `iat` (issued-at) seja anterior a `passwordChangedAt` —
como o access token é stateless (JWT), essa é a única forma de invalidá-lo
antes do seu próprio `exp`. O guard tem checagem nula explícita: contas
migradas pela migration `20260915235229` ficam com `passwordChangedAt = NULL`
de propósito (nunca tiveram uma troca), e sem esse `if` elas seriam
instantaneamente deslogadas por um valor que nunca existiu.

**Limitação conhecida (ver backlog):** `POST /auth/logout` revoga por
**correspondência exata de token**, enquanto a rotação de refresh (`POST
/auth/refresh`) revoga a linha antiga por `id` e cria uma nova. Se um logout
carrega o token pré-rotação porque a rotação terminou primeiro (corrida rede),
a revogação não encontra nada e o token novo fica órfão e válido no servidor
até expirar naturalmente pelo próprio TTL. O frontend (`waitForPendingRefresh`,
Task 19) fecha quase toda a janela cliente-side; fechar de vez exige o backend
suportar revogar por família/sessão em vez de só por token exato — ver
backlog, item classificado como recomendação pós-release.

---

## 8. RBAC — rotas administrativas e de conta

| Rota (backend) | Guard | Quem acessa |
|---|---|---|
| `POST /auth/login`, `/refresh`, `/forgot-password`, `/reset-password`, `/activate-account` | nenhum (público) | qualquer um — rate-limited |
| `POST /auth/logout`, `/auth/change-password`, `GET /auth/me` | `JwtAuthGuard` | qualquer sessão autenticada válida |
| `GET/POST/PATCH /users*` | `JwtAuthGuard` + `RolesGuard` + `@Roles(admin)` | somente `admin` |

| Rota (frontend) | Dentro de `ProtectedRoute` | Guard de role adicional | Quem acessa |
|---|---|---|---|
| `/login`, `/activate-account`, `/forgot-password`, `/reset-password` | não (públicas) | — | qualquer um, sem sessão |
| `/dashboard`, `/customers`, `/inventory/*`, `/rentals/*`, `/documents`, `/calendar`, `/financial/*` (ver README para a tabela completa por módulo) | sim | `RoleGuard` por módulo | conforme módulo |
| `/account/security` | sim | **nenhum** — deliberadamente fora do `RoleGuard(['admin'])` | `admin`, `attendant`, `financial` |
| `/users`, `/users/new`, `/users/:id/edit` | sim | `RoleGuard(['admin'])` | somente `admin` |

O guard de role no frontend é **só UX** em todos os casos: cada endpoint que
ele protege também é verificado de forma independente no backend
(`@Roles(admin)` em `UsersController`, `JwtStrategy` recarregando o usuário do
banco a cada requisição — mudanças de role ou desativação têm efeito
imediato, não esperam o access token expirar). O guard de frontend só evita
uma navegação e uma resposta 403 desnecessárias; ele nunca concede acesso que
a API recusaria.

Um `admin` nunca é editável pela tela `/users/:id/edit` mesmo por outro
`admin` — a tela mostra um estado terminal explicativo em vez de um
formulário quebrado, e o backend (`requireManageableTarget`) recusa a mesma
tentativa de forma independente.

---

## 9. Limites conhecidos e estratégia futura

Ver também a auditoria de segurança da Task 20 e o backlog consolidado
(`docs/security-checklist-deploy.md`, seção "Backlog de segurança/arquitetura").

- **Rotação de pepper:** hoje não existe suporte a múltiplos peppers ativos
  simultaneamente. Trocar `PASSWORD_PEPPER` invalida **todo** hash Argon2id
  existente (o material derivado muda), porque o pepper não viaja dentro do
  PHC string (ao contrário do salt, que é público por design do Argon2id — o
  pepper existe justamente para ser um segredo que NÃO mora ao lado do hash).
  Uma rotação seria: (1) adicionar uma coluna `password_hash_pepper_version`
  ao `User`; (2) `deriveMaterial()` passar a ler o pepper certo pela versão
  gravada, com múltiplos peppers configurados simultaneamente (atual +
  anterior); (3) verificar com o pepper da versão gravada; (4) opcionalmente
  re-hash progressivo com o pepper novo no próximo login válido, como já
  acontece para bcrypt → Argon2id. Não implementado — não há hoje pressão
  operacional para rotacionar, e a mudança teria escopo próprio.
- **Token de ação com TTL fixo por tipo:** não há como um admin encurtar/
  estender o TTL de um convite específico após emitido — a única alavanca é
  revogar e reemitir.
- **Sem sincronização entre abas do navegador** para logout/login (evento
  `storage` do `localStorage` não é escutado) — deslogar em uma aba não
  desloga outra aba aberta da mesma sessão até a próxima ação que dispare uma
  chamada de rede nela.
