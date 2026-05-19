import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, ChevronUp, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface FilterPanelProps {
  activeCount: number
  summary?: string
  onClear: () => void
  children: ReactNode
}

export function FilterPanel({ activeCount, summary, onClear, children }: FilterPanelProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Mobile: collapsible — hidden on desktop via md:hidden */}
      <div className="md:hidden">
        <Button
          variant="outline"
          className="w-full justify-between"
          onClick={() => setOpen(v => !v)}
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            {summary && activeCount > 0 ? `Filtros · ${summary}` : 'Filtros'}
            {activeCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground leading-none">
                {activeCount}
              </span>
            )}
          </span>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>

        {open && (
          <div className="mt-3 space-y-4 rounded-md border p-4">
            {children}
            {activeCount > 0 && (
              <Button variant="ghost" size="sm" className="w-full" onClick={onClear}>
                <X className="mr-2 h-3 w-3" />
                Limpar filtros
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Desktop: renderiza children em fluxo normal — hidden on mobile */}
      <div className="hidden md:block space-y-4">
        {children}
      </div>
    </>
  )
}
