import { useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { changePasswordSchema, type ChangePasswordFormValues } from '@/schemas/password.schema'
import { authApi } from '@/lib/api/auth.api'
import { useAuthStore } from '@/stores/auth.store'
import { PasswordInput } from '../components/PasswordInput'
import { PasswordRequirements } from '../components/PasswordRequirements'
import { describeApiError } from '../lib/apiErrors'
import { prepareToEndSession, revokeAndClearSession } from '../lib/endSession'

type SecurityNotice = 'password-changed' | 'session-expired'

export function AccountSecurityPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [apiMessages, setApiMessages] = useState<string[]>([])
  // Same reasoning as SetPasswordForm's inFlight ref: isSubmitting alone does
  // not exist until React re-renders, so two submits landing in one tick both
  // get past it. This is what makes a double click send exactly one request.
  const inFlight = useRef<Promise<void> | null>(null)
  const requirementsId = useId()
  const warningId = useId()
  const errorsId = useId()

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', newPasswordConfirmation: '' },
    shouldFocusError: true,
  })

  const newPassword = form.watch('newPassword')
  const newPasswordConfirmation = form.watch('newPasswordConfirmation')

  // The page that would show a result is about to unmount as part of this
  // sequence, so nothing downstream of it — a toast, a query refetch — can be
  // trusted to run or be seen. Order matters: stop a refresh in flight from
  // reviving the session before anything else, then stop queries that could
  // still write into the cache we're about to drop, then drop it, then do the
  // actual revoke-and-clear, then leave.
  async function endAuthenticatedSession(notice: SecurityNotice) {
    await prepareToEndSession()
    await queryClient.cancelQueries()
    queryClient.clear()
    await revokeAndClearSession()
    // A toast tied to this page cannot survive the clear above, so the login
    // page renders its own message from this bare, non-sensitive indicator
    // instead of us trying to raise one here.
    navigate('/login', { replace: true, state: { securityNotice: notice } })
  }

  const runSubmit = async (values: ChangePasswordFormValues) => {
    setApiMessages([])
    // Captured before the request, not after: authApi.changePassword is a
    // real network round trip, and nothing stops this same tab from reaching
    // /login and signing into a DIFFERENT account while it is in flight (no
    // route guard blocks an authenticated user from visiting /login). If that
    // happens, the account this submission belongs to is gone by the time we
    // get a response — ending "the current session" at that point would mean
    // revoking and destroying whatever the new account just started, not
    // anything this form ever touched.
    const startingUserId = useAuthStore.getState().user?.id

    let notice: SecurityNotice
    try {
      await authApi.changePassword(
        values.currentPassword,
        values.newPassword,
        values.newPasswordConfirmation,
      )
      // On success the backend has already revoked every refresh token for
      // this user and moved passwordChangedAt, ending every session including
      // this one. What follows is this tab catching up to that fact.
      notice = 'password-changed'
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status
      // A 401 here means this browser's own session died independently of the
      // change attempt (expired or replaced elsewhere) while the form was
      // open — there is nothing to show inline, because the account this form
      // was editing is no longer the one in the browser.
      if (status !== 401) {
        const { messages } = describeApiError(error)
        setApiMessages(messages)
        return
      }
      notice = 'session-expired'
    }

    // A same-user re-login during the request above is still safe to finish:
    // a successful change already revoked that new login's tokens too, and an
    // expired-session 401 for the same account has nothing left to protect
    // either way. Only a genuinely different account must be left alone.
    if (useAuthStore.getState().user?.id !== startingUserId) return

    await endAuthenticatedSession(notice)
  }

  const handleSubmit = (values: ChangePasswordFormValues) => {
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
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Segurança</h2>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Alterar senha</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senha atual</FormLabel>
                    <FormControl>
                      <PasswordInput autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nova senha</FormLabel>
                    <FormControl aria-describedby={requirementsId}>
                      <PasswordInput autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="newPasswordConfirmation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirmar nova senha</FormLabel>
                    <FormControl>
                      <PasswordInput
                        autoComplete="new-password"
                        data-testid="new-password-confirmation"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <PasswordRequirements
                id={requirementsId}
                value={newPassword}
                confirmation={newPasswordConfirmation}
              />

              <p id={warningId} className="text-sm text-muted-foreground">
                Ao alterar sua senha, todas as sessões ativas serão encerradas e será
                necessário entrar novamente.
              </p>

              {/* Present from first render, like SetPasswordForm's own error
                  region, so it is in the accessibility tree before anything is
                  written into it. */}
              <div id={errorsId} role="alert" className="space-y-1">
                {apiMessages.map((message) => (
                  <p key={message} className="text-sm font-medium text-destructive-text">
                    {message}
                  </p>
                ))}
              </div>

              {/* aria-disabled, not disabled: see SetPasswordForm for why
                  disabling the control just activated would blur focus to
                  <body>. Duplicate submissions are already serialised by
                  inFlight above. aria-describedby on warningId: a user who
                  tabs field-to-field lands on this button directly from the
                  last password field, never passing through the warning
                  paragraph in a way Tab would stop on — this is what exposes
                  it to assistive tech regardless of navigation style. */}
              <Button
                type="submit"
                className="w-full sm:w-auto"
                aria-disabled={busy}
                aria-busy={busy}
                aria-describedby={warningId}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {busy ? 'Alterando…' : 'Alterar senha'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
