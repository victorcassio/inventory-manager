# Migrations e Seeds

> Não contém credenciais ou valores reais. Sempre valide uma migration nova em
> um banco descartável antes de aplicá-la em um banco com dados reais — nunca
> use `prisma migrate reset` fora de desenvolvimento local.

## Migrations aplicadas

| Migration | Descrição |
|---|---|
| `20260515045555_init` | Schema inicial completo |
| `20260515144724_plan2_core_modules` | Enums, novos módulos, `ContractCounter` |
| `20260515150000_add_payment_id_to_financial_transaction` | Associação Payment → lançamento financeiro |
| `20260515151000_add_void_fields_to_financial_transaction` | Campos de estorno de lançamento |
| `20260520174259_add_performance_indexes` | 10 índices de performance |
| `20260915235229_user_invitations_and_password_tokens` | Convites, ativação, recuperação de senha (ver abaixo) |

Todas as migrations acima são **transacionais** (nenhuma usa
`CREATE INDEX CONCURRENTLY` ou qualquer outra instrução que force
`prisma migrate dev --create-only` a marcar a migration como não-transacional)
— uma falha em qualquer passo reverte a migration inteira, ela nunca fica
"pela metade" no banco.

### `20260915235229_user_invitations_and_password_tokens` — detalhe

Esta é a migration mais delicada do repositório até hoje: ela roda contra uma
tabela `users` que pode já ter dados reais em produção. Passos, em ordem:

1. **Preflight de colisão (BLOQUEANTE, automático):** um bloco `DO $$` verifica
   se algum par de e-mails colide depois de `lower(btrim(email))`. Se colidir,
   a migration inteira **aborta** com uma exceção nomeando os e-mails em
   conflito (`RAISE EXCEPTION`) — **nunca** normaliza, funde ou apaga contas
   automaticamente. A resolução é sempre manual: um operador decide qual
   conta é a correta (renomear, desativar, mesclar dados de negócio à mão) e
   só então tenta aplicar a migration de novo.
2. Normaliza (`lower(btrim(...))`) os e-mails que sobreviveram ao preflight.
3. Torna `password` nulável (o fluxo de convite cria o usuário antes de existir
   uma senha).
4. Adiciona `email_verified_at`, `password_set_at`, `password_changed_at`
   (todas nulas, sem rewrite de tabela, sem default).
5. **Backfill obrigatório:** todo usuário que já tinha `password` preenchido
   recebe `email_verified_at = password_set_at = created_at`. Sem este passo,
   **toda conta existente fica travada no login** — o novo gate de login
   (`JwtStrategy`/`AuthService.validateUser`) rejeita qualquer conta com
   `email_verified_at` nulo. `password_changed_at` fica `NULL` de propósito:
   essas contas nunca passaram por uma *troca* de senha, só por criação.
6. Cria a tabela `user_action_tokens` (convites e resets — ver
   `docs/authentication-rbac.md` seção 6).
7. Cria um **índice único funcional** `users_email_normalized_key` sobre
   `lower(btrim(email))` — garantia de unicidade case/espaço-insensível no
   nível do banco, não só na aplicação. `prisma db pull`/`migrate diff` **não**
   consegue expressar um índice funcional em `schema.prisma`, então uma
   ferramenta de diff pode sugerir removê-lo — **não remova**.

**Verificado nesta Task 20**, em bancos descartáveis (nunca no banco de
desenvolvimento nem em qualquer banco com dados reais):

- Aplicação completa do zero (as 6 migrations em sequência) — sucesso.
- Simulação de colisão: dois usuários inseridos manualmente com e-mails que só
  diferem em maiúsculas/espaços → a migration abortou exatamente como
  descrito, sem tocar em nenhuma linha, com a mensagem nomeando o e-mail em
  conflito.
- Recuperação: após corrigir manualmente o e-mail duplicado e marcar a
  migration como `--rolled-back` (`prisma migrate resolve`), reaplicar
  `prisma migrate deploy` teve sucesso — **repetido de novo, de forma
  independente, no portão final antes do PR** (2026-09-18), com o mesmo
  resultado.

**Por que não há corrida entre o preflight e uma escrita concorrente:** o
preflight é um `SELECT`/`GROUP BY` sem lock explícito contra `INSERT`
concorrente em `users`. Isso é seguro aqui porque, durante a janela
"migration antes do backend" (ver ordem abaixo), a versão ANTIGA do backend
ainda no ar não tem nenhum endpoint que crie usuário — `UsersController` é
inteiramente novo desta feature. A única escrita que o backend antigo faz em
`users` nessa janela é `last_login` no login, que não pode criar uma colisão
de e-mail. Se um futuro deploy tiver múltiplas versões do backend
capazes de criar usuários rodando simultaneamente, essa premissa deixa de
valer e o preflight precisaria de um lock explícito.

**Janela de indisponibilidade de escrita:** o `ALTER TABLE`, o `UPDATE` de
backfill e o `CREATE UNIQUE INDEX` (sem `CONCURRENTLY`) tomam um lock breve
em `users` — da ordem de milissegundos para o volume de linhas desta tabela
(equipe interna, não clientes). Uma tentativa de login exatamente nesse
instante pode sofrer uma latência pontual, não uma janela de manutenção
agendada.

**Reversão:** o esquema desta migration é só aditivo (nenhuma coluna
removida/renomeada que código antigo leia) e o código pré-feature ignora as
colunas/tabela novas sem erro. Se for necessário voltar para a versão
anterior do backend por outro motivo, **não é necessário reverter o schema**
— não existe nem é preciso existir uma down-migration para este caso.

## Ordem obrigatória num deploy real

Ver `docs/security-checklist-deploy.md` para o checklist completo — em
resumo, a migration **sempre** roda antes de subir a nova versão do backend
(nunca o contrário: o código novo espera colunas/tabelas que só existem depois
da migration), e só depois de um backup válido do banco.

## Seeds

### `prisma/seed.ts` — bootstrap do admin

- Idempotente: se `admin@inventory.local` já existe, não faz nada (não
  reseta a senha, não duplica).
- Exige duas variáveis de ambiente, ambas obrigatórias e **nunca** com
  default embutido no código:
  - `SEED_ADMIN_PASSWORD` — deve satisfazer a mesma política de senha
    (mínimo 12 caracteres, fora da lista de senhas comuns) que qualquer outra
    senha da aplicação. Gerar com `openssl rand -base64 24` (ou uma frase
    memorável que passe a política) e **nunca commitar**.
  - `PASSWORD_PEPPER` — mesmo pepper que o backend usa em runtime (ver
    `docs/authentication-rbac.md` seção 3). Sem ele, o script recusa gerar
    qualquer hash.
- Usa `hashSeedPassword`/`ARGON2_PARAMS` importados de
  `src/modules/hashing/hashing.service.ts` — **não é uma segunda
  implementação do hashing**, é um espelho que importa a mesma constante, para
  que os parâmetros nunca possam divergir entre o serviço real e o seed.

**Verificado nesta Task 20**, em um banco descartável, isolando o processo do
`.env` real de desenvolvimento (para não vazar o pepper/senha reais para o
teste):

| Cenário | Resultado |
|---|---|
| `SEED_ADMIN_PASSWORD` ausente | falha, mensagem nomeando a variável faltante |
| `PASSWORD_PEPPER` ausente | falha, mensagem nomeando a variável faltante |
| `SEED_ADMIN_PASSWORD` fraca/comum (`password123`) | falha, mensagem listando as violações da política |
| Configuração completa e válida | admin criado com sucesso |

### `prisma/seed-demo.ts`

Popula dados de demonstração (clientes, itens, locações, etc.) para uso
**exclusivamente em desenvolvimento**. Nunca deve rodar contra um banco de
produção — ver item correspondente em `docs/security-checklist-deploy.md`
("`seed-demo.ts` nunca executado em produção").

## Como validar uma migration nova (procedimento manual)

```bash
# 1. Crie um banco descartável na mesma instância de Postgres.
#    NUNCA reaproveite o banco de desenvolvimento nem qualquer banco com dados reais.
psql -U <user> -d postgres -c "CREATE DATABASE minha_migracao_teste OWNER <user>;"

# 2. Aplique todas as migrations do zero.
DATABASE_URL=".../minha_migracao_teste" npx prisma migrate deploy

# 3. (Opcional, ao alterar dados existentes) semeie dados representativos do
#    cenário de produção que a migration precisa lidar (ex.: e-mails duplicados
#    após normalização) e confirme o comportamento esperado.

# 4. Descarte o banco.
psql -U <user> -d postgres -c "DROP DATABASE minha_migracao_teste;"
```

Nunca rode `prisma migrate reset` fora de um ambiente de desenvolvimento
local descartável — ele apaga todos os dados do banco apontado por
`DATABASE_URL` sem confirmação adicional além da flag `--force`.
