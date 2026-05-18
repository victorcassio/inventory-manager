import { getEventUrgency } from '@/features/calendar/utils/eventUrgency'

function dateOffset(days: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

describe('getEventUrgency', () => {
  it('retorna overdue para expectedReturn ontem', () => {
    const result = getEventUrgency(dateOffset(-1))
    expect(result.status).toBe('overdue')
    expect(result.color).toBe('#ef4444')
    expect(result.label).toBe('Atrasado')
  })

  it('retorna overdue para expectedReturn 30 dias atrás', () => {
    const result = getEventUrgency(dateOffset(-30))
    expect(result.status).toBe('overdue')
    expect(result.color).toBe('#ef4444')
  })

  it('retorna today para expectedReturn hoje', () => {
    const result = getEventUrgency(dateOffset(0))
    expect(result.status).toBe('today')
    expect(result.color).toBe('#f97316')
    expect(result.label).toBe('Vence hoje')
  })

  it('retorna soon para expectedReturn amanhã (1 dia)', () => {
    const result = getEventUrgency(dateOffset(1))
    expect(result.status).toBe('soon')
    expect(result.color).toBe('#eab308')
    expect(result.label).toBe('Próximos 1–3 dias')
  })

  it('retorna soon para expectedReturn em 3 dias', () => {
    const result = getEventUrgency(dateOffset(3))
    expect(result.status).toBe('soon')
    expect(result.color).toBe('#eab308')
  })

  it('retorna future para expectedReturn em 4 dias', () => {
    const result = getEventUrgency(dateOffset(4))
    expect(result.status).toBe('future')
    expect(result.color).toBe('#22c55e')
    expect(result.label).toBe('Futuro')
  })

  it('retorna future para expectedReturn em 30 dias', () => {
    const result = getEventUrgency(dateOffset(30))
    expect(result.status).toBe('future')
    expect(result.color).toBe('#22c55e')
  })

  it('aceita datetime string e usa apenas a parte da data', () => {
    const datetime = dateOffset(0) + 'T23:00:00.000Z'
    const result = getEventUrgency(datetime)
    expect(result.status).toBe('today')
  })
})
