import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  createUserSchema,
  updateUserSchema,
  INVITABLE_ROLES,
  type CreateUserFormValues,
  type UpdateUserFormValues,
} from '@/schemas/user.schema'
import type { AdminUser } from '@/types'

const ROLE_LABELS: Record<(typeof INVITABLE_ROLES)[number], string> = {
  attendant: 'Atendente',
  financial: 'Financeiro',
}

interface UserFormProps {
  mode: 'create'
  defaultValues?: Partial<CreateUserFormValues>
  onSubmit: (values: CreateUserFormValues) => void
  submitting: boolean
}

interface UserEditFormProps {
  mode: 'edit'
  user: AdminUser
  defaultValues?: Partial<UpdateUserFormValues>
  onSubmit: (values: UpdateUserFormValues) => void
  submitting: boolean
}

/**
 * Shared create/edit form for attendant and financial users.
 *
 * There is deliberately no password field anywhere in this form: an admin
 * never sets or sees another user's password. Accounts are always onboarded
 * through the invitation flow (Task 16/17), which is the only path that ever
 * touches a password. role is restricted to INVITABLE_ROLES at the schema
 * level, so 'admin' cannot even be constructed here — the backend enforces the
 * same restriction independently, since this is UX, not the security boundary.
 */
export function UserForm(props: UserFormProps | UserEditFormProps) {
  const isEdit = props.mode === 'edit'

  const form = useForm<CreateUserFormValues | UpdateUserFormValues>({
    resolver: zodResolver(isEdit ? updateUserSchema : createUserSchema),
    defaultValues: isEdit
      ? { name: props.user.name, role: props.user.role as 'attendant' | 'financial', ...props.defaultValues }
      : { name: '', email: '', role: undefined, ...props.defaultValues },
    shouldFocusError: true,
  })

  const busy = props.submitting || form.formState.isSubmitting

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => {
          if (isEdit) props.onSubmit(values as UpdateUserFormValues)
          else props.onSubmit(values as CreateUserFormValues)
        })}
        className="space-y-4"
        noValidate
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome</FormLabel>
              <FormControl>
                {/* No disabled={busy} here: disabling the field the user is
                    focused in (e.g. after pressing Enter to submit) blurs it to
                    <body>, losing their place. The inFlight guard in
                    UserNewPage/UserEditPage already prevents a duplicate
                    submit, so this has nothing left to protect against. */}
                <Input autoComplete="name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {isEdit ? (
          <FormItem>
            <FormLabel htmlFor="user-email-readonly">E-mail</FormLabel>
            <FormControl>
              <Input
                id="user-email-readonly"
                value={props.user.email}
                readOnly
                aria-describedby="user-email-readonly-hint"
              />
            </FormControl>
            <FormDescription id="user-email-readonly-hint">
              O e-mail não pode ser alterado após o cadastro.
            </FormDescription>
          </FormItem>
        ) : (
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>E-mail</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Perfil</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger ref={field.ref}>
                    <SelectValue placeholder="Selecione um perfil" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {INVITABLE_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" aria-disabled={busy} aria-busy={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {busy ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Cadastrar usuário'}
        </Button>
      </form>
    </Form>
  )
}
