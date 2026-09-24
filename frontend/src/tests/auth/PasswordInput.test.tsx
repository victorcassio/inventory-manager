import { describe, it, expect, vi } from 'vitest'
import { createRef, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PasswordInput } from '@/features/auth/components/PasswordInput'

const input = () => screen.getByTestId('password-input') as HTMLInputElement
const toggle = () => screen.getByRole('button', { name: /senha/i })

/** A controlled host, the way React Hook Form drives the field. */
function Host({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <PasswordInput
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="new-password"
        name="password"
      />
      <span data-testid="echo">{JSON.stringify(value)}</span>
    </>
  )
}

describe('PasswordInput', () => {
  it('starts masked and announces the action, not the state of the secret', () => {
    render(<PasswordInput value="" onChange={vi.fn()} autoComplete="new-password" />)

    expect(input()).toHaveAttribute('type', 'password')
    expect(toggle()).toHaveAccessibleName('Mostrar senha')
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(toggle()).toHaveAttribute('type', 'button')
  })

  it('toggles visibility, flipping both the label and aria-pressed', async () => {
    const user = userEvent.setup()
    render(<PasswordInput value="segredo" onChange={vi.fn()} autoComplete="new-password" />)

    await user.click(toggle())

    expect(input()).toHaveAttribute('type', 'text')
    expect(toggle()).toHaveAccessibleName('Ocultar senha')
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')

    await user.click(toggle())
    expect(input()).toHaveAttribute('type', 'password')
    expect(toggle()).toHaveAccessibleName('Mostrar senha')
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
  })

  it('is reachable and operable by keyboard alone', async () => {
    const user = userEvent.setup()
    render(<PasswordInput value="segredo" onChange={vi.fn()} autoComplete="new-password" />)

    await user.tab()
    expect(input()).toHaveFocus()
    await user.tab()
    expect(toggle()).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')

    await user.keyboard(' ')
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps the value and the caret position across a toggle', async () => {
    const user = userEvent.setup()
    render(<Host initial="senha bem comprida" />)

    input().focus()
    input().setSelectionRange(5, 5)
    // jsdom does NOT reset the selection when `type` flips, though every real
    // browser does — so asserting selectionStart afterwards would pass even
    // with the restore deleted. Assert the mechanism instead.
    const setSelectionRange = vi.spyOn(input(), 'setSelectionRange')

    await user.click(toggle())

    expect(input().value).toBe('senha bem comprida')
    expect(setSelectionRange).toHaveBeenCalledWith(5, 5)
    // Focus returns to the field, so typing continues where it left off.
    expect(input()).toHaveFocus()
  })

  it('announces the new visibility state, and says nothing on first render', async () => {
    const user = userEvent.setup()
    render(<PasswordInput value="segredo" onChange={vi.fn()} autoComplete="new-password" />)

    // Focus goes back to the field on toggle, so the button's own state change
    // would otherwise never be spoken.
    expect(screen.getByRole('status')).toBeEmptyDOMElement()

    await user.click(toggle())
    expect(screen.getByRole('status')).toHaveTextContent('Senha visível')

    await user.click(toggle())
    expect(screen.getByRole('status')).toHaveTextContent('Senha oculta')
  })

  it('stays silent on the keyboard path, where the toggle itself is announced', async () => {
    const user = userEvent.setup()
    render(<PasswordInput value="segredo" onChange={vi.fn()} autoComplete="new-password" />)

    await user.tab()
    await user.tab()
    expect(toggle()).toHaveFocus()
    await user.keyboard('{Enter}')

    // Focus is on the toggle, so assistive technology already reads its new
    // name and pressed state. A region firing here would say it twice.
    expect(input()).toHaveAttribute('type', 'text')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('lets a caller override the test id, since a page renders two of these', () => {
    render(
      <PasswordInput
        value=""
        onChange={vi.fn()}
        autoComplete="new-password"
        data-testid="password-confirmation"
      />,
    )

    expect(screen.getByTestId('password-confirmation')).toBeInTheDocument()
    expect(screen.queryByTestId('password-input')).not.toBeInTheDocument()
  })

  it('forwards the ref, so RHF can focus the first invalid field', () => {
    const ref = createRef<HTMLInputElement>()
    render(<PasswordInput ref={ref} value="" onChange={vi.fn()} autoComplete="new-password" />)

    expect(ref.current).toBe(input())
    ref.current?.focus()
    expect(input()).toHaveFocus()
  })

  it('passes ARIA, name, autoComplete and disabled through to the field', () => {
    render(
      <PasswordInput
        value=""
        onChange={vi.fn()}
        autoComplete="current-password"
        name="currentPassword"
        aria-invalid
        aria-describedby="password-error"
        disabled
      />,
    )

    expect(input()).toHaveAttribute('autocomplete', 'current-password')
    expect(input()).toHaveAttribute('name', 'currentPassword')
    expect(input()).toHaveAttribute('aria-invalid', 'true')
    expect(input()).toHaveAttribute('aria-describedby', 'password-error')
    expect(input()).toBeDisabled()
    // The toggle is useless on a disabled field and must not be a focus trap.
    expect(toggle()).toBeDisabled()
  })

  it('preserves spaces exactly: no trim, no normalisation, no silent cap', async () => {
    const user = userEvent.setup()
    render(<Host />)

    const secret = '  senha  com   espaços  '
    await user.type(input(), secret)

    expect(input().value).toBe(secret)
    // textContent, not toHaveTextContent: the matcher collapses whitespace,
    // which is the very thing under test here.
    expect(screen.getByTestId('echo').textContent).toBe(JSON.stringify(secret))
    expect(input()).not.toHaveAttribute('maxlength')
  })

  it('never exposes the value through the toggle', () => {
    render(
      <PasswordInput value="minha-senha-secreta" onChange={vi.fn()} autoComplete="new-password" />,
    )

    expect(toggle().outerHTML).not.toContain('minha-senha-secreta')
    expect(toggle()).toHaveAccessibleName('Mostrar senha')
  })
})
