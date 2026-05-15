import { render, screen } from '@testing-library/react'
import { StatusBadge } from '@/components/feedback/StatusBadge'

describe('StatusBadge', () => {
  it('shows "Ativo" for active status', () => {
    render(<StatusBadge status="active" />)
    expect(screen.getByText('Ativo')).toBeInTheDocument()
  })

  it('shows "Vencido" for overdue status', () => {
    render(<StatusBadge status="overdue" />)
    expect(screen.getByText('Vencido')).toBeInTheDocument()
  })

  it('shows "Devolvido" for returned status', () => {
    render(<StatusBadge status="returned" />)
    expect(screen.getByText('Devolvido')).toBeInTheDocument()
  })

  it('shows "Cancelado" for canceled status', () => {
    render(<StatusBadge status="canceled" />)
    expect(screen.getByText('Cancelado')).toBeInTheDocument()
  })
})
