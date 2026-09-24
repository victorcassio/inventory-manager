import { useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import type { z } from 'zod'
import type { SetPasswordFormValues } from '@/schemas/password.schema'
import { PasswordInput } from './PasswordInput'
import { PasswordRequirements } from './PasswordRequirements'
import { TerminalPanel } from './TerminalPanel'
import { describeApiError, INVALID_LINK_MESSAGE } from '../lib/apiErrors'

interface SetPasswordFormProps {
  /** Stated by the caller: activation and reset are the same policy today, and
   *  hardcoding one here would let them diverge without anyone noticing. */
  schema: z.ZodType<SetPasswordFormValues>
  title: string
  submitLabel: string
  token: string | null
  onSubmit: (token: string, password: string, passwordConfirmation: string) => Promise<unknown>
  onSuccess: () => void
}

export function SetPasswordForm({
  schema,
  title,
  submitLabel,
  token,
  onSubmit,
  onSuccess,
}: SetPasswordFormProps) {
  const [tokenRejected, setTokenRejected] = useState(false)
  const [apiMessages, setApiMessages] = useState<string[]>([])
  // Holds the in-flight request so a second submission can JOIN it rather than
  // be dropped. Returning early instead would hand React Hook Form an
  // already-resolved promise for that invocation, so its isSubmitting would
  // flip back to false while the first request is still running — spinner
  // gone, label reverted, inputs re-enabled, and the next click silently doing
  // nothing. isSubmitting alone cannot serialise these either: the disabled
  // button only exists after a re-render, and two submits in one tick get past
  // it. On these endpoints a duplicate burns a single-use token twice.
  const inFlight = useRef<Promise<void> | null>(null)
  const requirementsId = useId()
  const errorsId = useId()

  const form = useForm<SetPasswordFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', passwordConfirmation: '' },
    // Focus the first invalid field on a failed submit. PasswordInput forwards
    // its ref, which is what makes this work.
    shouldFocusError: true,
  })

  const password = form.watch('password')
  const confirmation = form.watch('passwordConfirmation')

  // No token, or one the server has rejected: there is nothing to validate, so
  // the API is never called just to be told what we already know.
  if (!token || tokenRejected) {
    return (
      <TerminalPanel title={INVALID_LINK_MESSAGE}>
        <p className="text-sm text-muted-foreground">
          Este link não é mais válido. Solicite um novo para continuar.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link to="/forgot-password">Solicitar novo link</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full sm:w-auto">
            <Link to="/login">Voltar ao login</Link>
          </Button>
        </div>
      </TerminalPanel>
    )
  }

  const runSubmit = async (values: SetPasswordFormValues) => {
    setApiMessages([])
    let succeeded = false

    try {
      // The token travels here and only here: in the mutation body. It is
      // never a query key, never persisted, never logged.
      await onSubmit(token, values.password, values.passwordConfirmation)
      succeeded = true
    } catch (error) {
      const { kind, messages } = describeApiError(error)
      // A rejected token ends the flow — retrying cannot help, and the reason
      // is deliberately indistinguishable from expiry or reuse.
      if (kind === 'token') setTokenRejected(true)
      else setApiMessages(messages)
    }

    // Outside the try on purpose. If navigate or the toast throws, that is not
    // an API failure, and reporting it as one would tell someone whose password
    // was just changed to try again with a token that is now spent.
    if (succeeded) onSuccess()
  }

  const handleSubmit = (values: SetPasswordFormValues) => {
    if (inFlight.current) return inFlight.current

    // An async function never throws synchronously, so the ref is always
    // assigned before anything can clear it.
    const request = runSubmit(values)
    inFlight.current = request
    void request.finally(() => {
      if (inFlight.current === request) inFlight.current = null
    })
    return request
  }

  const busy = form.formState.isSubmitting

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nova senha</FormLabel>
                  {/* On FormControl, not on the input. Radix's Slot lets the
                      CHILD's props win, so setting it below would replace the
                      value FormControl computes — and with it the link to this
                      field's own validation message. Passed here, FormControl
                      composes the two. */}
                  <FormControl aria-describedby={requirementsId}>
                    <PasswordInput autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="passwordConfirmation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirmar nova senha</FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete="new-password"
                      data-testid="password-confirmation"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <PasswordRequirements
              id={requirementsId}
              value={password}
              confirmation={confirmation}
            />

            {/* Present from first render so the region is in the accessibility
                tree before anything is written into it. */}
            <div id={errorsId} role="alert" className="space-y-1">
              {apiMessages.map((message) => (
                <p key={message} className="text-sm font-medium text-destructive-text">
                  {message}
                </p>
              ))}
            </div>

            {/* aria-disabled, not disabled: disabling the control the user just
                activated blurs it to <body>, so a keyboard user's next Tab
                restarts from the top of the document and a screen-reader user
                loses their place. Staying focused also means the label change
                to "Enviando…" is announced, which aria-busy alone does not do.
                Duplicate submissions are already serialised by inFlight. */}
            <Button type="submit" className="w-full" aria-disabled={busy} aria-busy={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {busy ? 'Enviando…' : submitLabel}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
