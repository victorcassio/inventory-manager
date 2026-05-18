# Code Splitting Design

**Data:** 2026-05-18  
**Status:** Aprovado

---

## Objetivo

Reduzir o bundle inicial da aplicação convertendo os imports eager das páginas de feature para `React.lazy()`, e adicionar um único `<Suspense>` no `AppLayout` em volta do `<Outlet />`. Sidebar e header permanecem visíveis durante a navegação — apenas a área de conteúdo exibe o fallback de carregamento.

---

## Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `frontend/src/app/routes.tsx` | Converter 21 imports de pages para `React.lazy()` |
| `frontend/src/components/layout/AppLayout.tsx` | Adicionar `<Suspense>` em volta do `<Outlet />` |
| `frontend/src/components/layout/PageLoader.tsx` | Criar componente de fallback |

---

## Páginas lazy (21)

Todas as páginas de feature e a DashboardPage. Nenhuma tem `export default` — usar o padrão `.then((m) => ({ default: m.PageName }))`.

```typescript
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
)
const CustomersListPage = lazy(() =>
  import('@/features/customers/pages/CustomersListPage').then((m) => ({ default: m.CustomersListPage }))
)
// ... (demais 19 pages — mesmo padrão)
```

## Páginas eager (manter como estão)

- `LoginPage` — sempre carregada para usuários não autenticados
- `ForbiddenPage` — pequena, usada em role guards dentro de pages lazy
- `NotFoundPage` — pequena, catch-all
- `AppLayout`, `AuthLayout`, `ProtectedRoute` — layouts, não páginas

---

## PageLoader (fallback)

Componente centralizado, ocupa apenas a área de conteúdo (não interfere com sidebar/header). Usa `Loader2` do lucide-react, já instalado.

```tsx
// frontend/src/components/layout/PageLoader.tsx
import { Loader2 } from 'lucide-react'

export function PageLoader() {
  return (
    <div className="flex h-full min-h-[400px] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}
```

`text-muted-foreground` funciona em light e dark mode via CSS variables do shadcn.

---

## Mudança no AppLayout

Adicionar import de `Suspense` do React e `PageLoader`, e envolver o `<Outlet />`:

```tsx
import { Suspense } from 'react'
import { PageLoader } from './PageLoader'

// Dentro do JSX, onde hoje há:
<Outlet />

// Substituir por:
<Suspense fallback={<PageLoader />}>
  <Outlet />
</Suspense>
```

---

## Testes

Os testes existentes mocam os hooks e componentes das páginas — não chamam imports reais. `React.lazy` só é ativado quando o módulo é efetivamente carregado pelo browser, então os testes com `vi.mock` não são afetados.

Se algum teste renderizar o `AppLayout` real (não mockado), precisará de `<Suspense>` no wrapper. Verificar rodando a suite completa após a implementação.

---

## O que NÃO é lazy

- Hooks, APIs, schemas, tipos
- Componentes de UI (shadcn)
- Componentes de layout (Sidebar, Header)
- Componentes de feedback (ErrorState, EmptyState, Skeleton)

---

## Resultado esperado

- Bundle inicial menor (somente layouts + login + 403 + 404 carregados de início)
- Cada feature page vira um chunk separado gerado pelo Vite
- Navegação entre rotas mostra `PageLoader` enquanto o chunk carrega (primeira visita por rota)
- Visitas subsequentes são instantâneas (chunk já em cache pelo browser)
- 147 testes continuam passando
