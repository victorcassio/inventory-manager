import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'

const onConfirm = vi.fn()
const onCancel = vi.fn()

/**
 * React rethrows an error from an event handler on the window, where Vitest
 * reports it as an unhandled error and warns that it may cause false
 * positives. These two tests throw ON PURPOSE, so the expected one is marked
 * handled and anything else still surfaces.
 */
function expectThrown(message: string) {
  const handler = (event: ErrorEvent) => {
    if (event.error?.message === message) event.preventDefault()
  }
  window.addEventListener('error', handler)
  return () => window.removeEventListener('error', handler)
}

function renderDialog() {
  return render(
    <ConfirmDialog
      open
      title="Revogar convite"
      description="Esta ação não pode ser desfeita."
      onConfirm={onConfirm}
      onCancel={onCancel}
      destructive
    />,
  )
}

describe('ConfirmDialog', () => {
  beforeEach(() => {
    onConfirm.mockClear()
    onCancel.mockClear()
  })

  it('confirms without also cancelling', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    // Radix closes the dialog through the same channel for both buttons, so a
    // confirm must not be mistaken for a dismissal.
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels exactly once on the cancel button', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('cancels on Escape, so a keyboard user is not stuck in the modal', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('can still be cancelled after a confirm handler throws', async () => {
    const user = userEvent.setup()
    onConfirm.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const stopSwallowing = expectThrown('boom')
    renderDialog()

    // The throw propagates out of the click; what matters is what it leaves
    // behind.
    await user.click(screen.getByRole('button', { name: 'Confirmar' })).catch(() => {})
    stopSwallowing()

    await user.keyboard('{Escape}')
    // A stale confirm flag would swallow this and trap the user in the modal.
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not carry a stale confirm across a reopen', async () => {
    const user = userEvent.setup()
    onConfirm.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const stopSwallowing = expectThrown('boom')
    const { rerender } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Confirmar' })).catch(() => {})
    stopSwallowing()

    // Close and reopen, as a caller would after handling the failure.
    rerender(
      <ConfirmDialog
        open={false}
        title="Revogar convite"
        description="Esta ação não pode ser desfeita."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    onCancel.mockClear()
    rerender(
      <ConfirmDialog
        open
        title="Revogar convite"
        description="Esta ação não pode ser desfeita."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('exposes the dialog with its title and description', () => {
    renderDialog()

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Revogar convite')
    expect(dialog).toHaveAccessibleDescription('Esta ação não pode ser desfeita.')
  })
})
