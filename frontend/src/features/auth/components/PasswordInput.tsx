import { forwardRef, useLayoutEffect, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type PasswordInputProps = Omit<React.ComponentPropsWithoutRef<typeof Input>, 'type'> & {
  autoComplete: 'new-password' | 'current-password'
}

/**
 * A password field with a visibility toggle.
 *
 * Forwards its ref so React Hook Form can focus the first invalid field, and
 * deliberately does nothing to the value: no trim, no normalisation, no maximum
 * length. Spaces are legitimate password characters and the backend does not
 * trim either — quietly altering what the user typed would mean the password
 * they set is not the password they think they set.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, autoComplete, disabled, ...props }, forwardedRef) => {
    const [visible, setVisible] = useState(false)
    const [announcement, setAnnouncement] = useState('')
    const inputRef = useRef<HTMLInputElement | null>(null)
    const toggleRef = useRef<HTMLButtonElement | null>(null)
    // Captured on toggle, restored after the re-render: switching the input's
    // type resets the selection in every browser, which would drop the caret to
    // the end of the field mid-word.
    const pendingSelection = useRef<{ start: number; end: number } | null>(null)

    useLayoutEffect(() => {
      const selection = pendingSelection.current
      const input = inputRef.current
      pendingSelection.current = null
      if (!selection || !input) return

      // focus() is belt and braces: mousedown's preventDefault already keeps
      // focus in the field, so in practice it is a no-op. It matters only if
      // that ever changes. setSelectionRange is the part that does the work.
      input.focus()
      input.setSelectionRange(selection.start, selection.end)
    }, [visible])

    function toggleVisibility() {
      const input = inputRef.current
      if (input && document.activeElement === input) {
        pendingSelection.current = {
          start: input.selectionStart ?? input.value.length,
          end: input.selectionEnd ?? input.value.length,
        }
      }
      // Both writes outside the updater: an updater must be pure, which is the
      // same rule the fragment hook's lazy initializer follows, and StrictMode
      // double-invokes it. `visible` cannot be stale inside a click handler.
      const next = !visible
      setVisible(next)

      // Only where nothing else speaks. On the keyboard path focus is on the
      // toggle, so assistive technology already announces its new name and
      // pressed state — a region firing as well would say the same thing
      // twice. On the mouse and touch paths focus never reaches the button
      // (mousedown is prevented) and this is the ONLY announcement there.
      // Clearing it is silent, so a keyboard toggle after a mouse one adds
      // nothing.
      const toggleIsFocused = document.activeElement === toggleRef.current
      setAnnouncement(toggleIsFocused ? '' : next ? 'Senha visível' : 'Senha oculta')
    }

    const Icon = visible ? EyeOff : Eye
    // Names the action, never the secret or its length.
    const label = visible ? 'Ocultar senha' : 'Mostrar senha'

    return (
      <div className="relative">
        <Input
          // Before the spread, so a page rendering two of these — a password
          // and its confirmation — can give each its own id.
          data-testid="password-input"
          {...props}
          ref={(node) => {
            inputRef.current = node
            if (typeof forwardedRef === 'function') forwardedRef(node)
            else if (forwardedRef) forwardedRef.current = node
          }}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          disabled={disabled}
          className={cn('pr-10', className)}
        />
        <button
          ref={toggleRef}
          // Never "submit": inside a form, a default-type button would send it.
          type="button"
          // Keeps focus in the field when the toggle is clicked: without this,
          // mousedown moves focus to the button before onClick runs, so there
          // is no selection left to preserve and the user lands on a button
          // instead of back in the password they were typing. Tab still
          // focuses it, so keyboard users are unaffected.
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleVisibility}
          // Disabled alongside the field, so it is neither a dead control nor a
          // way to reveal a value the user cannot edit.
          disabled={disabled}
          aria-label={label}
          aria-pressed={visible}
          title={label}
          // p-2 keeps the hit area at 32px rather than sitting exactly on the
          // 24px WCAG 2.5.8 floor. The focus treatment is the app-wide one on
          // purpose: Tailwind's outline-none is not `outline: none` but a 2px
          // transparent outline, which Windows forced-colors mode repaints
          // with a system colour, so the ring survives high contrast.
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </button>
        {/* The toggle returns focus to the field, so a screen-reader user who
            clicks it never hears the button's own state change. This says what
            happened, once, and stays silent on first render. */}
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    )
  },
)

PasswordInput.displayName = 'PasswordInput'
