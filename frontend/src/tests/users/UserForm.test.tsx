import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserForm } from '@/features/users/components/UserForm'
import { createUserSchema, updateUserSchema } from '@/schemas/user.schema'
import type { AdminUser } from '@/types'

function makeAdminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'u-1',
    name: 'Carlos Financeiro',
    email: 'carlos@example.com',
    role: 'financial',
    isActive: true,
    emailVerifiedAt: '2026-01-01T00:00:00Z',
    passwordSetAt: '2026-01-01T00:00:00Z',
    lastLogin: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    invitationStatus: 'accepted',
    invitationExpiresAt: null,
    ...overrides,
  }
}

describe('UserForm — schema', () => {
  it('rejects role admin on create', () => {
    const result = createUserSchema.safeParse({
      name: 'Novo Admin',
      email: 'admin@example.com',
      role: 'admin',
    })
    expect(result.success).toBe(false)
  })

  it('rejects role admin on edit', () => {
    const result = updateUserSchema.safeParse({ name: 'Alguém', role: 'admin' })
    expect(result.success).toBe(false)
  })

  it('accepts attendant and financial on create', () => {
    for (const role of ['attendant', 'financial']) {
      const result = createUserSchema.safeParse({
        name: 'Fulano',
        email: 'fulano@example.com',
        role,
      })
      expect(result.success).toBe(true)
    }
  })
})

describe('UserForm — create mode', () => {
  it('has no password field anywhere in the form', () => {
    render(<UserForm mode="create" onSubmit={vi.fn()} submitting={false} />)

    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument()
    expect(document.querySelector('input[type="password"]')).not.toBeInTheDocument()
    expect(screen.queryByTestId('password-input')).not.toBeInTheDocument()
  })

  it('renders an editable e-mail field', () => {
    render(<UserForm mode="create" onSubmit={vi.fn()} submitting={false} />)

    const email = screen.getByLabelText('E-mail')
    expect(email).not.toBeDisabled()
    expect(email).not.toHaveAttribute('readonly')
  })

  it('only offers attendant and financial as role options', async () => {
    const user = userEvent.setup()
    render(<UserForm mode="create" onSubmit={vi.fn()} submitting={false} />)

    await user.click(screen.getByRole('combobox', { name: /perfil/i }))

    expect(screen.getByRole('option', { name: 'Atendente' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Financeiro' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /admin/i })).not.toBeInTheDocument()
  })

  it('submits the entered values', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<UserForm mode="create" onSubmit={onSubmit} submitting={false} />)

    await user.type(screen.getByLabelText('Nome'), 'Maria Nova')
    await user.type(screen.getByLabelText('E-mail'), 'maria.nova@example.com')
    await user.click(screen.getByRole('combobox', { name: /perfil/i }))
    await user.click(screen.getByRole('option', { name: 'Atendente' }))
    await user.click(screen.getByRole('button', { name: /cadastrar usuário/i }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Maria Nova',
        email: 'maria.nova@example.com',
        role: 'attendant',
      }),
    )
  })
})

describe('UserForm — edit mode', () => {
  it('has no password field', () => {
    render(
      <UserForm mode="edit" user={makeAdminUser()} onSubmit={vi.fn()} submitting={false} />,
    )

    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument()
    expect(document.querySelector('input[type="password"]')).not.toBeInTheDocument()
  })

  it('keeps the e-mail field read-only, pre-filled with the existing address', () => {
    render(
      <UserForm mode="edit" user={makeAdminUser()} onSubmit={vi.fn()} submitting={false} />,
    )

    const email = screen.getByLabelText('E-mail') as HTMLInputElement
    expect(email.value).toBe('carlos@example.com')
    expect(email).toBeDisabled()
    expect(email).toHaveAttribute('readonly')
  })

  it('does not send the e-mail field on submit, since it cannot change', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <UserForm mode="edit" user={makeAdminUser()} onSubmit={onSubmit} submitting={false} />,
    )

    await user.clear(screen.getByLabelText('Nome'))
    await user.type(screen.getByLabelText('Nome'), 'Carlos Editado')
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.not.objectContaining({ email: expect.anything() }),
    )
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Carlos Editado' }))
  })
})
