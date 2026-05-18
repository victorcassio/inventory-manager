# Payments List Page — Design Spec

**Data:** 2026-05-18
**Status:** Aprovado
**Escopo:** Frontend apenas — backend `GET /payments` já implementado

---

## Contexto

A rota `/payments` atualmente retorna 404. O backend já expõe `GET /api/v1/payments` com filtros por método, período e `rentalId`. Este spec implementa a página standalone de listagem de pagamentos acessível para `admin` e `financial`.

---

## Rota

| Rota | Componente | Roles |
|---|---|---|
| `/payments` | `PaymentsListPage` | admin, financial |

O Sidebar já tem o item `Pagamentos` apontando para `/payments` com `roles: ['admin', 'financial']`. Basta adicionar a rota no router.

**Sem página de detalhe** — clique no contrato abre `/rentals/:rentalId`.

---

## Backend disponível

```
GET /payments
  query params: rentalId?, method?, dateFrom?, dateTo?, page, limit
  include: rental.{ id, contractNumber }, user.{ id, name }
  roles: admin, financial
  order: paidAt desc
```

O backend **não aceita `contractNumber` diretamente**. Para filtrar por contrato, o frontend deve:
1. Buscar a locação via `GET /rentals?contractNumber=<valor>` (busca parcial)
2. Pegar o `rentalId` do primeiro resultado
3. Passar esse `rentalId` no filtro de `/payments`

---

## Arquivos

| Arquivo | Ação |
|---|---|
| `frontend/src/features/payments/pages/PaymentsListPage.tsx` | **Criar** |
| `frontend/src/features/payments/hooks/usePayments.ts` | **Modificar** — adicionar `dateFrom`/`dateTo` ao `usePayments` |
| `frontend/src/lib/api/payments.api.ts` | **Modificar** — adicionar `dateFrom`/`dateTo` ao `list()` |
| `frontend/src/app/routes.tsx` | **Modificar** — adicionar rota `/payments` |
| `frontend/src/tests/payments/PaymentsListPage.test.tsx` | **Criar** |

---

## Layout da página

```
Header
  título: "Pagamentos"
  subtítulo: "Histórico de pagamentos recebidos"

Filtros (topo, com labels)
  Período: atalhos Hoje / Esta semana / Este mês (padrão) + Personalizado (datepicker dateFrom/dateTo)
  Método: Select — Todos | PIX | Dinheiro | Cartão | Transferência
  Contrato: Input texto — ao digitar ≥ 2 chars, busca rental por contractNumber e filtra por rentalId

Tabela paginada
  Colunas: Data | Contrato | Cliente | Método | Valor
  Linha NÃO é clicável como um todo
  Contrato: link clicável → /rentals/:rentalId (stopPropagation não necessário pois linha não navega)
  Valor: verde com sinal +

Paginação
  "N pagamentos" à esquerda
  Botões Anterior / Próxima à direita

Estados
  Loading: Skeletons
  Erro: ErrorState com retry
  Vazio: EmptyState "Nenhum pagamento encontrado"
```

---

## Lógica do filtro de contrato

```ts
// Estado local:
const [contractSearch, setContractSearch] = useState('')
const [rentalIdFilter, setRentalIdFilter] = useState<string | undefined>()

// Ao digitar no campo Contrato:
const handleContractSearch = async (value: string) => {
  setContractSearch(value)
  if (value.length < 2) { setRentalIdFilter(undefined); return }
  const result = await rentalsApi.list({ contractNumber: value, limit: 5 })
  // Se encontrou exatamente 1 resultado, aplica automaticamente
  // Se vários, mostra dropdown simples e usuário escolhe
  setRentalIdFilter(result.data[0]?.id)  // aplica o primeiro match
  setPage(1)
}
```

Para simplificar: aplicar sempre o **primeiro resultado** da busca de contratos.
Limpar o filtro de rentalId quando o campo de contrato for apagado.

---

## Período (filtro de data)

Mesmo padrão da FinancialListPage:
- **Hoje:** dateFrom=hoje, dateTo=hoje
- **Esta semana:** seg a dom da semana atual (weekStartsOn: 1)
- **Este mês (padrão):** 1º ao último dia do mês atual
- **Personalizado:** `<Input type="date">` para dateFrom e dateTo

---

## Mapeamento de labels

```ts
const METHOD_LABELS: Record<string, string> = {
  pix:      'PIX',
  cash:     'Dinheiro',
  card:     'Cartão',
  transfer: 'Transferência',
}
```

---

## Modificações em arquivos existentes

### `paymentsApi.list`

Adicionar `dateFrom` e `dateTo` aos parâmetros:
```ts
list: (params?: {
  rentalId?: string
  method?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}) => api.get<PaginatedResponse<Payment>>('/payments', { params }).then(r => r.data),
```

### `usePayments` hook

Adicionar `dateFrom`/`dateTo` à assinatura:
```ts
export function usePayments(params?: {
  rentalId?: string
  method?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}) {
  return useQuery({
    queryKey: paymentKeys.list(params),
    queryFn: () => paymentsApi.list(params),
  })
}
```

---

## RBAC

- `admin` e `financial`: acesso total
- `attendant`: não acessa `/payments` — o Sidebar já filtra o link; rota protegida implicitamente (backend retorna 403)

---

## Testes

`src/tests/payments/PaymentsListPage.test.tsx`:
1. Renderiza loading state
2. Renderiza error state com retry
3. Exibe lista de pagamentos na tabela
4. Exibe contrato como link clicável
5. EmptyState quando sem pagamentos
6. Botão anterior/próxima aparece quando total > limit

---

## Decisões fora de escopo

- Página de detalhe `/payments/:id` — futura evolução
- Dropdown de múltiplos contratos no autocomplete — simplificado para primeiro resultado
- Busca por cliente nome — não suportada diretamente pelo backend de payments
