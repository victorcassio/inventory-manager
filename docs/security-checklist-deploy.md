# Security Checklist — Deploy

> Executar este checklist antes de cada deploy para homologação e produção.
> Nunca ignorar itens marcados como **BLOQUEANTE**.

---

## 0. Ordem obrigatória de deploy [BLOQUEANTE]

Cada etapa depende da anterior ter sido concluída com sucesso. Não pule
etapas nem as execute fora de ordem, mesmo sob pressão de tempo.

1. **Backup** do banco de produção, com teste de restore verificado (ver
   seção 3). Sem um backup íntegro, nenhuma migration deve ser aplicada.
2. **Preflight de e-mails normalizados duplicados** — rode a query abaixo
   contra o banco de produção ANTES de aplicar a migration
   `20260915235229_user_invitations_and_password_tokens` (ela roda o mesmo
   preflight sozinha e aborta em caso de colisão, mas confirmar antes evita
   descobrir o problema no meio de uma janela de deploy):
   ```sql
   SELECT lower(btrim(email)) AS e, count(*)
   FROM users
   GROUP BY lower(btrim(email))
   HAVING count(*) > 1;
   ```
   Se a query retornar alguma linha, resolva manualmente (ver
   `docs/migrations-and-seeds.md`) antes de prosseguir. **Nunca** normalize,
   funda ou apague usuários automaticamente para "destravar" o deploy.
3. **Configuração das variáveis de ambiente** da nova versão (seções 1 e 2
   abaixo) — inclusive as novas `PASSWORD_PEPPER`, `MAIL_DRIVER` e `SMTP_*`.
4. **Migration antes do novo backend.** `npx prisma migrate deploy` roda
   contra o banco de produção usando o schema mais recente, **antes** de
   qualquer instância do novo backend receber tráfego. O backend antigo
   continua servindo tráfego durante esse passo — as migrations deste
   projeto são aditivas o suficiente para isso (nenhuma remove uma coluna que
   o código antigo ainda lê).
5. **Deploy do backend** (nova versão).
6. **Deploy do frontend** (nova versão) — só depois do backend novo já estar
   respondendo, para que a versão nova do frontend nunca fale com uma versão
   de API que ainda não existe.
7. **Smoke tests** (seção 7-A) contra o ambiente já no ar.
8. **Monitoramento** — confirmar que logs/alertas/uptime monitor estão
   recebendo dados da nova versão antes de considerar o deploy concluído.

---

## 1. Secrets e credenciais [BLOQUEANTE]

- [ ] `JWT_ACCESS_SECRET` gerado aleatoriamente (mín. 32 chars, sem palavras como `secret`, `test`, `example`)
  ```bash
  openssl rand -hex 64
  ```
- [ ] `JWT_REFRESH_SECRET` diferente do `JWT_ACCESS_SECRET`, mesma força
- [ ] `PASSWORD_PEPPER` gerado aleatoriamente (mín. 32 chars — recomendado 48 bytes em base64):
  ```bash
  openssl rand -base64 48
  ```
  Nunca igual, nem derivado de, `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`. Ver
  `docs/authentication-rbac.md` seção 3 para o papel exato do pepper — perdê-lo
  ou trocá-lo sem uma migração de rotação invalida **todos** os hashes de
  senha existentes.
- [ ] `SEED_ADMIN_PASSWORD` usado apenas no momento do seed inicial, gerado com
  `openssl rand -base64 24` (ou senha memorável que satisfaça a política —
  mínimo 12 caracteres, fora da lista de senhas comuns), **nunca commitado**,
  e descartado/rotacionado depois do primeiro login.
- [ ] `DATABASE_URL` usa usuário/senha exclusivos de produção (nunca os do dev)
- [ ] Senha de todos os usuários foi redefinida antes da entrega (nunca usar as do seed)
- [ ] E-mail do admin não é `admin@inventory.local`
- [ ] Nenhum `.env` de produção commitado no repositório (verificar `git status`)
- [ ] `MAIL_DRIVER` é **obrigatoriamente** `smtp` em produção — `fake` só loga
  e nunca entrega convites/resets a um usuário real. A aplicação **recusa
  iniciar** em `NODE_ENV=production` com `MAIL_DRIVER=fake` (verificação
  automática, `app.config.ts`).
- [ ] `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`
  todos preenchidos com credenciais reais do provedor de e-mail — a
  aplicação recusa iniciar em produção se qualquer um estiver ausente.

**Verificação automática:** ao iniciar com `NODE_ENV=production`, a aplicação rejeita automaticamente secrets com padrões como `secret`, `test`, `example`, `changeme` (isso inclui `PASSWORD_PEPPER`, não só os segredos JWT). Se esses valores estiverem configurados, o backend **não sobe**. Essa é uma verificação de sanidade contra placeholders esquecidos — não substitui gerar segredos de verdade.

---

## 2. Variáveis de ambiente obrigatórias [BLOQUEANTE]

| Variável | Valor esperado em produção |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_ACCESS_SECRET` | string aleatória ≥ 32 chars |
| `JWT_REFRESH_SECRET` | string aleatória ≥ 32 chars, diferente da access |
| `PASSWORD_PEPPER` | string aleatória ≥ 32 chars, diferente das duas acima |
| `DATABASE_URL` | URL do banco de produção |
| `FRONTEND_URL` | URL exata do frontend (`https://seudominio.com`) — sem trailing slash, sem wildcard |
| `PORT` | porta do servidor (ex: `3003`) |
| `MAIL_DRIVER` | `smtp` (obrigatório em produção — `fake` é recusado na inicialização) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | credenciais reais do provedor SMTP (obrigatórios quando `MAIL_DRIVER=smtp`) |
| `TRUST_PROXY` | nº de saltos ou IP/CIDR exato do proxy **se e somente se** houver reverse proxy/load balancer na frente (ver seção 5 — **nunca `true`** como padrão) — vazio/`false` se o backend é acessado direto |

`SEED_ADMIN_PASSWORD` só é necessária no momento pontual de rodar
`prisma/seed.ts` pela primeira vez — não precisa permanecer configurada como
variável de ambiente do processo do backend em produção.

---

## 3. Banco de dados [BLOQUEANTE]

- [ ] Backup do banco realizado e **restore testado** (não basta o backup existir — confirme que ele restaura)
- [ ] Preflight de e-mails duplicados executado manualmente antes da migration (ver seção 0, item 2)
- [ ] `prisma migrate deploy` executado (nunca `prisma migrate dev` em produção)
- [ ] A migration nunca normaliza/funde/apaga usuários automaticamente — se ela abortar por colisão, resolva manualmente e reaplique (ver `docs/migrations-and-seeds.md`)
- [ ] `seed-demo.ts` **nunca executado** em produção
- [ ] `prisma migrate reset` **nunca executado** em produção
- [ ] Porta do banco **não exposta** publicamente (somente acessível pelo backend)
- [ ] Backup automático configurado (Railway, Neon, Supabase oferecem isso no free tier)
- [ ] Usuário do banco com permissões mínimas (apenas DML no schema da app, sem DDL)

---

## 4. Ferramentas de desenvolvimento [BLOQUEANTE]

- [ ] **Prisma Studio** não está rodando em produção — `npm run prisma:studio` é comando local apenas
- [ ] **pgAdmin** não está exposto publicamente — remover do `docker-compose.yml` de produção ou não iniciar o container `pgadmin`
- [ ] `ReactQueryDevtools` desabilitado automaticamente quando `NODE_ENV=production` (já configurado no frontend)

---

## 5. CORS e rede

- [ ] `FRONTEND_URL` aponta **somente** para o domínio de produção (`https://seudominio.com`)
- [ ] HTTPS obrigatório — nunca aceitar HTTP em produção
- [ ] Certificado SSL/TLS ativo e válido
- [ ] Porta do backend **não acessível diretamente** via browser — apenas pelo frontend via CORS
- [ ] **`TRUST_PROXY` configurado corretamente para a topologia real** — se
      **qualquer** reverse proxy/load balancer/ingress fica na frente deste
      processo (Railway, Render, Fly, nginx, ALB, k8s ingress — o caso comum
      em produção), `TRUST_PROXY` **precisa** apontar para ele. Sem isso,
      `req.ip` — usado pelo rate limiting por IP da seção 7 E pelo
      `ipAddress` gravado em `AuditLog` — vira o IP do proxy para TODO
      cliente: o rate limit de `forgot-password`/`login` deixa de ser por
      usuário e passa a ser uma cota GLOBAL (um único atacante esgota a cota
      de todo mundo), e a trilha forense de auditoria perde o IP real. Se o
      backend for acessado DIRETAMENTE (sem proxy na frente), deixe
      `TRUST_PROXY` vazio/`false` — setá-lo sem um proxy real torna `req.ip`
      **falsificável** por qualquer cliente via `X-Forwarded-For`, o problema
      inverso.
  - [ ] **NUNCA use `TRUST_PROXY=true` como padrão de conveniência.** `true`
        manda o Express confiar em TODO salto do cabeçalho e usar a entrada
        MAIS À ESQUERDA de `X-Forwarded-For` como IP do cliente — isso só é
        seguro se o processo for **literalmente inalcançável** por qualquer
        caminho que não seja o proxy confiável, e se esse proxy **substituir**
        o cabeçalho em vez de só acrescentar a ele (nem todo proxy faz isso).
        Se o cliente conseguir adicionar entradas forjadas na frente do que o
        proxy escreve, `true` lê a entrada forjada como se fosse o IP real.
        Prefira **número de saltos** (`1` para exatamente um proxy — o
        Express então confia na entrada de `X-Forwarded-For` a partir da
        DIREITA, ou seja, a que só o SEU proxy poderia ter escrito, e ignora
        qualquer prefixo que o cliente tenha forjado) ou o **IP/CIDR exato**
        do proxy (`10.0.0.5` ou `10.0.0.0/24`), conforme a infraestrutura
        real — nunca o valor genérico `true`.

**Verificação:**
```bash
# Deve retornar vazio (sem ACAO header) para origins desconhecidas
curl -I -X OPTIONS https://sua-api.com/api/v1/customers \
  -H "Origin: https://evil-site.com" | grep -i "access-control-allow-origin"

# Com TRUST_PROXY configurado para o proxy real: um X-Forwarded-For forjado
# vindo de FORA do proxy não deve conseguir contornar o rate limit nem
# aparecer no AuditLog — só o IP que o proxy de fato injeta é confiável.
```

---

## 6. Headers de segurança (Helmet)

Verificar que os headers estão presentes em qualquer resposta:

```bash
curl -sI https://sua-api.com/api/v1/auth/login | grep -iE \
  "content-security-policy|x-frame-options|x-content-type|strict-transport|referrer-policy"
```

Esperado:
- `Content-Security-Policy` presente
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` presente
- `Referrer-Policy: no-referrer`

---

## 7. Autenticação e rate limiting

- [ ] Rate limit do login: máx 10 tentativas por IP por minuto (bloqueio 429 após a 10ª)
- [ ] Rate limit do refresh: máx 15 chamadas por minuto
- [ ] Rate limit de `forgot-password`: máx 5 por IP a cada 15 minutos
- [ ] Rate limit de `reset-password`, `change-password` e `activate-account`: máx 10 por IP a cada 15 minutos cada
- [ ] Rate limit global: 100 req/min por IP

**Verificação manual:**
```bash
# Deve retornar 429 na 11ª tentativa
for i in {1..11}; do
  curl -s -o /dev/null -w "Tentativa $i: %{http_code}\n" \
    -X POST https://sua-api.com/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"x@x.com","password":"wrongpass"}'
done
```

> ⚠️ **Limitação conhecida (aceita, ver backlog):** o throttling
> (`@nestjs/throttler`) usa armazenamento **em memória do processo**. Com mais
> de uma réplica do backend atrás de um load balancer, cada réplica conta
> tentativas de forma independente — o limite efetivo por IP é
> `limite × número_de_réplicas`, não o limite nominal. Se o deploy usar mais
> de uma réplica, considere um storage compartilhado (Redis) para o
> throttler antes de depender deste limite como controle único de força
> bruta.

---

## 7-A. Smoke tests pós-deploy [BLOQUEANTE]

Executar contra o ambiente recém-implantado, na ordem, antes de considerar o
deploy concluído (ver seção 0, passo 7). Cada item deve ser feito com uma
conta e dados descartáveis do próprio ambiente de destino, nunca contra dados
reais de cliente.

- [ ] **Login legado bcrypt + rehash** — se houver uma conta migrada de antes
  desta feature (hash bcrypt), fazer login com ela e confirmar sucesso; em
  seguida confirmar no banco que `password` passou a começar com `$argon2id$`
  (migração progressiva, ver `docs/authentication-rbac.md` seção 3). Sem uma
  conta bcrypt real disponível, pule com anotação explícita — não simule.
- [ ] **Criação e ativação de usuário** — criar um `attendant`/`financial` via
  `/users`, confirmar o e-mail de convite chega (SMTP real), abrir o link e
  ativar a conta com uma senha nova.
- [ ] **Recuperação de senha** — solicitar reset para uma conta existente,
  confirmar o e-mail chega, completar a redefinição, confirmar login com a
  senha nova e falha com a antiga.
- [ ] **Troca de senha autenticada** — logar, ir em `/account/security`,
  trocar a senha, confirmar que a sessão é encerrada e a tela volta para
  `/login`.
- [ ] **Revogação de sessões** — após a troca acima (ou um reset), confirmar
  que um access token emitido ANTES da troca deixou de funcionar (`GET
  /auth/me` com o token antigo deve responder 401).
- [ ] **Desativação de usuário** — desativar uma conta via `/users`, confirmar
  que uma sessão já aberta dessa conta perde acesso na próxima requisição
  (sem esperar o access token expirar).
- [ ] **RBAC** — confirmar que uma conta `attendant`/`financial` recebe 403 ao
  chamar um endpoint de `/users*` diretamente (não só que a UI esconde o
  link), e que `/account/security` funciona para as três roles.
- [ ] **Envio SMTP** — confirmar nos logs do provedor SMTP (não nos logs da
  aplicação) que os e-mails de convite/reset foram de fato aceitos pelo
  servidor de destino, não só enfileirados localmente.
- [ ] **Páginas públicas** — abrir `/activate-account`, `/forgot-password` e
  `/reset-password` sem sessão e confirmar que carregam (não são
  redirecionadas para `/login`) e que um token inválido/expirado mostra a
  mensagem genérica, nunca um erro técnico.
- [ ] **Build guard** — confirmar que o build do frontend usado no deploy
  passou pelo guard de bundle (`npm run build` no CI/pipeline, não apenas
  `vite build` direto — ver limitação conhecida no backlog).
- [ ] **`TRUST_PROXY` reflete a topologia real** (só se houver reverse
  proxy/load balancer na frente) — disparar uma requisição autenticada que
  grave `AuditLog` (ex.: trocar a senha em `/account/security`) a partir de
  uma rede/IP conhecido e confirmar que o `ipAddress` gravado é o IP real do
  cliente, não o do proxy. Se vários smoke tests desta lista, feitos de
  máquinas diferentes, gravarem o MESMO `ipAddress`, `TRUST_PROXY` está
  incorreto.

---

## 8. Logs e dados sensíveis

- [ ] Logs **não contêm**: senhas, tokens JWT, Authorization header, paths de filesystem
- [ ] Erros 500 em endpoints de autenticação logam apenas método e status (sem URL ou body)
- [ ] Dados pessoais de clientes não estão em logs de console

**O que já está implementado:**
- `GlobalExceptionFilter` não loga request body em nenhum cenário
- Endpoints de auth não têm URL registrada nos logs de erro 500
- Campo `path` (filesystem) removido de todos os responses de documentos
- `AuditLog` registra ações mas nunca armazena senhas ou tokens

---

## 9. Refresh tokens

- [ ] Cleanup automático de tokens revogados e expirados ocorre a cada login (já implementado)
- [ ] Tokens de refresh têm expiração de 7 dias — **hardcoded** em
      `AuthService.saveRefreshToken` (`auth.service.ts`), NÃO controlado por
      `JWT_REFRESH_EXPIRES_IN`. Essa env var só afeta o `exp` embutido no JWT
      assinado; o fluxo de refresh nunca verifica esse `exp` — ele busca o
      token por valor exato no banco e compara `expiresAt` da própria linha.
      Mudar `JWT_REFRESH_EXPIRES_IN` para encurtar/alongar a sessão por
      exigência de segurança/compliance **não tem efeito real** — ver item 7
      do backlog abaixo (recomendação pós-release: tornar isto de fato
      configurável, ou remover a env var para não sugerir um controle que
      não existe).
- [ ] Refresh tokens são de uso único — após uso, são revogados e um novo é gerado (rotação implementada)

---

## 10. Build de produção

```bash
# Frontend
cd frontend && npm run build
# Verificar que o build não contém segredos hardcoded
grep -r "Admin@123456\|inventory_pass_dev\|supersecret" dist/ && echo "SEGREDO ENCONTRADO" || echo "OK"

# Backend
cd backend && npm run build
```

---

## 11. Checklist final antes de go-live

```
[ ] Todos os itens BLOQUEANTE deste documento estão marcados
[ ] Build de produção testado localmente com NODE_ENV=production
[ ] Login funciona com as credenciais reais de produção
[ ] Rate limiting validado em staging
[ ] CORS validado — origin maliciosa retorna sem ACAO header
[ ] Backup do banco configurado e testado (restore funciona)
[ ] URL do frontend e da API documentadas para a equipe
[ ] Processo de emergência definido: quem contatar se o sistema cair?
```

---

## Backlog de segurança/arquitetura (Task 20 — consolidado)

Itens levantados pelas revisões das Tasks 15–20, consolidados em 2026-09-18,
mais o portão final de 6 revisões independentes (correção, segurança,
acessibilidade/responsividade, migration/deploy, documentação-vs-código,
bundle/performance) rodado sobre o diff completo `main...HEAD` em
2026-09-18 antes do PR. Nenhum item abaixo bloqueia esta release, exceto onde
marcado.

### Bloqueador de release

Nenhum item pendente. O portão final encontrou 2 achados Critical (ambos de
**acurácia de documentação**, não de código: a claim de que nenhum "dado de
sessão" vai para `localStorage`, e a claim de que `JWT_REFRESH_EXPIRES_IN`
controla o TTL real do refresh token) e 7 Important (2 de segurança — oracle
de tempo em `forgot-password` e ausência de `TRUST_PROXY`; 5 de
acessibilidade, todos em `LoginForm`/`form.tsx`/`AppLayout` — controle
`disabled` nativo, campo de senha sem toggle, região de status que nasce já
preenchida, contraste do `FormLabel` em erro, títulos de página ausentes para
as 4 rotas novas). Todos os 9 foram corrigidos.

Um segundo checkpoint (2026-09-21), sobre as correções acima ainda não
commitadas, fechou mais 4 pontos: (1) a comparação `iat`/`passwordChangedAt`
em `JwtStrategy` foi trocada de milissegundo-truncado para segundos inteiros
com igualdade aceita, e `iat` ausente passou a ser tratado como inválido —
com testes de mutação (`<` vs `<=`) provando que só a desigualdade estrita
rejeita; (2) essa mudança expôs uma corrida de mesmo-segundo latente em 2
testes e2e (`reset-password`, `change-password`) que dependiam de sorte de
timing — corrigidos com um helper que garante segundos civis distintos,
confirmado estável em 3 execuções consecutivas; (3) `npm audit --omit=dev`
rodado nos dois lados, com bump direcionado (sem major) de `axios`/
`react-router-dom` no frontend — ver item 4 abaixo para o que foi corrigido
e o que ficou no backlog por exigir major; (4) a documentação de
`TRUST_PROXY` foi reforçada para nunca recomendar `true` como padrão.
Nenhum achado Critical/Important novo sobreviveu a este checkpoint. Os
itens abaixo são recomendações pós-release ou limitações aceitas.

### Recomendação pós-release

1. **Logout revoga por token exato, não por família/sessão** — `POST
   /auth/logout` (`AuthService.logout`) revoga só a linha cujo `token` bate
   exatamente; a rotação (`refreshTokens`) já revogou a linha antiga por
   `id` antes de mintar a nova. Se um logout carrega o token pré-rotação
   porque a rotação terminou primeiro (corrida de rede, não de UI), a
   revogação não encontra nada e o token novo fica **órfão e válido no
   servidor até expirar naturalmente** (7 dias, hardcoded — ver item 6 abaixo
   sobre `JWT_REFRESH_EXPIRES_IN` não controlar isto de fato). O
   frontend (Task 19: `waitForPendingRefresh`/`prepareToEndSession`) fecha
   quase toda a janela client-side — o que resta exige que a corrida
   aconteça fora do controle do cliente. **Recomendação concreta:** o
   backend passar a suportar revogação por família (uma coluna
   `familyId`/`sessionId` compartilhada entre gerações de um mesmo refresh
   token, herdada na rotação) ou um endpoint dedicado "revogar todas as
   sessões do usuário", usado tanto por `logout()` quanto por
   `resetPassword()`/`changePassword()` no lugar do `updateMany` por
   `userId`. É uma mudança de contrato — não implementar sem revisão de
   design própria.
2. **`QueryClientProvider` no caminho crítico público** — está na raiz do
   app (`app/providers.tsx`), então `query-vendor` (~13 kB gz) carrega até em
   `/login` e nas páginas públicas de senha, que não usam TanStack Query.
   Mover o provider para dentro de `ProtectedRoute` economizaria esse peso do
   caminho público — precisa confirmar antes que nenhuma página pública
   (incluindo futuras) passe a depender de um hook de query.
3. **Guarda de bundle não é reforçada por CI** — o guard
   (`scripts/assert-public-critical-path.mjs`) só roda dentro de `npm run
   build`; um pipeline que chamar `vite build` diretamente o ignora
   silenciosamente. Não há CI/workflow neste repositório ainda.
   **Recomendação:** ao criar um pipeline de CI/CD, garantir que o comando de
   build usado seja sempre `npm run build`, nunca `vite build` isolado.
4. **`npm audit` de produção (`--omit=dev`) do frontend e do backend, e bump
   direcionado do que tinha correção sem major** — feito nesta consolidação
   (2026-09-21), não apenas planejado:
   - **Frontend, corrigido:** `axios` 1.16.1 → **1.20.0** e `react-router-dom`
     6.30.4 → **6.30.6** (ambas patches dentro da mesma major, `npm install
     axios@1.20.0 react-router-dom@6.30.6`, sem `npm audit fix` amplo). Isso
     zera as 10 advisories de `axios` (todas <1.18.0) e a advisory própria de
     `react-router-dom` (open-redirect, `<=6.30.5`); `form-data` (transitiva
     de `axios`) resolveu sozinha para 4.0.6, zerando também a dela. A opção
     `redact` do axios (exigida em `client.ts`) continua disponível em
     1.20.0 — confirmado pela suíte de testes passando sem alteração.
     Impacto de bundle: caminho crítico público 146.4 → **149.1 kB gzip**
     (+2.7 kB, dentro de `http-vendor`), ainda longe do teto de 200 kB do
     guard. Suítes completas, `tsc`, lint e build rodados depois — 0
     regressões.
   - **Frontend, sem correção disponível (major exigido):** `react-router`
     (dependência transitiva de `react-router-dom`, mesmo par de versões)
     ainda tem 2 advisories moderate — open-redirect via backslash em
     `<Link>`/`useNavigate` e injeção de construtor via `deserializeErrors()`
     em hidratação SSR — ambas só corrigidas em `react-router@7.18.0+`, ou
     seja, major bump de `react-router-dom` 6→7. Este app não usa SSR
     (elimina a segunda) nem navega para destino controlado por parâmetro
     externo (mitiga a primeira, sem eliminar). **Mantido no backlog** —
     upgrade para v7 é mudança de major com API própria, fora do escopo
     deste fechamento; avaliar num PR dedicado.
   - **Backend, sem correção disponível (major exigido):** `npm audit
     --omit=dev` aponta `@nestjs/core`/`@nestjs/common`/`@nestjs/platform-express`
     (moderate/high) e `prisma` (high) como diretos — todos só resolvidos
     numa major (`@nestjs/*` 10→12; a faixa vulnerável do `prisma` cobre até
     a última dev release, sem stable corrigida na mesma major 7.x
     disponível no momento desta auditoria). **Mantido no backlog** — trocar
     a major do NestJS ou do Prisma é um esforço de regressão própria, fora
     do escopo deste fechamento.
5. **`clearAuth()` em `ResetPasswordPage`/`ActivateAccountPage` não revoga
   remotamente uma sessão PRÉ-EXISTENTE e não relacionada** que porventura
   já estivesse aberta neste navegador — ambas as páginas chamam
   `useAuthStore.getState().clearAuth()` incondicionalmente após sucesso,
   sem passar por `revokeAndClearSession()`. Nos dois casos, o backend já
   revogou os tokens da conta que foi resetada/ativada — o gap é só quando o
   navegador tinha uma sessão de OUTRA conta ativa no momento (ex.: mesma
   máquina, pessoa diferente). Nesse cenário estreito, o refresh token dessa
   outra sessão fica órfão e válido no servidor até expirar naturalmente —
   mesma classe de risco residual do item 1, por um caminho diferente.
   **Recomendação:** antes de `clearAuth()`, se houver um refresh token
   local, tentar `authApi.logout()` best-effort (mesmo padrão de
   `revokeAndClearSession()`) antes de limpar.
6. **Mensagem "Credenciais inválidas" do login é inalcançável** —
   confirmado nesta auditoria: qualquer 401 (inclusive o de senha errada em
   `/auth/login`) entra no interceptor de refresh do axios
   (`client.ts`), que não tem token de refresh para usar (usuário nunca
   logou), lança `RefreshFailedError('No refresh token')` e rejeita com esse
   objeto — que não tem `.response`. `LoginForm.tsx` checa
   `err.response?.status === 401`, que nunca é verdadeiro nesse caminho, então
   sempre cai no branch genérico "Erro ao fazer login. Tente novamente." O
   teste existente (`LoginForm.test.tsx`) não pega isso porque mocka
   `login()` diretamente com um objeto `{response:{status:401}}` fabricado, em
   vez de exercitar o interceptor real — é um teste vacuamente verde. Sem
   impacto de segurança (a mensagem genérica não vaza menos nem mais que a
   específica), mas é uma regressão de UX real e sempre reproduzível.
   **Recomendação:** o interceptor não deveria sequer tentar refresh para uma
   resposta 401 vinda de `/auth/login` ou `/auth/refresh` — checar a URL da
   requisição original antes de entrar no ciclo de refresh, e reescrever
   `LoginForm.test.tsx` para exercitar o cliente axios real (como
   `endSession.test.tsx` já faz) em vez de mockar `login()` diretamente, para
   não voltar a ficar vacuamente verde.
7. **`JWT_REFRESH_EXPIRES_IN` não controla o TTL real do refresh token** —
   confirmado nesta auditoria: `AuthService.saveRefreshToken`
   (`auth.service.ts`) grava `expiresAt` com `new Date()` + 7 dias
   hardcoded; `refreshTokens()` valida esse `expiresAt` da linha do banco, e
   nunca decodifica/verifica o `exp` do JWT assinado (que é o único lugar
   onde `JWT_REFRESH_EXPIRES_IN` entra). A env var existe, está documentada
   como configurável em mais de um lugar (README, seção 2 e 9 deste
   checklist antes desta correção) e simplesmente não faz nada no caminho
   que importa — um operador que a mude para reduzir a janela de sessão por
   exigência de segurança/compliance não terá o efeito esperado, sem
   nenhum erro ou aviso. Sem impacto de segurança imediato (o hardcoded é 7
   dias, igual ao default da env var), mas é uma incoerência entre
   documentação/intenção e comportamento real. **Recomendação:** ou fazer
   `saveRefreshToken` calcular `expiresAt` a partir de
   `JWT_REFRESH_EXPIRES_IN` (parseando a mesma sintaxe de duração que o
   `JwtModule` já aceita), ou remover a env var/documentação que sugere
   controle sobre isso, para não induzir uma mudança de configuração sem
   efeito.

### Limitação aceita/documentada

8. **Sem sincronização entre abas** (`storage` event do `localStorage` não é
   escutado por `auth.store`) — deslogar numa aba não desloga outra aba
   aberta da mesma sessão até a próxima chamada de rede nela. Puramente UX,
   sem brecha de segurança (o backend já invalidou o refresh/access token; a
   outra aba só demora a perceber).
9. **Token de convite/reset exposto na barra de endereço, no histórico do
   navegador e no `tab.url` de extensões com permissão `tabs`** — o link
   chega por e-mail com o token no fragmento (`#token=...`), que nunca é
   enviado ao servidor nem aparece em `Referer`, mas fica visível no
   navegador local pelo tempo entre o clique e o `useFragmentToken` limpar a
   URL. Mitigado por uso único + TTL curto (30min reset / 24h convite), não
   eliminado. Uma correção completa exigiria o link do e-mail apontar para um
   endpoint que valida o token no servidor e troca por um cookie httpOnly ou
   handle opaco — mudança arquitetural, fora do escopo desta feature.
10. **Throttling em memória do processo** — ver seção 7 acima. Aceito para o
   deploy de réplica única recomendado neste README; passa a exigir um
   storage compartilhado (Redis) se o deploy escalar para múltiplas réplicas.

---

## Referências

- Autenticação/RBAC/hashing/tokens: `docs/authentication-rbac.md`
- Migrations e seeds: `docs/migrations-and-seeds.md`
- Spec: `docs/superpowers/specs/2026-09-15-users-password-management-design.md`
- README principal: `README.md` e `README.pt-BR.md`
