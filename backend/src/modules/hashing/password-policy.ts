export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_POLICY_MESSAGES = {
  type: 'A senha deve ser um texto',
  min: `A senha deve ter no mínimo ${PASSWORD_MIN_LENGTH} caracteres`,
  max: `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres`,
  common: 'Esta senha é muito comum. Escolha uma senha menos previsível',
} as const;

// Extremely common passwords. Compared case-insensitively. Intentionally short:
// the length floor does most of the work, this only blocks the obvious ones.
const COMMON_PASSWORDS = new Set(
  [
    '123456',
    '1234567',
    '12345678',
    '123456789',
    '1234567890',
    '123456789012',
    'password',
    'password1',
    'password123',
    'passw0rd',
    'senha123',
    'senha12345',
    'qwerty',
    'qwerty123',
    'qwertyuiop',
    'admin',
    'admin123',
    'admin@123',
    'admin@123456',
    'administrador',
    'iloveyou',
    'letmein',
    'welcome',
    'welcome123',
    'abc123',
    'abcd1234',
    '111111',
    '000000',
    'inventory',
    'inventory123',
  ].map(p => p.toLowerCase()),
);

/**
 * Validates a password against the policy. Returns the list of violations —
 * an empty array means the password is acceptable.
 *
 * Never logs, never throws on odd input, never mutates the password. In
 * particular it does NOT trim: spaces are legitimate password characters and
 * count toward the length.
 */
export function validatePasswordPolicy(password: unknown): string[] {
  if (typeof password !== 'string') {
    return [PASSWORD_POLICY_MESSAGES.type];
  }

  const violations: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    violations.push(PASSWORD_POLICY_MESSAGES.min);
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    violations.push(PASSWORD_POLICY_MESSAGES.max);
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    violations.push(PASSWORD_POLICY_MESSAGES.common);
  }

  return violations;
}
