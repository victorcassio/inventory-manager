import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Users as UsersIcon, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { FilterPanel } from '@/components/filters/FilterPanel'
import { usePagination } from '@/hooks/usePagination'
import { useAuthStore } from '@/stores/auth.store'
import { formatDate } from '@/lib/formatters'
import type { UserRole } from '@/types'
import { useUsersList } from '../hooks/useUsers'
import { InvitationStatusBadge } from '../components/InvitationStatusBadge'
import { UserRowActions } from '../components/UserRowActions'

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  attendant: 'Atendente',
  financial: 'Financeiro',
}

const ROLE_OPTIONS: UserRole[] = ['admin', 'attendant', 'financial']

export function UsersListPage() {
  const navigate = useNavigate()
  const { user: currentUser } = useAuthStore()

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<UserRole | ''>('')
  const [status, setStatus] = useState<'active' | 'inactive' | ''>('')
  const { page, limit, setPage, reset } = usePagination()

  // Same debounce shape as PaymentsListPage/DocumentsListPage: 300ms, cleared on
  // every keystroke.
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const handleSearchInput = (value: string) => {
    setSearchInput(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(value)
      reset()
    }, 300)
  }

  const handleRoleChange = (value: string) => {
    setRole(value === 'all' ? '' : (value as UserRole))
    reset()
  }

  const handleStatusChange = (value: string) => {
    setStatus(value === 'all' ? '' : (value as 'active' | 'inactive'))
    reset()
  }

  const handleClearFilters = () => {
    // A search typed just before this click has a timer in flight; without
    // cancelling it, it fires ~300ms later and reinstates the very filter
    // this button just cleared.
    clearTimeout(debounceRef.current)
    setSearchInput('')
    setSearch('')
    setRole('')
    setStatus('')
    reset()
  }

  useEffect(() => {
    return () => clearTimeout(debounceRef.current)
  }, [])

  const { data, isLoading, isError, refetch } = useUsersList({
    page,
    limit,
    search: search || undefined,
    role: role || undefined,
    status: status || undefined,
  })

  const activeCount = [!!search, !!role, !!status].filter(Boolean).length
  const filterSummary = [
    role ? ROLE_LABELS[role] : null,
    status ? (status === 'active' ? 'Ativos' : 'Inativos') : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Usuários</h2>
        <Button onClick={() => navigate('/users/new')}>
          <Plus className="mr-2 h-4 w-4" />
          Novo usuário
        </Button>
      </div>

      <FilterPanel activeCount={activeCount} summary={filterSummary} onClear={handleClearFilters}>
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou e-mail..."
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
            className="pl-9"
            aria-label="Buscar por nome ou e-mail"
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Select value={role || 'all'} onValueChange={handleRoleChange}>
            <SelectTrigger className="sm:w-48" aria-label="Filtrar por perfil">
              <SelectValue placeholder="Perfil" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os perfis</SelectItem>
              {ROLE_OPTIONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status || 'all'} onValueChange={handleStatusChange}>
            <SelectTrigger className="sm:w-48" aria-label="Filtrar por status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="inactive">Inativos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FilterPanel>

      {activeCount > 0 && (
        <div className="hidden lg:flex">
          <Button variant="ghost" size="sm" onClick={handleClearFilters}>
            Limpar filtros
          </Button>
        </div>
      )}

      {/* One persistent live region for the whole results area, rather than
          the mount/unmount-per-state pattern the loading skeleton used to use
          on its own: a role="status" node that appears already carrying its
          final content is the exact case screen readers announce least
          reliably, because it was never in the tree to compare against. This
          node exists for the page's whole lifetime and only its text changes,
          which is the reliable version of the same signal — and it is what a
          screen-reader user gets in place of watching the table update after
          typing a search term or changing a filter. */}
      <p role="status" aria-live="polite" className="sr-only">
        {isLoading
          ? 'Carregando usuários'
          : isError
            ? ''
            : data
              ? data.data.length === 0
                ? 'Nenhum usuário encontrado'
                : `Mostrando ${(page - 1) * limit + 1} a ${Math.min(page * limit, data.total)} de ${data.total} usuários`
              : ''}
      </p>

      {isLoading && (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState
              icon={<UsersIcon className="h-12 w-12" />}
              title="Nenhum usuário encontrado"
              description={
                activeCount > 0
                  ? 'Tente ajustar os filtros de busca.'
                  : 'Cadastre o primeiro usuário para começar.'
              }
              action={
                activeCount === 0
                  ? { label: 'Novo usuário', onClick: () => navigate('/users/new') }
                  : undefined
              }
            />
          ) : (
            <>
              {/* Desktop. lg, not md: at md (768px) the permanent sidebar (w-64)
                  plus the page's own padding leave under 500px for these 8
                  columns — not enough. */}
              <div className="hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>E-mail</TableHead>
                      <TableHead>Perfil</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Convite</TableHead>
                      <TableHead>E-mail verificado</TableHead>
                      <TableHead>Último login</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.name}</TableCell>
                        <TableCell className="max-w-[220px] truncate text-muted-foreground">
                          {user.email}
                        </TableCell>
                        <TableCell>{ROLE_LABELS[user.role]}</TableCell>
                        <TableCell>
                          <Badge variant={user.isActive ? 'default' : 'secondary'}>
                            {user.isActive ? 'Ativo' : 'Inativo'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <InvitationStatusBadge status={user.invitationStatus} expiresAt={user.invitationExpiresAt} />
                        </TableCell>
                        <TableCell>
                          {user.emailVerifiedAt ? (
                            <span className="inline-flex items-center gap-1 text-sm">
                              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" aria-hidden="true" />
                              Verificado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                              <XCircle className="h-4 w-4" aria-hidden="true" />
                              Não verificado
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {user.lastLogin ? formatDate(user.lastLogin) : 'Nunca'}
                        </TableCell>
                        <TableCell className="text-right">
                          <UserRowActions user={user} currentUserId={currentUser?.id} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile — shown up to lg, matching the table's own cutoff above. */}
              <div className="lg:hidden space-y-3">
                {data.data.map((user) => (
                  <div key={user.id} className="rounded-md border p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{user.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                      </div>
                      <Badge variant={user.isActive ? 'default' : 'secondary'} className="shrink-0">
                        {user.isActive ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{ROLE_LABELS[user.role]}</span>
                      <InvitationStatusBadge status={user.invitationStatus} expiresAt={user.invitationExpiresAt} />
                      {user.emailVerifiedAt ? (
                        <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          E-mail verificado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <XCircle className="h-3 w-3" aria-hidden="true" />
                          E-mail não verificado
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Último login: {user.lastLogin ? formatDate(user.lastLogin) : 'Nunca'}
                    </p>

                    <UserRowActions user={user} currentUserId={currentUser?.id} />
                  </div>
                ))}
              </div>
            </>
          )}

          {data.total > limit && (
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">
                Mostrando {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} de {data.total}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * limit >= data.total}
                  onClick={() => setPage(page + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
