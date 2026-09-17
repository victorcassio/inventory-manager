import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PasswordRequirements } from '@/features/auth/components/PasswordRequirements'
import { PASSWORD_RULES, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '@/schemas/password.schema'

const rule = (id: string) => screen.getByTestId(`rule-${id}`)

describe('PasswordRequirements', () => {
  it('renders one entry per rule in the shared policy, plus the confirmation', () => {
    render(<PasswordRequirements value="" confirmation="" />)

    for (const { id } of PASSWORD_RULES) {
      expect(rule(id)).toBeInTheDocument()
    }
    expect(rule('confirmation')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(PASSWORD_RULES.length + 1)
    expect(screen.getByRole('list')).toHaveAccessibleName('Requisitos da senha')
  })

  it('judges an empty field by each rule, not by a blanket "nothing yet"', () => {
    render(<PasswordRequirements value="" confirmation="" />)

    // Empty genuinely satisfies "at most 128" and "not a common password" —
    // the shared predicate short-circuits empty on purpose. Marking them unmet
    // would be a lie, and would contradict the schema these come from.
    expect(rule('max')).toHaveAttribute('data-met', 'true')
    expect(rule('common')).toHaveAttribute('data-met', 'true')
    expect(rule('min')).toHaveAttribute('data-met', 'false')
    // Two empty fields are equal, but calling that "confirmed" would mislead.
    expect(rule('confirmation')).toHaveAttribute('data-met', 'false')
  })

  it('accepts a valid password', () => {
    render(
      <PasswordRequirements value="uma senha bem comprida" confirmation="uma senha bem comprida" />,
    )

    expect(rule('min')).toHaveAttribute('data-met', 'true')
    expect(rule('max')).toHaveAttribute('data-met', 'true')
    expect(rule('common')).toHaveAttribute('data-met', 'true')
    expect(rule('confirmation')).toHaveAttribute('data-met', 'true')
  })

  it('rejects a password below the minimum', () => {
    render(<PasswordRequirements value={'a'.repeat(PASSWORD_MIN_LENGTH - 1)} confirmation="" />)
    expect(rule('min')).toHaveAttribute('data-met', 'false')
  })

  it('rejects a password above the maximum', () => {
    render(<PasswordRequirements value={'a'.repeat(PASSWORD_MAX_LENGTH + 1)} confirmation="" />)
    expect(rule('max')).toHaveAttribute('data-met', 'false')
    expect(rule('min')).toHaveAttribute('data-met', 'true')
  })

  it('rejects a blocklisted password', () => {
    // 12 characters, so it can only fail on the blocklist rule.
    render(<PasswordRequirements value="inventory123" confirmation="inventory123" />)

    expect(rule('min')).toHaveAttribute('data-met', 'true')
    expect(rule('common')).toHaveAttribute('data-met', 'false')
  })

  it('rejects a mismatched confirmation', () => {
    render(<PasswordRequirements value="uma senha bem comprida" confirmation="outra coisa" />)
    expect(rule('confirmation')).toHaveAttribute('data-met', 'false')
  })

  it('counts spaces towards the length, like the schema does', () => {
    render(<PasswordRequirements value={' '.repeat(PASSWORD_MIN_LENGTH)} confirmation="" />)
    expect(rule('min')).toHaveAttribute('data-met', 'true')
  })

  it('states each rule in text with an accessible status, not by icon or colour alone', () => {
    render(
      <PasswordRequirements value="uma senha bem comprida" confirmation="nao confere" />,
    )

    // Every rule carries its own words...
    for (const { label } of PASSWORD_RULES) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    // ...and a status a screen reader reads out, independent of the icon.
    expect(rule('min')).toHaveTextContent('Requisito atendido')
    expect(rule('confirmation')).toHaveTextContent('Requisito não atendido')
    // The icons themselves are decorative.
    for (const icon of document.querySelectorAll('svg')) {
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('does not put the list in a live region, which would announce every keystroke', () => {
    render(<PasswordRequirements value="uma senha" confirmation="" />)
    expect(screen.getByRole('list')).not.toHaveAttribute('aria-live')
  })

  it('announces only the terminal state, once everything is satisfied', () => {
    const { rerender } = render(<PasswordRequirements value="curta" confirmation="curta" />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()

    rerender(
      <PasswordRequirements value="uma senha bem comprida" confirmation="uma senha bem comprida" />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('A senha atende a todos os requisitos')
  })

  it('never renders the password itself', () => {
    const secret = 'minha-senha-muito-secreta'
    const { container } = render(<PasswordRequirements value={secret} confirmation={secret} />)

    expect(container.innerHTML).not.toContain(secret)
  })

  it('does not carry a second copy of the blocklist', () => {
    const source = readFileSync(
      resolve(__dirname, '../../features/auth/components/PasswordRequirements.tsx'),
      'utf-8',
    )
    // The policy lives in the schema; a copy here would drift from the backend.
    expect(source).toMatch(/import\s*\{[^}]*PASSWORD_RULES[^}]*\}\s*from\s*'@\/schemas\/password\.schema'/)
    // A second blocklist would have to be an array or a Set of literals.
    expect(source).not.toMatch(/new Set\(\s*\[/)
  })
})
