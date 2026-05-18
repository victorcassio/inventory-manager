export type EventUrgencyStatus = 'overdue' | 'today' | 'soon' | 'future'

export interface EventUrgency {
  status: EventUrgencyStatus
  label: string
  color: string
}

export function getEventUrgency(expectedReturn: string): EventUrgency {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const returnDate = new Date(expectedReturn.slice(0, 10) + 'T00:00:00')
  returnDate.setHours(0, 0, 0, 0)
  const diff = Math.round((returnDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diff < 0)   return { status: 'overdue', label: 'Atrasado',          color: '#ef4444' }
  if (diff === 0) return { status: 'today',   label: 'Vence hoje',         color: '#f97316' }
  if (diff <= 3)  return { status: 'soon',    label: 'Próximos 1–3 dias',  color: '#eab308' }
  return                 { status: 'future',  label: 'Futuro',             color: '#22c55e' }
}
