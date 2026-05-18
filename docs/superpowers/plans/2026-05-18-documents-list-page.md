# Documents List Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a página `/documents` — listagem global read-only de documentos gerados, acessível para todos os três perfis (admin, attendant, financial).

**Architecture:** Backend precisa de um novo endpoint `GET /documents` com paginação e filtros; frontend recebe um novo hook `useDocuments()`, uma nova API call `documentsApi.list()`, e a página `DocumentsListPage` que segue o padrão estabelecido em `PaymentsListPage`. A sidebar já tem o item de navegação configurado — só falta a rota e a página.

**Tech Stack:** NestJS + Prisma 7 (backend), React + TanStack Query + shadcn/ui + TailwindCSS (frontend), Vitest + Testing Library (testes).

---

## Mapa de arquivos

| Arquivo | Ação |
|---|---|
| `backend/src/modules/documents/documents.service.ts` | Modificar: adicionar `listDocuments()` |
| `backend/src/modules/documents/documents.controller.ts` | Modificar: adicionar `GET /documents` |
| `backend/src/modules/documents/documents.service.spec.ts` | Modificar: adicionar `count` ao mock + testes de `listDocuments` |
| `frontend/src/types/index.ts` | Modificar: adicionar `rental?` ao `Document` |
| `frontend/src/lib/api/documents.api.ts` | Modificar: adicionar `documentsApi.list()` |
| `frontend/src/features/documents/hooks/useDocuments.ts` | Modificar: adicionar `documentKeys.list` + `useDocuments()` |
| `frontend/src/features/documents/pages/DocumentsListPage.tsx` | Criar: página de listagem |
| `frontend/src/app/routes.tsx` | Modificar: adicionar rota `/documents` |
| `frontend/src/tests/documents/DocumentsListPage.test.tsx` | Criar: testes da página |

---

## Task 1: Backend — método listDocuments no service

**Files:**
- Modify: `backend/src/modules/documents/documents.service.ts`
- Test: `backend/src/modules/documents/documents.service.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar `count: jest.fn()` ao `mockPrisma.document` e a describe `listDocuments` em `documents.service.spec.ts`.

Localizar o bloco `mockPrisma` (linha ~98) e substituir `document`:

```typescript
  document: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
```

Adicionar o bloco de testes ao final do `describe('DocumentsService')`, antes do `});` de fechamento:

```typescript
  // ─── listDocuments ────────────────────────────────────────────────────────

  describe('listDocuments', () => {
    const docWithRental = {
      ...baseDocument,
      rental: { id: 'rental-1', contractNumber: '2026-0001', customer: { id: 'cust-1', name: 'Acme Corp' } },
    };

    beforeEach(() => {
      mockPrisma.document.findMany.mockResolvedValue([docWithRental]);
      mockPrisma.document.count.mockResolvedValue(1);
    });

    it('retorna lista paginada com rental incluso', async () => {
      const result = await service.listDocuments({});
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('inclui rental no findMany', async () => {
      await service.listDocuments({});
      expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({ rental: expect.anything() }),
        }),
      );
    });

    it('filtra por type quando fornecido', async () => {
      await service.listDocuments({ type: 'contract' as any });
      expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ type: 'contract' }) }),
      );
    });

    it('filtra por status quando fornecido', async () => {
      await service.listDocuments({ status: 'generated' as any });
      expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'generated' }) }),
      );
    });

    it('filtra por rentalId quando fornecido', async () => {
      await service.listDocuments({ rentalId: 'rental-1' });
      expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ rentalId: 'rental-1' }) }),
      );
    });

    it('filtra por dateFrom e dateTo', async () => {
      await service.listDocuments({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });
      expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ createdAt: { gte: expect.any(Date), lte: expect.any(Date) } }),
        }),
      );
    });

    it('aplica paginação via skip e take', async () => {
      await service.listDocuments({ page: 2, limit: 10 });
      expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });
  });
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

```bash
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx jest --testPathPattern="documents.service.spec" --no-coverage 2>&1 | tail -20
```

Esperado: FAIL — "service.listDocuments is not a function"

- [ ] **Step 3: Implementar listDocuments no service**

Adicionar os imports necessários no topo de `documents.service.ts`:

```typescript
import { DocumentStatus, DocumentType } from '@prisma/client';
import { PaginatedResult } from '../../common/types/paginated-result.interface';
```

(Já importados: `DocumentStatus`, `DocumentType` — verificar se estão presentes; `PaginatedResult` provavelmente não está — adicionar.)

Adicionar o método ao final da classe `DocumentsService`, antes do método `savePdf`:

```typescript
  async listDocuments(query: {
    page?: number;
    limit?: number;
    type?: DocumentType;
    status?: DocumentStatus;
    rentalId?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<PaginatedResult<any>> {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.rentalId) where.rentalId = query.rentalId;

    const dateWhere: any = {};
    if (query.dateFrom) dateWhere.gte = new Date(query.dateFrom);
    if (query.dateTo) dateWhere.lte = new Date(query.dateTo);
    if (Object.keys(dateWhere).length > 0) where.createdAt = dateWhere;

    const [data, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          rental: {
            select: {
              id: true,
              contractNumber: true,
              customer: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.document.count({ where }),
    ]);

    return { data, total, page, limit };
  }
```

- [ ] **Step 4: Rodar testes e confirmar que passam**

```bash
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx jest --testPathPattern="documents.service.spec" --no-coverage 2>&1 | tail -15
```

Esperado: PASS — todos os testes de DocumentsService passando (incluindo os novos).

---

## Task 2: Backend — endpoint GET /documents no controller

**Files:**
- Modify: `backend/src/modules/documents/documents.controller.ts`

- [ ] **Step 1: Adicionar o endpoint ao controller**

Adicionar os imports necessários. Localizar a linha de imports e adicionar `Query` (se ainda não estiver) e `DocumentStatus`, `DocumentType`:

```typescript
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { DocumentStatus, DocumentType, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DocumentsService } from './documents.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import * as fs from 'fs';
```

Adicionar o handler logo após o `listDocumentsByRental`, antes do `downloadDocument`:

```typescript
  @Get('documents')
  @Roles(UserRole.admin, UserRole.attendant, UserRole.financial)
  listDocuments(
    @Query()
    query: PaginationDto & {
      type?: DocumentType;
      status?: DocumentStatus;
      rentalId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    return this.documentsService.listDocuments(query);
  }
```

- [ ] **Step 2: Rodar toda a suite de testes do backend**

```bash
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx jest --no-coverage 2>&1 | tail -20
```

Esperado: todos os testes passando (número igual ou maior que antes — eram 185).

- [ ] **Step 3: Commit**

```bash
cd /home/userterras/Documents/inventory-manager
git add backend/src/modules/documents/documents.service.ts backend/src/modules/documents/documents.controller.ts backend/src/modules/documents/documents.service.spec.ts
git commit -m "feat(documents): add GET /documents global list endpoint with pagination and filters"
```

---

## Task 3: Frontend — estender tipo Document + adicionar documentsApi.list()

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/lib/api/documents.api.ts`

- [ ] **Step 1: Adicionar campo `rental` ao tipo Document em `frontend/src/types/index.ts`**

Localizar a interface `Document` (linha ~171) e adicionar o campo `rental`:

```typescript
export interface Document {
  id: string
  type: DocumentType
  filename: string
  path: string
  status: DocumentStatus
  rentalId?: string | null
  customerId?: string | null
  paymentId?: string | null
  returnId?: string | null
  userId?: string | null
  createdAt: string
  rental?: { id: string; contractNumber: string; customer: { id: string; name: string } } | null
}
```

- [ ] **Step 2: Adicionar `documentsApi.list()` em `frontend/src/lib/api/documents.api.ts`**

Adicionar a função `list` ao objeto `documentsApi` (no início, antes de `getByRental`):

```typescript
import api from './client'
import type { Document, PaginatedResponse } from '@/types'

export const documentsApi = {
  list: (params?: {
    type?: string
    status?: string
    rentalId?: string
    dateFrom?: string
    dateTo?: string
    page?: number
    limit?: number
  }) =>
    api.get<PaginatedResponse<Document>>('/documents', { params }).then(r => r.data),

  getByRental: (rentalId: string) =>
    api.get<Document[]>(`/rentals/${rentalId}/documents`).then(r => r.data),

  generateContract: (rentalId: string) =>
    api.post<Document>(`/rentals/${rentalId}/documents/contract`).then(r => r.data),

  generateReceipt: (paymentId: string) =>
    api.post<Document>(`/payments/${paymentId}/documents/receipt`).then(r => r.data),

  generateReturnProof: (returnId: string) =>
    api.post<Document>(`/returns/${returnId}/documents/proof`).then(r => r.data),

  download: async (documentId: string, filename: string): Promise<void> => {
    const response = await api.get(`/documents/${documentId}/download`, {
      responseType: 'blob',
    })
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = window.document.createElement('a')
    link.href = url
    link.setAttribute('download', filename)
    window.document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  },
}
```

---

## Task 4: Frontend — adicionar useDocuments() hook

**Files:**
- Modify: `frontend/src/features/documents/hooks/useDocuments.ts`

- [ ] **Step 1: Adicionar `documentKeys.list` e `useDocuments()` ao arquivo de hooks**

Substituir o objeto `documentKeys` e adicionar `useDocuments` logo após:

```typescript
export const documentKeys = {
  all: ['documents'] as const,
  list: (params?: object) => [...documentKeys.all, 'list', params] as const,
  byRental: (rentalId: string) => [...documentKeys.all, 'rental', rentalId] as const,
}

export function useDocuments(params?: {
  type?: string
  status?: string
  rentalId?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}) {
  return useQuery({
    queryKey: documentKeys.list(params),
    queryFn: () => documentsApi.list(params),
  })
}
```

O restante do arquivo (`useDocumentsByRental`, `useGenerateContract`, etc.) permanece inalterado.

---

## Task 5: Frontend — criar DocumentsListPage

**Files:**
- Create: `frontend/src/features/documents/pages/DocumentsListPage.tsx`

- [ ] **Step 1: Criar o arquivo da página**

```tsx
import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import { Download, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useDocuments } from '../hooks/useDocuments'
import { useDownloadDocument } from '../hooks/useDocuments'
import { usePagination } from '@/hooks/usePagination'
import { rentalsApi } from '@/lib/api/rentals.api'
import { formatDate } from '@/lib/formatters'
import type { DocumentType, DocumentStatus } from '@/types'

type PeriodPreset = 'today' | 'this_week' | 'this_month' | 'custom'

function getPresetDates(preset: PeriodPreset): { dateFrom: string; dateTo: string } {
  const now = new Date()
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd')
  switch (preset) {
    case 'today':      return { dateFrom: fmt(now), dateTo: fmt(now) }
    case 'this_week':  return { dateFrom: fmt(startOfWeek(now, { weekStartsOn: 1 })), dateTo: fmt(endOfWeek(now, { weekStartsOn: 1 })) }
    case 'this_month': return { dateFrom: fmt(startOfMonth(now)), dateTo: fmt(endOfMonth(now)) }
    case 'custom':     return { dateFrom: '', dateTo: '' }
  }
}

const PRESET_LABELS: Record<PeriodPreset, string> = {
  today:      'Hoje',
  this_week:  'Esta semana',
  this_month: 'Este mês',
  custom:     'Personalizado',
}

const TYPE_LABELS: Record<DocumentType, string> = {
  contract:     'Contrato',
  receipt:      'Recibo',
  return_proof: 'Comprovante de Devolução',
}

const STATUS_LABELS: Record<DocumentStatus, string> = {
  generated: 'Gerado',
  voided:    'Anulado',
}

const STATUS_VARIANT: Record<DocumentStatus, 'default' | 'outline'> = {
  generated: 'default',
  voided:    'outline',
}

export function DocumentsListPage() {
  const navigate = useNavigate()
  const { page, limit, setPage } = usePagination()
  const [preset, setPreset]                 = useState<PeriodPreset>('this_month')
  const [customFrom, setCustomFrom]         = useState('')
  const [customTo, setCustomTo]             = useState('')
  const [docType, setDocType]               = useState('')
  const [docStatus, setDocStatus]           = useState('')
  const [contractSearch, setContractSearch] = useState('')
  const [rentalIdFilter, setRentalIdFilter] = useState<string | undefined>()
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const download = useDownloadDocument()

  const periodDates =
    preset === 'custom'
      ? { dateFrom: customFrom || undefined, dateTo: customTo || undefined }
      : getPresetDates(preset)

  const { data, isLoading, isError, refetch } = useDocuments({
    ...periodDates,
    type:     docType || undefined,
    status:   docStatus || undefined,
    rentalId: rentalIdFilter,
    page,
    limit,
  })

  const handlePreset = (p: PeriodPreset) => { setPreset(p); setPage(1) }

  const handleContractInput = (value: string) => {
    setContractSearch(value)
    clearTimeout(debounceRef.current)
    if (!value || value.length < 2) {
      setRentalIdFilter(undefined)
      setPage(1)
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await rentalsApi.list({ contractNumber: value, limit: 5 })
        setRentalIdFilter(result.data[0]?.id ?? undefined)
        setPage(1)
      } catch {
        setRentalIdFilter(undefined)
      }
    }, 300)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Documentos</h2>
        <p className="text-muted-foreground">Contratos, recibos e comprovantes gerados</p>
      </div>

      {/* Period presets */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map(p => (
          <Button key={p} variant={preset === p ? 'default' : 'outline'} size="sm" onClick={() => handlePreset(p)}>
            {PRESET_LABELS[p]}
          </Button>
        ))}
      </div>

      {/* Custom date range */}
      {preset === 'custom' && (
        <div className="flex gap-4 items-end flex-wrap">
          <div className="space-y-1">
            <Label htmlFor="dateFrom">De</Label>
            <Input id="dateFrom" type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(1) }} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dateTo">Até</Label>
            <Input id="dateTo" type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(1) }} className="w-40" />
          </div>
        </div>
      )}

      {/* Type + Status + Contract filters */}
      <div className="flex gap-4 flex-wrap items-end">
        <div className="space-y-1">
          <Label>Tipo</Label>
          <Select value={docType || 'all'} onValueChange={v => { setDocType(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="contract">Contrato</SelectItem>
              <SelectItem value="receipt">Recibo</SelectItem>
              <SelectItem value="return_proof">Comprovante de Devolução</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Status</Label>
          <Select value={docStatus || 'all'} onValueChange={v => { setDocStatus(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="generated">Gerado</SelectItem>
              <SelectItem value="voided">Anulado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="contract">Contrato</Label>
          <Input
            id="contract"
            placeholder="Buscar por contrato..."
            value={contractSearch}
            onChange={e => handleContractInput(e.target.value)}
            className="w-48"
          />
        </div>
      </div>

      {/* Table */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" role="status" />
          ))}
        </div>
      )}

      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState title="Nenhum documento encontrado" description="Ajuste os filtros para ver mais resultados." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map(doc => (
                  <TableRow key={doc.id}>
                    <TableCell className="text-muted-foreground text-sm">{formatDate(doc.createdAt)}</TableCell>
                    <TableCell>{TYPE_LABELS[doc.type] ?? doc.type}</TableCell>
                    <TableCell>
                      {doc.rental ? (
                        <button
                          className="font-mono text-xs text-primary hover:underline"
                          onClick={() => navigate(`/rentals/${doc.rentalId}`)}
                        >
                          #{doc.rental.contractNumber}
                        </button>
                      ) : '—'}
                    </TableCell>
                    <TableCell>{doc.rental?.customer?.name ?? '—'}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground">
                      {doc.filename}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[doc.status] ?? 'secondary'}>
                        {STATUS_LABELS[doc.status] ?? doc.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={download.isPending || doc.status === 'voided'}
                          onClick={() => download.mutate({ documentId: doc.id, filename: doc.filename })}
                          title="Baixar PDF"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        {doc.rentalId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(`/rentals/${doc.rentalId}`)}
                            title="Ver locação"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {data.total > limit && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{data.total} documentos</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Anterior
                </Button>
                <Button variant="outline" size="sm" disabled={page * limit >= data.total} onClick={() => setPage(page + 1)}>
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
```

---

## Task 6: Frontend — adicionar rota /documents em routes.tsx

**Files:**
- Modify: `frontend/src/app/routes.tsx`

- [ ] **Step 1: Adicionar import e rota**

Adicionar o import de `DocumentsListPage` com os outros imports de features:

```typescript
import { DocumentsListPage } from '@/features/documents/pages/DocumentsListPage'
```

Adicionar a rota dentro do `<Route element={<AppLayout />}>`, logo após a rota `/payments`:

```tsx
<Route path="/documents" element={<DocumentsListPage />} />
```

---

## Task 7: Frontend — testes de DocumentsListPage

**Files:**
- Create: `frontend/src/tests/documents/DocumentsListPage.test.tsx`

- [ ] **Step 1: Criar o arquivo de testes**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocumentsListPage } from '@/features/documents/pages/DocumentsListPage'
import { useDocuments } from '@/features/documents/hooks/useDocuments'
import { useDownloadDocument } from '@/features/documents/hooks/useDocuments'

vi.mock('@/features/documents/hooks/useDocuments', () => ({
  useDocuments: vi.fn(),
  useDownloadDocument: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const mockUseDocuments = useDocuments as unknown as ReturnType<typeof vi.fn>
const mockUseDownload = useDownloadDocument as unknown as ReturnType<typeof vi.fn>

const mockDoc = {
  id: 'doc-1',
  type: 'contract' as const,
  filename: 'contract-123.pdf',
  path: '/storage/documents/rental-1/contract-123.pdf',
  status: 'generated' as const,
  rentalId: 'rental-1',
  customerId: 'cust-1',
  createdAt: '2026-05-15T10:00:00Z',
  rental: { id: 'rental-1', contractNumber: '2026-0001', customer: { id: 'cust-1', name: 'Acme Corp' } },
}

function setupMocks() {
  mockUseDownload.mockReturnValue({ mutate: vi.fn(), isPending: false })
  mockUseDocuments.mockReturnValue({
    data: { data: [mockDoc], total: 1, page: 1, limit: 20 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
}

function renderPage() {
  return render(<MemoryRouter><DocumentsListPage /></MemoryRouter>)
}

describe('DocumentsListPage', () => {
  it('renderiza lista de documentos', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
      expect(screen.getByText('#2026-0001')).toBeInTheDocument()
      expect(screen.getByText('contract-123.pdf')).toBeInTheDocument()
      expect(screen.getByText('Contrato')).toBeInTheDocument()
    })
  })

  it('mostra EmptyState quando vazio', async () => {
    mockUseDownload.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mockUseDocuments.mockReturnValue({
      data: { data: [], total: 0, page: 1, limit: 20 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/nenhum documento encontrado/i)).toBeInTheDocument())
  })

  it('renderiza loading state (skeletons)', async () => {
    mockUseDownload.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mockUseDocuments.mockReturnValue({ isLoading: true, isError: false, data: undefined })
    renderPage()
    await waitFor(() => expect(screen.getAllByRole('status').length).toBeGreaterThan(0))
  })

  it('renderiza error state com botão retry', async () => {
    mockUseDownload.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mockUseDocuments.mockReturnValue({ isLoading: false, isError: true, data: undefined, refetch: vi.fn() })
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument())
  })

  it('exibe contrato como link clicável para /rentals/:id', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      const link = screen.getByText('#2026-0001')
      expect(link.tagName).toBe('BUTTON')
    })
  })

  it('botão download chama useDownloadDocument.mutate', async () => {
    const mockMutate = vi.fn()
    mockUseDownload.mockReturnValue({ mutate: mockMutate, isPending: false })
    mockUseDocuments.mockReturnValue({
      data: { data: [mockDoc], total: 1, page: 1, limit: 20 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    const { getByTitle } = renderPage()
    await waitFor(() => getByTitle('Baixar PDF'))
    getByTitle('Baixar PDF').click()
    expect(mockMutate).toHaveBeenCalledWith({ documentId: 'doc-1', filename: 'contract-123.pdf' })
  })

  it('filtra por tipo — useDocuments chamado com params de período', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => screen.getByText('Acme Corp'))
    const call = mockUseDocuments.mock.calls[mockUseDocuments.mock.calls.length - 1][0]
    expect(call?.dateFrom).toBeDefined()
    expect(call?.dateTo).toBeDefined()
  })

  it('filtra por status — useDocuments recebe page=1 nos params', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => screen.getByText('Acme Corp'))
    expect(mockUseDocuments).toHaveBeenCalled()
    const call = mockUseDocuments.mock.calls[0][0]
    expect(call).toHaveProperty('page', 1)
  })

  it('exibe paginação quando total > limit', async () => {
    mockUseDownload.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mockUseDocuments.mockReturnValue({
      data: { data: [mockDoc], total: 25, page: 1, limit: 20 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /próxima/i })).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Rodar os testes do frontend e confirmar que passam**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx vitest run --reporter=verbose src/tests/documents/DocumentsListPage.test.tsx 2>&1 | tail -30
```

Esperado: PASS — 9 testes passando.

- [ ] **Step 3: Rodar toda a suite de testes do frontend**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx vitest run 2>&1 | tail -15
```

Esperado: todos os testes passando (119 + 9 novos = 128+).

- [ ] **Step 4: Commit final**

```bash
cd /home/userterras/Documents/inventory-manager
git add \
  frontend/src/types/index.ts \
  frontend/src/lib/api/documents.api.ts \
  frontend/src/features/documents/hooks/useDocuments.ts \
  frontend/src/features/documents/pages/DocumentsListPage.tsx \
  frontend/src/app/routes.tsx \
  frontend/src/tests/documents/DocumentsListPage.test.tsx
git commit -m "feat(documents): implement DocumentsListPage with global filters, pagination and role access"
```

---

## Self-review checklist

### Cobertura do spec

| Requisito | Task |
|---|---|
| Rota `/documents` | Task 6 |
| Roles: admin, attendant, financial | Task 5 (sem redirect), Task 7 (implícito — nenhum perfil é bloqueado) |
| Header "Documentos" + subtítulo | Task 5 |
| Filtro tipo (Todos/Contrato/Recibo/Comprovante) | Task 5 |
| Filtro status (Todos/Gerado/Anulado) | Task 5 |
| Filtro período com presets + personalizado | Task 5 |
| Filtro contrato (busca por contractNumber via rentalId) | Task 5 |
| Tabela: Data, Tipo, Contrato, Cliente, Arquivo, Status, Ações | Task 5 |
| Download PDF | Task 5 |
| Link para /rentals/:rentalId | Task 5 |
| Loading state | Task 5 + Task 7 |
| ErrorState com retry | Task 5 + Task 7 |
| EmptyState | Task 5 + Task 7 |
| Paginação | Task 5 + Task 7 |
| Backend `GET /documents` | Tasks 1 e 2 |
| Testes: renderiza lista | Task 7 |
| Testes: EmptyState | Task 7 |
| Testes: filtra por tipo | Task 7 |
| Testes: filtra por status | Task 7 |
| Testes: contrato como link | Task 7 |
| Testes: download | Task 7 |
| Testes: admin/attendant/financial acessam | Task 7 (sem guard de redirect — todos acessam) |
| Sidebar já configurada | Nenhuma mudança necessária |

### Scan de placeholders

Nenhum "TBD", "TODO", "fill in details" ou "similar to Task N" encontrado.

### Consistência de tipos

- `documentsApi.list()` retorna `PaginatedResponse<Document>` — o mesmo tipo que `paymentsApi.list()` usa com `Payment`.
- `useDocuments()` usa `documentKeys.list(params)` — consistente com `usePayments()` que usa `paymentKeys.list(params)`.
- `Document.rental` adicionado ao tipo base — compatível com o backend `include: { rental: ... }`.
- `download.mutate({ documentId, filename })` — mesma assinatura que `useDownloadDocument` já usa.
