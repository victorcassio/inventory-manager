import { useQuery } from '@tanstack/react-query'
import { rentalsApi } from '@/lib/api/rentals.api'

// MVP: busca todas as locações ativas de uma vez (limit=500).
// Evolução futura: substituir por busca por range visível do calendário
// usando startDate/expectedReturnDate via callback datesSet do FullCalendar.
export function useCalendarRentals() {
  return useQuery({
    queryKey: ['calendar', 'rentals'],
    queryFn: () => rentalsApi.list({ status: 'active', limit: 500 }),
  })
}
