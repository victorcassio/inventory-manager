import { useEffect, useRef } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  destructive?: boolean
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  onConfirm,
  onCancel,
  destructive = false,
}: ConfirmDialogProps) {
  // Set by the confirm button, read by onOpenChange, which Radix drives for
  // every close — confirm included.
  const confirmed = useRef(false)

  // Cleared on every open, so the flag can never carry across dialogs. The
  // try/catch below covers a throwing onConfirm; this covers any future route
  // that sets the flag without a matching close, where a stale true would
  // silently swallow the NEXT dismissal of the next opening.
  useEffect(() => {
    if (open) confirmed.current = false
  }, [open])

  return (
    <AlertDialog
      open={open}
      // Without this the dialog can only be dismissed with the mouse on its
      // Cancel button: Escape does nothing, which leaves keyboard users in a
      // modal they cannot back out of. (An alert dialog deliberately ignores
      // clicks outside it, so this changes Escape and the Cancel button only.)
      //
      // Radix implements BOTH footer buttons as Close, so every route out of
      // the dialog — including a confirm — lands here. Without the flag below,
      // confirming would also run onCancel: harmless for a caller that just
      // closes a panel, wrong for one that aborts a request, resets a form or
      // writes an audit line.
      onOpenChange={(next) => {
        if (next) return
        if (confirmed.current) {
          confirmed.current = false
          return
        }
        onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              confirmed.current = true
              try {
                onConfirm()
              } catch (error) {
                // Radix composes the close handler after this one, so a throw
                // here means onOpenChange never runs and the flag never clears.
                // Left set, it would swallow the user's next Escape and leave a
                // destructive modal with no way out.
                confirmed.current = false
                throw error
              }
            }}
            className={destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
