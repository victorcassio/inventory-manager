import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FinancialNewPage } from '@/features/financial/pages/FinancialNewPage'
import { useCreateTransaction } from '@/features/financial/hooks/useCreateTransaction'

vi.mock('@/features/financial/hooks/useCreateTransaction', () => ({
  useCreateTransaction: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const mockUseCreateTransaction = useCreateTransaction as unknown as ReturnType<typeof vi.fn>

function setupMocks() {
  mockUseCreateTransaction.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ id: 'new-txn-1' }),
    isPending: false,
  })
}

function renderPage() {
  return render(<MemoryRouter><FinancialNewPage /></MemoryRouter>)
}

describe('FinancialNewPage', () => {
  it('exibe título Novo Lançamento', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getByText('Novo Lançamento')).toBeInTheDocument())
  })

  it('exibe seletor de tipo (Entrada / Saída)', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Entrada')).toBeInTheDocument()
      expect(screen.getByText('Saída')).toBeInTheDocument()
    })
  })

  it('exibe campo Descrição', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getByLabelText(/descrição/i)).toBeInTheDocument())
  })

  it('exibe botão Cancelar', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument())
  })

  it('exibe botão Salvar Lançamento', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /salvar lançamento/i })).toBeInTheDocument())
  })
})
