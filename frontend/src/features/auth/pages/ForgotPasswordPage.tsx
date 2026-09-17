import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { forgotPasswordSchema, type ForgotPasswordFormValues } from '@/schemas/password.schema'
import { authApi } from '@/lib/api/auth.api'
import { TerminalPanel } from '../components/TerminalPanel'
import { GENERIC_ERROR_MESSAGE } from '../lib/apiErrors'

const CONFIRMATION =
  'Se o e-mail estiver cadastrado, enviaremos as instruções para redefinição da senha.'

export function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false)
  const [transportError, setTransportError] = useState<string | null>(null)
  // Joined, not dropped — see SetPasswordForm for why returning early makes
  // the form look idle while its request is still running.
  const inFlight = useRef<Promise<void> | null>(null)

  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
    shouldFocusError: true,
  })

  const runSubmit = async (values: ForgotPasswordFormValues) => {
    setTransportError(null)

    try {
      await authApi.forgotPassword(values.email)
      // Only a 2xx earns the confirmation, and the confirmation says nothing
      // about whether the address exists — the backend answers identically
      // either way, and the send is not awaited there, so timing does not
      // differentiate either.
      setSubmitted(true)
    } catch {
      // 400, 429, 5xx, a timeout, a dropped connection: the request was not
      // processed, so claiming instructions are on their way would be a lie.
      // The message never says which of those happened.
      setTransportError(GENERIC_ERROR_MESSAGE)
    }
  }

  const onSubmit = (values: ForgotPasswordFormValues) => {
    if (inFlight.current) return inFlight.current

    const request = runSubmit(values)
    inFlight.current = request
    void request.finally(() => {
      if (inFlight.current === request) inFlight.current = null
    })
    return request
  }

  if (submitted) {
    return (
      <TerminalPanel title="Verifique seu e-mail">
        <p className="text-sm text-muted-foreground">{CONFIRMATION}</p>
        <Button asChild variant="outline" className="w-full">
          <Link to="/login">Voltar ao login</Link>
        </Button>
      </TerminalPanel>
    )
  }

  const busy = form.formState.isSubmitting

  return (
    <Card>
      <CardHeader>
        <CardTitle>Esqueci minha senha</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="seu@email.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div role="alert">
              {transportError && (
                <p className="text-sm font-medium text-destructive-text">{transportError}</p>
              )}
            </div>

            {/* See SetPasswordForm: disabling the focused button drops focus to
                <body> and silences the "Enviando…" label change. */}
            <Button type="submit" className="w-full" aria-disabled={busy} aria-busy={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {busy ? 'Enviando…' : 'Enviar instruções'}
            </Button>

            <Button asChild variant="ghost" className="w-full">
              <Link to="/login">Voltar ao login</Link>
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
