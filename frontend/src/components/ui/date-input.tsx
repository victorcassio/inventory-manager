import * as React from 'react'
import { cn } from '@/lib/utils'

interface DateInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  value?: string
  onChange?: React.ChangeEventHandler<HTMLInputElement>
}

// Converts YYYY-MM-DD → DD/MM/YYYY for display
function toDisplay(iso: string): string {
  return iso && iso.length === 10
    ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
    : ''
}

// Converts DD/MM/YYYY → YYYY-MM-DD for internal value (returns '' if incomplete)
function toIso(display: string): string {
  const d = display.split('/')
  return d.length === 3 && d[0].length === 2 && d[1].length === 2 && d[2].length === 4
    ? `${d[2]}-${d[1]}-${d[0]}`
    : ''
}

const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ className, value, onChange, ...props }, ref) => {
    const [display, setDisplay] = React.useState(() => toDisplay(value ?? ''))

    React.useEffect(() => {
      setDisplay(toDisplay(value ?? ''))
    }, [value])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const digits = e.target.value.replace(/\D/g, '').slice(0, 8)
      let formatted = digits
      if (digits.length > 2) formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`
      if (digits.length > 4) formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
      setDisplay(formatted)
      onChange?.({ ...e, target: { ...e.target, value: toIso(formatted) } })
    }

    return (
      <input
        {...props}
        ref={ref}
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        value={display}
        onChange={handleChange}
        maxLength={10}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      />
    )
  },
)
DateInput.displayName = 'DateInput'

export { DateInput }
