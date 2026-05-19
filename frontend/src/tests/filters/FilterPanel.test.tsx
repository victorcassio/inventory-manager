import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilterPanel } from '@/components/filters/FilterPanel'

function renderPanel(props: Partial<React.ComponentProps<typeof FilterPanel>> = {}) {
  return render(
    <FilterPanel activeCount={0} onClear={vi.fn()} {...props}>
      <div>conteúdo dos filtros</div>
    </FilterPanel>,
  )
}

describe('FilterPanel', () => {
  it('renderiza botão de toggle', () => {
    renderPanel()
    const btns = screen.getAllByRole('button')
    expect(btns.some(b => b.textContent?.includes('Filtros'))).toBe(true)
  })

  it('conteúdo mobile oculto por padrão (painel fechado)', () => {
    renderPanel()
    // desktop wrapper (hidden md:block) sempre renderiza em jsdom → 1 ocorrência
    // mobile panel só renderiza children quando open=true → 0 ocorrências
    expect(screen.getAllByText('conteúdo dos filtros')).toHaveLength(1)
  })

  it('expande conteúdo ao clicar no toggle', async () => {
    const user = userEvent.setup()
    renderPanel()
    const toggleBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('Filtros'))!
    await user.click(toggleBtn)
    // agora children aparece em desktop wrapper E no painel mobile
    expect(screen.getAllByText('conteúdo dos filtros')).toHaveLength(2)
  })

  it('mostra badge com activeCount quando > 0', () => {
    renderPanel({ activeCount: 2 })
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('mostra summary no botão quando há filtros ativos', () => {
    renderPanel({ activeCount: 1, summary: 'Este mês · PIX' })
    expect(screen.getByText(/Filtros · Este mês · PIX/)).toBeInTheDocument()
  })

  it('mostra botão "Limpar filtros" dentro do painel quando activeCount > 0', async () => {
    const user = userEvent.setup()
    renderPanel({ activeCount: 1 })
    const toggleBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('Filtros'))!
    await user.click(toggleBtn)
    expect(screen.getByRole('button', { name: /limpar filtros/i })).toBeInTheDocument()
  })

  it('chama onClear ao clicar em "Limpar filtros"', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    renderPanel({ activeCount: 1, onClear })
    const toggleBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('Filtros'))!
    await user.click(toggleBtn)
    await user.click(screen.getByRole('button', { name: /limpar filtros/i }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('não mostra "Limpar filtros" quando activeCount é 0', async () => {
    const user = userEvent.setup()
    renderPanel({ activeCount: 0 })
    const toggleBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('Filtros'))!
    await user.click(toggleBtn)
    expect(screen.queryByRole('button', { name: /limpar filtros/i })).not.toBeInTheDocument()
  })
})
