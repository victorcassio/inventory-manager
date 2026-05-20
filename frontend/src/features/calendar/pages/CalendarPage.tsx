import { useRef, useState, useEffect } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import ptBrLocale from '@fullcalendar/core/locales/pt-br'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useCalendarRentals } from '../hooks/useCalendarRentals'
import { useAuthStore } from '@/stores/auth.store'
import { getEventUrgency } from '../utils/eventUrgency'
import { getIsMobile, getEventTitle } from '../utils/calendarHelpers'

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
  const calendarRef = useRef<FullCalendar>(null)

  const [isMobile, setIsMobile] = useState(getIsMobile)
  const [calendarTitle, setCalendarTitle] = useState('')
  const [currentView, setCurrentView] = useState('dayGridMonth')

  useEffect(() => {
    const handleResize = () => setIsMobile(getIsMobile())
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  if (user && user.role === 'financial') {
    return <Navigate to="/403" replace />
  }

  const switchView = (viewName: string) => {
    calendarRef.current?.getApi().changeView(viewName)
    setCurrentView(viewName)
  }

  const events = (data?.data ?? []).map(rental => {
    const urgency = getEventUrgency(rental.expectedReturn)
    return {
      id: rental.id,
      title: getEventTitle(rental.contractNumber, rental.customer?.name ?? '—', isMobile),
      date: rental.expectedReturn.slice(0, 10),
      allDay: true,
      backgroundColor: urgency.color,
      borderColor: urgency.color,
      textColor: '#ffffff',
    }
  })

  const hasData = !isLoading && !isError && data && data.data.length > 0

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Calendário</h2>
        <p className="text-muted-foreground">Devoluções previstas de locações ativas</p>
      </div>

      {/* Legenda — compacta no mobile */}
      <div className={isMobile ? 'grid grid-cols-2 gap-x-4 gap-y-1' : 'flex flex-wrap gap-4'}>
        {LEGEND_ITEMS.map(item => (
          <div key={item.label} className="flex items-center gap-1.5">
            <span
              className={isMobile ? 'h-2 w-2 flex-shrink-0 rounded-sm' : 'h-3 w-3 flex-shrink-0 rounded-sm'}
              style={{ backgroundColor: item.color }}
              aria-hidden="true"
            />
            <span className={isMobile ? 'text-xs text-muted-foreground' : 'text-sm text-muted-foreground'}>
              {item.label}
            </span>
          </div>
        ))}
      </div>

      {/* Mobile custom toolbar — dois níveis */}
      {isMobile && hasData && (
        <div className="space-y-2" data-testid="mobile-toolbar">
          {/* Linha 1: prev/next + título + Hoje */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1">
              <Button size="icon" variant="outline" className="h-8 w-8"
                onClick={() => calendarRef.current?.getApi().prev()}
                aria-label="Mês anterior">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="outline" className="h-8 w-8"
                onClick={() => calendarRef.current?.getApi().next()}
                aria-label="Próximo mês">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <span className="font-semibold text-sm flex-1 text-center">{calendarTitle}</span>
            <Button size="sm" variant="outline" className="h-8 text-xs"
              onClick={() => calendarRef.current?.getApi().today()}>
              Hoje
            </Button>
          </div>
          {/* Linha 2: Mês / Lista */}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 h-8 text-xs"
              variant={currentView === 'dayGridMonth' ? 'default' : 'outline'}
              onClick={() => switchView('dayGridMonth')}>
              Mês
            </Button>
            <Button size="sm" className="flex-1 h-8 text-xs"
              variant={currentView === 'listMonth' ? 'default' : 'outline'}
              onClick={() => switchView('listMonth')}>
              Lista
            </Button>
          </div>
        </div>
      )}

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

      {hasData && (
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, listPlugin]}
          initialView="dayGridMonth"
          locale={ptBrLocale}
          firstDay={1}
          headerToolbar={isMobile ? false : {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,listMonth',
          }}
          buttonText={{ today: 'Hoje', month: 'Mês', list: 'Lista' }}
          events={events}
          eventClick={({ event }) => navigate(`/rentals/${event.id}`)}
          eventDisplay="block"
          dayMaxEvents={isMobile ? 2 : 3}
          height="auto"
          datesSet={({ view }) => setCalendarTitle(view.title)}
        />
      )}
    </div>
  )
}
