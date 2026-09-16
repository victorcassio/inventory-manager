import * as argon2 from 'argon2';
import { createHmac } from 'crypto';
import { validatePasswordPolicy } from '../src/modules/hashing/password-policy';
import { ARGON2_PARAMS } from '../src/modules/hashing/hashing.service';

/**
 * Standalone mirror of HashingService for seed scripts, which run outside the
 * Nest container. Must stay byte-identical to HashingService.deriveMaterial —
 * it imports ARGON2_PARAMS so the parameters cannot drift, and the label below
 * is the same versioned constant.
 */
const PEPPER_LABEL = 'inventory-manager:password:v1';

export function requireSeedPassword(): string {
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    throw new Error(
      'SEED_ADMIN_PASSWORD is not set. Generate one with `openssl rand -base64 24` and export it before seeding. Never commit it.',
    );
  }

  const violations = validatePasswordPolicy(password);
  if (violations.length > 0) {
    throw new Error(`SEED_ADMIN_PASSWORD does not satisfy the password policy: ${violations.join('; ')}`);
  }

  return password;
}

export async function hashSeedPassword(password: string): Promise<string> {
  const pepper = process.env.PASSWORD_PEPPER;
  if (!pepper) {
    throw new Error('PASSWORD_PEPPER is not set — refusing to seed password hashes');
  }

  const material = createHmac('sha256', pepper)
    .update(PEPPER_LABEL)
    .update(password, 'utf8')
    .digest();

  return argon2.hash(material, ARGON2_PARAMS);
}
