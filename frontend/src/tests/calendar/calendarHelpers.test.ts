import { getIsMobile, getEventTitle } from '@/features/calendar/utils/calendarHelpers'

describe('getIsMobile', () => {
  function setViewport(width: number) {
    Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true })
  }

  it('retorna true quando innerWidth < 768', () => {
    setViewport(375)
    expect(getIsMobile()).toBe(true)
  })

  it('retorna false quando innerWidth === 768', () => {
    setViewport(768)
    expect(getIsMobile()).toBe(false)
  })

  it('retorna false quando innerWidth > 768', () => {
    setViewport(1280)
    expect(getIsMobile()).toBe(false)
  })
})

describe('getEventTitle', () => {
  it('mobile: retorna formato curto "#número · nome"', () => {
    expect(getEventTitle('2026-0001', 'João Silva', true)).toBe('#2026-0001 · João Silva')
  })

  it('desktop: retorna formato longo "Contrato número · nome"', () => {
    expect(getEventTitle('2026-0001', 'João Silva', false)).toBe('Contrato 2026-0001 · João Silva')
  })

  it('trata nome fallback "—"', () => {
    expect(getEventTitle('2026-0042', '—', true)).toBe('#2026-0042 · —')
  })
})
