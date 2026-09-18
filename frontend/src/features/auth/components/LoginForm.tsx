import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
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

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (values: LoginFormValues) => {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
      </CardHeader>
      <CardContent>
        {securityNotice && (
          <p role="status" className="mb-4 rounded-md bg-muted p-3 text-sm text-muted-foreground">
            {securityNotice}
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
                    <Input
                      type="password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {apiError && (
              <p className="text-sm font-medium text-destructive-text">{apiError}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Entrar
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
