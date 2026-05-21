# Security Checklist — Deploy

> Executar este checklist antes de cada deploy para homologação e produção.
> Nunca ignorar itens marcados como **BLOQUEANTE**.

---

## 1. Secrets e credenciais [BLOQUEANTE]

- [ ] `JWT_ACCESS_SECRET` gerado aleatoriamente (mín. 32 chars, sem palavras como `secret`, `test`, `example`)
  ```bash
  openssl rand -hex 64
  ```
- [ ] `JWT_REFRESH_SECRET` diferente do `JWT_ACCESS_SECRET`, mesma força
- [ ] `DATABASE_URL` usa usuário/senha exclusivos de produção (nunca os do dev)
- [ ] Senha de todos os usuários foi redefinida antes da entrega (nunca usar as do seed)
- [ ] E-mail do admin não é `admin@inventory.local`
- [ ] Nenhum `.env` de produção commitado no repositório (verificar `git status`)

**Verificação automática:** ao iniciar com `NODE_ENV=production`, a aplicação rejeita automaticamente secrets com padrões como `secret`, `test`, `example`, `changeme`. Se esses valores estiverem configurados, o backend **não sobe**.

---

## 2. Variáveis de ambiente obrigatórias [BLOQUEANTE]

| Variável | Valor esperado em produção |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_ACCESS_SECRET` | string aleatória ≥ 32 chars |
| `JWT_REFRESH_SECRET` | string aleatória ≥ 32 chars, diferente da access |
| `DATABASE_URL` | URL do banco de produção |
| `FRONTEND_URL` | URL exata do frontend (`https://seudominio.com`) — sem trailing slash, sem wildcard |
| `PORT` | porta do servidor (ex: `3003`) |

---

## 3. Banco de dados [BLOQUEANTE]

- [ ] `prisma migrate deploy` executado (nunca `prisma migrate dev` em produção)
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

**Verificação:**
```bash
# Deve retornar vazio (sem ACAO header) para origins desconhecidas
curl -I -X OPTIONS https://sua-api.com/api/v1/customers \
  -H "Origin: https://evil-site.com" | grep -i "access-control-allow-origin"
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
- [ ] Tokens de refresh têm expiração de 7 dias (configurável via `JWT_REFRESH_EXPIRES_IN`)
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

## Referências

- Spec: `docs/superpowers/specs/2026-05-19-mobile-responsiveness-design.md`
- Auditoria de segurança: relatório em `docs/security-audit-2026-05-21.md` *(a criar se necessário)*
- README principal: `README.md` e `README.pt-BR.md`
