import { Check, Minus } from 'lucide-react'
import { PASSWORD_RULES } from '@/schemas/password.schema'
import { cn } from '@/lib/utils'

interface PasswordRequirementsProps {
  value: string
  confirmation?: string
}

const MET = 'Requisito atendido'
const UNMET = 'Requisito não atendido'
const ALL_MET = 'A senha atende a todos os requisitos'

/**
 * Renders the password policy and which parts of it the current value
 * satisfies — never the value itself.
 *
 * The rules come from PASSWORD_RULES, the same list the Zod schema validates
 * with, which in turn mirrors the backend policy. There is deliberately no
 * second copy of the blocklist here: a copy would drift, and the drift would
 * show up as a form that accepts what the server rejects.
 *
 * Announcements are deliberately restrained. The list is NOT a live region:
 * marking it one would make a screen reader re-read every rule on every
 * keystroke while the user is still typing. The list is a stable structure
 * whose items each carry their own state in words, and a separate status region
 * speaks once, when the password finally satisfies everything.
 */
export function PasswordRequirements({ value, confirmation }: PasswordRequirementsProps) {
  const rules = [
    // Each rule answers for itself. An empty field genuinely satisfies "no
    // more than 128 characters" and "not a common password" — the shared
    // predicate short-circuits empty on purpose — and claiming otherwise would
    // both lie and contradict the schema these rules come from.
    ...PASSWORD_RULES.map((rule) => ({
      id: rule.id,
      label: rule.label,
      met: rule.test(value),
    })),
    ...(confirmation !== undefined
      ? [
          {
            id: 'confirmation',
            // Phrased as an obligation like its siblings: read out unmet, an
            // assertion ("é idêntica … não atendido") contradicts itself.
            label: 'A confirmação deve ser idêntica à senha',
            // Gated on a non-empty password: two empty fields are equal, but
            // calling that "confirmed" would be misleading.
            met: value.length > 0 && value === confirmation,
          },
        ]
      : []),
  ]

  const allMet = rules.every((rule) => rule.met)

  return (
    <div className="space-y-1">
      {/* Named, so a screen-reader user browsing the page meets a labelled
          list rather than four orphan items. Pages should also point the
          field's aria-describedby at this id. */}
      <ul id="password-requirements" role="list" aria-label="Requisitos da senha" className="space-y-1 text-xs">
        {rules.map((rule) => {
          const Icon = rule.met ? Check : Minus
          return (
            <li
              key={rule.id}
              data-testid={`rule-${rule.id}`}
              data-met={rule.met}
              className={cn(
                'flex items-center gap-2',
                rule.met ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground',
              )}
            >
              {/* Decorative: colour and icon are reinforcement, never the only
                  signal. The state below is what a screen reader reads. */}
              <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>{rule.label}</span>
              <span className="sr-only">{rule.met ? MET : UNMET}</span>
            </li>
          )
        })}
      </ul>
      {/* Terminal feedback only — silent while the user is still working. */}
      <p role="status" aria-live="polite" className="sr-only">
        {allMet ? ALL_MET : ''}
      </p>
    </div>
  )
}
