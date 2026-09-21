import { Link, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { loginSchema, type LoginFormValues } from '@/schemas/auth.schema'
import { useAuth } from '../hooks/useAuth'
import { PasswordInput } from './PasswordInput'

/**
 * Fixed, non-sensitive strings only. AccountSecurityPage passes a bare
 * indicator through navigation state rather than a toast — a toast tied to
 * the page it fired from can be unmounted before it renders, and this way the
 * message is guaranteed to show exactly where the user lands, not wherever
 * they happened to be a moment before the redirect.
 */
const SECURITY_NOTICES: Record<string, string> = {
  'password-changed': 'Senha alterada. Faça login novamente.',
  'session-expired': 'Sua sessão expirou. Faça login novamente.',
}

export function LoginForm() {
  const { login } = useAuth()
  const location = useLocation()
  const [apiError, setApiError] = useState<string | null>(null)
  const securityNotice =
    typeof (location.state as { securityNotice?: unknown })?.securityNotice === 'string'
      ? SECURITY_NOTICES[(location.state as { securityNotice: string }).securityNotice]
      : undefined

  // securityNotice is already known on the very first render (it comes from
  // the navigate() call that landed us here), so a role="status" paragraph
  // that renders it directly would be born already containing its final
  // text — the case screen readers announce least reliably, since nothing
  // about an already-complete live region looks like a change to announce
  // (see TerminalPanel for the same reasoning applied to a heading). Mounting
  // this text one tick later, via an effect that runs after the region
  // itself is already in the tree, turns it into a genuine mutation instead.
  const [noticeText, setNoticeText] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (securityNotice) setNoticeText(securityNotice)
  }, [securityNotice])

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  // Joined, not dropped — see ForgotPasswordPage/SetPasswordForm for why
  // returning early on a reentrant submit would leave the form looking idle
  // while a request it started is still in flight.
  const inFlight = useRef<Promise<void> | null>(null)

  const runSubmit = async (values: LoginFormValues) => {
    setApiError(null)
    try {
      await login(values.email, values.password)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 401) {
        setApiError('Credenciais inválidas')
      } else {
        setApiError('Erro ao fazer login. Tente novamente.')
      }
    }
  }

  const onSubmit = (values: LoginFormValues) => {
    if (inFlight.current) return inFlight.current
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
        <CardTitle>Entrar</CardTitle>
      </CardHeader>
      <CardContent>
        {securityNotice && (
          <p role="status" className="mb-4 rounded-md bg-muted p-3 text-sm text-muted-foreground">
            {noticeText}
          </p>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="seu@email.com"
                      autoComplete="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Senha</FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder="••••••••"
                      autoComplete="current-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* Present from first render, like the notice above, so an error
                arriving after submission is a mutation of an already-mounted
                region rather than a node born already containing text. */}
            <div role="alert">
              {apiError && (
                <p className="text-sm font-medium text-destructive-text">{apiError}</p>
              )}
            </div>
            {/* aria-disabled, not disabled: disabling the control the user
                just activated drops focus to <body>, breaking the Tab
                sequence and silencing the "Entrando…" label change for
                assistive tech (see SetPasswordForm). Reentrant submits are
                already serialised by inFlight above. */}
            <Button
              type="submit"
              className="w-full"
              aria-disabled={busy}
              aria-busy={busy}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {busy ? 'Entrando…' : 'Entrar'}
            </Button>

            <Button asChild variant="link" className="w-full font-normal">
              <Link to="/forgot-password">Esqueci minha senha</Link>
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
