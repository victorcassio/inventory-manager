import { Navigate, useNavigate } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import ptBrLocale from '@fullcalendar/core/locales/pt-br'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useCalendarRentals } from '../hooks/useCalendarRentals'
import { useAuthStore } from '@/stores/auth.store'
import { getEventUrgency } from '../utils/eventUrgency'

const LEGEND_ITEMS = [
  { label: 'Atrasado',          color: '#ef4444' },
  { label: 'Vence hoje',        color: '#f97316' },
  { label: 'Próximos 1–3 dias', color: '#eab308' },
  { label: 'Futuro',            color: '#22c55e' },
]

export function CalendarPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { data, isLoading, isError, refetch } = useCalendarRentals()

  if (user && user.role === 'financial') {
    return <Navigate to="/403" replace />
  }

  const events = (data?.data ?? []).map(rental => {
    const urgency = getEventUrgency(rental.expectedReturn)
    return {
      id: rental.id,
      title: `Contrato ${rental.contractNumber} · ${rental.customer?.name ?? '—'}`,
      date: rental.expectedReturn.slice(0, 10),
      allDay: true,
      backgroundColor: urgency.color,
      borderColor: urgency.color,
      textColor: '#ffffff',
    }
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Calendário</h2>
        <p className="text-muted-foreground">Devoluções previstas de locações ativas</p>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap gap-4">
        {LEGEND_ITEMS.map(item => (
          <div key={item.label} className="flex items-center gap-2">
            <span
              className="h-3 w-3 flex-shrink-0 rounded-sm"
              style={{ backgroundColor: item.color }}
              aria-hidden="true"
            />
            <span className="text-sm text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Estados */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" role="status" />
          ))}
        </div>
      )}

      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && data && data.data.length === 0 && (
        <EmptyState
          title="Nenhuma locação com devolução prevista"
          description="Não há locações ativas no momento."
        />
      )}

      {!isLoading && !isError && data && data.data.length > 0 && (
        <FullCalendar
          plugins={[dayGridPlugin, listPlugin]}
          initialView="dayGridMonth"
          locale={ptBrLocale}
          firstDay={1}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,listMonth',
          }}
          buttonText={{ today: 'Hoje', month: 'Mês', list: 'Lista' }}
          events={events}
          eventClick={({ event }) => navigate(`/rentals/${event.id}`)}
          eventDisplay="block"
          dayMaxEvents={3}
          height="auto"
        />
      )}
    </div>
  )
}
