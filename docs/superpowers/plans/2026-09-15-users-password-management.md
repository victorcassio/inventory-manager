# Users and Password Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bcrypt with Argon2id + pepper and add admin-driven user creation by e-mail invitation, self-service account activation, password recovery, and authenticated password change — without breaking the existing JWT access/rotating-refresh flow or locking out existing users.

**Architecture:** Three new infrastructure modules (`hashing`, `mail`, `user-action-tokens`) are consumed by an expanded `UsersModule` (admin CRUD + invitations) and `AuthModule` (activation, forgot, reset, change). Action tokens are stored only as SHA-256 digests and consumed by a single conditional `updateMany` so concurrent attempts cannot both win. Existing bcrypt hashes stay valid and are rehashed to Argon2id on the next successful login.

**Tech Stack:** Node 20.19.4, NestJS 10, Prisma 7 + `@prisma/adapter-pg`, PostgreSQL 16, `argon2`, `bcrypt` (verify-only), `nodemailer`, Jest 30 + Supertest; React 18, Vite 6, TanStack Query 5, React Hook Form 7, Zod 3, Zustand 5, Tailwind 3.4 + shadcn/ui, Vitest 2 + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-15-users-password-management-design.md` — read it alongside this plan. Every task argues from it.

## Global Constraints

- **Node 20 is mandatory.** Prefix every npm/npx command with `source ~/.nvm/nvm.sh && nvm use 20.19.4`. The machine default is v16 and breaks Vite/Vitest.
- **Branch:** `feat/users-password-management`. Never commit to `main`. Never push or open a PR without explicit user authorization.
- **Backend port 3003**, Postgres on **5440** (`docker-compose.dev.yml`), API prefix `api/v1`.
- **Argon2id parameters, exact:** `memoryCost: 65536`, `timeCost: 3`, `parallelism: 1`, `hashLength: 32`, `type: argon2.argon2id`.
- **HMAC label, exact and never changed silently:** `inventory-manager:password:v1`.
- **Password policy:** min 12, max 128 characters, counted on the raw string. No `trim()`. No truncation. Spaces and Unicode allowed. No character-class requirements. Blocklist includes `123456`, `password`, `Admin@123456`.
- **bcrypt verifies the RAW password** (`bcrypt.compare(rawPassword, storedHash)`) because legacy hashes were made from it. Argon2id verifies the **HMAC-derived material**. Never mix the two.
- **Never** log, audit, return, or persist: a password, a pepper, a raw action token, a dummy hash, or which algorithm a row uses.
- **Invitation TTL: 24 hours. Password-reset TTL: 30 minutes.** Both single-use.
- **Generic messages, verbatim:**
  - Login failure: `Email ou senha inválidos`
  - Any action-token defect: `Link inválido ou expirado`
  - Forgot-password success: `Se o e-mail estiver cadastrado, enviaremos as instruções para redefinição da senha.`
  - Frontend unexpected/network error: `Não foi possível processar a solicitação agora. Tente novamente.`
  - Frontend create success: `Usuário criado. Um convite foi enviado para que ele valide o e-mail e defina sua senha.`
  - Frontend create with mail failure: `Usuário criado, mas o convite não pôde ser enviado. Use 'Reenviar convite' na lista.`
- **Email links use the URL fragment, never the query string:** `{FRONTEND_URL}/activate-account#token={rawToken}`, `{FRONTEND_URL}/reset-password#token={rawToken}`.
- **`PASSWORD_PEPPER` validation:** presence and ≥32 characters enforced in **every** environment (consistent with how `app.config.ts:16-22` already treats the JWT secrets); the placeholder-pattern check runs in production only. This is one notch stricter than the spec's wording and is intentional.
- **Do not edit existing migrations.** One new migration directory only.
- **Existing tests must keep passing:** backend 215 tests / 11 suites, frontend 193 tests / 27 suites.

## Deviations From the Spec

One file in the spec's frontend inventory has no task: `features/auth/hooks/usePasswordFlows.ts`.
It is intentionally dropped. Task 17 passes `authApi.activateAccount` / `authApi.resetPassword`
directly into the shared `SetPasswordForm`, and error classification lives in
`features/auth/lib/apiErrors.ts`, so the hook would wrap a single call and add nothing. Everything
else in the spec's inventory is built. If you reach for that hook, you have taken a wrong turn.

## Task Seam

Tasks 1–13 are backend and are independently shippable and testable. Tasks 14–19 are frontend and depend only on the HTTP contracts frozen in Tasks 7, 8 and 12. Task 20 is documentation and depends on everything.

---

## Phase 1 — Infrastructure

### Task 1: Dependencies and configuration validation

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/src/config/app.config.ts`
- Modify: `backend/.env.example`
- Modify: `backend/.env` (local only, gitignored)
- Test: `backend/src/config/app.config.spec.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: config keys `app.passwordPepper` (string), `app.mail.driver` (`'smtp' | 'fake'`), `app.mail.smtp` (`{ host, port, secure, user, password, from }`), `app.frontendUrl` (already exists).

- [ ] **Step 1: Install dependencies**

```bash
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npm install argon2 nodemailer
npm install --save-dev @types/nodemailer
```

`bcrypt` and `@types/bcrypt` stay installed — they are still needed to verify legacy hashes.

- [ ] **Step 2: Write the failing config test**

Create `backend/src/config/app.config.spec.ts`:

```ts
import appConfig from './app.config';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://u:p@localhost:5440/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  PASSWORD_PEPPER: 'c'.repeat(48),
};

describe('appConfig', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...BASE_ENV } as any;
  });

  afterAll(() => {
    process.env = original;
  });

  it('exposes the pepper and a fake mail driver outside production', () => {
    const cfg = appConfig();
    expect(cfg.passwordPepper).toBe('c'.repeat(48));
    expect(cfg.mail.driver).toBe('fake');
  });

  it('throws when PASSWORD_PEPPER is missing', () => {
    delete process.env.PASSWORD_PEPPER;
    expect(() => appConfig()).toThrow(/PASSWORD_PEPPER/);
  });

  it('throws when PASSWORD_PEPPER is shorter than 32 characters', () => {
    process.env.PASSWORD_PEPPER = 'short';
    expect(() => appConfig()).toThrow(/at least 32 characters/);
  });

  it('rejects a placeholder pepper in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.PASSWORD_PEPPER = 'changeme-changeme-changeme-changeme';
    process.env.MAIL_DRIVER = 'smtp';
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASSWORD = 'pass';
    process.env.SMTP_FROM = 'no-reply@example.com';
    expect(() => appConfig()).toThrow(/insecure placeholder/);
  });

  it('refuses the fake mail driver in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.MAIL_DRIVER = 'fake';
    expect(() => appConfig()).toThrow(/MAIL_DRIVER/);
  });

  it('requires the full SMTP set in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.MAIL_DRIVER = 'smtp';
    expect(() => appConfig()).toThrow(/SMTP_HOST/);
  });

  it('never returns the pepper under a key that looks loggable', () => {
    const cfg = appConfig();
    expect(JSON.stringify(cfg)).toContain('passwordPepper');
    expect(cfg.mail.smtp.password).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

```bash
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx jest --config jest.config.ts src/config/app.config.spec.ts
```

Expected: FAIL — `cfg.passwordPepper` is `undefined` and `cfg.mail` does not exist.

- [ ] **Step 4: Implement the config changes**

Replace the body of `backend/src/config/app.config.ts` with:

```ts
import { registerAs } from '@nestjs/config';

export default registerAs('app', () => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';

  const required = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'PASSWORD_PEPPER',
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  const minLength: Record<string, number> = {
    JWT_ACCESS_SECRET: 32,
    JWT_REFRESH_SECRET: 32,
    PASSWORD_PEPPER: 32,
  };

  for (const [key, min] of Object.entries(minLength)) {
    if ((process.env[key] ?? '').length < min) {
      throw new Error(`${key} must be at least ${min} characters`);
    }
  }

  // Fail if running in production with obviously insecure placeholder secrets
  const insecurePatterns = ['secret', 'test', 'example', 'changeme', 'placeholder'];
  if (isProduction) {
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'PASSWORD_PEPPER']) {
      const val = (process.env[key] ?? '').toLowerCase();
      if (insecurePatterns.some(p => val.includes(p))) {
        throw new Error(`${key} contains an insecure placeholder value. Generate a strong random secret for production.`);
      }
    }
  }

  const mailDriver = process.env.MAIL_DRIVER ?? (isProduction ? 'smtp' : 'fake');

  if (isProduction) {
    if (mailDriver !== 'smtp') {
      throw new Error('MAIL_DRIVER must be "smtp" in production — a real mail provider is required to deliver invitations and password resets');
    }
    for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM']) {
      if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
      }
    }
  }

  if (mailDriver !== 'smtp' && mailDriver !== 'fake') {
    throw new Error(`Unknown MAIL_DRIVER "${mailDriver}" — expected "smtp" or "fake"`);
  }

  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    nodeEnv,
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    passwordPepper: process.env.PASSWORD_PEPPER as string,
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET,
      refreshSecret: process.env.JWT_REFRESH_SECRET,
      accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    },
    mail: {
      driver: mailDriver as 'smtp' | 'fake',
      smtp: {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT ?? '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER,
        password: process.env.SMTP_PASSWORD,
        from: process.env.SMTP_FROM ?? 'no-reply@inventory.local',
      },
    },
  };
});
```

Note the last assertion in the test: `cfg.mail.smtp.password` is `undefined` in the test env because `SMTP_PASSWORD` is unset there. That assertion exists to catch someone adding a default credential.

- [ ] **Step 5: Add the env keys**

Append to `backend/.env.example` (no real values, ever):

```env
# Password hashing — generate with: openssl rand -base64 48
PASSWORD_PEPPER=

# Mail — "fake" logs instead of sending; production requires "smtp"
MAIL_DRIVER=fake
SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

# Development seed password (must satisfy the password policy)
SEED_ADMIN_PASSWORD=
```

Then set a real local value in the gitignored `backend/.env` so the app still boots in development:

```bash
cd /home/userterras/Documents/inventory-manager/backend
printf '\n# Local development only\nPASSWORD_PEPPER=%s\nMAIL_DRIVER=fake\n' "$(openssl rand -base64 48 | tr -d '\n')" >> .env
```

- [ ] **Step 6: Run the config test and the full backend suite**

```bash
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx jest --config jest.config.ts src/config/app.config.spec.ts
npm run test
```

Expected: the new suite PASSES; all 215 pre-existing tests still pass.

- [ ] **Step 7: Commit**

```bash
cd /home/userterras/Documents/inventory-manager
git checkout -b feat/users-password-management
git add backend/package.json backend/package-lock.json backend/src/config/app.config.ts backend/src/config/app.config.spec.ts backend/.env.example
git commit -m "$(cat <<'MSG'
feat(config): require PASSWORD_PEPPER and mail configuration

Adds argon2 + nodemailer, makes PASSWORD_PEPPER a required env var with a
32-character floor in every environment, and refuses to boot in production
with a placeholder pepper or a fake mail driver.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: HashingService and password policy

**Files:**
- Create: `backend/src/modules/hashing/hashing.module.ts`
- Create: `backend/src/modules/hashing/hashing.service.ts`
- Create: `backend/src/modules/hashing/password-policy.ts`
- Create: `backend/src/modules/hashing/is-strong-password.validator.ts`
- Create: `backend/src/modules/hashing/is-equal-to.validator.ts`
- Test: `backend/src/modules/hashing/hashing.service.spec.ts`
- Test: `backend/src/modules/hashing/password-policy.spec.ts`

**Interfaces:**
- Consumes: `app.passwordPepper` from Task 1.
- Produces:
  - `ARGON2_PARAMS` constant.
  - `HashingService.hash(password: string): Promise<string>`
  - `HashingService.verify(storedHash: string, password: string): Promise<{ valid: boolean; needsRehash: boolean }>`
  - `HashingService.isBcryptHash(hash: string): boolean`
  - `HashingService.verifyDummy(password: string): Promise<false>`
  - `validatePasswordPolicy(password: unknown): string[]` — returns violation messages, empty array when valid.
  - `PASSWORD_POLICY_MESSAGES` constant.
  - `@IsStrongPassword()` and `@IsEqualTo('otherField')` class-validator decorators.
  - `HashingModule` exporting `HashingService`.

- [ ] **Step 1: Write the failing policy test**

Create `backend/src/modules/hashing/password-policy.spec.ts`:

```ts
import { validatePasswordPolicy } from './password-policy';

describe('validatePasswordPolicy', () => {
  it('accepts a 12-character password', () => {
    expect(validatePasswordPolicy('abcdefghijkl')).toEqual([]);
  });

  it('rejects an 11-character password', () => {
    expect(validatePasswordPolicy('abcdefghijk')).toContain(
      'A senha deve ter no mínimo 12 caracteres',
    );
  });

  it('rejects a password longer than 128 characters', () => {
    expect(validatePasswordPolicy('a'.repeat(129))).toContain(
      'A senha deve ter no máximo 128 caracteres',
    );
  });

  it('accepts a long passphrase with spaces', () => {
    expect(validatePasswordPolicy('cavalo de batalha azul e quadrado')).toEqual([]);
  });

  it('accepts Unicode characters', () => {
    expect(validatePasswordPolicy('çãoÇÃO-ñ-日本語-ok')).toEqual([]);
  });

  it('does not trim — leading and trailing spaces count toward the length', () => {
    // 10 visible chars + 2 spaces = 12 → valid only if spaces are counted
    expect(validatePasswordPolicy(' abcdefghij ')).toEqual([]);
  });

  it('rejects blocklisted passwords regardless of case', () => {
    for (const weak of ['123456', 'password', 'Admin@123456', 'PASSWORD']) {
      expect(validatePasswordPolicy(weak).length).toBeGreaterThan(0);
    }
  });

  it('does not require mixed character classes', () => {
    expect(validatePasswordPolicy('aaaaaaaaaaaaaaaa')).toEqual([]);
  });

  it('rejects non-string input without throwing', () => {
    expect(validatePasswordPolicy(undefined).length).toBeGreaterThan(0);
    expect(validatePasswordPolicy(12345678901234).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx jest --config jest.config.ts src/modules/hashing/password-policy.spec.ts
```

Expected: FAIL — `Cannot find module './password-policy'`.

- [ ] **Step 3: Implement the policy**

Create `backend/src/modules/hashing/password-policy.ts`:

```ts
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
```

- [ ] **Step 4: Run the policy test**

```bash
npx jest --config jest.config.ts src/modules/hashing/password-policy.spec.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Write the failing hashing test**

Create `backend/src/modules/hashing/hashing.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { HashingService } from './hashing.service';

const TEST_PEPPER = 'test-only-pepper-with-at-least-32-chars';

function moduleWith(pepper: string | undefined) {
  return Test.createTestingModule({
    providers: [
      HashingService,
      {
        provide: ConfigService,
        useValue: { get: jest.fn().mockReturnValue(pepper) },
      },
    ],
  }).compile();
}

describe('HashingService', () => {
  let service: HashingService;

  beforeEach(async () => {
    const module: TestingModule = await moduleWith(TEST_PEPPER);
    service = module.get(HashingService);
    await service.onModuleInit();
  });

  describe('hash', () => {
    it('produces an argon2id PHC string', async () => {
      const hash = await service.hash('uma senha bem comprida');
      expect(hash.startsWith('$argon2id$')).toBe(true);
      expect(hash).toContain('m=65536,p=1,t=3');
    });

    it('produces different hashes for the same password (random salt)', async () => {
      const [a, b] = await Promise.all([
        service.hash('uma senha bem comprida'),
        service.hash('uma senha bem comprida'),
      ]);
      expect(a).not.toBe(b);
    });

    it('rejects a password that violates the policy', async () => {
      await expect(service.hash('curta')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('never puts the password in the thrown error', async () => {
      await expect(service.hash('curta')).rejects.not.toThrow(/curta/);
    });
  });

  describe('verify', () => {
    it('accepts the correct password', async () => {
      const hash = await service.hash('uma senha bem comprida');
      await expect(service.verify(hash, 'uma senha bem comprida')).resolves.toEqual({
        valid: true,
        needsRehash: false,
      });
    });

    it('rejects an incorrect password', async () => {
      const hash = await service.hash('uma senha bem comprida');
      const result = await service.verify(hash, 'outra senha bem comprida');
      expect(result.valid).toBe(false);
    });

    it('verifies legacy bcrypt hashes against the raw password and flags a rehash', async () => {
      const legacy = await bcrypt.hash('Admin@123456', 12);
      await expect(service.verify(legacy, 'Admin@123456')).resolves.toEqual({
        valid: true,
        needsRehash: true,
      });
    });

    it('rejects a wrong password against a bcrypt hash', async () => {
      const legacy = await bcrypt.hash('Admin@123456', 12);
      const result = await service.verify(legacy, 'errada');
      expect(result.valid).toBe(false);
    });

    it('does not flag a rehash for argon2id hashes', async () => {
      const hash = await service.hash('uma senha bem comprida');
      const result = await service.verify(hash, 'uma senha bem comprida');
      expect(result.needsRehash).toBe(false);
    });

    it('returns invalid instead of throwing on a malformed hash', async () => {
      await expect(service.verify('not-a-hash', 'uma senha bem comprida')).resolves.toEqual({
        valid: false,
        needsRehash: false,
      });
    });

    it('accepts a password that predates the policy (verification is not gated by policy)', async () => {
      const legacy = await bcrypt.hash('short', 12);
      const result = await service.verify(legacy, 'short');
      expect(result.valid).toBe(true);
    });
  });

  describe('isBcryptHash', () => {
    it.each(['$2a$12$abc', '$2b$12$abc', '$2y$12$abc'])('detects %s', prefix => {
      expect(service.isBcryptHash(prefix)).toBe(true);
    });

    it('does not flag argon2id', async () => {
      const hash = await service.hash('uma senha bem comprida');
      expect(service.isBcryptHash(hash)).toBe(false);
    });
  });

  describe('verifyDummy', () => {
    it('always resolves to false', async () => {
      await expect(service.verifyDummy('qualquer coisa')).resolves.toBe(false);
    });

    it('computes the dummy hash once at startup, not per call', async () => {
      const first = (service as any).dummyHash;
      await service.verifyDummy('a');
      await service.verifyDummy('b');
      expect((service as any).dummyHash).toBe(first);
    });

    it('produces an argon2id dummy hash with the same parameters', () => {
      const dummy = (service as any).dummyHash as string;
      expect(dummy.startsWith('$argon2id$')).toBe(true);
      expect(dummy).toContain('m=65536,p=1,t=3');
    });
  });

  describe('missing pepper', () => {
    it('fails in a controlled way when the pepper is absent', async () => {
      const module = await moduleWith(undefined);
      const unpeppered = module.get(HashingService);
      await expect(unpeppered.onModuleInit()).rejects.toThrow(/PASSWORD_PEPPER/);
    });

    it('does not hash when the pepper is absent', async () => {
      const module = await moduleWith(undefined);
      const unpeppered = module.get(HashingService);
      await expect(unpeppered.hash('uma senha bem comprida')).rejects.toThrow(/PASSWORD_PEPPER/);
    });
  });
});
```

- [ ] **Step 6: Run it to make sure it fails**

```bash
npx jest --config jest.config.ts src/modules/hashing/hashing.service.spec.ts
```

Expected: FAIL — `Cannot find module './hashing.service'`.

- [ ] **Step 7: Implement HashingService**

Create `backend/src/modules/hashing/hashing.service.ts`:

```ts
import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcrypt';
import { createHmac, randomBytes } from 'crypto';
import { validatePasswordPolicy } from './password-policy';

/**
 * Argon2id parameters. Centralized so they can be tuned in one place.
 * Changing these keeps existing hashes verifiable — the parameters travel
 * inside each PHC string.
 */
export const ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 65_536, // KiB
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;

/**
 * Domain-separation label for the pepper HMAC. VERSIONED ON PURPOSE.
 * Changing "v1" invalidates every stored hash — a rotation requires a
 * password_hash_version column and a dual-verify window. See the spec.
 */
const PEPPER_LABEL = 'inventory-manager:password:v1';

const BCRYPT_PREFIXES = ['$2a$', '$2b$', '$2y$'];

export interface VerifyResult {
  valid: boolean;
  /** True only for legacy bcrypt hashes that should be upgraded to Argon2id. */
  needsRehash: boolean;
}

@Injectable()
export class HashingService implements OnModuleInit {
  /**
   * Precomputed at startup so that authentication paths with no eligible
   * stored password can still pay the Argon2id cost. Never persisted, never
   * logged, never recomputed per request.
   */
  private dummyHash: string | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const throwaway = randomBytes(32).toString('base64');
    this.dummyHash = await argon2.hash(this.deriveMaterial(throwaway), ARGON2_PARAMS);
  }

  async hash(password: string): Promise<string> {
    const violations = validatePasswordPolicy(password);
    if (violations.length > 0) {
      // The password itself never appears in the exception.
      throw new BadRequestException(violations);
    }
    return argon2.hash(this.deriveMaterial(password), ARGON2_PARAMS);
  }

  async verify(storedHash: string, password: string): Promise<VerifyResult> {
    if (typeof storedHash !== 'string' || storedHash.length === 0) {
      return { valid: false, needsRehash: false };
    }

    try {
      if (this.isBcryptHash(storedHash)) {
        // Legacy hashes were produced from the RAW password, not the HMAC
        // material — they must be compared the same way they were created.
        const valid = await bcrypt.compare(password, storedHash);
        return { valid, needsRehash: valid };
      }

      const valid = await argon2.verify(storedHash, this.deriveMaterial(password));
      return { valid, needsRehash: false };
    } catch {
      // Malformed or unrecognized hash — indistinguishable from a wrong password.
      return { valid: false, needsRehash: false };
    }
  }

  isBcryptHash(hash: string): boolean {
    return typeof hash === 'string' && BCRYPT_PREFIXES.some(p => hash.startsWith(p));
  }

  /**
   * Best-effort timing mitigation. Verifies against the startup dummy hash so
   * that "no such user", "inactive", "unverified" and "no password" cost
   * roughly the same as a real verification. Always resolves to false.
   */
  async verifyDummy(password: string): Promise<false> {
    if (!this.dummyHash) {
      await this.onModuleInit();
    }
    try {
      await argon2.verify(this.dummyHash as string, this.deriveMaterial(password));
    } catch {
      // expected and ignored
    }
    return false;
  }

  /**
   * The single transformation applied before Argon2id. Used by hash(),
   * verify() and verifyDummy() so they can never drift apart.
   */
  private deriveMaterial(password: string): Buffer {
    const pepper = this.configService.get<string>('app.passwordPepper');
    if (!pepper) {
      throw new Error('PASSWORD_PEPPER is not configured — refusing to hash or verify passwords');
    }
    return createHmac('sha256', pepper)
      .update(PEPPER_LABEL)
      .update(password, 'utf8')
      .digest();
  }
}
```

The HMAC digest is 32 bytes, well under bcrypt's 72-byte truncation limit — but note that limit only ever applied to the legacy path, which uses the raw password.

- [ ] **Step 8: Run the hashing test**

```bash
npx jest --config jest.config.ts src/modules/hashing/hashing.service.spec.ts
```

Expected: PASS. Argon2id at 64 MiB is deliberately slow; this suite takes roughly 10–20 seconds.

- [ ] **Step 9: Add the class-validator decorators**

Create `backend/src/modules/hashing/is-strong-password.validator.ts`:

```ts
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { validatePasswordPolicy } from './password-policy';

export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return validatePasswordPolicy(value).length === 0;
        },
        defaultMessage(args: ValidationArguments) {
          // Returns the rule text only — never the submitted value.
          return validatePasswordPolicy(args.value).join('; ');
        },
      },
    });
  };
}
```

Create `backend/src/modules/hashing/is-equal-to.validator.ts`:

```ts
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

export function IsEqualTo(property: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isEqualTo',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints as [string];
          const related = (args.object as Record<string, unknown>)[relatedPropertyName];
          return value === related;
        },
        defaultMessage() {
          return 'A confirmação não corresponde à senha';
        },
      },
    });
  };
}
```

Create `backend/src/modules/hashing/hashing.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HashingService } from './hashing.service';

@Module({
  providers: [HashingService],
  exports: [HashingService],
})
export class HashingModule {}
```

- [ ] **Step 10: Run both new suites plus the whole backend suite**

```bash
npx jest --config jest.config.ts src/modules/hashing
npm run test
```

Expected: both new suites PASS; the 215 pre-existing tests still pass.

- [ ] **Step 11: Commit**

```bash
cd /home/userterras/Documents/inventory-manager
git add backend/src/modules/hashing
git commit -m "$(cat <<'MSG'
feat(hashing): add Argon2id hashing service with pepper and password policy

Centralizes Argon2id parameters and the HMAC-SHA-256 pepper derivation so
hash and verify cannot drift. Legacy bcrypt hashes verify against the raw
password and report needsRehash. A startup-precomputed dummy hash backs
best-effort login timing mitigation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: MailModule with fake and SMTP drivers

**Files:**
- Create: `backend/src/modules/mail/mail.module.ts`
- Create: `backend/src/modules/mail/mail.service.ts`
- Create: `backend/src/modules/mail/smtp-mail.service.ts`
- Create: `backend/src/modules/mail/fake-mail.service.ts`
- Create: `backend/src/modules/mail/templates/invitation.template.ts`
- Create: `backend/src/modules/mail/templates/password-reset.template.ts`
- Test: `backend/src/modules/mail/fake-mail.service.spec.ts`
- Test: `backend/src/modules/mail/templates/templates.spec.ts`

**Interfaces:**
- Consumes: `app.mail.*` and `app.frontendUrl` from Task 1.
- Produces:
  - `MAIL_SERVICE` injection token.
  - `interface MailService { send(message: MailMessage): Promise<void> }`
  - `type MailMessage = { to: string; subject: string; html: string; text: string }`
  - `FakeMailService.sent: MailMessage[]` and `FakeMailService.reset(): void` (test-only inspection).
  - `buildInvitationEmail({ name, activationUrl }): MailMessage['subject' | 'html' | 'text']` shape → `{ subject, html, text }`
  - `buildPasswordResetEmail({ name, resetUrl }): { subject, html, text }`
  - `MailModule` exporting `MAIL_SERVICE`.

- [ ] **Step 1: Write the failing template test**

Create `backend/src/modules/mail/templates/templates.spec.ts`:

```ts
import { buildInvitationEmail } from './invitation.template';
import { buildPasswordResetEmail } from './password-reset.template';

describe('mail templates', () => {
  const activationUrl = 'http://localhost:5173/activate-account#token=RAW_TOKEN_VALUE';
  const resetUrl = 'http://localhost:5173/reset-password#token=RAW_TOKEN_VALUE';

  describe('buildInvitationEmail', () => {
    const mail = buildInvitationEmail({ name: 'Maria Silva', activationUrl });

    it('is written in Portuguese', () => {
      expect(mail.subject).toMatch(/convite|acesso/i);
      expect(mail.text).toMatch(/senha/i);
    });

    it('includes the activation link in both parts', () => {
      expect(mail.html).toContain(activationUrl);
      expect(mail.text).toContain(activationUrl);
    });

    it('greets the invited user by name', () => {
      expect(mail.text).toContain('Maria Silva');
    });

    it('states the 24-hour validity', () => {
      expect(mail.text).toMatch(/24 horas/);
    });

    it('does not contain a provisional password', () => {
      expect(mail.text.toLowerCase()).not.toMatch(/senha provis|senha tempor|sua senha é/);
      expect(mail.html.toLowerCase()).not.toMatch(/senha provis|senha tempor|sua senha é/);
    });

    it('escapes the user name so it cannot inject markup', () => {
      const hostile = buildInvitationEmail({
        name: '<script>alert(1)</script>',
        activationUrl,
      });
      expect(hostile.html).not.toContain('<script>');
      expect(hostile.html).toContain('&lt;script&gt;');
    });
  });

  describe('buildPasswordResetEmail', () => {
    const mail = buildPasswordResetEmail({ name: 'Maria Silva', resetUrl });

    it('includes the reset link', () => {
      expect(mail.html).toContain(resetUrl);
      expect(mail.text).toContain(resetUrl);
    });

    it('states the 30-minute validity', () => {
      expect(mail.text).toMatch(/30 minutos/);
    });

    it('tells the recipient to ignore it if they did not ask', () => {
      expect(mail.text.toLowerCase()).toContain('ignore');
    });

    it('does not contain a provisional password', () => {
      expect(mail.text.toLowerCase()).not.toMatch(/senha provis|senha tempor|sua senha é/);
    });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx jest --config jest.config.ts src/modules/mail
```

Expected: FAIL — `Cannot find module './invitation.template'`.

- [ ] **Step 3: Implement the templates**

Create `backend/src/modules/mail/templates/invitation.template.ts`:

```ts
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface InvitationEmailData {
  name: string;
  activationUrl: string;
}

export function buildInvitationEmail({ name, activationUrl }: InvitationEmailData) {
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(activationUrl);

  const subject = 'Convite de acesso — Inventory Manager';

  const text = [
    `Olá, ${name}!`,
    '',
    'Você recebeu um convite para acessar o Inventory Manager.',
    'Para concluir o cadastro, confirme seu e-mail e defina sua senha no link abaixo:',
    '',
    activationUrl,
    '',
    'O link é válido por 24 horas e pode ser usado uma única vez.',
    'Se você não esperava este convite, ignore esta mensagem.',
    '',
    'Inventory Manager',
  ].join('\n');

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 15px; color: #111; line-height: 1.6;">
      <p>Olá, ${safeName}!</p>
      <p>Você recebeu um convite para acessar o <strong>Inventory Manager</strong>.</p>
      <p>Para concluir o cadastro, confirme seu e-mail e defina sua senha:</p>
      <p>
        <a href="${safeUrl}" style="display: inline-block; padding: 10px 18px; background: #0f172a; color: #fff; border-radius: 6px; text-decoration: none;">
          Definir minha senha
        </a>
      </p>
      <p style="font-size: 13px; color: #555;">
        Ou copie e cole este endereço no navegador:<br />
        <span style="word-break: break-all;">${safeUrl}</span>
      </p>
      <p style="font-size: 13px; color: #555;">
        O link é válido por <strong>24 horas</strong> e pode ser usado uma única vez.
        Se você não esperava este convite, ignore esta mensagem.
      </p>
      <p style="font-size: 13px; color: #555;">Inventory Manager</p>
    </div>
  `.trim();

  return { subject, html, text };
}
```

Create `backend/src/modules/mail/templates/password-reset.template.ts`:

```ts
import { escapeHtml } from './invitation.template';

export interface PasswordResetEmailData {
  name: string;
  resetUrl: string;
}

export function buildPasswordResetEmail({ name, resetUrl }: PasswordResetEmailData) {
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(resetUrl);

  const subject = 'Redefinição de senha — Inventory Manager';

  const text = [
    `Olá, ${name}!`,
    '',
    'Recebemos uma solicitação para redefinir a senha da sua conta no Inventory Manager.',
    'Se foi você, use o link abaixo para escolher uma nova senha:',
    '',
    resetUrl,
    '',
    'O link é válido por 30 minutos e pode ser usado uma única vez.',
    'Se você não solicitou a redefinição, ignore esta mensagem — sua senha atual continua valendo.',
    '',
    'Inventory Manager',
  ].join('\n');

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 15px; color: #111; line-height: 1.6;">
      <p>Olá, ${safeName}!</p>
      <p>Recebemos uma solicitação para redefinir a senha da sua conta no <strong>Inventory Manager</strong>.</p>
      <p>
        <a href="${safeUrl}" style="display: inline-block; padding: 10px 18px; background: #0f172a; color: #fff; border-radius: 6px; text-decoration: none;">
          Redefinir minha senha
        </a>
      </p>
      <p style="font-size: 13px; color: #555;">
        Ou copie e cole este endereço no navegador:<br />
        <span style="word-break: break-all;">${safeUrl}</span>
      </p>
      <p style="font-size: 13px; color: #555;">
        O link é válido por <strong>30 minutos</strong> e pode ser usado uma única vez.
        Se você não solicitou a redefinição, ignore esta mensagem — sua senha atual continua valendo.
      </p>
      <p style="font-size: 13px; color: #555;">Inventory Manager</p>
    </div>
  `.trim();

  return { subject, html, text };
}
```

- [ ] **Step 4: Run the template test**

```bash
npx jest --config jest.config.ts src/modules/mail/templates/templates.spec.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Write the failing fake-driver test**

Create `backend/src/modules/mail/fake-mail.service.spec.ts`:

```ts
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FakeMailService } from './fake-mail.service';

const MESSAGE = {
  to: 'maria@example.com',
  subject: 'Convite de acesso — Inventory Manager',
  html: '<a href="http://localhost:5173/activate-account#token=SECRET_TOKEN">x</a>',
  text: 'http://localhost:5173/activate-account#token=SECRET_TOKEN',
};

function serviceFor(nodeEnv: string) {
  const config = { get: jest.fn().mockReturnValue(nodeEnv) } as unknown as ConfigService;
  return new FakeMailService(config);
}

describe('FakeMailService', () => {
  describe('in the test environment', () => {
    it('keeps sent messages in memory for inspection', async () => {
      const service = serviceFor('test');
      await service.send(MESSAGE);
      expect(service.sent).toHaveLength(1);
      expect(service.sent[0].to).toBe('maria@example.com');
    });

    it('reset() clears the inspector', async () => {
      const service = serviceFor('test');
      await service.send(MESSAGE);
      service.reset();
      expect(service.sent).toHaveLength(0);
    });
  });

  describe('in development', () => {
    it('does not retain messages in memory', async () => {
      const service = serviceFor('development');
      await service.send(MESSAGE);
      expect(service.sent).toHaveLength(0);
    });

    it('logs the recipient and subject but never the token or the URL', async () => {
      const service = serviceFor('development');
      const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

      await service.send(MESSAGE);

      expect(spy).toHaveBeenCalledTimes(1);
      const logged = String(spy.mock.calls[0][0]);
      expect(logged).toContain('maria@example.com');
      expect(logged).toContain('Convite de acesso');
      expect(logged).not.toContain('SECRET_TOKEN');
      expect(logged).not.toContain('#token=');
      expect(logged).not.toContain('activate-account');

      spy.mockRestore();
    });
  });
});
```

- [ ] **Step 6: Run it to make sure it fails**

```bash
npx jest --config jest.config.ts src/modules/mail/fake-mail.service.spec.ts
```

Expected: FAIL — `Cannot find module './fake-mail.service'`.

- [ ] **Step 7: Implement the mail interface and both drivers**

Create `backend/src/modules/mail/mail.service.ts`:

```ts
export const MAIL_SERVICE = 'MAIL_SERVICE';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Provider-agnostic mail abstraction. Swapping providers means adding an
 * implementation and changing the MailModule factory — no domain service
 * touches a transport.
 */
export interface MailService {
  send(message: MailMessage): Promise<void>;
}
```

Create `backend/src/modules/mail/fake-mail.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailMessage, MailService } from './mail.service';

/**
 * Non-sending driver for development and tests.
 *
 * In tests it retains messages so a spec can read the activation link.
 * Everywhere else it retains nothing and logs only the recipient, the subject
 * and a fixed marker — never a token, never a URL.
 */
@Injectable()
export class FakeMailService implements MailService {
  private readonly logger = new Logger(FakeMailService.name);
  private readonly messages: MailMessage[] = [];

  constructor(private readonly configService: ConfigService) {}

  get sent(): MailMessage[] {
    return this.messages;
  }

  reset(): void {
    this.messages.length = 0;
  }

  async send(message: MailMessage): Promise<void> {
    if (this.isTestEnv()) {
      this.messages.push(message);
      return;
    }

    this.logger.log(`[mail:fake] destinatário=${message.to} assunto="${message.subject}" (conteúdo omitido)`);
  }

  private isTestEnv(): boolean {
    return (this.configService.get<string>('app.nodeEnv') ?? process.env.NODE_ENV) === 'test';
  }
}
```

Create `backend/src/modules/mail/smtp-mail.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailMessage, MailService } from './mail.service';

@Injectable()
export class SmtpMailService implements MailService {
  private readonly logger = new Logger(SmtpMailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  async send(message: MailMessage): Promise<void> {
    const from = this.configService.get<string>('app.mail.smtp.from');

    await this.getTransporter().sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }

  private getTransporter(): nodemailer.Transporter {
    if (this.transporter) return this.transporter;

    const smtp = this.configService.get<{
      host: string;
      port: number;
      secure: boolean;
      user: string;
      password: string;
    }>('app.mail.smtp');

    this.transporter = nodemailer.createTransport({
      host: smtp?.host,
      port: smtp?.port,
      secure: smtp?.secure,
      auth: smtp?.user ? { user: smtp.user, pass: smtp.password } : undefined,
    });

    return this.transporter;
  }
}
```

Create `backend/src/modules/mail/mail.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAIL_SERVICE } from './mail.service';
import { FakeMailService } from './fake-mail.service';
import { SmtpMailService } from './smtp-mail.service';

@Module({
  providers: [
    FakeMailService,
    SmtpMailService,
    {
      provide: MAIL_SERVICE,
      inject: [ConfigService, FakeMailService, SmtpMailService],
      useFactory: (
        configService: ConfigService,
        fake: FakeMailService,
        smtp: SmtpMailService,
      ) => (configService.get<string>('app.mail.driver') === 'smtp' ? smtp : fake),
    },
  ],
  exports: [MAIL_SERVICE, FakeMailService],
})
export class MailModule {}
```

`FakeMailService` is exported as a concrete class as well, so the e2e spec can pull it out of the Nest container and read the activation link. In production it is never selected, and `app.config.ts` (Task 1) refuses to boot with `MAIL_DRIVER=fake`.

- [ ] **Step 8: Run the mail suites and the full backend suite**

```bash
npx jest --config jest.config.ts src/modules/mail
npm run test
```

Expected: both mail suites PASS; the 215 pre-existing tests still pass.

- [ ] **Step 9: Commit**

```bash
cd /home/userterras/Documents/inventory-manager
git add backend/src/modules/mail
git commit -m "$(cat <<'MSG'
feat(mail): add provider-agnostic mail abstraction with fake and SMTP drivers

Templates are pt-BR, escape user-supplied names, carry no provisional
password, and link via the URL fragment. The fake driver retains messages
only under NODE_ENV=test and never logs a token or URL.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: Prisma schema and migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_user_invitations_and_password_tokens/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `User.password: string | null`, `User.emailVerifiedAt`, `User.passwordSetAt`, `User.passwordChangedAt`, `User.actionTokens`, model `UserActionToken`, enum `UserActionTokenType { invitation, password_reset }`.

- [ ] **Step 1: Start the database and check for e-mail conflicts before writing anything**

```bash
docker-compose -f /home/userterras/Documents/inventory-manager/docker-compose.dev.yml up -d postgres
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx prisma db execute --stdin <<'SQL'
SELECT lower(btrim(email)) AS normalized, count(*)
FROM users
GROUP BY lower(btrim(email))
HAVING count(*) > 1;
SQL
```

Expected: no rows.

**This is a hard gate.** If any row comes back: do **not** modify, merge or delete a single user.
Stop the task, report the conflicting normalized addresses and the affected user ids, and wait for
explicit resolution from the human partner before continuing. The migration is designed to abort in
this situation and must never be worked around, and the same preflight must be run against any
persistent environment before `prisma migrate deploy` there.

- [ ] **Step 2: Edit the schema**

In `backend/prisma/schema.prisma`, replace the `User` model's `password` line and add the new fields and relation:

```prisma
model User {
  id                String    @id @default(uuid())
  name              String    @db.VarChar(100)
  email             String    @unique @db.VarChar(150)
  password          String?   @db.VarChar(255)
  role              UserRole
  isActive          Boolean   @default(true) @map("is_active")
  lastLogin         DateTime? @map("last_login")
  emailVerifiedAt   DateTime? @map("email_verified_at")
  passwordSetAt     DateTime? @map("password_set_at")
  passwordChangedAt DateTime? @map("password_changed_at")
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  refreshTokens         RefreshToken[]
  actionTokens          UserActionToken[]
  rentals               Rental[]
  inventoryMovements    InventoryMovement[]
  payments              Payment[]
  returns               Return[]
  financialTransactions FinancialTransaction[]
  documents             Document[]
  auditLogs             AuditLog[]

  @@map("users")
}
```

Add the enum next to the other enums, after `UserRole`:

```prisma
enum UserActionTokenType {
  invitation
  password_reset
}
```

Add the model immediately after `RefreshToken`:

```prisma
model UserActionToken {
  id        String              @id @default(uuid())
  userId    String              @map("user_id")
  type      UserActionTokenType
  tokenHash String              @unique @map("token_hash") @db.VarChar(64)
  expiresAt DateTime            @map("expires_at")
  usedAt    DateTime?           @map("used_at")
  revokedAt DateTime?           @map("revoked_at")
  createdAt DateTime            @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, type])
  @@index([expiresAt])
  @@map("user_action_tokens")
}
```

- [ ] **Step 3: Generate the migration without applying it**

```bash
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx prisma migrate dev --name user_invitations_and_password_tokens --create-only
```

This writes `prisma/migrations/<timestamp>_user_invitations_and_password_tokens/migration.sql` with Prisma's generated DDL and applies nothing. Note the exact directory name it printed — the next step edits that file.

- [ ] **Step 4: Replace the generated SQL with the guarded, backfilling version**

Overwrite the generated `migration.sql` with exactly this. Prisma runs the whole file in one transaction on PostgreSQL, so a failure anywhere leaves nothing behind. Nothing here can run outside a transaction — in particular the index is created **without** `CONCURRENTLY`, on purpose.

```sql
-- 1. Guard: refuse to proceed if any two e-mails collide once normalized.
--    Aborts the entire migration with a readable message. Never merges or
--    deletes users.
DO $$
DECLARE conflicting TEXT;
BEGIN
  SELECT string_agg(e, ', ') INTO conflicting
  FROM (
    SELECT lower(btrim("email")) AS e
    FROM "users"
    GROUP BY lower(btrim("email"))
    HAVING count(*) > 1
  ) dups;

  IF conflicting IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration abortada: e-mails que colidem apos normalizacao (lower+btrim): %. Resolva manualmente antes de aplicar.',
      conflicting;
  END IF;
END $$;

-- 2. Normalize existing e-mails so they match the service's normalized lookup.
UPDATE "users"
   SET "email" = lower(btrim("email"))
 WHERE "email" <> lower(btrim("email"));

-- 3. The invitation flow creates a user before any password exists.
ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;

-- 4. New timestamps. All nullable: no table rewrite, no default needed.
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "password_set_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "password_changed_at" TIMESTAMP(3);

-- 5. Backfill. WITHOUT THIS EVERY EXISTING USER IS LOCKED OUT, because the new
--    login gate rejects a NULL email_verified_at. password_changed_at stays
--    NULL: these accounts have never had a password *change*.
UPDATE "users"
   SET "email_verified_at" = "created_at",
       "password_set_at"   = "created_at"
 WHERE "password" IS NOT NULL;

-- 6. Action tokens (invitations and password resets).
CREATE TYPE "UserActionTokenType" AS ENUM ('invitation', 'password_reset');

CREATE TABLE "user_action_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "UserActionTokenType" NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_action_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_action_tokens_token_hash_key" ON "user_action_tokens"("token_hash");
CREATE INDEX "user_action_tokens_user_id_type_idx" ON "user_action_tokens"("user_id", "type");
CREATE INDEX "user_action_tokens_expires_at_idx" ON "user_action_tokens"("expires_at");

ALTER TABLE "user_action_tokens"
  ADD CONSTRAINT "user_action_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Case- AND whitespace-insensitive uniqueness as a database guarantee, not
--    just an application one. Prisma cannot express a functional index in
--    schema.prisma, so `prisma db pull` will not round-trip this — do not drop
--    it if a future `migrate diff` suggests doing so.
CREATE UNIQUE INDEX "users_email_normalized_key" ON "users" (lower(btrim("email")));
```

- [ ] **Step 5: Apply the migration and regenerate the client**

```bash
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx prisma migrate dev
npx prisma generate
```

Expected: the migration applies cleanly and the client regenerates with `UserActionToken`.

- [ ] **Step 6: Verify the backfill and the index by hand**

```bash
npx prisma db execute --stdin <<'SQL'
SELECT email, password IS NOT NULL AS has_password, email_verified_at IS NOT NULL AS verified,
       password_set_at IS NOT NULL AS pwd_set, password_changed_at
FROM users ORDER BY created_at;
SQL

npx prisma db execute --stdin <<'SQL'
SELECT indexname FROM pg_indexes WHERE tablename = 'users';
SQL
```

Expected: every pre-existing user shows `has_password = t`, `verified = t`, `pwd_set = t`, `password_changed_at` NULL; `users_email_normalized_key` appears in the index list.

- [ ] **Step 7: Confirm the guard actually fires — on a disposable database only**

Prove the abort path works rather than assuming it. **This test must never touch `inventory_db` or
any persistent environment.** It runs against a throwaway database created for this test and dropped
immediately afterwards, so no colliding e-mail is ever inserted anywhere that matters.

```bash
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4

DISPOSABLE="migration_guard_test_$$"
BASE_URL="postgresql://inventory_user:inventory_pass_dev@localhost:5440"

# 1. Create the disposable database.
psql "$BASE_URL/postgres" -c "CREATE DATABASE \"$DISPOSABLE\";"

# 2. Build the pre-migration schema there: apply every migration EXCEPT the new one.
#    The simplest safe route is to apply all migrations, then drop what the new one added,
#    so the guard runs against a realistic pre-state.
DATABASE_URL="$BASE_URL/$DISPOSABLE" npx prisma migrate deploy
DATABASE_URL="$BASE_URL/$DISPOSABLE" psql "$BASE_URL/$DISPOSABLE" <<'SQL'
DROP INDEX IF EXISTS "users_email_normalized_key";
SQL

# 3. Insert two rows that collide only after normalization.
psql "$BASE_URL/$DISPOSABLE" <<'SQL'
INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at)
VALUES (gen_random_uuid(), 'Dup A', 'dup@test.local', 'x', 'attendant', true, now(), now()),
       (gen_random_uuid(), 'Dup B', ' DUP@TEST.LOCAL ', 'x', 'attendant', true, now(), now());
SQL

# 4. The guard must abort with the descriptive message. Capture it.
psql "$BASE_URL/$DISPOSABLE" -v ON_ERROR_STOP=1 \
  -f prisma/migrations/*_user_invitations_and_password_tokens/migration.sql \
  2>&1 | tee /tmp/guard-output.txt || echo "guard fired as expected (non-zero exit)"

grep -q "Migration abortada" /tmp/guard-output.txt && echo "PASS: guard message present"

# 5. Destroy the disposable database unconditionally.
psql "$BASE_URL/postgres" -c "DROP DATABASE IF EXISTS \"$DISPOSABLE\" WITH (FORCE);"
psql "$BASE_URL/postgres" -c "SELECT datname FROM pg_database WHERE datname = '$DISPOSABLE';"
rm -f /tmp/guard-output.txt
```

Expected: step 4 prints the `Migration abortada: e-mails que colidem apos normalizacao ...` message
and exits non-zero; step 5's final query returns **zero rows**, proving the disposable database is
gone. If `psql` is unavailable on the host, run both `psql` invocations inside the Postgres
container with `docker-compose -f ../docker-compose.dev.yml exec -T postgres psql -U inventory_user`,
keeping the same create/test/drop sequence.

Confirm `inventory_db` was never touched:

```bash
npx prisma db execute --stdin <<'SQL'
SELECT count(*) AS colliding FROM (
  SELECT lower(btrim(email)) FROM users GROUP BY lower(btrim(email)) HAVING count(*) > 1
) d;
SQL
```

Expected: `0`.

- [ ] **Step 8: Run the full backend suite**

```bash
npm run test && npm run build
```

Expected: 215 tests still pass; `nest build` succeeds. `validateUser` still compiles because `user.password` is only read after the existing truthiness checks — if `tsc` complains about `string | null`, leave it failing and fix it in Task 6 rather than patching it here.

- [ ] **Step 9: Commit**

```bash
cd /home/userterras/Documents/inventory-manager
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "$(cat <<'MSG'
feat(db): add action tokens and password lifecycle columns

Makes users.password nullable for the invitation flow, adds
email_verified_at / password_set_at / password_changed_at, and creates
user_action_tokens. The migration guards against normalized e-mail
collisions, normalizes existing e-mails, backfills verification timestamps
for current users so nobody is locked out, and adds a functional unique
index on lower(btrim(email)).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: UserActionTokensService

**Files:**
- Create: `backend/src/modules/user-action-tokens/user-action-tokens.module.ts`
- Create: `backend/src/modules/user-action-tokens/user-action-tokens.service.ts`
- Test: `backend/src/modules/user-action-tokens/user-action-tokens.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, Prisma types from Task 4, `Tx` from `../audit/audit.service`.
- Produces:
  - `ACTION_TOKEN_TTL = { invitation: 24 * 60, password_reset: 30 }` (minutes)
  - `UserActionTokensService.issue(userId: string, type: UserActionTokenType, tx?: Tx): Promise<string>` — returns the raw token.
  - `UserActionTokensService.consume(rawToken: string, type: UserActionTokenType, tx?: Tx): Promise<{ userId: string }>` — throws `BadRequestException('Link inválido ou expirado')`.
  - `UserActionTokensService.revokePending(userId: string, type: UserActionTokenType, tx?: Tx): Promise<number>`
  - `UserActionTokensService.countRecent(userId: string, type: UserActionTokenType, sinceMinutes: number): Promise<number>`
  - `UserActionTokensService.findLatest(userIds: string[], type: UserActionTokenType): Promise<Map<string, UserActionToken>>`
  - `hashActionToken(rawToken: string): string` (exported helper, SHA-256 hex)
  - `UserActionTokensModule` exporting the service.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/user-action-tokens/user-action-tokens.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UserActionTokenType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UserActionTokensService,
  hashActionToken,
  ACTION_TOKEN_TTL,
} from './user-action-tokens.service';

const mockPrisma = {
  userActionToken: {
    create: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
};

describe('UserActionTokensService', () => {
  let service: UserActionTokensService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserActionTokensService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(UserActionTokensService);
  });

  describe('issue', () => {
    it('returns a high-entropy raw token', async () => {
      mockPrisma.userActionToken.create.mockResolvedValue({});
      const raw = await service.issue('user-1', UserActionTokenType.invitation);
      // 32 random bytes in base64url ≈ 43 characters
      expect(raw.length).toBeGreaterThanOrEqual(43);
      expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('never stores the raw token — only its SHA-256 digest', async () => {
      mockPrisma.userActionToken.create.mockResolvedValue({});
      const raw = await service.issue('user-1', UserActionTokenType.invitation);

      const data = mockPrisma.userActionToken.create.mock.calls[0][0].data;
      expect(data.tokenHash).toBe(hashActionToken(raw));
      expect(data.tokenHash).toHaveLength(64);
      expect(JSON.stringify(data)).not.toContain(raw);
    });

    it('issues an invitation valid for 24 hours', async () => {
      mockPrisma.userActionToken.create.mockResolvedValue({});
      const before = Date.now();
      await service.issue('user-1', UserActionTokenType.invitation);

      const { expiresAt } = mockPrisma.userActionToken.create.mock.calls[0][0].data;
      const minutes = (new Date(expiresAt).getTime() - before) / 60_000;
      expect(Math.round(minutes)).toBe(ACTION_TOKEN_TTL.invitation);
    });

    it('issues a password reset valid for 30 minutes', async () => {
      mockPrisma.userActionToken.create.mockResolvedValue({});
      const before = Date.now();
      await service.issue('user-1', UserActionTokenType.password_reset);

      const { expiresAt } = mockPrisma.userActionToken.create.mock.calls[0][0].data;
      const minutes = (new Date(expiresAt).getTime() - before) / 60_000;
      expect(Math.round(minutes)).toBe(ACTION_TOKEN_TTL.password_reset);
    });

    it('prunes only tokens whose terminal timestamp is past the retention cutoff', async () => {
      mockPrisma.userActionToken.create.mockResolvedValue({});
      await service.issue('user-1', UserActionTokenType.invitation);

      const where = mockPrisma.userActionToken.deleteMany.mock.calls[0][0].where;
      expect(where.userId).toBe('user-1');
      expect(where.OR).toEqual([
        { usedAt: { lt: expect.any(Date) } },
        { revokedAt: { lt: expect.any(Date) } },
        {
          AND: [
            { usedAt: null },
            { revokedAt: null },
            { expiresAt: { lt: expect.any(Date) } },
          ],
        },
      ]);
      // A live token is never matched by any branch above.
      expect(JSON.stringify(where)).not.toContain('createdAt');
    });
  });

  describe('consume', () => {
    it('validates and marks used in a single conditional update', async () => {
      mockPrisma.userActionToken.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.userActionToken.findFirst.mockResolvedValue({ userId: 'user-1' });

      const result = await service.consume('raw-token', UserActionTokenType.invitation);

      expect(result).toEqual({ userId: 'user-1' });
      const where = mockPrisma.userActionToken.updateMany.mock.calls[0][0].where;
      expect(where).toEqual({
        tokenHash: hashActionToken('raw-token'),
        type: UserActionTokenType.invitation,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      });
    });

    it('rejects when no row was updated', async () => {
      mockPrisma.userActionToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.consume('raw-token', UserActionTokenType.invitation),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses the same generic message for every defect', async () => {
      mockPrisma.userActionToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.consume('raw-token', UserActionTokenType.invitation),
      ).rejects.toThrow('Link inválido ou expirado');
    });

    it('never puts the raw token in the exception', async () => {
      mockPrisma.userActionToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.consume('SUPER_SECRET_TOKEN', UserActionTokenType.invitation),
      ).rejects.not.toThrow(/SUPER_SECRET_TOKEN/);
    });

    it('rejects a token presented for the wrong purpose', async () => {
      mockPrisma.userActionToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.consume('raw-token', UserActionTokenType.password_reset),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.userActionToken.updateMany.mock.calls[0][0].where.type).toBe(
        UserActionTokenType.password_reset,
      );
    });
  });

  describe('revokePending', () => {
    it('revokes only tokens that are still pending', async () => {
      mockPrisma.userActionToken.updateMany.mockResolvedValue({ count: 2 });

      const count = await service.revokePending('user-1', UserActionTokenType.invitation);

      expect(count).toBe(2);
      expect(mockPrisma.userActionToken.updateMany.mock.calls[0][0].where).toEqual({
        userId: 'user-1',
        type: UserActionTokenType.invitation,
        usedAt: null,
        revokedAt: null,
      });
    });
  });

  describe('countRecent', () => {
    it('counts tokens of one type created within the window', async () => {
      mockPrisma.userActionToken.count.mockResolvedValue(3);

      const count = await service.countRecent('user-1', UserActionTokenType.password_reset, 15);

      expect(count).toBe(3);
      const where = mockPrisma.userActionToken.count.mock.calls[0][0].where;
      expect(where.userId).toBe('user-1');
      expect(where.type).toBe(UserActionTokenType.password_reset);
      expect(where.createdAt.gte).toBeInstanceOf(Date);
    });
  });

  describe('findLatest', () => {
    it('returns the newest token per user in one query', async () => {
      mockPrisma.userActionToken.findMany.mockResolvedValue([
        { id: 't2', userId: 'user-1', createdAt: new Date('2026-09-10') },
        { id: 't1', userId: 'user-1', createdAt: new Date('2026-09-01') },
        { id: 't3', userId: 'user-2', createdAt: new Date('2026-09-05') },
      ]);

      const map = await service.findLatest(['user-1', 'user-2'], UserActionTokenType.invitation);

      expect(mockPrisma.userActionToken.findMany).toHaveBeenCalledTimes(1);
      expect(map.get('user-1')?.id).toBe('t2');
      expect(map.get('user-2')?.id).toBe('t3');
    });

    it('returns an empty map for no users without querying', async () => {
      const map = await service.findLatest([], UserActionTokenType.invitation);
      expect(map.size).toBe(0);
      expect(mockPrisma.userActionToken.findMany).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx jest --config jest.config.ts src/modules/user-action-tokens
```

Expected: FAIL — `Cannot find module './user-action-tokens.service'`.

- [ ] **Step 3: Implement the service**

Create `backend/src/modules/user-action-tokens/user-action-tokens.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { UserActionToken, UserActionTokenType } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { Tx } from '../audit/audit.service';

/** Time-to-live per token purpose, in minutes. */
export const ACTION_TOKEN_TTL = {
  invitation: 24 * 60,
  password_reset: 30,
} as const;

/** Terminal tokens older than this are pruned opportunistically. */
const RETENTION_DAYS = 30;

const TOKEN_BYTES = 32;

/** The generic message used for every token defect — absent, expired, used, revoked, wrong purpose. */
export const INVALID_TOKEN_MESSAGE = 'Link inválido ou expirado';

export function hashActionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

@Injectable()
export class UserActionTokensService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a token and returns the RAW value — the only moment it exists
   * outside the e-mail. Only its SHA-256 digest is persisted.
   */
  async issue(userId: string, type: UserActionTokenType, tx?: Tx): Promise<string> {
    const client = tx ?? this.prisma;

    const rawToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + ACTION_TOKEN_TTL[type] * 60_000);

    await client.userActionToken.create({
      data: { userId, type, tokenHash: hashActionToken(rawToken), expiresAt },
    });

    await this.pruneTerminal(userId, client);

    return rawToken;
  }

  /**
   * Validates and consumes in ONE conditional update, so two simultaneous
   * requests cannot both succeed. A preceding lookup would not be enough.
   */
  async consume(
    rawToken: string,
    type: UserActionTokenType,
    tx?: Tx,
  ): Promise<{ userId: string }> {
    const client = tx ?? this.prisma;

    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }

    const tokenHash = hashActionToken(rawToken);
    const now = new Date();

    const { count } = await client.userActionToken.updateMany({
      where: { tokenHash, type, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });

    if (count !== 1) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }

    const consumed = await client.userActionToken.findFirst({
      where: { tokenHash, type },
      select: { userId: true },
    });

    if (!consumed) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }

    return { userId: consumed.userId };
  }

  async revokePending(
    userId: string,
    type: UserActionTokenType,
    tx?: Tx,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const { count } = await client.userActionToken.updateMany({
      where: { userId, type, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  async countRecent(
    userId: string,
    type: UserActionTokenType,
    sinceMinutes: number,
  ): Promise<number> {
    return this.prisma.userActionToken.count({
      where: {
        userId,
        type,
        createdAt: { gte: new Date(Date.now() - sinceMinutes * 60_000) },
      },
    });
  }

  /** Newest token of a type per user, in a single query. Used to derive invitation status. */
  async findLatest(
    userIds: string[],
    type: UserActionTokenType,
  ): Promise<Map<string, UserActionToken>> {
    const latest = new Map<string, UserActionToken>();
    if (userIds.length === 0) return latest;

    const tokens = await this.prisma.userActionToken.findMany({
      where: { userId: { in: userIds }, type },
      orderBy: { createdAt: 'desc' },
    });

    for (const token of tokens) {
      if (!latest.has(token.userId)) latest.set(token.userId, token);
    }

    return latest;
  }

  /**
   * Deletes tokens whose TERMINAL timestamp is itself older than the cutoff.
   * A live token is never eligible, whatever its createdAt.
   */
  private async pruneTerminal(userId: string, client: Tx | PrismaService): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000);

    await client.userActionToken.deleteMany({
      where: {
        userId,
        OR: [
          { usedAt: { lt: cutoff } },
          { revokedAt: { lt: cutoff } },
          {
            AND: [
              { usedAt: null },
              { revokedAt: null },
              { expiresAt: { lt: cutoff } },
            ],
          },
        ],
      },
    });
  }
}
```

Create `backend/src/modules/user-action-tokens/user-action-tokens.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { UserActionTokensService } from './user-action-tokens.service';

@Module({
  providers: [UserActionTokensService],
  exports: [UserActionTokensService],
})
export class UserActionTokensModule {}
```

- [ ] **Step 4: Run the test**

```bash
npx jest --config jest.config.ts src/modules/user-action-tokens
```

Expected: PASS (17 tests).

- [ ] **Step 5: Run the full backend suite and build**

```bash
npm run test && npm run build
```

- [ ] **Step 6: Commit**

```bash
cd /home/userterras/Documents/inventory-manager
git add backend/src/modules/user-action-tokens
git commit -m "$(cat <<'MSG'
feat(tokens): add single-use action token service

Issues 32-byte tokens, persists only the SHA-256 digest, and consumes them
with one conditional updateMany so concurrent attempts cannot both win.
Retention prunes only tokens whose terminal timestamp is past the cutoff.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Phase 2 — Authentication

### Task 6: Login gate, bcrypt rehash, and session gates

**Files:**
- Modify: `backend/src/modules/auth/auth.service.ts:34-42` (`validateUser`), `:73-91` (`refreshTokens`)
- Modify: `backend/src/modules/auth/strategies/jwt.strategy.ts:26-32`
- Modify: `backend/src/modules/auth/auth.module.ts`
- Modify: `backend/src/modules/auth/auth.service.spec.ts` (existing mock user needs the new columns)

**Interfaces:**
- Consumes: `HashingService` (Task 2).
- Produces: `validateUser` and `refreshTokens` enforce `isActive && emailVerifiedAt && password`; `JwtStrategy.validate` enforces the same. No signature changes.

- [ ] **Step 1: Update the existing mock user so the current suite still describes reality**

In `backend/src/modules/auth/auth.service.spec.ts`, extend `mockUser` (line 11) with the new columns, otherwise every existing `validateUser` test will now fail the gate:

```ts
const mockUser = {
  id: 'user-uuid-1',
  name: 'Admin User',
  email: 'admin@test.com',
  password: '$argon2id$v=19$m=65536,p=1,t=3$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA',
  role: UserRole.admin,
  isActive: true,
  lastLogin: null,
  emailVerifiedAt: new Date('2026-01-01'),
  passwordSetAt: new Date('2026-01-01'),
  passwordChangedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
```

Add a `HashingService` mock next to the others and register it in the testing module providers:

```ts
const mockHashingService = {
  hash: jest.fn(),
  verify: jest.fn(),
  isBcryptHash: jest.fn(),
  verifyDummy: jest.fn().mockResolvedValue(false),
};
```

Replace the two `jest.spyOn(bcrypt, 'compare')` call sites (lines 90 and 97) with
`mockHashingService.verify.mockResolvedValue({ valid: false, needsRehash: false })` and
`{ valid: true, needsRehash: false }` respectively, and drop the now-unused
`import * as bcrypt from 'bcrypt'`.

- [ ] **Step 2: Write the failing gate and rehash tests**

Append to `backend/src/modules/auth/auth.service.spec.ts`, inside the top-level `describe('AuthService')`:

```ts
describe('validateUser — eligibility gate', () => {
  beforeEach(() => {
    mockHashingService.verify.mockResolvedValue({ valid: true, needsRehash: false });
  });

  it('rejects an inactive user', async () => {
    mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, isActive: false });
    await expect(service.validateUser('admin@test.com', 'uma senha bem comprida')).resolves.toBeNull();
  });

  it('rejects a user whose e-mail is not verified', async () => {
    mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, emailVerifiedAt: null });
    await expect(service.validateUser('admin@test.com', 'uma senha bem comprida')).resolves.toBeNull();
  });

  it('rejects a user with no password set', async () => {
    mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, password: null });
    await expect(service.validateUser('admin@test.com', 'uma senha bem comprida')).resolves.toBeNull();
  });

  it('never calls verify() when there is no eligible stored password', async () => {
    mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, password: null });
    await service.validateUser('admin@test.com', 'uma senha bem comprida');
    expect(mockHashingService.verify).not.toHaveBeenCalled();
  });

  it.each([
    ['nonexistent user', null],
    ['inactive user', { ...mockUser, isActive: false }],
    ['unverified user', { ...mockUser, emailVerifiedAt: null }],
    ['passwordless user', { ...mockUser, password: null }],
  ])('runs the dummy verification for a %s', async (_label, found) => {
    mockUsersService.findByEmail.mockResolvedValue(found);
    await service.validateUser('whoever@test.com', 'uma senha bem comprida');
    expect(mockHashingService.verifyDummy).toHaveBeenCalledWith('uma senha bem comprida');
  });

  it('returns null identically for all ineligible conditions — nothing distinguishes them', async () => {
    const results: unknown[] = [];
    for (const found of [null, { ...mockUser, isActive: false }, { ...mockUser, emailVerifiedAt: null }, { ...mockUser, password: null }]) {
      mockUsersService.findByEmail.mockResolvedValue(found);
      results.push(await service.validateUser('whoever@test.com', 'uma senha bem comprida'));
    }
    expect(results).toEqual([null, null, null, null]);
  });
});

describe('validateUser — bcrypt migration', () => {
  it('rehashes to Argon2id after a valid bcrypt login', async () => {
    const legacy = { ...mockUser, password: '$2b$12$legacyhashvalue' };
    mockUsersService.findByEmail.mockResolvedValue(legacy);
    mockHashingService.verify.mockResolvedValue({ valid: true, needsRehash: true });
    mockHashingService.hash.mockResolvedValue('$argon2id$v=19$m=65536,p=1,t=3$new$hash');
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.validateUser('admin@test.com', 'Admin@123456');

    expect(result).toEqual(legacy);
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: legacy.id, password: '$2b$12$legacyhashvalue' },
      data: { password: '$argon2id$v=19$m=65536,p=1,t=3$new$hash' },
    });
  });

  it('does not touch passwordChangedAt on a transparent rehash', async () => {
    mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, password: '$2a$12$legacy' });
    mockHashingService.verify.mockResolvedValue({ valid: true, needsRehash: true });
    mockHashingService.hash.mockResolvedValue('$argon2id$new');
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

    await service.validateUser('admin@test.com', 'Admin@123456');

    const data = mockPrisma.user.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('passwordChangedAt');
  });

  it('does not rehash an Argon2id password', async () => {
    mockUsersService.findByEmail.mockResolvedValue(mockUser);
    mockHashingService.verify.mockResolvedValue({ valid: true, needsRehash: false });

    await service.validateUser('admin@test.com', 'uma senha bem comprida');

    expect(mockHashingService.hash).not.toHaveBeenCalled();
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('does not rehash after an invalid bcrypt login', async () => {
    mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, password: '$2y$12$legacy' });
    mockHashingService.verify.mockResolvedValue({ valid: false, needsRehash: false });

    await expect(service.validateUser('admin@test.com', 'errada')).resolves.toBeNull();
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('does not log which algorithm the row used', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, password: '$2b$12$legacy' });
    mockHashingService.verify.mockResolvedValue({ valid: true, needsRehash: true });
    mockHashingService.hash.mockResolvedValue('$argon2id$new');
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

    await service.validateUser('admin@test.com', 'Admin@123456');

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('refreshTokens — user state gate', () => {
  const storedToken = {
    id: 'rt-1',
    token: 'refresh-value',
    revoked: false,
    expiresAt: new Date(Date.now() + 86_400_000),
    user: mockUser,
  };

  it.each([
    ['inactive', { ...mockUser, isActive: false }],
    ['unverified', { ...mockUser, emailVerifiedAt: null }],
    ['passwordless', { ...mockUser, password: null }],
  ])('refuses to rotate for an %s user', async (_label, user) => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({ ...storedToken, user });
    mockPrisma.refreshToken.update.mockResolvedValue({});

    await expect(service.refreshTokens('refresh-value')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('revokes the presented token when the user is ineligible', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      ...storedToken,
      user: { ...mockUser, isActive: false },
    });
    mockPrisma.refreshToken.update.mockResolvedValue({});

    await expect(service.refreshTokens('refresh-value')).rejects.toThrow();
    expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'rt-1' },
      data: { revoked: true },
    });
  });

  it('keeps the existing generic message', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      ...storedToken,
      user: { ...mockUser, isActive: false },
    });
    mockPrisma.refreshToken.update.mockResolvedValue({});

    await expect(service.refreshTokens('refresh-value')).rejects.toThrow(
      'Token de refresh inválido ou expirado',
    );
  });
});
```

Add `Logger` to the `@nestjs/common` import at the top of the spec, and add `updateMany: jest.fn()` to `mockPrisma.user`.

- [ ] **Step 3: Run it to make sure it fails**

```bash
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx jest --config jest.config.ts src/modules/auth/auth.service.spec.ts
```

Expected: FAIL — `HashingService` is not a provider, `verifyDummy` is never called, and `refreshTokens` rotates for inactive users.

- [ ] **Step 4: Implement the gates in `auth.service.ts`**

Replace the `bcrypt` import with the hashing service, update the constructor, and rewrite the two methods.

Remove line 4 (`import * as bcrypt from 'bcrypt';`) and add:

```ts
import { HashingService } from '../hashing/hashing.service';
```

Add to the constructor parameter list:

```ts
private readonly hashing: HashingService,
```

Replace `validateUser` (lines 34-42) with:

```ts
async validateUser(email: string, password: string): Promise<User | null> {
  const user = await this.usersService.findByEmail(email);

  // No eligible stored password: inactive, unverified, never activated, or no
  // such user. Pay the hashing cost anyway so the four cases are not
  // distinguishable by response time, then fail generically.
  if (!user || !user.isActive || !user.password || !user.emailVerifiedAt) {
    await this.hashing.verifyDummy(password);
    return null;
  }

  const { valid, needsRehash } = await this.hashing.verify(user.password, password);
  if (!valid) return null;

  if (needsRehash) {
    // Conditional on the old hash so a concurrent reset/change wins instead of
    // being overwritten. passwordChangedAt is deliberately untouched: a
    // transparent rehash is not a user-initiated change.
    await this.prisma.user.updateMany({
      where: { id: user.id, password: user.password },
      data: { password: await this.hashing.hash(password) },
    });
  }

  return user;
}
```

Replace the guard inside `refreshTokens` (lines 79-81) with:

```ts
if (!stored || stored.revoked || stored.expiresAt < new Date()) {
  throw new UnauthorizedException('Token de refresh inválido ou expirado');
}

const { user } = stored;
if (!user.isActive || !user.emailVerifiedAt || !user.password) {
  // A deactivated or incomplete account must not receive a new token pair,
  // and the token it presented is burned.
  await this.prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revoked: true },
  });
  throw new UnauthorizedException('Token de refresh inválido ou expirado');
}
```

Also extend the `select` in `login()` (lines 59-68) with the three new columns so the login response reflects them:

```ts
select: {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  lastLogin: true,
  emailVerifiedAt: true,
  passwordSetAt: true,
  createdAt: true,
  updatedAt: true,
},
```

and widen `TokensDto['user']` (lines 13-22) with `emailVerifiedAt: Date | null;` and `passwordSetAt: Date | null;`.

- [ ] **Step 5: Extend the JwtStrategy gate**

Replace `validate` in `backend/src/modules/auth/strategies/jwt.strategy.ts`:

```ts
async validate(payload: JwtPayload) {
  const user = await this.usersService.findById(payload.sub);

  // The user is reloaded on every authenticated request, so deactivation and
  // role changes take effect immediately rather than after the access token
  // expires. The `role` claim in the token is informational and is never used
  // for authorization — RolesGuard reads req.user.role, which is this row.
  if (!user || !user.isActive || !user.emailVerifiedAt || !user.password) {
    throw new UnauthorizedException('Usuário não encontrado ou inativo');
  }

  return user;
}
```

- [ ] **Step 6: Wire HashingModule into AuthModule**

In `backend/src/modules/auth/auth.module.ts`, add `HashingModule` to `imports`:

```ts
import { HashingModule } from '../hashing/hashing.module';
// ...
imports: [UsersModule, PassportModule, HashingModule, JwtModule.register({})],
```

- [ ] **Step 7: Write the failing JwtStrategy test**

Create `backend/src/modules/auth/strategies/jwt.strategy.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../../users/users.service';

const eligible = {
  id: 'user-1',
  name: 'Admin',
  email: 'admin@test.com',
  password: '$argon2id$hash',
  role: UserRole.admin,
  isActive: true,
  emailVerifiedAt: new Date(),
  passwordSetAt: new Date(),
  passwordChangedAt: null,
  lastLogin: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('JwtStrategy', () => {
  const usersService = { findById: jest.fn() } as unknown as UsersService;
  const configService = {
    get: jest.fn().mockReturnValue('access-secret-32-chars-minimum!!'),
  } as unknown as ConfigService;

  const strategy = new JwtStrategy(configService, usersService);

  it('returns the reloaded database row, not the token claims', async () => {
    (usersService.findById as jest.Mock).mockResolvedValue(eligible);
    const result = await strategy.validate({ sub: 'user-1', email: 'stale@test.com', role: 'attendant' });
    expect(result).toEqual(eligible);
    expect(result.role).toBe(UserRole.admin); // DB wins over the stale claim
  });

  it.each([
    ['missing', null],
    ['inactive', { ...eligible, isActive: false }],
    ['unverified', { ...eligible, emailVerifiedAt: null }],
    ['passwordless', { ...eligible, password: null }],
  ])('rejects a %s user', async (_label, found) => {
    (usersService.findById as jest.Mock).mockResolvedValue(found);
    await expect(
      strategy.validate({ sub: 'user-1', email: 'admin@test.com', role: 'admin' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses one message for every rejection', async () => {
    (usersService.findById as jest.Mock).mockResolvedValue({ ...eligible, isActive: false });
    await expect(
      strategy.validate({ sub: 'user-1', email: 'admin@test.com', role: 'admin' }),
    ).rejects.toThrow('Usuário não encontrado ou inativo');
  });
});
```

- [ ] **Step 8: Run the auth suites**

```bash
npx jest --config jest.config.ts src/modules/auth
```

Expected: PASS — the pre-existing `AuthService` tests plus the new gate, rehash and strategy tests.

- [ ] **Step 9: Run the full backend suite and build**

```bash
npm run test && npm run build
```

Expected: everything green.

- [ ] **Step 10: Commit**

```bash
cd /home/userterras/Documents/inventory-manager
git add backend/src/modules/auth
git commit -m "$(cat <<'MSG'
feat(auth): gate login and refresh on account eligibility, migrate bcrypt

Login, refresh and the JWT strategy all require isActive, a verified e-mail
and a stored password. Ineligible paths run a dummy Argon2id verification so
they cost roughly the same as a real one. A valid bcrypt login is rehashed to
Argon2id with a conditional update that loses to a concurrent change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: PasswordService — forgot, reset, change

**Files:**
- Create: `backend/src/modules/auth/password.service.ts`
- Create: `backend/src/modules/auth/dto/forgot-password.dto.ts`
- Create: `backend/src/modules/auth/dto/reset-password.dto.ts`
- Create: `backend/src/modules/auth/dto/change-password.dto.ts`
- Modify: `backend/src/modules/auth/auth.controller.ts`
- Modify: `backend/src/modules/auth/auth.module.ts`
- Modify: `backend/src/common/filters/global-exception.filter.ts:13`
- Test: `backend/src/modules/auth/password.service.spec.ts`

**Interfaces:**
- Consumes: `HashingService`, `UserActionTokensService`, `MAIL_SERVICE`, `AuditService`, `PrismaService`, `app.frontendUrl`.
- Produces:
  - `PasswordService.requestReset(email: string, ipAddress?: string): Promise<{ message: string }>`
  - `PasswordService.resetPassword(dto: ResetPasswordDto): Promise<void>`
  - `PasswordService.changePassword(userId: string, dto: ChangePasswordDto, ipAddress?: string): Promise<void>`
  - `GENERIC_RESET_MESSAGE` constant.
  - Routes `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/change-password`.

- [ ] **Step 1: Write the DTOs**

Create `backend/src/modules/auth/dto/forgot-password.dto.ts`:

```ts
import { IsEmail, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(150)
  email: string;
}
```

Create `backend/src/modules/auth/dto/reset-password.dto.ts`:

```ts
import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../hashing/is-strong-password.validator';
import { IsEqualTo } from '../../hashing/is-equal-to.validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token: string;

  @IsStrongPassword()
  password: string;

  @IsString()
  @IsEqualTo('password')
  passwordConfirmation: string;
}
```

Create `backend/src/modules/auth/dto/change-password.dto.ts`:

```ts
import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../hashing/is-strong-password.validator';
import { IsEqualTo } from '../../hashing/is-equal-to.validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentPassword: string;

  @IsStrongPassword()
  newPassword: string;

  @IsString()
  @IsEqualTo('newPassword')
  newPasswordConfirmation: string;
}
```

- [ ] **Step 2: Write the failing service test**

Create `backend/src/modules/auth/password.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserActionTokenType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { HashingService } from '../hashing/hashing.service';
import { UserActionTokensService } from '../user-action-tokens/user-action-tokens.service';
import { MAIL_SERVICE } from '../mail/mail.service';
import { PasswordService, GENERIC_RESET_MESSAGE } from './password.service';

const user = {
  id: 'user-1',
  name: 'Maria',
  email: 'maria@test.com',
  password: '$argon2id$current',
  role: UserRole.attendant,
  isActive: true,
  emailVerifiedAt: new Date('2026-01-01'),
  passwordSetAt: new Date('2026-01-01'),
  passwordChangedAt: null,
  lastLogin: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  $transaction: jest.fn(),
};
const mockTokens = {
  issue: jest.fn(),
  consume: jest.fn(),
  revokePending: jest.fn(),
  countRecent: jest.fn(),
};
const mockHashing = { hash: jest.fn(), verify: jest.fn() };
const mockMail = { send: jest.fn() };
const mockAudit = { log: jest.fn() };
const mockConfig = {
  get: jest.fn().mockImplementation((k: string) =>
    k === 'app.frontendUrl' ? 'http://localhost:5173' : undefined,
  ),
};

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
    mockTokens.countRecent.mockResolvedValue(0);
    mockTokens.revokePending.mockResolvedValue(0);
    mockTokens.issue.mockResolvedValue('RAW_TOKEN');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UserActionTokensService, useValue: mockTokens },
        { provide: HashingService, useValue: mockHashing },
        { provide: MAIL_SERVICE, useValue: mockMail },
        { provide: AuditService, useValue: mockAudit },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(PasswordService);
  });

  describe('requestReset', () => {
    it('returns the generic message for an existing eligible user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      await expect(service.requestReset('maria@test.com')).resolves.toEqual({
        message: GENERIC_RESET_MESSAGE,
      });
    });

    it('returns the identical message for a nonexistent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.requestReset('ninguem@test.com')).resolves.toEqual({
        message: GENERIC_RESET_MESSAGE,
      });
    });

    it.each([
      ['inactive', { ...user, isActive: false }],
      ['unverified', { ...user, emailVerifiedAt: null }],
      ['passwordless', { ...user, password: null }],
    ])('returns the identical message for an %s user and sends nothing', async (_l, found) => {
      mockPrisma.user.findUnique.mockResolvedValue(found);
      await expect(service.requestReset('maria@test.com')).resolves.toEqual({
        message: GENERIC_RESET_MESSAGE,
      });
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('normalizes the e-mail before lookup', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await service.requestReset('  MARIA@TEST.COM  ');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'maria@test.com' },
      });
    });

    it('revokes previous reset tokens before issuing a new one', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      await service.requestReset('maria@test.com');
      expect(mockTokens.revokePending).toHaveBeenCalledWith(
        'user-1',
        UserActionTokenType.password_reset,
        expect.anything(),
      );
    });

    it('builds the reset link with the token in the URL fragment', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      await service.requestReset('maria@test.com');
      const sent = mockMail.send.mock.calls[0][0];
      expect(sent.text).toContain('http://localhost:5173/reset-password#token=RAW_TOKEN');
      expect(sent.text).not.toContain('?token=');
    });

    it('skips sending once the per-user window limit is reached', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockTokens.countRecent.mockResolvedValue(3);

      await expect(service.requestReset('maria@test.com')).resolves.toEqual({
        message: GENERIC_RESET_MESSAGE,
      });
      expect(mockMail.send).not.toHaveBeenCalled();
      expect(mockTokens.issue).not.toHaveBeenCalled();
    });

    it('returns the same successful response when SMTP throws', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockMail.send.mockRejectedValue(new Error('SMTP down'));

      await expect(service.requestReset('maria@test.com')).resolves.toEqual({
        message: GENERIC_RESET_MESSAGE,
      });
    });

    it('logs an SMTP failure without the token, URL or recipient', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockMail.send.mockRejectedValue(new Error('SMTP down'));
      const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await service.requestReset('maria@test.com');

      const logged = spy.mock.calls.map(c => String(c[0])).join(' ');
      expect(logged).not.toContain('RAW_TOKEN');
      expect(logged).not.toContain('maria@test.com');
      expect(logged).not.toContain('reset-password');
      spy.mockRestore();
    });

    it('does not write an audit entry attributing the request to the user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      await service.requestReset('maria@test.com');

      const actions = mockAudit.log.mock.calls.map(c => c[0].action);
      expect(actions).not.toContain('request_password_reset');
    });
  });

  describe('resetPassword', () => {
    const dto = {
      token: 'RAW_TOKEN',
      password: 'uma senha bem comprida',
      passwordConfirmation: 'uma senha bem comprida',
    };

    beforeEach(() => {
      mockTokens.consume.mockResolvedValue({ userId: 'user-1' });
      mockHashing.hash.mockResolvedValue('$argon2id$new');
      mockPrisma.user.update.mockResolvedValue(user);
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
    });

    it('writes the new hash and stamps passwordChangedAt', async () => {
      await service.resetPassword(dto);

      const data = mockPrisma.user.update.mock.calls[0][0].data;
      expect(data.password).toBe('$argon2id$new');
      expect(data.passwordChangedAt).toBeInstanceOf(Date);
    });

    it('revokes every refresh token for the user', async () => {
      await service.resetPassword(dto);
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revoked: false },
        data: { revoked: true },
      });
    });

    it('runs inside a single transaction', async () => {
      await service.resetPassword(dto);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid token generically and changes nothing', async () => {
      mockTokens.consume.mockRejectedValue(new BadRequestException('Link inválido ou expirado'));

      await expect(service.resetPassword(dto)).rejects.toThrow('Link inválido ou expirado');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('audits without password, token or pepper', async () => {
      await service.resetPassword(dto);

      const entry = mockAudit.log.mock.calls.find(c => c[0].action === 'reset_password')?.[0];
      expect(entry).toBeDefined();
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain('uma senha bem comprida');
      expect(serialized).not.toContain('RAW_TOKEN');
      expect(serialized).not.toContain('$argon2id$');
    });
  });

  describe('changePassword', () => {
    const dto = {
      currentPassword: 'a senha atual longa',
      newPassword: 'uma senha nova bem comprida',
      newPasswordConfirmation: 'uma senha nova bem comprida',
    };

    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockHashing.hash.mockResolvedValue('$argon2id$new');
      mockPrisma.user.update.mockResolvedValue(user);
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });
    });

    it('changes the password when the current one is correct', async () => {
      mockHashing.verify
        .mockResolvedValueOnce({ valid: true, needsRehash: false })  // current
        .mockResolvedValueOnce({ valid: false, needsRehash: false }); // new differs

      await service.changePassword('user-1', dto);

      expect(mockPrisma.user.update.mock.calls[0][0].data.password).toBe('$argon2id$new');
    });

    it('rejects an incorrect current password', async () => {
      mockHashing.verify.mockResolvedValue({ valid: false, needsRehash: false });

      await expect(service.changePassword('user-1', dto)).rejects.toThrow('Senha atual incorreta');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a new password equal to the current one via stored-hash verification', async () => {
      // Plaintext differs, so only hash verification can catch this.
      mockHashing.verify
        .mockResolvedValueOnce({ valid: true, needsRehash: false }) // current ok
        .mockResolvedValueOnce({ valid: true, needsRehash: false }); // new matches stored hash

      await expect(service.changePassword('user-1', dto)).rejects.toThrow(
        'A nova senha deve ser diferente da senha atual',
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('verifies the new password against the stored hash, not just the plaintext', async () => {
      mockHashing.verify
        .mockResolvedValueOnce({ valid: true, needsRehash: false })
        .mockResolvedValueOnce({ valid: false, needsRehash: false });

      await service.changePassword('user-1', dto);

      expect(mockHashing.verify).toHaveBeenCalledTimes(2);
      expect(mockHashing.verify).toHaveBeenNthCalledWith(2, '$argon2id$current', dto.newPassword);
    });

    it('rejects the plaintext-identical case early', async () => {
      mockHashing.verify.mockResolvedValueOnce({ valid: true, needsRehash: false });

      await expect(
        service.changePassword('user-1', {
          currentPassword: 'a senha atual longa',
          newPassword: 'a senha atual longa',
          newPasswordConfirmation: 'a senha atual longa',
        }),
      ).rejects.toThrow('A nova senha deve ser diferente da senha atual');
    });

    it('revokes all refresh tokens including the caller session', async () => {
      mockHashing.verify
        .mockResolvedValueOnce({ valid: true, needsRehash: false })
        .mockResolvedValueOnce({ valid: false, needsRehash: false });

      await service.changePassword('user-1', dto);

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revoked: false },
        data: { revoked: true },
      });
    });

    it.each([
      ['inactive', { ...user, isActive: false }],
      ['unverified', { ...user, emailVerifiedAt: null }],
      ['passwordless', { ...user, password: null }],
    ])('rejects an %s user even with a valid JWT', async (_l, found) => {
      mockPrisma.user.findUnique.mockResolvedValue(found);

      await expect(service.changePassword('user-1', dto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(mockHashing.verify).not.toHaveBeenCalled();
    });

    it('audits without sensitive data', async () => {
      mockHashing.verify
        .mockResolvedValueOnce({ valid: true, needsRehash: false })
        .mockResolvedValueOnce({ valid: false, needsRehash: false });

      await service.changePassword('user-1', dto);

      const entry = mockAudit.log.mock.calls.find(c => c[0].action === 'change_password')?.[0];
      expect(entry).toBeDefined();
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(dto.newPassword);
      expect(serialized).not.toContain(dto.currentPassword);
      expect(serialized).not.toContain('$argon2id$');
    });
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

```bash
npx jest --config jest.config.ts src/modules/auth/password.service.spec.ts
```

Expected: FAIL — `Cannot find module './password.service'`.

- [ ] **Step 4: Implement PasswordService**

Create `backend/src/modules/auth/password.service.ts`:

```ts
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserActionTokenType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, Tx } from '../audit/audit.service';
import { HashingService } from '../hashing/hashing.service';
import { UserActionTokensService } from '../user-action-tokens/user-action-tokens.service';
import { MAIL_SERVICE, MailService } from '../mail/mail.service';
import { buildPasswordResetEmail } from '../mail/templates/password-reset.template';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/** The one response the forgot-password endpoint ever returns. */
export const GENERIC_RESET_MESSAGE =
  'Se o e-mail estiver cadastrado, enviaremos as instruções para redefinição da senha.';

/** Per-user throttle: at most this many reset tokens inside the window. */
const RESET_WINDOW_MINUTES = 15;
const RESET_MAX_PER_WINDOW = 3;

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: UserActionTokensService,
    private readonly hashing: HashingService,
    @Inject(MAIL_SERVICE) private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Always resolves to the same message, whatever the account's state. Every
   * early return below is silent on purpose — distinguishing them would
   * enumerate accounts.
   */
  async requestReset(email: string): Promise<{ message: string }> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });

    const eligible = Boolean(user && user.isActive && user.emailVerifiedAt && user.password);
    if (!user || !eligible) {
      return { message: GENERIC_RESET_MESSAGE };
    }

    const recent = await this.tokens.countRecent(
      user.id,
      UserActionTokenType.password_reset,
      RESET_WINDOW_MINUTES,
    );
    if (recent >= RESET_MAX_PER_WINDOW) {
      return { message: GENERIC_RESET_MESSAGE };
    }

    const rawToken = await this.prisma.$transaction(async (tx: Tx) => {
      await this.tokens.revokePending(user.id, UserActionTokenType.password_reset, tx);
      return this.tokens.issue(user.id, UserActionTokenType.password_reset, tx);
    });

    const frontendUrl = this.configService.get<string>('app.frontendUrl');
    // Fragment, not query string: the token never reaches a server log or a Referer.
    const resetUrl = `${frontendUrl}/reset-password#token=${rawToken}`;

    try {
      await this.mail.send({
        to: user.email,
        ...buildPasswordResetEmail({ name: user.name, resetUrl }),
      });
    } catch {
      // The public response must not change. Nothing identifying is logged.
      this.logger.error('Falha ao enviar e-mail de redefinição de senha (detalhes omitidos)');
    }

    // No audit entry: the request is anonymous and AuditLog.userId means "actor".
    return { message: GENERIC_RESET_MESSAGE };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    if (dto.password !== dto.passwordConfirmation) {
      throw new BadRequestException('A confirmação não corresponde à senha');
    }

    const passwordHash = await this.hashing.hash(dto.password);

    await this.prisma.$transaction(async (tx: Tx) => {
      const { userId } = await this.tokens.consume(
        dto.token,
        UserActionTokenType.password_reset,
        tx,
      );

      await tx.user.update({
        where: { id: userId },
        data: { password: passwordHash, passwordChangedAt: new Date() },
      });

      await tx.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      });

      await this.audit.log(
        { userId, action: 'reset_password', entity: 'User', entityId: userId },
        tx,
      );
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.isActive || !user.emailVerifiedAt || !user.password) {
      throw new UnauthorizedException('Sessão inválida');
    }

    if (dto.newPassword !== dto.newPasswordConfirmation) {
      throw new BadRequestException('A confirmação não corresponde à senha');
    }

    // Cheap pre-check only — the authoritative rule is the hash comparison below.
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('A nova senha deve ser diferente da senha atual');
    }

    const current = await this.hashing.verify(user.password, dto.currentPassword);
    if (!current.valid) {
      throw new BadRequestException('Senha atual incorreta');
    }

    const sameAsStored = await this.hashing.verify(user.password, dto.newPassword);
    if (sameAsStored.valid) {
      throw new BadRequestException('A nova senha deve ser diferente da senha atual');
    }

    const passwordHash = await this.hashing.hash(dto.newPassword);

    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { password: passwordHash, passwordChangedAt: new Date() },
      });

      // Every session ends, including the caller's — the frontend redirects to login.
      await tx.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      });

      await this.audit.log(
        { userId, action: 'change_password', entity: 'User', entityId: userId },
        tx,
      );
    });
  }
}
```

- [ ] **Step 5: Add the controller routes**

In `backend/src/modules/auth/auth.controller.ts`, add the imports and the three handlers:

```ts
import { PasswordService } from './password.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
```

Extend the constructor:

```ts
constructor(
  private readonly authService: AuthService,
  private readonly passwordService: PasswordService,
) {}
```

Append the handlers inside the class:

```ts
@Throttle({ global: { ttl: 900_000, limit: 5 } })
@Post('forgot-password')
@HttpCode(HttpStatus.OK)
async forgotPassword(@Body() dto: ForgotPasswordDto) {
  return this.passwordService.requestReset(dto.email);
}

@Throttle({ global: { ttl: 900_000, limit: 10 } })
@Post('reset-password')
@HttpCode(HttpStatus.NO_CONTENT)
async resetPassword(@Body() dto: ResetPasswordDto) {
  await this.passwordService.resetPassword(dto);
}

@UseGuards(JwtAuthGuard)
@Throttle({ global: { ttl: 900_000, limit: 10 } })
@Post('change-password')
@HttpCode(HttpStatus.NO_CONTENT)
async changePassword(@CurrentUser() user: User, @Body() dto: ChangePasswordDto) {
  await this.passwordService.changePassword(user.id, dto);
}
```

- [ ] **Step 6: Register the provider and extend the sensitive-path list**

In `backend/src/modules/auth/auth.module.ts` add `MailModule`, `UserActionTokensModule`, `AuditModule` and `PrismaModule` to `imports` and `PasswordService` to `providers`:

```ts
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { MailModule } from '../mail/mail.module';
import { UserActionTokensModule } from '../user-action-tokens/user-action-tokens.module';
import { PasswordService } from './password.service';
// ...
imports: [
  UsersModule,
  PassportModule,
  PrismaModule,
  AuditModule,
  HashingModule,
  MailModule,
  UserActionTokensModule,
  JwtModule.register({}),
],
providers: [AuthService, PasswordService, LocalStrategy, JwtStrategy, JwtRefreshStrategy],
exports: [AuthService, PasswordService],
```

In `backend/src/common/filters/global-exception.filter.ts`, extend line 13. The list drives **request-body redaction in server logs and telemetry only** — it never alters a response, so password-policy messages still reach the client:

```ts
// Paths that may carry credentials or single-use tokens — never log their
// request body or detailed context. Responses are unaffected.
const SENSITIVE_PATHS = [
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
  '/auth/activate-account',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/change-password',
];
```

- [ ] **Step 7: Run the suite**

```bash
npx jest --config jest.config.ts src/modules/auth
npm run test && npm run build
```

Expected: the new `PasswordService` suite passes (26 tests) and everything else stays green.

- [ ] **Step 8: Commit**

```bash
cd /home/userterras/Documents/inventory-manager
git add backend/src/modules/auth backend/src/common/filters/global-exception.filter.ts
git commit -m "$(cat <<'MSG'
feat(auth): add forgot, reset and authenticated change-password flows

forgot-password always returns one generic message and stays identical when
SMTP fails. reset and change run in a transaction, stamp passwordChangedAt
and revoke every refresh token. "New password differs" is decided by
verifying against the stored hash, not by comparing plaintext.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: InvitationsService and account activation

**Files:**
- Create: `backend/src/modules/users/invitations.service.ts`
- Create: `backend/src/modules/auth/dto/activate-account.dto.ts`
- Modify: `backend/src/modules/auth/auth.controller.ts`
- Modify: `backend/src/modules/users/users.module.ts`
- Test: `backend/src/modules/users/invitations.service.spec.ts`

**Interfaces:**
- Consumes: `HashingService`, `UserActionTokensService`, `MAIL_SERVICE`, `AuditService`, `PrismaService`, `app.frontendUrl`.
- Produces:
  - `type InvitationStatus = 'none' | 'pending' | 'expired' | 'revoked' | 'accepted'`
  - `deriveInvitationStatus(user: { passwordSetAt: Date | null }, latest: UserActionToken | undefined, now?: Date): InvitationStatus`
  - `InvitationsService.sendInvitation(userId: string, tx?: Tx): Promise<boolean>` — resolves `true` when the mail was accepted, `false` when delivery failed. Never throws on delivery failure.
  - `InvitationsService.activate(dto: ActivateAccountDto): Promise<void>`
  - `InvitationsService.revoke(userId: string, actorId: string): Promise<void>`
  - Route `POST /auth/activate-account`.
  - `UsersModule` exports `InvitationsService`.

- [ ] **Step 1: Write the DTO**

Create `backend/src/modules/auth/dto/activate-account.dto.ts`:

```ts
import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../hashing/is-strong-password.validator';
import { IsEqualTo } from '../../hashing/is-equal-to.validator';

export class ActivateAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token: string;

  @IsStrongPassword()
  password: string;

  @IsString()
  @IsEqualTo('password')
  passwordConfirmation: string;
}
```

- [ ] **Step 2: Write the failing status-derivation test**

Create `backend/src/modules/users/invitations.service.spec.ts` starting with the pure function, which is where the precedence rules live:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserActionTokenType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { HashingService } from '../hashing/hashing.service';
import { UserActionTokensService } from '../user-action-tokens/user-action-tokens.service';
import { MAIL_SERVICE } from '../mail/mail.service';
import { InvitationsService, deriveInvitationStatus } from './invitations.service';

const NOW = new Date('2026-09-15T12:00:00Z');

function token(overrides: Partial<any> = {}) {
  return {
    id: 't1',
    userId: 'user-1',
    type: UserActionTokenType.invitation,
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date('2026-09-16T12:00:00Z'),
    usedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-09-15T11:00:00Z'),
    ...overrides,
  };
}

describe('deriveInvitationStatus', () => {
  it('returns accepted when the password is set, whatever the tokens say', () => {
    expect(
      deriveInvitationStatus({ passwordSetAt: NOW }, token({ revokedAt: NOW }), NOW),
    ).toBe('accepted');
  });

  it('returns pending for a live token', () => {
    expect(deriveInvitationStatus({ passwordSetAt: null }, token(), NOW)).toBe('pending');
  });

  it('returns none when there is no token at all', () => {
    expect(deriveInvitationStatus({ passwordSetAt: null }, undefined, NOW)).toBe('none');
  });

  it('returns revoked when the newest token was revoked', () => {
    expect(
      deriveInvitationStatus({ passwordSetAt: null }, token({ revokedAt: NOW }), NOW),
    ).toBe('revoked');
  });

  it('returns expired when the newest token just aged out', () => {
    expect(
      deriveInvitationStatus(
        { passwordSetAt: null },
        token({ expiresAt: new Date('2026-09-14T12:00:00Z') }),
        NOW,
      ),
    ).toBe('expired');
  });

  it('returns expired for a used-but-not-activated token', () => {
    // Defensive: usedAt set without passwordSetAt should never be reachable,
    // but it must not read as pending.
    expect(
      deriveInvitationStatus({ passwordSetAt: null }, token({ usedAt: NOW }), NOW),
    ).toBe('expired');
  });
});
```

- [ ] **Step 3: Append the service tests to the same file**

```ts
const user = {
  id: 'user-1',
  name: 'Maria',
  email: 'maria@test.com',
  password: null,
  role: UserRole.attendant,
  isActive: true,
  emailVerifiedAt: null,
  passwordSetAt: null,
  passwordChangedAt: null,
  lastLogin: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
};
const mockTokens = {
  issue: jest.fn(),
  consume: jest.fn(),
  revokePending: jest.fn(),
  findLatest: jest.fn(),
};
const mockHashing = { hash: jest.fn() };
const mockMail = { send: jest.fn() };
const mockAudit = { log: jest.fn() };
const mockConfig = {
  get: jest.fn().mockImplementation((k: string) =>
    k === 'app.frontendUrl' ? 'http://localhost:5173' : undefined,
  ),
};

describe('InvitationsService', () => {
  let service: InvitationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
    mockTokens.issue.mockResolvedValue('RAW_INVITE_TOKEN');
    mockTokens.revokePending.mockResolvedValue(0);
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UserActionTokensService, useValue: mockTokens },
        { provide: HashingService, useValue: mockHashing },
        { provide: MAIL_SERVICE, useValue: mockMail },
        { provide: AuditService, useValue: mockAudit },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(InvitationsService);
  });

  describe('sendInvitation', () => {
    it('revokes pending invitations before issuing a new one', async () => {
      await service.sendInvitation('user-1');
      expect(mockTokens.revokePending).toHaveBeenCalledWith(
        'user-1',
        UserActionTokenType.invitation,
        expect.anything(),
      );
    });

    it('builds the activation link with the token in the fragment', async () => {
      await service.sendInvitation('user-1');
      const sent = mockMail.send.mock.calls[0][0];
      expect(sent.text).toContain('http://localhost:5173/activate-account#token=RAW_INVITE_TOKEN');
      expect(sent.text).not.toContain('?token=');
    });

    it('resolves true when the mail is accepted', async () => {
      mockMail.send.mockResolvedValue(undefined);
      await expect(service.sendInvitation('user-1')).resolves.toBe(true);
    });

    it('resolves false instead of throwing when delivery fails', async () => {
      mockMail.send.mockRejectedValue(new Error('SMTP down'));
      await expect(service.sendInvitation('user-1')).resolves.toBe(false);
    });

    it('keeps the issued token when delivery fails, so a resend works', async () => {
      mockMail.send.mockRejectedValue(new Error('SMTP down'));
      await service.sendInvitation('user-1');
      expect(mockTokens.issue).toHaveBeenCalledTimes(1);
    });

    it('logs a delivery failure without the token or the URL', async () => {
      mockMail.send.mockRejectedValue(new Error('SMTP down'));
      const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await service.sendInvitation('user-1');

      const logged = spy.mock.calls.map(c => String(c[0])).join(' ');
      expect(logged).not.toContain('RAW_INVITE_TOKEN');
      expect(logged).not.toContain('activate-account');
      spy.mockRestore();
    });
  });

  describe('activate', () => {
    const dto = {
      token: 'RAW_INVITE_TOKEN',
      password: 'uma senha bem comprida',
      passwordConfirmation: 'uma senha bem comprida',
    };

    beforeEach(() => {
      mockTokens.consume.mockResolvedValue({ userId: 'user-1' });
      mockHashing.hash.mockResolvedValue('$argon2id$new');
      mockPrisma.user.update.mockResolvedValue(user);
    });

    it('sets the password and both verification timestamps', async () => {
      await service.activate(dto);

      const data = mockPrisma.user.update.mock.calls[0][0].data;
      expect(data.password).toBe('$argon2id$new');
      expect(data.emailVerifiedAt).toBeInstanceOf(Date);
      expect(data.passwordSetAt).toBeInstanceOf(Date);
    });

    it('runs in a single transaction', async () => {
      await service.activate(dto);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('revokes the user other pending invitations', async () => {
      await service.activate(dto);
      expect(mockTokens.revokePending).toHaveBeenCalledWith(
        'user-1',
        UserActionTokenType.invitation,
        expect.anything(),
      );
    });

    it('issues no session — activation never authenticates', async () => {
      const result = await service.activate(dto);
      expect(result).toBeUndefined();
    });

    it.each([
      ['expired', 'Link inválido ou expirado'],
      ['used', 'Link inválido ou expirado'],
      ['revoked', 'Link inválido ou expirado'],
    ])('rejects a %s token with the generic message', async (_label, message) => {
      mockTokens.consume.mockRejectedValue(new BadRequestException(message));

      await expect(service.activate(dto)).rejects.toThrow('Link inválido ou expirado');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('never exposes the password in the audit payload', async () => {
      await service.activate(dto);

      const entry = mockAudit.log.mock.calls.find(c => c[0].action === 'activate_account')?.[0];
      expect(entry).toBeDefined();
      expect(JSON.stringify(entry)).not.toContain('uma senha bem comprida');
      expect(JSON.stringify(entry)).not.toContain('RAW_INVITE_TOKEN');
    });
  });

  describe('revoke', () => {
    it('revokes pending invitations and audits', async () => {
      mockTokens.revokePending.mockResolvedValue(1);

      await service.revoke('user-1', 'admin-1');

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          action: 'revoke_user_invitation',
          entity: 'User',
          entityId: 'user-1',
        }),
        expect.anything(),
      );
    });

    it('throws 404 when there is nothing pending to revoke', async () => {
      mockTokens.revokePending.mockResolvedValue(0);
      await expect(service.revoke('user-1', 'admin-1')).rejects.toThrow(
        'Nenhum convite pendente para este usuário',
      );
    });
  });
});
```

- [ ] **Step 4: Run it to make sure it fails**

```bash
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx jest --config jest.config.ts src/modules/users/invitations.service.spec.ts
```

Expected: FAIL — `Cannot find module './invitations.service'`.

- [ ] **Step 5: Implement InvitationsService**

Create `backend/src/modules/users/invitations.service.ts`:

```ts
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserActionToken, UserActionTokenType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, Tx } from '../audit/audit.service';
import { HashingService } from '../hashing/hashing.service';
import { UserActionTokensService } from '../user-action-tokens/user-action-tokens.service';
import { MAIL_SERVICE, MailService } from '../mail/mail.service';
import { buildInvitationEmail } from '../mail/templates/invitation.template';
import { ActivateAccountDto } from '../auth/dto/activate-account.dto';

export type InvitationStatus = 'none' | 'pending' | 'expired' | 'revoked' | 'accepted';

/**
 * Deterministic precedence, first match wins. Derived rather than stored: a
 * persisted status has to be kept in sync with token expiry and eventually lies.
 */
export function deriveInvitationStatus(
  user: { passwordSetAt: Date | null },
  latest: UserActionToken | undefined,
  now: Date = new Date(),
): InvitationStatus {
  if (user.passwordSetAt) return 'accepted';
  if (!latest) return 'none';

  const live = !latest.usedAt && !latest.revokedAt && latest.expiresAt > now;
  if (live) return 'pending';

  if (latest.revokedAt) return 'revoked';
  return 'expired';
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: UserActionTokensService,
    private readonly hashing: HashingService,
    @Inject(MAIL_SERVICE) private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Issues a fresh invitation and attempts delivery.
   *
   * Returns whether the mail was accepted. A delivery failure NEVER throws and
   * never rolls back the token: the caller reports invitationEmailSent: false
   * so the admin can resend against the same user instead of creating a duplicate.
   */
  async sendInvitation(userId: string, tx?: Tx): Promise<boolean> {
    const user = await (tx ?? this.prisma).user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const issue = async (client: Tx) => {
      await this.tokens.revokePending(userId, UserActionTokenType.invitation, client);
      return this.tokens.issue(userId, UserActionTokenType.invitation, client);
    };

    const rawToken = tx ? await issue(tx) : await this.prisma.$transaction(issue);

    const frontendUrl = this.configService.get<string>('app.frontendUrl');
    // Fragment, not query string: the token never reaches a server log or a Referer.
    const activationUrl = `${frontendUrl}/activate-account#token=${rawToken}`;

    try {
      await this.mail.send({
        to: user.email,
        ...buildInvitationEmail({ name: user.name, activationUrl }),
      });
      return true;
    } catch {
      this.logger.error('Falha ao enviar e-mail de convite (detalhes omitidos)');
      return false;
    }
  }

  async activate(dto: ActivateAccountDto): Promise<void> {
    const passwordHash = await this.hashing.hash(dto.password);

    await this.prisma.$transaction(async (tx: Tx) => {
      const { userId } = await this.tokens.consume(
        dto.token,
        UserActionTokenType.invitation,
        tx,
      );

      const now = new Date();
      await tx.user.update({
        where: { id: userId },
        data: {
          password: passwordHash,
          emailVerifiedAt: now,
          passwordSetAt: now,
        },
      });

      // Any other invitation still outstanding for this account is now moot.
      await this.tokens.revokePending(userId, UserActionTokenType.invitation, tx);

      await this.audit.log(
        { userId, action: 'activate_account', entity: 'User', entityId: userId },
        tx,
      );
    });

    // Deliberately no tokens returned: the user is sent to the login screen.
  }

  async revoke(userId: string, actorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx: Tx) => {
      const revoked = await this.tokens.revokePending(
        userId,
        UserActionTokenType.invitation,
        tx,
      );

      if (revoked === 0) {
        throw new NotFoundException('Nenhum convite pendente para este usuário');
      }

      await this.audit.log(
        {
          userId: actorId,
          action: 'revoke_user_invitation',
          entity: 'User',
          entityId: userId,
        },
        tx,
      );
    });
  }
}
```

- [ ] **Step 6: Add the activation route**

In `backend/src/modules/auth/auth.controller.ts`, inject `InvitationsService` and add:

```ts
@Throttle({ global: { ttl: 900_000, limit: 10 } })
@Post('activate-account')
@HttpCode(HttpStatus.NO_CONTENT)
async activateAccount(@Body() dto: ActivateAccountDto) {
  await this.invitationsService.activate(dto);
}
```

`UsersModule` must export `InvitationsService` for this to resolve — `AuthModule` already imports `UsersModule`.

- [ ] **Step 7: Update UsersModule**

Replace `backend/src/modules/users/users.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { HashingModule } from '../hashing/hashing.module';
import { MailModule } from '../mail/mail.module';
import { UserActionTokensModule } from '../user-action-tokens/user-action-tokens.module';
import { UsersService } from './users.service';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [PrismaModule, AuditModule, HashingModule, MailModule, UserActionTokensModule],
  providers: [UsersService, InvitationsService],
  exports: [UsersService, InvitationsService],
})
export class UsersModule {}
```

- [ ] **Step 8: Run the suites, build, commit**

```bash
npx jest --config jest.config.ts src/modules/users src/modules/auth
npm run test && npm run build
```

```bash
cd /home/userterras/Documents/inventory-manager
git add backend/src/modules/users backend/src/modules/auth
git commit -m "$(cat <<'MSG'
feat(users): add invitation issuing, activation and revocation

Invitations carry a fragment token, are single-use, and survive a delivery
failure so the admin can resend without creating a duplicate user.
Activation sets the password and both verification timestamps in one
transaction and never authenticates the user.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Phase 3 — Admin users area

### Task 9: UserResponseMapper, list and detail

**Files:**
- Create: `backend/src/modules/users/user-response.mapper.ts`
- Create: `backend/src/modules/users/dto/list-users.dto.ts`
- Modify: `backend/src/modules/users/users.service.ts`
- Test: `backend/src/modules/users/users.service.spec.ts`
- Test: `backend/src/modules/users/user-response.mapper.spec.ts`

**Interfaces:**
- Consumes: `deriveInvitationStatus`, `UserActionTokensService.findLatest`.
- Produces:
  - `USER_SELECT` — the explicit Prisma select every user query uses.
  - `interface UserResponse { id, name, email, role, isActive, emailVerifiedAt, passwordSetAt, lastLogin, createdAt, updatedAt, invitationStatus, invitationExpiresAt }`
  - `toUserResponse(user, latestInvitation?): UserResponse`
  - `UsersService.findAllPaginated(query: ListUsersDto): Promise<PaginatedResult<UserResponse>>`
  - `UsersService.findByIdOrFail(id: string): Promise<UserResponse>`

- [ ] **Step 1: Write the failing mapper test**

Create `backend/src/modules/users/user-response.mapper.spec.ts`:

```ts
import { UserRole, UserActionTokenType } from '@prisma/client';
import { USER_SELECT, toUserResponse } from './user-response.mapper';

const row = {
  id: 'user-1',
  name: 'Maria',
  email: 'maria@test.com',
  role: UserRole.attendant,
  isActive: true,
  emailVerifiedAt: null,
  passwordSetAt: null,
  lastLogin: null,
  createdAt: new Date('2026-09-01'),
  updatedAt: new Date('2026-09-01'),
};

const pending = {
  id: 't1',
  userId: 'user-1',
  type: UserActionTokenType.invitation,
  tokenHash: 'a'.repeat(64),
  expiresAt: new Date('2099-01-01'),
  usedAt: null,
  revokedAt: null,
  createdAt: new Date('2026-09-01'),
};

describe('USER_SELECT', () => {
  it('never selects the password', () => {
    expect(USER_SELECT).not.toHaveProperty('password');
  });

  it('selects exactly the public columns', () => {
    expect(Object.keys(USER_SELECT).sort()).toEqual(
      [
        'createdAt',
        'email',
        'emailVerifiedAt',
        'id',
        'isActive',
        'lastLogin',
        'name',
        'passwordSetAt',
        'role',
        'updatedAt',
      ].sort(),
    );
  });
});

describe('toUserResponse', () => {
  it('exposes no password and no tokenHash', () => {
    const response = toUserResponse(row, pending);
    expect(response).not.toHaveProperty('password');
    expect(response).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(response)).not.toContain('a'.repeat(64));
  });

  it('derives the invitation status', () => {
    expect(toUserResponse(row, pending).invitationStatus).toBe('pending');
    expect(toUserResponse(row, undefined).invitationStatus).toBe('none');
  });

  it('exposes invitationExpiresAt only while pending', () => {
    expect(toUserResponse(row, pending).invitationExpiresAt).toEqual(pending.expiresAt);
    expect(toUserResponse(row, { ...pending, revokedAt: new Date() }).invitationExpiresAt).toBeNull();
    expect(toUserResponse({ ...row, passwordSetAt: new Date() }, pending).invitationExpiresAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails, then implement the mapper**

```bash
npx jest --config jest.config.ts src/modules/users/user-response.mapper.spec.ts
```

Expected: FAIL — module not found. Then create `backend/src/modules/users/user-response.mapper.ts`:

```ts
import { Prisma, UserActionToken, UserRole } from '@prisma/client';
import { deriveInvitationStatus, InvitationStatus } from './invitations.service';

/**
 * The only shape in which a user leaves this module. Declared as a Prisma
 * select so `password` cannot be picked up by accident when a column is added.
 */
export const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  emailVerifiedAt: true,
  passwordSetAt: true,
  lastLogin: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type SelectedUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export interface UserResponse {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  passwordSetAt: Date | null;
  lastLogin: Date | null;
  createdAt: Date;
  updatedAt: Date;
  invitationStatus: InvitationStatus;
  /** Only set while the invitation is pending. */
  invitationExpiresAt: Date | null;
}

export function toUserResponse(
  user: SelectedUser,
  latestInvitation?: UserActionToken,
  now: Date = new Date(),
): UserResponse {
  const invitationStatus = deriveInvitationStatus(user, latestInvitation, now);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    emailVerifiedAt: user.emailVerifiedAt,
    passwordSetAt: user.passwordSetAt,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    invitationStatus,
    invitationExpiresAt:
      invitationStatus === 'pending' ? (latestInvitation?.expiresAt ?? null) : null,
  };
}
```

- [ ] **Step 3: Write the list DTO**

Create `backend/src/modules/users/dto/list-users.dto.ts`:

```ts
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class ListUsersDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}
```

- [ ] **Step 4: Write the failing list/detail test**

Create `backend/src/modules/users/users.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UserActionTokensService } from '../user-action-tokens/user-action-tokens.service';
import { InvitationsService } from './invitations.service';
import { UsersService } from './users.service';
import { USER_SELECT } from './user-response.mapper';

const row = {
  id: 'user-1',
  name: 'Maria',
  email: 'maria@test.com',
  role: UserRole.attendant,
  isActive: true,
  emailVerifiedAt: null,
  passwordSetAt: null,
  lastLogin: null,
  createdAt: new Date('2026-09-01'),
  updatedAt: new Date('2026-09-01'),
};

const mockPrisma = {
  user: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: { updateMany: jest.fn() },
  $transaction: jest.fn(),
};
const mockTokens = { findLatest: jest.fn() };
const mockInvitations = { sendInvitation: jest.fn(), revoke: jest.fn() };
const mockAudit = { log: jest.fn() };

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
    mockTokens.findLatest.mockResolvedValue(new Map());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UserActionTokensService, useValue: mockTokens },
        { provide: InvitationsService, useValue: mockInvitations },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('findAllPaginated', () => {
    beforeEach(() => {
      mockPrisma.user.findMany.mockResolvedValue([row]);
      mockPrisma.user.count.mockResolvedValue(1);
    });

    it('uses the explicit select and never returns a password', async () => {
      const result = await service.findAllPaginated({});

      expect(mockPrisma.user.findMany.mock.calls[0][0].select).toBe(USER_SELECT);
      expect(result.data[0]).not.toHaveProperty('password');
    });

    it('coerces string page and limit (PaginationDto intersection quirk)', async () => {
      const result = await service.findAllPaginated({ page: '2' as any, limit: '5' as any });

      expect(result.page).toBe(2);
      expect(result.limit).toBe(5);
      expect(mockPrisma.user.findMany.mock.calls[0][0].skip).toBe(5);
      expect(mockPrisma.user.findMany.mock.calls[0][0].take).toBe(5);
    });

    it('searches name and e-mail case-insensitively', async () => {
      await service.findAllPaginated({ search: 'MAR' });

      expect(mockPrisma.user.findMany.mock.calls[0][0].where.OR).toEqual([
        { name: { contains: 'MAR', mode: 'insensitive' } },
        { email: { contains: 'mar', mode: 'insensitive' } },
      ]);
    });

    it('filters by role and status', async () => {
      await service.findAllPaginated({ role: UserRole.financial, status: 'inactive' });

      const where = mockPrisma.user.findMany.mock.calls[0][0].where;
      expect(where.role).toBe(UserRole.financial);
      expect(where.isActive).toBe(false);
    });

    it('lists every role including admin', async () => {
      await service.findAllPaginated({});
      expect(mockPrisma.user.findMany.mock.calls[0][0].where.role).toBeUndefined();
    });

    it('fetches invitation tokens for the whole page in one query', async () => {
      mockPrisma.user.findMany.mockResolvedValue([row, { ...row, id: 'user-2' }]);
      await service.findAllPaginated({});

      expect(mockTokens.findLatest).toHaveBeenCalledTimes(1);
      expect(mockTokens.findLatest.mock.calls[0][0]).toEqual(['user-1', 'user-2']);
    });
  });

  describe('findByIdOrFail', () => {
    it('returns the mapped user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(row);
      const result = await service.findByIdOrFail('user-1');
      expect(result.id).toBe('user-1');
      expect(result).not.toHaveProperty('password');
    });

    it('throws 404 when missing', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findByIdOrFail('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
```

- [ ] **Step 5: Implement list and detail**

Replace `backend/src/modules/users/users.service.ts` with (keeping `findByEmail` and `findById`, which `AuthService` and `JwtStrategy` depend on):

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { User, UserActionTokenType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PaginatedResult } from '../../common/types/paginated-result.interface';
import { UserActionTokensService } from '../user-action-tokens/user-action-tokens.service';
import { InvitationsService } from './invitations.service';
import { USER_SELECT, UserResponse, toUserResponse } from './user-response.mapper';
import { ListUsersDto } from './dto/list-users.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: UserActionTokensService,
    private readonly invitations: InvitationsService,
    private readonly audit: AuditService,
  ) {}

  /** Used by AuthService — returns the full row including the password hash. */
  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
  }

  /** Used by JwtStrategy — returns the full row including the password hash. */
  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findAllPaginated(query: ListUsersDto): Promise<PaginatedResult<UserResponse>> {
    // PaginationDto arrives as strings through an intersection type — coerce.
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search.toLowerCase(), mode: 'insensitive' } },
      ];
    }

    if (query.role) where.role = query.role;
    if (query.status) where.isActive = query.status === 'active';

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    // One query for the whole page instead of one per row.
    const invitations = await this.tokens.findLatest(
      rows.map(r => r.id),
      UserActionTokenType.invitation,
    );

    return {
      data: rows.map(r => toUserResponse(r, invitations.get(r.id))),
      total,
      page,
      limit,
    };
  }

  async findByIdOrFail(id: string): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const invitations = await this.tokens.findLatest([id], UserActionTokenType.invitation);
    return toUserResponse(user, invitations.get(id));
  }
}
```

- [ ] **Step 6: Run the suites, build, commit**

```bash
npx jest --config jest.config.ts src/modules/users
npm run test && npm run build
```

```bash
cd /home/userterras/Documents/inventory-manager
git add backend/src/modules/users
git commit -m "$(cat <<'MSG'
feat(users): add paginated listing and detail with mapped responses

Every user query goes through an explicit Prisma select and a mapper, so no
response can leak a password hash. Invitation status is derived per request
and its tokens are fetched once per page.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: Create, update, status, resend and revoke

**Files:**
- Create: `backend/src/modules/users/dto/create-user.dto.ts`
- Create: `backend/src/modules/users/dto/update-user.dto.ts`
- Create: `backend/src/modules/users/dto/update-user-status.dto.ts`
- Modify: `backend/src/modules/users/users.service.ts`
- Test: `backend/src/modules/users/users.service.spec.ts` (extend)

**Interfaces:**
- Consumes: Task 9's mapper, `InvitationsService.sendInvitation`, `InvitationsService.revoke`.
- Produces:
  - `type InvitableRole = 'attendant' | 'financial'`
  - `UsersService.create(dto, actorId): Promise<{ user: UserResponse; invitationEmailSent: boolean }>`
  - `UsersService.update(id, dto, actorId): Promise<UserResponse>`
  - `UsersService.setStatus(id, isActive, actorId): Promise<UserResponse>`
  - `UsersService.resendInvitation(id, actorId): Promise<{ user: UserResponse; invitationEmailSent: boolean }>`
  - `UsersService.revokeInvitation(id, actorId): Promise<void>`

- [ ] **Step 1: Write the DTOs**

Create `backend/src/modules/users/dto/create-user.dto.ts`:

```ts
import { IsEmail, IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { UserRole } from '@prisma/client';

/** Roles an admin may assign through this flow. `admin` is deliberately absent. */
export const INVITABLE_ROLES = [UserRole.attendant, UserRole.financial] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(150)
  email: string;

  @IsIn(INVITABLE_ROLES, {
    message: 'Perfil inválido. Apenas attendant ou financial podem ser criados',
  })
  role: InvitableRole;
}
```

Create `backend/src/modules/users/dto/update-user.dto.ts`:

```ts
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { INVITABLE_ROLES, InvitableRole } from './create-user.dto';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(INVITABLE_ROLES, {
    message: 'Perfil inválido. Apenas attendant ou financial podem ser atribuídos',
  })
  role?: InvitableRole;
}
```

Create `backend/src/modules/users/dto/update-user-status.dto.ts`:

```ts
import { IsBoolean } from 'class-validator';

export class UpdateUserStatusDto {
  @IsBoolean()
  isActive: boolean;
}
```

`main.ts` already runs `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`, so any extra field — `password`, `isActive` on create, `emailVerifiedAt` — is rejected with a 400 rather than silently dropped. No extra work needed, but do not weaken those options.

- [ ] **Step 2: Write the failing mutation tests**

Append to `backend/src/modules/users/users.service.spec.ts`:

```ts
describe('create', () => {
  beforeEach(() => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ ...row, id: 'new-user' });
    mockPrisma.user.findUnique.mockResolvedValue({ ...row, id: 'new-user' });
    mockInvitations.sendInvitation.mockResolvedValue(true);
  });

  it('creates an attendant and reports the invitation as sent', async () => {
    const result = await service.create(
      { name: 'Maria', email: 'maria@test.com', role: UserRole.attendant },
      'admin-1',
    );

    expect(result.invitationEmailSent).toBe(true);
    expect(mockPrisma.user.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ role: UserRole.attendant, password: null, isActive: true }),
    );
  });

  it('creates a financial user', async () => {
    await service.create(
      { name: 'João', email: 'joao@test.com', role: UserRole.financial },
      'admin-1',
    );
    expect(mockPrisma.user.create.mock.calls[0][0].data.role).toBe(UserRole.financial);
  });

  it('normalizes the e-mail with trim and lowercase', async () => {
    await service.create(
      { name: 'Maria', email: '  MARIA@Test.COM  ', role: UserRole.attendant },
      'admin-1',
    );
    expect(mockPrisma.user.create.mock.calls[0][0].data.email).toBe('maria@test.com');
  });

  it('rejects a duplicate e-mail case-insensitively with 409', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(row);
    await expect(
      service.create({ name: 'Maria', email: 'MARIA@TEST.COM', role: UserRole.attendant }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps a Prisma unique-constraint race to 409', async () => {
    mockPrisma.user.create.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' }),
    );
    await expect(
      service.create({ name: 'Maria', email: 'maria@test.com', role: UserRole.attendant }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to create an admin even if the DTO is bypassed', async () => {
    await expect(
      service.create({ name: 'X', email: 'x@test.com', role: 'admin' as any }, 'admin-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('keeps the user and reports false when delivery fails', async () => {
    mockInvitations.sendInvitation.mockResolvedValue(false);

    const result = await service.create(
      { name: 'Maria', email: 'maria@test.com', role: UserRole.attendant },
      'admin-1',
    );

    expect(result.invitationEmailSent).toBe(false);
    expect(result.user.id).toBe('new-user');
    const actions = mockAudit.log.mock.calls.map(c => c[0].action);
    expect(actions).toContain('invitation_email_failed');
  });

  it('never returns a password and never audits one', async () => {
    const result = await service.create(
      { name: 'Maria', email: 'maria@test.com', role: UserRole.attendant },
      'admin-1',
    );

    expect(result.user).not.toHaveProperty('password');
    expect(JSON.stringify(mockAudit.log.mock.calls)).not.toContain('password');
  });
});

describe('update', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue(row);
    mockPrisma.user.update.mockResolvedValue(row);
  });

  it('updates the name', async () => {
    await service.update('user-1', { name: 'Maria Silva' }, 'admin-1');
    expect(mockPrisma.user.update.mock.calls[0][0].data).toEqual({ name: 'Maria Silva' });
  });

  it('revokes refresh tokens when the role changes', async () => {
    await service.update('user-1', { role: UserRole.financial }, 'admin-1');
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revoked: false },
      data: { revoked: true },
    });
  });

  it('does not revoke sessions for a name-only change', async () => {
    await service.update('user-1', { name: 'Maria Silva' }, 'admin-1');
    expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to modify an admin target', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...row, role: UserRole.admin });
    await expect(
      service.update('user-1', { name: 'X' }, 'admin-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a self role change', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...row, id: 'admin-1' });
    await expect(
      service.update('admin-1', { role: UserRole.financial }, 'admin-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws 404 for a missing user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.update('nope', { name: 'X' }, 'admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('setStatus', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue(row);
    mockPrisma.user.update.mockResolvedValue({ ...row, isActive: false });
  });

  it('deactivates and revokes refresh tokens in the same transaction', async () => {
    await service.setStatus('user-1', false, 'admin-1');

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revoked: false },
      data: { revoked: true },
    });
  });

  it('does not revoke sessions when reactivating', async () => {
    await service.setStatus('user-1', true, 'admin-1');
    expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to change the caller own status', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...row, id: 'admin-1' });
    await expect(service.setStatus('admin-1', false, 'admin-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses an admin target', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...row, role: UserRole.admin });
    await expect(service.setStatus('user-1', false, 'admin-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses to deactivate the last active admin', async () => {
    // Guard is reachable only once admin management is enabled; assert it directly.
    mockPrisma.user.findUnique.mockResolvedValue({ ...row, role: UserRole.admin });
    mockPrisma.user.count.mockResolvedValue(1);
    await expect(
      (service as any).assertNotLastActiveAdmin({ ...row, role: UserRole.admin }),
    ).rejects.toThrow(/último administrador/);
  });
});

describe('resendInvitation', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue(row);
    mockInvitations.sendInvitation.mockResolvedValue(true);
  });

  it('reissues and reports delivery', async () => {
    const result = await service.resendInvitation('user-1', 'admin-1');
    expect(result.invitationEmailSent).toBe(true);
    expect(mockInvitations.sendInvitation).toHaveBeenCalledWith('user-1');
  });

  it('refuses a user who already activated', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...row, passwordSetAt: new Date() });
    await expect(service.resendInvitation('user-1', 'admin-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses an inactive user and never changes isActive', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...row, isActive: false });

    await expect(service.resendInvitation('user-1', 'admin-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

describe('revokeInvitation', () => {
  it('delegates to InvitationsService', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(row);
    await service.revokeInvitation('user-1', 'admin-1');
    expect(mockInvitations.revoke).toHaveBeenCalledWith('user-1', 'admin-1');
  });
});
```

Add `ConflictException`, `ForbiddenException` and `NotFoundException` to the `@nestjs/common` import, and add `count: jest.fn()` to `mockPrisma.user`.

- [ ] **Step 3: Run it to make sure it fails**

```bash
npx jest --config jest.config.ts src/modules/users/users.service.spec.ts
```

Expected: FAIL — `service.create is not a function`.

- [ ] **Step 4: Implement the mutations**

Append to `backend/src/modules/users/users.service.ts` (and add the imports):

```ts
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Tx } from '../audit/audit.service';
import { CreateUserDto, INVITABLE_ROLES } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
```

```ts
  async create(
    dto: CreateUserDto,
    actorId: string,
  ): Promise<{ user: UserResponse; invitationEmailSent: boolean }> {
    // The DTO already restricts this, but a DTO is not a security boundary.
    if (!INVITABLE_ROLES.includes(dto.role as any)) {
      throw new ForbiddenException('Não é permitido criar usuários administradores por este fluxo');
    }

    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Já existe um usuário com este e-mail');
    }

    let created: { id: string };
    try {
      created = await this.prisma.$transaction(async (tx: Tx) => {
        const user = await tx.user.create({
          data: {
            name: dto.name,
            email,
            role: dto.role,
            // No password: the user sets it through the invitation link.
            password: null,
            isActive: true,
          },
          select: { id: true },
        });

        await this.audit.log(
          {
            userId: actorId,
            action: 'create_user',
            entity: 'User',
            entityId: user.id,
            payload: { role: dto.role },
          },
          tx,
        );

        return user;
      });
    } catch (error: any) {
      // Loses the race against the functional unique index — same 409.
      if (error?.code === 'P2002') {
        throw new ConflictException('Já existe um usuário com este e-mail');
      }
      throw error;
    }

    // Delivery happens after the commit, so a mail failure cannot roll back the
    // user. The token stays valid and the admin can resend on the same row.
    const invitationEmailSent = await this.invitations.sendInvitation(created.id);

    if (!invitationEmailSent) {
      await this.audit.log({
        userId: actorId,
        action: 'invitation_email_failed',
        entity: 'User',
        entityId: created.id,
        payload: { invitationEmailSent: false },
      });
    }

    return { user: await this.findByIdOrFail(created.id), invitationEmailSent };
  }

  async update(id: string, dto: UpdateUserDto, actorId: string): Promise<UserResponse> {
    const target = await this.requireManageableTarget(id);

    if (dto.role && id === actorId) {
      throw new ForbiddenException('Você não pode alterar seu próprio perfil por este fluxo');
    }

    const roleChanged = Boolean(dto.role && dto.role !== target.role);

    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
        },
      });

      if (roleChanged) {
        // The effective role already comes from the database on every request;
        // this exists so the frontend's cached role cannot linger in the UI.
        await tx.refreshToken.updateMany({
          where: { userId: id, revoked: false },
          data: { revoked: true },
        });
      }

      await this.audit.log(
        {
          userId: actorId,
          action: 'update_user',
          entity: 'User',
          entityId: id,
          payload: { ...(dto.role ? { role: dto.role } : {}) },
        },
        tx,
      );
    });

    return this.findByIdOrFail(id);
  }

  async setStatus(id: string, isActive: boolean, actorId: string): Promise<UserResponse> {
    if (id === actorId) {
      throw new ForbiddenException('Você não pode alterar o status da sua própria conta');
    }

    const target = await this.requireManageableTarget(id);

    if (!isActive) {
      await this.assertNotLastActiveAdmin(target);
    }

    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.user.update({ where: { id }, data: { isActive } });

      if (!isActive) {
        // Otherwise a disabled account keeps renewable sessions.
        await tx.refreshToken.updateMany({
          where: { userId: id, revoked: false },
          data: { revoked: true },
        });
      }

      await this.audit.log(
        {
          userId: actorId,
          action: 'update_user_status',
          entity: 'User',
          entityId: id,
          payload: { isActive },
        },
        tx,
      );
    });

    return this.findByIdOrFail(id);
  }

  async resendInvitation(
    id: string,
    actorId: string,
  ): Promise<{ user: UserResponse; invitationEmailSent: boolean }> {
    const target = await this.requireManageableTarget(id);

    if (target.passwordSetAt) {
      throw new ConflictException('Este usuário já ativou a conta');
    }

    if (!target.isActive) {
      // Never silently reactivate — the admin must do that explicitly.
      throw new ConflictException('Reative o usuário antes de reenviar o convite');
    }

    const invitationEmailSent = await this.invitations.sendInvitation(id);

    await this.audit.log({
      userId: actorId,
      action: 'resend_user_invitation',
      entity: 'User',
      entityId: id,
      payload: { invitationEmailSent },
    });

    return { user: await this.findByIdOrFail(id), invitationEmailSent };
  }

  async revokeInvitation(id: string, actorId: string): Promise<void> {
    await this.requireManageableTarget(id);
    await this.invitations.revoke(id, actorId);
  }

  /** 404 when absent, 403 when the target is an admin (admin management is out of scope). */
  private async requireManageableTarget(id: string) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true, passwordSetAt: true },
    });

    if (!target) throw new NotFoundException('Usuário não encontrado');

    if (target.role === 'admin') {
      throw new ForbiddenException('Gerenciamento de administradores não é permitido por este fluxo');
    }

    return target;
  }

  /**
   * Unreachable while admin targets are refused above — implemented and wired
   * so it is live the day admin management is enabled.
   */
  private async assertNotLastActiveAdmin(target: { id: string; role: string }): Promise<void> {
    if (target.role !== 'admin') return;

    const activeAdmins = await this.prisma.user.count({
      where: { role: 'admin', isActive: true, id: { not: target.id } },
    });

    if (activeAdmins === 0) {
      throw new ForbiddenException(
        'Não é possível desativar o último administrador ativo do sistema',
      );
    }
  }
```

- [ ] **Step 5: Run, build, commit**

```bash
npx jest --config jest.config.ts src/modules/users
npm run test && npm run build
```

```bash
cd /home/userterras/Documents/inventory-manager
git add backend/src/modules/users
git commit -m "$(cat <<'MSG'
feat(users): add admin create, edit, status, resend and revoke

Creation normalizes the e-mail, refuses the admin role at both the DTO and
service layers, and survives a mail failure by reporting
invitationEmailSent: false. Deactivation and role changes revoke refresh
tokens in the same transaction. Resend never mutates isActive.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 11: UsersController and RBAC

**Files:**
- Create: `backend/src/modules/users/users.controller.ts`
- Modify: `backend/src/modules/users/users.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/src/modules/users/users.controller.spec.ts`

**Interfaces:**
- Consumes: `UsersService` (Tasks 9–10).
- Produces: `GET /users`, `POST /users`, `GET /users/:id`, `PATCH /users/:id`, `PATCH /users/:id/status`, `POST /users/:id/resend-invitation`, `POST /users/:id/revoke-invitation` — all `admin`-only.

- [ ] **Step 1: Write the failing controller test**

Create `backend/src/modules/users/users.controller.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

const mockUsersService = {
  findAllPaginated: jest.fn(),
  findByIdOrFail: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  setStatus: jest.fn(),
  resendInvitation: jest.fn(),
  revokeInvitation: jest.fn(),
};

function contextFor(role: UserRole, handler: Function) {
  return {
    getHandler: () => handler,
    getClass: () => UsersController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'actor-1', role } }) }),
  } as any;
}

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();
    controller = module.get(UsersController);
  });

  describe('authorization metadata', () => {
    it('requires JwtAuthGuard and RolesGuard on the controller', () => {
      const guards = Reflect.getMetadata('__guards__', UsersController) ?? [];
      const names = guards.map((g: any) => g.name ?? g.constructor?.name);
      expect(names).toContain(JwtAuthGuard.name);
      expect(names).toContain(RolesGuard.name);
    });

    it.each([
      'findAll',
      'create',
      'findById',
      'update',
      'updateStatus',
      'resendInvitation',
      'revokeInvitation',
    ])('restricts %s to admin', method => {
      const roles = Reflect.getMetadata(ROLES_KEY, (UsersController.prototype as any)[method]);
      expect(roles).toEqual([UserRole.admin]);
    });

    it.each([UserRole.attendant, UserRole.financial])('RolesGuard rejects %s', role => {
      const guard = new RolesGuard(new Reflector());
      expect(() =>
        guard.canActivate(contextFor(role, UsersController.prototype.findAll)),
      ).toThrow(ForbiddenException);
    });

    it('RolesGuard allows admin', () => {
      const guard = new RolesGuard(new Reflector());
      expect(guard.canActivate(contextFor(UserRole.admin, UsersController.prototype.findAll))).toBe(
        true,
      );
    });
  });

  describe('delegation', () => {
    it('passes the actor id from the request to create', async () => {
      mockUsersService.create.mockResolvedValue({ user: { id: 'u1' }, invitationEmailSent: true });
      const dto = { name: 'Maria', email: 'maria@test.com', role: UserRole.attendant as any };

      const result = await controller.create(dto, { user: { id: 'actor-1' } } as any);

      expect(mockUsersService.create).toHaveBeenCalledWith(dto, 'actor-1');
      expect(result).toEqual({ user: { id: 'u1' }, invitationEmailSent: true });
    });

    it('passes the actor id to updateStatus', async () => {
      mockUsersService.setStatus.mockResolvedValue({ id: 'u1' });
      await controller.updateStatus('u1', { isActive: false }, { user: { id: 'actor-1' } } as any);
      expect(mockUsersService.setStatus).toHaveBeenCalledWith('u1', false, 'actor-1');
    });

    it('returns nothing from revokeInvitation', async () => {
      mockUsersService.revokeInvitation.mockResolvedValue(undefined);
      await expect(
        controller.revokeInvitation('u1', { user: { id: 'actor-1' } } as any),
      ).resolves.toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails, then implement the controller**

```bash
npx jest --config jest.config.ts src/modules/users/users.controller.spec.ts
```

Expected: FAIL — module not found. Create `backend/src/modules/users/users.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UsersService } from './users.service';
import { ListUsersDto } from './dto/list-users.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.admin)
  findAll(@Query() query: ListUsersDto) {
    return this.usersService.findAllPaginated(query);
  }

  @Post()
  @Roles(UserRole.admin)
  create(@Body() dto: CreateUserDto, @Request() req: any) {
    return this.usersService.create(dto, req.user.id);
  }

  @Get(':id')
  @Roles(UserRole.admin)
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findByIdOrFail(id);
  }

  @Patch(':id')
  @Roles(UserRole.admin)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Request() req: any,
  ) {
    return this.usersService.update(id, dto, req.user.id);
  }

  @Patch(':id/status')
  @Roles(UserRole.admin)
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @Request() req: any,
  ) {
    return this.usersService.setStatus(id, dto.isActive, req.user.id);
  }

  @Post(':id/resend-invitation')
  @Roles(UserRole.admin)
  @HttpCode(HttpStatus.OK)
  resendInvitation(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.usersService.resendInvitation(id, req.user.id);
  }

  @Post(':id/revoke-invitation')
  @Roles(UserRole.admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInvitation(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.usersService.revokeInvitation(id, req.user.id);
  }
}
```

- [ ] **Step 3: Register the controller and the new modules**

Add `controllers: [UsersController]` to `backend/src/modules/users/users.module.ts`.

In `backend/src/app.module.ts`, add the three infrastructure modules to `imports` (order does not matter; keep them grouped after `PrismaModule`):

```ts
import { HashingModule } from './modules/hashing/hashing.module';
import { MailModule } from './modules/mail/mail.module';
import { UserActionTokensModule } from './modules/user-action-tokens/user-action-tokens.module';
// ...
PrismaModule,
HashingModule,
MailModule,
UserActionTokensModule,
AuthModule,
UsersModule,
```

- [ ] **Step 4: Run everything, build, commit**

```bash
npx jest --config jest.config.ts src/modules/users
npm run test && npm run build
```

```bash
cd /home/userterras/Documents/inventory-manager
git add backend/src/modules/users backend/src/app.module.ts
git commit -m "$(cat <<'MSG'
feat(users): expose admin-only user management endpoints

Seven endpoints behind JwtAuthGuard + RolesGuard with @Roles(admin),
delegating to UsersService and passing the authenticated actor id for audit
attribution.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 12: Migrate the seeds off bcrypt

**Files:**
- Modify: `backend/prisma/seed.ts`
- Modify: `backend/prisma/seed-demo.ts:12,54`
- Modify: `backend/test/auth.e2e-spec.ts:8,35-47`
- Create: `backend/prisma/seed-hash.ts`

**Interfaces:**
- Consumes: `ARGON2_PARAMS` and the HMAC label — but seeds run outside Nest, so they cannot inject `HashingService`.
- Produces: `hashSeedPassword(password: string): Promise<string>` and `requireSeedPassword(): string`.

- [ ] **Step 1: Write the standalone seed hashing helper**

The seeds are plain `ts-node` scripts with no Nest container, so they need a small standalone helper that reproduces the same transformation. Create `backend/prisma/seed-hash.ts`:

```ts
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
```

- [ ] **Step 2: Update `prisma/seed.ts`**

Replace the bcrypt import (line 3) and the hashing call (line 23), and set the verification timestamps so the seeded admin can log in under the new gate:

```ts
import { hashSeedPassword, requireSeedPassword } from './seed-hash';
// ...
const seedPassword = requireSeedPassword();
const hashed = await hashSeedPassword(seedPassword);
const now = new Date();

const admin = await prisma.user.create({
  data: {
    name: 'Administrador',
    email: 'admin@inventory.local',
    password: hashed,
    role: UserRole.admin,
    emailVerifiedAt: now,
    passwordSetAt: now,
  },
});
```

Apply the same change in `prisma/seed-demo.ts` (line 12 import, line 54 hash), for all three demo users.

- [ ] **Step 3: Update the existing e2e spec**

In `backend/test/auth.e2e-spec.ts`, replace the bcrypt import (line 8) and the `upsert` (lines 35-47):

```ts
import { hashSeedPassword } from '../prisma/seed-hash';
// ...
const testPassword = 'E2E senha de teste bem comprida';
const hashed = await hashSeedPassword(testPassword);
const now = new Date();

await prisma.user.upsert({
  where: { email: 'e2e-test@test.com' },
  update: { password: hashed, emailVerifiedAt: now, passwordSetAt: now, isActive: true },
  create: {
    name: 'E2E Test User',
    email: 'e2e-test@test.com',
    password: hashed,
    role: 'admin',
    isActive: true,
    emailVerifiedAt: now,
    passwordSetAt: now,
  },
});
```

Then replace every `'Test@123456'` literal in that file with `testPassword` — the old value is blocklisted by the new policy and would also fail the length floor.

- [ ] **Step 4: Verify the seed path end to end**

```bash
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4

# Must fail with a clear instruction
npx ts-node prisma/seed.ts; echo "exit=$?"

# Then succeed with a generated password
export SEED_ADMIN_PASSWORD="$(openssl rand -base64 24)"
npx ts-node prisma/seed-demo.ts
echo "Dev password (do not commit): $SEED_ADMIN_PASSWORD"
```

Expected: the first run aborts naming `SEED_ADMIN_PASSWORD`; the second seeds three users whose `password` starts with `$argon2id$`. Verify:

```bash
npx prisma db execute --stdin <<'SQL'
SELECT email, left(password, 10) AS algo, email_verified_at IS NOT NULL AS verified
FROM users ORDER BY email;
SQL
```

Expected: every row shows `$argon2id$` and `verified = t`. No row starts with `$2a$`, `$2b$` or `$2y$`.

- [ ] **Step 5: Prove no code path still generates a bcrypt hash**

```bash
cd /home/userterras/Documents/inventory-manager/backend
grep -rn "bcrypt.hash\|bcrypt\.hashSync" src/ prisma/ test/ | grep -v "\.spec\.ts" | grep -v "e2e-spec"
```

Expected: **no output**. The only permitted `bcrypt.hash` calls are inside test files, where they
deliberately fabricate a legacy hash to exercise the migration path. Then confirm the remaining
bcrypt usage is verification only:

```bash
grep -rn "bcrypt" src/ | grep -v "\.spec\.ts"
```

Expected: exactly one non-test hit — `bcrypt.compare` inside
`src/modules/hashing/hashing.service.ts`.

- [ ] **Step 6: Run everything and commit**

```bash
npm run test && npm run build
```

```bash
cd /home/userterras/Documents/inventory-manager
git add backend/prisma backend/test/auth.e2e-spec.ts
git commit -m "$(cat <<'MSG'
refactor(seed): hash seed passwords with Argon2id and an env-provided secret

Seeds and the auth e2e fixture no longer produce bcrypt hashes. The seed
password comes from SEED_ADMIN_PASSWORD, is validated against the password
policy, and is never committed. Seeded users get verification timestamps so
they satisfy the new login gate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 13: End-to-end integration spec

**Files:**
- Create: `backend/test/users-passwords.e2e-spec.ts`

**Interfaces:**
- Consumes: the whole backend; `FakeMailService` for link retrieval.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the e2e spec**

Create `backend/test/users-passwords.e2e-spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import helmet from 'helmet';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeMailService } from '../src/modules/mail/fake-mail.service';
import { hashSeedPassword } from '../prisma/seed-hash';

const ADMIN_EMAIL = 'e2e-admin-upm@test.com';
const ATTENDANT_EMAIL = 'e2e-attendant-upm@test.com';
const INVITED_EMAIL = 'e2e-invited-upm@test.com';
const LEGACY_EMAIL = 'e2e-legacy-upm@test.com';
const PASSWORD = 'Senha e2e bem comprida 123';
const NEW_PASSWORD = 'Outra senha e2e bem comprida';

const ALL_EMAILS = [ADMIN_EMAIL, ATTENDANT_EMAIL, INVITED_EMAIL, LEGACY_EMAIL];

/** Pulls the token out of the fragment of the last fake-mail message. */
function lastTokenFrom(mail: FakeMailService): string {
  const last = mail.sent[mail.sent.length - 1];
  const match = last.text.match(/#token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('No fragment token found in the last message');
  return match[1];
}

describe('Users and passwords (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: FakeMailService;

  const api = () => request(app.getHttpServer());

  async function seedUser(email: string, role: string, password: string | null, extra = {}) {
    const now = new Date();
    return prisma.user.upsert({
      where: { email },
      update: { password, isActive: true, emailVerifiedAt: now, passwordSetAt: now, ...extra },
      create: {
        name: `E2E ${role}`,
        email,
        password,
        role: role as any,
        isActive: true,
        emailVerifiedAt: now,
        passwordSetAt: now,
        ...extra,
      },
    });
  }

  async function login(email: string, password: string) {
    const res = await api().post('/api/v1/auth/login').send({ email, password });
    return res.body as { accessToken: string; refreshToken: string };
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.MAIL_DRIVER = 'fake';

    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.use(helmet());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    prisma = module.get(PrismaService);
    mail = module.get(FakeMailService);
  });

  beforeEach(async () => {
    mail.reset();
    const hashed = await hashSeedPassword(PASSWORD);
    await seedUser(ADMIN_EMAIL, 'admin', hashed);
    await seedUser(ATTENDANT_EMAIL, 'attendant', hashed);
  });

  afterEach(async () => {
    await prisma.userActionToken.deleteMany({ where: { user: { email: { in: ALL_EMAILS } } } });
    await prisma.refreshToken.deleteMany({ where: { user: { email: { in: ALL_EMAILS } } } });
    await prisma.auditLog.deleteMany({ where: { user: { email: { in: ALL_EMAILS } } } });
    await prisma.user.deleteMany({ where: { email: { in: [INVITED_EMAIL, LEGACY_EMAIL] } } });
  });

  afterAll(async () => {
    await prisma.userActionToken.deleteMany({ where: { user: { email: { in: ALL_EMAILS } } } });
    await prisma.refreshToken.deleteMany({ where: { user: { email: { in: ALL_EMAILS } } } });
    await prisma.auditLog.deleteMany({ where: { user: { email: { in: ALL_EMAILS } } } });
    await prisma.user.deleteMany({ where: { email: { in: ALL_EMAILS } } });
    await app.close();
  });

  describe('invitation to activation to login', () => {
    it('completes the whole flow', async () => {
      const { accessToken } = await login(ADMIN_EMAIL, PASSWORD);

      const created = await api()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Convidada', email: INVITED_EMAIL, role: 'attendant' });

      expect(created.status).toBe(201);
      expect(created.body.invitationEmailSent).toBe(true);
      expect(created.body.user.invitationStatus).toBe('pending');
      expect(created.body.user).not.toHaveProperty('password');

      // The invited user cannot log in yet.
      const early = await api()
        .post('/api/v1/auth/login')
        .send({ email: INVITED_EMAIL, password: NEW_PASSWORD });
      expect(early.status).toBe(401);

      const token = lastTokenFrom(mail);

      const activated = await api()
        .post('/api/v1/auth/activate-account')
        .send({ token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD });
      expect(activated.status).toBe(204);
      expect(activated.body).toEqual({}); // no tokens: activation never authenticates

      const after = await login(INVITED_EMAIL, NEW_PASSWORD);
      expect(after.accessToken).toBeDefined();
    });

    it('stores only the SHA-256 digest, never the raw token', async () => {
      const { accessToken } = await login(ADMIN_EMAIL, PASSWORD);
      await api()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Convidada', email: INVITED_EMAIL, role: 'attendant' });

      const raw = lastTokenFrom(mail);
      const stored = await prisma.userActionToken.findMany({
        where: { user: { email: INVITED_EMAIL } },
      });

      expect(stored).toHaveLength(1);
      expect(stored[0].tokenHash).toHaveLength(64);
      expect(stored[0].tokenHash).not.toBe(raw);
      expect(JSON.stringify(stored)).not.toContain(raw);
    });

    it('rejects a reused token with the generic message', async () => {
      const { accessToken } = await login(ADMIN_EMAIL, PASSWORD);
      await api()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Convidada', email: INVITED_EMAIL, role: 'attendant' });

      const token = lastTokenFrom(mail);
      const body = { token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD };

      await api().post('/api/v1/auth/activate-account').send(body).expect(204);

      const second = await api().post('/api/v1/auth/activate-account').send(body);
      expect(second.status).toBe(400);
      expect(JSON.stringify(second.body)).toContain('Link inválido ou expirado');
    });

    it('rejects an expired token', async () => {
      const { accessToken } = await login(ADMIN_EMAIL, PASSWORD);
      await api()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Convidada', email: INVITED_EMAIL, role: 'attendant' });

      const token = lastTokenFrom(mail);
      await prisma.userActionToken.updateMany({
        where: { user: { email: INVITED_EMAIL } },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await api()
        .post('/api/v1/auth/activate-account')
        .send({ token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD });
      expect(res.status).toBe(400);
    });

    it('rejects a revoked token and resend invalidates the previous one', async () => {
      const { accessToken } = await login(ADMIN_EMAIL, PASSWORD);
      const created = await api()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Convidada', email: INVITED_EMAIL, role: 'attendant' });

      const firstToken = lastTokenFrom(mail);

      await api()
        .post(`/api/v1/users/${created.body.user.id}/resend-invitation`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const secondToken = lastTokenFrom(mail);
      expect(secondToken).not.toBe(firstToken);

      // The first token is now revoked.
      await api()
        .post('/api/v1/auth/activate-account')
        .send({ token: firstToken, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD })
        .expect(400);

      // The second one works.
      await api()
        .post('/api/v1/auth/activate-account')
        .send({ token: secondToken, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD })
        .expect(204);
    });

    it('lets exactly one of two concurrent activations succeed', async () => {
      const { accessToken } = await login(ADMIN_EMAIL, PASSWORD);
      await api()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Convidada', email: INVITED_EMAIL, role: 'attendant' });

      const token = lastTokenFrom(mail);
      const body = { token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD };

      const [a, b] = await Promise.all([
        api().post('/api/v1/auth/activate-account').send(body),
        api().post('/api/v1/auth/activate-account').send(body),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([204, 400]);
    });

    it('returns 409 for a duplicate e-mail differing only in case', async () => {
      const { accessToken } = await login(ADMIN_EMAIL, PASSWORD);
      await api()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Convidada', email: INVITED_EMAIL, role: 'attendant' })
        .expect(201);

      const dup = await api()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Outra', email: INVITED_EMAIL.toUpperCase(), role: 'financial' });

      expect(dup.status).toBe(409);
    });

    it('refuses to create an admin', async () => {
      const { accessToken } = await login(ADMIN_EMAIL, PASSWORD);
      const res = await api()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Root', email: INVITED_EMAIL, role: 'admin' });

      expect([400, 403]).toContain(res.status);
    });

    it('never leaks a password or tokenHash in any users response', async () => {
      const { accessToken } = await login(ADMIN_EMAIL, PASSWORD);
      const list = await api()
        .get('/api/v1/users?limit=100')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const serialized = JSON.stringify(list.body);
      expect(serialized).not.toContain('password');
      expect(serialized).not.toContain('tokenHash');
      expect(serialized).not.toContain('$argon2id$');
    });
  });

  describe('RBAC', () => {
    it.each([
      ['get', '/api/v1/users'],
      ['post', '/api/v1/users'],
    ])('returns 403 for an attendant on %s %s', async (method, path) => {
      const { accessToken } = await login(ATTENDANT_EMAIL, PASSWORD);
      const res = await (api() as any)[method](path)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'X', email: INVITED_EMAIL, role: 'attendant' });
      expect(res.status).toBe(403);
    });

    it('returns 401 without a token', async () => {
      await api().get('/api/v1/users').expect(401);
    });

    it('returns 404 for an unknown id', async () => {
      const { accessToken } = await login(ADMIN_EMAIL, PASSWORD);
      await api()
        .get('/api/v1/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });

    it('refuses to deactivate the caller own account', async () => {
      const { accessToken } = await login(ADMIN_EMAIL, PASSWORD);
      const me = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });

      await api()
        .patch(`/api/v1/users/${me!.id}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ isActive: false })
        .expect(403);
    });
  });

  describe('deactivation', () => {
    it('blocks login and invalidates existing sessions', async () => {
      const { accessToken: adminToken } = await login(ADMIN_EMAIL, PASSWORD);
      const attendant = await prisma.user.findUnique({ where: { email: ATTENDANT_EMAIL } });
      const session = await login(ATTENDANT_EMAIL, PASSWORD);

      await api()
        .patch(`/api/v1/users/${attendant!.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })
        .expect(200);

      // Cannot log in.
      await api()
        .post('/api/v1/auth/login')
        .send({ email: ATTENDANT_EMAIL, password: PASSWORD })
        .expect(401);

      // Cannot refresh — the token was revoked with the status change.
      await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);

      // Cannot use the already-issued access token.
      await api()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(401);
    });
  });

  describe('forgot and reset', () => {
    it('returns the identical response for existing and nonexistent e-mails', async () => {
      const known = await api()
        .post('/api/v1/auth/forgot-password')
        .send({ email: ATTENDANT_EMAIL });
      const unknown = await api()
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'ninguem-aqui@test.com' });

      expect(known.status).toBe(unknown.status);
      expect(known.body).toEqual(unknown.body);
    });

    it('resets the password, revokes sessions, and is single-use', async () => {
      const session = await login(ATTENDANT_EMAIL, PASSWORD);

      await api().post('/api/v1/auth/forgot-password').send({ email: ATTENDANT_EMAIL }).expect(200);
      const token = lastTokenFrom(mail);
      const body = { token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD };

      await api().post('/api/v1/auth/reset-password').send(body).expect(204);

      // New password works, old one does not.
      await api()
        .post('/api/v1/auth/login')
        .send({ email: ATTENDANT_EMAIL, password: NEW_PASSWORD })
        .expect(200);
      await api()
        .post('/api/v1/auth/login')
        .send({ email: ATTENDANT_EMAIL, password: PASSWORD })
        .expect(401);

      // Sessions revoked.
      await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);

      // Token is single-use.
      await api().post('/api/v1/auth/reset-password').send(body).expect(400);
    });

    it('invalidates a previous reset token when a new one is requested', async () => {
      await api().post('/api/v1/auth/forgot-password').send({ email: ATTENDANT_EMAIL }).expect(200);
      const first = lastTokenFrom(mail);

      await api().post('/api/v1/auth/forgot-password').send({ email: ATTENDANT_EMAIL }).expect(200);
      const second = lastTokenFrom(mail);

      expect(second).not.toBe(first);

      await api()
        .post('/api/v1/auth/reset-password')
        .send({ token: first, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD })
        .expect(400);
    });

    it('stops issuing tokens once the per-user window limit is reached', async () => {
      for (let i = 0; i < 3; i++) {
        await api().post('/api/v1/auth/forgot-password').send({ email: ATTENDANT_EMAIL });
      }
      const before = mail.sent.length;

      const res = await api()
        .post('/api/v1/auth/forgot-password')
        .send({ email: ATTENDANT_EMAIL });

      // Same public response, but nothing new was sent.
      expect(res.status).toBe(200);
      expect(mail.sent.length).toBe(before);
    });

    it('rejects a password that violates the policy without echoing it', async () => {
      await api().post('/api/v1/auth/forgot-password').send({ email: ATTENDANT_EMAIL }).expect(200);
      const token = lastTokenFrom(mail);

      const res = await api()
        .post('/api/v1/auth/reset-password')
        .send({ token, password: 'curta', passwordConfirmation: 'curta' });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('12 caracteres');
      expect(JSON.stringify(res.body)).not.toContain('curta');
    });
  });

  describe('change-password', () => {
    it('changes the password and ends every session', async () => {
      const session = await login(ATTENDANT_EMAIL, PASSWORD);

      await api()
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
          newPasswordConfirmation: NEW_PASSWORD,
        })
        .expect(204);

      await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      await api()
        .post('/api/v1/auth/login')
        .send({ email: ATTENDANT_EMAIL, password: NEW_PASSWORD })
        .expect(200);
    });

    it('rejects a wrong current password', async () => {
      const session = await login(ATTENDANT_EMAIL, PASSWORD);

      await api()
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({
          currentPassword: 'senha errada bem comprida',
          newPassword: NEW_PASSWORD,
          newPasswordConfirmation: NEW_PASSWORD,
        })
        .expect(400);
    });

    it('rejects reusing the current password', async () => {
      const session = await login(ATTENDANT_EMAIL, PASSWORD);

      const res = await api()
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({
          currentPassword: PASSWORD,
          newPassword: PASSWORD,
          newPasswordConfirmation: PASSWORD,
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('diferente da senha atual');
    });
  });

  describe('bcrypt migration', () => {
    it('logs in a legacy user and upgrades the hash to Argon2id', async () => {
      const legacyHash = await bcrypt.hash(PASSWORD, 12);
      await seedUser(LEGACY_EMAIL, 'attendant', legacyHash);

      const before = await prisma.user.findUnique({ where: { email: LEGACY_EMAIL } });
      expect(before!.password!.startsWith('$2')).toBe(true);

      await api()
        .post('/api/v1/auth/login')
        .send({ email: LEGACY_EMAIL, password: PASSWORD })
        .expect(200);

      const after = await prisma.user.findUnique({ where: { email: LEGACY_EMAIL } });
      expect(after!.password!.startsWith('$argon2id$')).toBe(true);
      // A transparent rehash is not a user-initiated change.
      expect(after!.passwordChangedAt).toBeNull();

      // The same password still works against the new hash.
      await api()
        .post('/api/v1/auth/login')
        .send({ email: LEGACY_EMAIL, password: PASSWORD })
        .expect(200);
    });

    it('does not upgrade the hash after a failed login', async () => {
      const legacyHash = await bcrypt.hash(PASSWORD, 12);
      await seedUser(LEGACY_EMAIL, 'attendant', legacyHash);

      await api()
        .post('/api/v1/auth/login')
        .send({ email: LEGACY_EMAIL, password: 'errada e bem comprida' })
        .expect(401);

      const after = await prisma.user.findUnique({ where: { email: LEGACY_EMAIL } });
      expect(after!.password!.startsWith('$2')).toBe(true);
    });
  });

  describe('login gate', () => {
    it('returns the same 401 for unknown, unverified and passwordless accounts', async () => {
      await seedUser(INVITED_EMAIL, 'attendant', null, { emailVerifiedAt: null, passwordSetAt: null });

      const unknown = await api()
        .post('/api/v1/auth/login')
        .send({ email: 'nao-existe-mesmo@test.com', password: PASSWORD });
      const passwordless = await api()
        .post('/api/v1/auth/login')
        .send({ email: INVITED_EMAIL, password: PASSWORD });

      expect(unknown.status).toBe(401);
      expect(passwordless.status).toBe(401);
      expect(unknown.body.message).toEqual(passwordless.body.message);
    });
  });
});
```

- [ ] **Step 2: Run the e2e suite against a live database**

```bash
docker-compose -f /home/userterras/Documents/inventory-manager/docker-compose.dev.yml up -d postgres
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npm run test:e2e
```

Expected: both e2e suites pass. If the rate-limit test interferes with neighbours, the throttler is in-memory and shared across the suite — run `npm run test:e2e -- --runInBand` (already the default for a single worker) and keep the forgot-password describe block last, as written.

- [ ] **Step 3: Run the unit suite and build, then commit**

```bash
npm run test && npm run build
```

```bash
cd /home/userterras/Documents/inventory-manager
git add backend/test/users-passwords.e2e-spec.ts
git commit -m "$(cat <<'MSG'
test(e2e): cover invitation, activation, recovery and bcrypt migration

Exercises the full flows against PostgreSQL: single-use tokens, exactly one
winner among concurrent activations, case-insensitive e-mail uniqueness,
deactivation invalidating sessions and access tokens, identical public
responses for forgot-password, and the bcrypt to Argon2id upgrade.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Phase 4 — Frontend

All frontend commands need Node 20: `cd frontend && source ~/.nvm/nvm.sh && nvm use 20.19.4`.

### Task 14: Types, API clients and Zod schemas

**Files:**
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/lib/api/users.api.ts`
- Modify: `frontend/src/lib/api/auth.api.ts`
- Create: `frontend/src/schemas/password.schema.ts`
- Create: `frontend/src/schemas/user.schema.ts`
- Test: `frontend/src/tests/schemas/password.schema.test.ts`

**Interfaces:**
- Consumes: the HTTP contracts from Tasks 7, 8 and 11.
- Produces:
  - `type InvitationStatus = 'none' | 'pending' | 'expired' | 'revoked' | 'accepted'`
  - `interface AdminUser` — exactly the backend `UserResponse`, with no sensitive fields.
  - `interface CreateUserResult { user: AdminUser; invitationEmailSent: boolean }`
  - `usersApi.{list,getById,create,update,updateStatus,resendInvitation,revokeInvitation}`
  - `authApi.{activateAccount,forgotPassword,resetPassword,changePassword}`
  - `passwordFieldSchema`, `activateAccountSchema`, `resetPasswordSchema`, `changePasswordSchema`, `forgotPasswordSchema`
  - `createUserSchema`, `updateUserSchema`
  - `PASSWORD_RULES` — the array the requirements checklist renders.

- [ ] **Step 1: Write the failing schema test**

Create `frontend/src/tests/schemas/password.schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  passwordFieldSchema,
  activateAccountSchema,
  changePasswordSchema,
} from '@/schemas/password.schema'

describe('passwordFieldSchema', () => {
  it('accepts exactly 12 characters', () => {
    expect(passwordFieldSchema.safeParse('abcdefghijkl').success).toBe(true)
  })

  it('rejects 11 characters', () => {
    expect(passwordFieldSchema.safeParse('abcdefghijk').success).toBe(false)
  })

  it('rejects more than 128 characters', () => {
    expect(passwordFieldSchema.safeParse('a'.repeat(129)).success).toBe(false)
  })

  it('accepts a long passphrase with spaces', () => {
    expect(passwordFieldSchema.safeParse('cavalo de batalha azul e quadrado').success).toBe(true)
  })

  it('accepts Unicode', () => {
    expect(passwordFieldSchema.safeParse('çãoÇÃO-ñ-日本語-ok').success).toBe(true)
  })

  it('does not trim — surrounding spaces count', () => {
    const result = passwordFieldSchema.safeParse(' abcdefghij ')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe(' abcdefghij ')
  })

  it('rejects blocklisted passwords', () => {
    for (const weak of ['123456789012', 'password123', 'Admin@123456']) {
      expect(passwordFieldSchema.safeParse(weak).success).toBe(false)
    }
  })

  it('does not require mixed character classes', () => {
    expect(passwordFieldSchema.safeParse('aaaaaaaaaaaaaa').success).toBe(true)
  })
})

describe('activateAccountSchema', () => {
  it('rejects a mismatched confirmation on the confirmation field', () => {
    const result = activateAccountSchema.safeParse({
      password: 'uma senha bem comprida',
      passwordConfirmation: 'outra senha bem comprida',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['passwordConfirmation'])
    }
  })

  it('accepts a matching confirmation', () => {
    expect(
      activateAccountSchema.safeParse({
        password: 'uma senha bem comprida',
        passwordConfirmation: 'uma senha bem comprida',
      }).success,
    ).toBe(true)
  })
})

describe('changePasswordSchema', () => {
  it('requires a current password', () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: '',
        newPassword: 'uma senha bem comprida',
        newPasswordConfirmation: 'uma senha bem comprida',
      }).success,
    ).toBe(false)
  })

  it('rejects a new password equal to the current one', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'uma senha bem comprida',
      newPassword: 'uma senha bem comprida',
      newPasswordConfirmation: 'uma senha bem comprida',
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd /home/userterras/Documents/inventory-manager/frontend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npx vitest run src/tests/schemas/password.schema.test.ts
```

Expected: FAIL — cannot resolve `@/schemas/password.schema`.

- [ ] **Step 3: Implement the schemas**

Create `frontend/src/schemas/password.schema.ts`:

```ts
import { z } from 'zod'

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

/** Mirrors the backend blocklist. The backend remains authoritative. */
const COMMON_PASSWORDS = new Set(
  [
    '123456', '1234567', '12345678', '123456789', '1234567890', '123456789012',
    'password', 'password1', 'password123', 'passw0rd',
    'senha123', 'senha12345', 'qwerty', 'qwerty123', 'qwertyuiop',
    'admin', 'admin123', 'admin@123', 'admin@123456', 'administrador',
    'iloveyou', 'letmein', 'welcome', 'welcome123', 'abc123', 'abcd1234',
    '111111', '000000', 'inventory', 'inventory123',
  ].map((p) => p.toLowerCase()),
)

/** Rendered by PasswordRequirements. Each predicate receives the raw value. */
export const PASSWORD_RULES = [
  {
    id: 'min',
    label: `Pelo menos ${PASSWORD_MIN_LENGTH} caracteres`,
    test: (value: string) => value.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'max',
    label: `No máximo ${PASSWORD_MAX_LENGTH} caracteres`,
    test: (value: string) => value.length <= PASSWORD_MAX_LENGTH,
  },
  {
    id: 'common',
    label: 'Não pode ser uma senha muito comum',
    test: (value: string) => value.length === 0 || !COMMON_PASSWORDS.has(value.toLowerCase()),
  },
] as const

// No .trim(): spaces are legitimate password characters.
export const passwordFieldSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `A senha deve ter no mínimo ${PASSWORD_MIN_LENGTH} caracteres`)
  .max(PASSWORD_MAX_LENGTH, `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres`)
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), {
    message: 'Esta senha é muito comum. Escolha uma senha menos previsível',
  })

export const forgotPasswordSchema = z.object({
  email: z.string().email('E-mail inválido'),
})

const withConfirmation = z
  .object({
    password: passwordFieldSchema,
    passwordConfirmation: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'A confirmação não corresponde à senha',
    path: ['passwordConfirmation'],
  })

export const activateAccountSchema = withConfirmation
export const resetPasswordSchema = withConfirmation

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe sua senha atual'),
    newPassword: passwordFieldSchema,
    newPasswordConfirmation: z.string(),
  })
  .refine((data) => data.newPassword === data.newPasswordConfirmation, {
    message: 'A confirmação não corresponde à senha',
    path: ['newPasswordConfirmation'],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'A nova senha deve ser diferente da senha atual',
    path: ['newPassword'],
  })

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>
export type SetPasswordFormValues = z.infer<typeof withConfirmation>
export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>
```

Create `frontend/src/schemas/user.schema.ts`:

```ts
import { z } from 'zod'

export const INVITABLE_ROLES = ['attendant', 'financial'] as const

export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(100, 'Máximo de 100 caracteres'),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(150),
  role: z.enum(INVITABLE_ROLES, { errorMap: () => ({ message: 'Selecione um perfil' }) }),
})

export const updateUserSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(100, 'Máximo de 100 caracteres'),
  role: z.enum(INVITABLE_ROLES, { errorMap: () => ({ message: 'Selecione um perfil' }) }),
})

export type CreateUserFormValues = z.infer<typeof createUserSchema>
export type UpdateUserFormValues = z.infer<typeof updateUserSchema>
```

- [ ] **Step 4: Add the types**

Append to `frontend/src/types/index.ts`:

```ts
export type InvitationStatus = 'none' | 'pending' | 'expired' | 'revoked' | 'accepted'

/**
 * Mirrors the backend UserResponse exactly. Sensitive fields are absent by
 * construction — there is deliberately no `password`, `tokenHash`, action
 * token or refresh token anywhere in this type.
 */
export interface AdminUser {
  id: string
  name: string
  email: string
  role: UserRole
  isActive: boolean
  emailVerifiedAt?: string | null
  passwordSetAt?: string | null
  lastLogin?: string | null
  createdAt: string
  updatedAt: string
  invitationStatus: InvitationStatus
  invitationExpiresAt?: string | null
}

export interface CreateUserResult {
  user: AdminUser
  invitationEmailSent: boolean
}
```

Also extend the existing `User` interface with the two read-only timestamps the login response now returns:

```ts
  emailVerifiedAt?: string | null
  passwordSetAt?: string | null
```

- [ ] **Step 5: Add the API clients**

Create `frontend/src/lib/api/users.api.ts`:

```ts
import api from './client'
import type { AdminUser, CreateUserResult, PaginatedResponse, UserRole } from '@/types'

export interface ListUsersParams {
  page?: number
  limit?: number
  search?: string
  role?: UserRole
  status?: 'active' | 'inactive'
}

export const usersApi = {
  list: (params?: ListUsersParams) =>
    api.get<PaginatedResponse<AdminUser>>('/users', { params }).then((r) => r.data),
  getById: (id: string) => api.get<AdminUser>(`/users/${id}`).then((r) => r.data),
  create: (data: { name: string; email: string; role: 'attendant' | 'financial' }) =>
    api.post<CreateUserResult>('/users', data).then((r) => r.data),
  update: (id: string, data: { name?: string; role?: 'attendant' | 'financial' }) =>
    api.patch<AdminUser>(`/users/${id}`, data).then((r) => r.data),
  updateStatus: (id: string, isActive: boolean) =>
    api.patch<AdminUser>(`/users/${id}/status`, { isActive }).then((r) => r.data),
  resendInvitation: (id: string) =>
    api.post<CreateUserResult>(`/users/${id}/resend-invitation`).then((r) => r.data),
  revokeInvitation: (id: string) => api.post(`/users/${id}/revoke-invitation`),
}
```

Append to `frontend/src/lib/api/auth.api.ts` inside the `authApi` object:

```ts
  activateAccount: (token: string, password: string, passwordConfirmation: string) =>
    api.post('/auth/activate-account', { token, password, passwordConfirmation }),
  forgotPassword: (email: string) =>
    api.post<{ message: string }>('/auth/forgot-password', { email }).then((r) => r.data),
  resetPassword: (token: string, password: string, passwordConfirmation: string) =>
    api.post('/auth/reset-password', { token, password, passwordConfirmation }),
  changePassword: (
    currentPassword: string,
    newPassword: string,
    newPasswordConfirmation: string,
  ) =>
    api.post('/auth/change-password', {
      currentPassword,
      newPassword,
      newPasswordConfirmation,
    }),
```

- [ ] **Step 6: Run the schema test and the full frontend suite**

```bash
npx vitest run src/tests/schemas/password.schema.test.ts
npm run test && npm run lint
```

Expected: the new suite passes; all 193 existing tests still pass; lint exits 0.

- [ ] **Step 7: Commit**

```bash
cd /home/userterras/Documents/inventory-manager
git add frontend/src/types frontend/src/lib/api frontend/src/schemas frontend/src/tests/schemas
git commit -m "$(cat <<'MSG'
feat(frontend): add user and password types, API clients and Zod schemas

AdminUser mirrors the backend response and declares no sensitive field, so
one cannot land in the client by accident. Password schemas mirror the
backend policy for UX without trimming.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 15: Close the refresh-token race

**Files:**
- Modify: `frontend/src/lib/api/client.ts:55-85`
- Modify: `frontend/src/app/providers.tsx:22-34`
- Test: `frontend/src/tests/auth/refreshRace.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: the `auth:tokens-refreshed` event detail gains `sourceRefreshToken: string`.

- [ ] **Step 1: Write the failing race test**

Create `frontend/src/tests/auth/refreshRace.test.tsx` (it renders JSX, so the extension must be `.tsx`):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth.store'
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from '@/lib/api/client'

function dispatchRefresh(detail: {
  accessToken: string
  refreshToken: string
  sourceRefreshToken: string
}) {
  window.dispatchEvent(new CustomEvent('auth:tokens-refreshed', { detail }))
}

// The listener lives in AuthHydration; mount it the same way providers.tsx does.
import { render } from '@testing-library/react'
import { Providers } from '@/app/providers'

const USER = {
  id: 'u1',
  name: 'Maria',
  email: 'maria@test.com',
  role: 'attendant' as const,
  isActive: true,
  createdAt: '2026-01-01',
}

describe('refresh token race', () => {
  beforeEach(() => {
    localStorage.clear()
    clearTokens()
    useAuthStore.getState().clearAuth()
    render(<Providers><div /></Providers>)
  })

  it('updates tokens for the current session', () => {
    useAuthStore.getState().setAuth(USER, 'at-1', 'rt-1')

    dispatchRefresh({ accessToken: 'at-2', refreshToken: 'rt-2', sourceRefreshToken: 'rt-1' })

    expect(useAuthStore.getState().accessToken).toBe('at-2')
    expect(useAuthStore.getState().refreshToken).toBe('rt-2')
  })

  it('does not restore authentication after logout', () => {
    useAuthStore.getState().setAuth(USER, 'at-1', 'rt-1')
    useAuthStore.getState().clearAuth()

    dispatchRefresh({ accessToken: 'at-2', refreshToken: 'rt-2', sourceRefreshToken: 'rt-1' })

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(getAccessToken()).toBeNull()
  })

  it('does not let a session A refresh overwrite session B', () => {
    useAuthStore.getState().setAuth(USER, 'at-A', 'rt-A')
    // User logs out and logs back in — session B.
    useAuthStore.getState().clearAuth()
    useAuthStore.getState().setAuth(USER, 'at-B', 'rt-B')

    // The in-flight refresh from session A finally resolves.
    dispatchRefresh({ accessToken: 'at-A2', refreshToken: 'rt-A2', sourceRefreshToken: 'rt-A' })

    expect(useAuthStore.getState().accessToken).toBe('at-B')
    expect(useAuthStore.getState().refreshToken).toBe('rt-B')
  })

  it('clearAuth invalidates every in-flight refresh result, axios state included', () => {
    useAuthStore.getState().setAuth(USER, 'at-1', 'rt-1')
    setTokens('at-1', 'rt-1')

    useAuthStore.getState().clearAuth()
    dispatchRefresh({ accessToken: 'at-2', refreshToken: 'rt-2', sourceRefreshToken: 'rt-1' })

    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npx vitest run src/tests/auth/refreshRace.test.tsx
```

Expected: FAIL — the stale-session cases currently overwrite the store.

- [ ] **Step 3: Gate the axios interceptor on the originating token**

In `frontend/src/lib/api/client.ts`, replace the `try` block of the response interceptor:

```ts
    try {
      const rt = refreshToken
      if (!rt) throw new Error('No refresh token')

      const { data } = await axios.post(
        `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/auth/refresh`,
        { refreshToken: rt },
      )

      // The session that started this refresh may be gone — logged out, or
      // replaced by a newer login. A stale response must not poison the client.
      if (refreshToken !== rt) {
        processQueue(new Error('Stale refresh response'), null)
        return Promise.reject(error)
      }

      const newAt = data.accessToken
      const newRt = data.refreshToken
      setTokens(newAt, newRt)
      processQueue(null, newAt)
      originalRequest.headers.Authorization = `Bearer ${newAt}`

      // sourceRefreshToken lets the store reject a result from an older session.
      window.dispatchEvent(
        new CustomEvent('auth:tokens-refreshed', {
          detail: { accessToken: newAt, refreshToken: newRt, sourceRefreshToken: rt },
        }),
      )
      return api(originalRequest)
    } catch (refreshError) {
```

- [ ] **Step 4: Gate the store listener**

In `frontend/src/app/providers.tsx`, replace `handleRefresh`:

```ts
    const handleRefresh = (e: Event) => {
      const { accessToken: at, refreshToken: rt, sourceRefreshToken } =
        (e as CustomEvent).detail ?? {}

      const state = useAuthStore.getState()

      // Reject a result belonging to a session that has ended (logout) or been
      // replaced (a newer login). Never let an older session update a newer one.
      if (!state.isAuthenticated || state.refreshToken !== sourceRefreshToken) return

      state.updateTokens(at, rt)
    }
```

- [ ] **Step 5: Run the test, the suite and lint**

```bash
npx vitest run src/tests/auth/refreshRace.test.tsx
npm run test && npm run lint
```

Expected: 4 new tests pass; the 193 existing tests still pass.

- [ ] **Step 6: Commit**

```bash
cd /home/userterras/Documents/inventory-manager
git add frontend/src/lib/api/client.ts frontend/src/app/providers.tsx frontend/src/tests/auth/refreshRace.test.tsx
git commit -m "$(cat <<'MSG'
fix(auth): stop a stale refresh from reviving or overwriting a session

The refresh result now carries the token that requested it, and both the
axios client and the store reject it unless that token is still current. A
refresh resolving after logout no longer restores authentication, and one
from a previous session no longer clobbers a newer login.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 16: Shared password UI and fragment-token hook

**Files:**
- Create: `frontend/src/features/auth/components/PasswordInput.tsx`
- Create: `frontend/src/features/auth/components/PasswordRequirements.tsx`
- Create: `frontend/src/features/auth/hooks/useFragmentToken.ts`
- Create: `frontend/src/features/auth/lib/apiErrors.ts`
- Modify: `frontend/src/components/feedback/ConfirmDialog.tsx`
- Modify: `frontend/index.html`
- Test: `frontend/src/tests/auth/PasswordInput.test.tsx`
- Test: `frontend/src/tests/auth/useFragmentToken.test.tsx`

**Interfaces:**
- Consumes: `PASSWORD_RULES` from Task 14.
- Produces:
  - `<PasswordInput {...field} autoComplete label />`
  - `<PasswordRequirements value confirmation />`
  - `useFragmentToken(): string | null`
  - `describeApiError(error: unknown): { kind: 'policy' | 'token' | 'generic'; messages: string[] }`
  - `GENERIC_ERROR_MESSAGE`, `INVALID_LINK_MESSAGE`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/tests/auth/useFragmentToken.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useFragmentToken } from '@/features/auth/hooks/useFragmentToken'

function Probe() {
  const token = useFragmentToken()
  return <span data-testid="token">{token ?? 'NO_TOKEN'}</span>
}

describe('useFragmentToken', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/activate-account')
    localStorage.clear()
    sessionStorage.clear()
  })

  it('reads the token from the URL fragment', () => {
    window.history.replaceState({}, '', '/activate-account#token=FRAGMENT_TOKEN')
    render(<Probe />)
    expect(screen.getByTestId('token')).toHaveTextContent('FRAGMENT_TOKEN')
  })

  it('removes the fragment from the URL immediately', () => {
    window.history.replaceState({}, '', '/activate-account#token=FRAGMENT_TOKEN')
    render(<Probe />)
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/activate-account')
  })

  it('never writes the token to persistent storage', () => {
    window.history.replaceState({}, '', '/reset-password#token=FRAGMENT_TOKEN')
    render(<Probe />)

    expect(JSON.stringify(localStorage)).not.toContain('FRAGMENT_TOKEN')
    expect(JSON.stringify(sessionStorage)).not.toContain('FRAGMENT_TOKEN')
  })

  it('returns null when there is no fragment (e.g. after a refresh)', () => {
    render(<Probe />)
    expect(screen.getByTestId('token')).toHaveTextContent('NO_TOKEN')
  })

  it('ignores a token in the query string', () => {
    window.history.replaceState({}, '', '/reset-password?token=QUERY_TOKEN')
    render(<Probe />)
    expect(screen.getByTestId('token')).toHaveTextContent('NO_TOKEN')
  })
})
```

Create `frontend/src/tests/auth/PasswordInput.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PasswordInput } from '@/features/auth/components/PasswordInput'
import { PasswordRequirements } from '@/features/auth/components/PasswordRequirements'

describe('PasswordInput', () => {
  it('starts masked', () => {
    render(<PasswordInput value="" onChange={vi.fn()} autoComplete="new-password" />)
    expect(screen.getByLabelText('Mostrar senha')).toHaveAttribute('aria-pressed', 'false')
  })

  it('toggles visibility and updates aria-pressed', async () => {
    const user = userEvent.setup()
    render(<PasswordInput value="segredo" onChange={vi.fn()} autoComplete="new-password" />)

    const toggle = screen.getByLabelText('Mostrar senha')
    await user.click(toggle)

    const pressed = screen.getByLabelText('Ocultar senha')
    expect(pressed).toHaveAttribute('aria-pressed', 'true')
  })

  it('is reachable and operable by keyboard', async () => {
    const user = userEvent.setup()
    render(<PasswordInput value="segredo" onChange={vi.fn()} autoComplete="new-password" />)

    await user.tab()
    await user.tab()
    expect(screen.getByLabelText('Mostrar senha')).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('Ocultar senha')).toHaveAttribute('aria-pressed', 'true')
  })

  it('passes autoComplete through', () => {
    render(<PasswordInput value="" onChange={vi.fn()} autoComplete="current-password" />)
    expect(screen.getByTestId('password-input')).toHaveAttribute(
      'autocomplete',
      'current-password',
    )
  })

  it('does not expose the value in the toggle label', () => {
    render(<PasswordInput value="minha-senha-secreta" onChange={vi.fn()} autoComplete="new-password" />)
    expect(screen.getByLabelText('Mostrar senha').textContent).not.toContain('minha-senha-secreta')
  })
})

describe('PasswordRequirements', () => {
  it('marks the length rule satisfied once long enough', () => {
    render(<PasswordRequirements value="uma senha bem comprida" confirmation="uma senha bem comprida" />)
    expect(screen.getByTestId('rule-min')).toHaveAttribute('data-met', 'true')
  })

  it('marks the length rule unsatisfied when too short', () => {
    render(<PasswordRequirements value="curta" confirmation="curta" />)
    expect(screen.getByTestId('rule-min')).toHaveAttribute('data-met', 'false')
  })

  it('marks the confirmation rule unsatisfied on a mismatch', () => {
    render(<PasswordRequirements value="uma senha bem comprida" confirmation="outra" />)
    expect(screen.getByTestId('rule-confirmation')).toHaveAttribute('data-met', 'false')
  })

  it('announces requirement changes politely', () => {
    render(<PasswordRequirements value="curta" confirmation="" />)
    expect(screen.getByRole('list')).toHaveAttribute('aria-live', 'polite')
  })
})
```

- [ ] **Step 2: Run them to make sure they fail, then implement**

```bash
npx vitest run src/tests/auth/useFragmentToken.test.tsx src/tests/auth/PasswordInput.test.tsx
```

Create `frontend/src/features/auth/hooks/useFragmentToken.ts`:

```ts
import { useRef } from 'react'

/**
 * Reads a single-use token from the URL fragment and strips the fragment
 * immediately.
 *
 * The fragment is used instead of the query string because it is never sent to
 * a server: the token cannot appear in an access log or a Referer header. The
 * value is held only in this ref for the life of the component — never in
 * localStorage, sessionStorage, the auth store, a query key or a log.
 *
 * Consequence, by design: refreshing the page after the fragment is removed
 * loses the token, and the page must then render its invalid-link state
 * without calling the API.
 */
export function useFragmentToken(): string | null {
  const tokenRef = useRef<string | null | undefined>(undefined)

  if (tokenRef.current === undefined) {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
    tokenRef.current = new URLSearchParams(hash).get('token')

    if (window.location.hash) {
      window.history.replaceState(window.history.state, document.title, window.location.pathname)
    }
  }

  return tokenRef.current
}
```

Create `frontend/src/features/auth/components/PasswordInput.tsx`:

```tsx
import { forwardRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type PasswordInputProps = React.ComponentPropsWithoutRef<typeof Input> & {
  autoComplete: 'new-password' | 'current-password'
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, autoComplete, ...props }, ref) => {
    const [visible, setVisible] = useState(false)
    const Icon = visible ? EyeOff : Eye
    const label = visible ? 'Ocultar senha' : 'Mostrar senha'

    return (
      <div className="relative">
        <Input
          {...props}
          ref={ref}
          data-testid="password-input"
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          className={cn('pr-10', className)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={label}
          aria-pressed={visible}
          title={label}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    )
  },
)

PasswordInput.displayName = 'PasswordInput'
```

Create `frontend/src/features/auth/components/PasswordRequirements.tsx`:

```tsx
import { Check, Minus } from 'lucide-react'
import { PASSWORD_RULES } from '@/schemas/password.schema'
import { cn } from '@/lib/utils'

interface PasswordRequirementsProps {
  value: string
  confirmation?: string
}

/** Renders the rules, never the value. */
export function PasswordRequirements({ value, confirmation }: PasswordRequirementsProps) {
  const rules = [
    ...PASSWORD_RULES.map((rule) => ({
      id: rule.id,
      label: rule.label,
      met: value.length > 0 && rule.test(value),
    })),
    ...(confirmation !== undefined
      ? [
          {
            id: 'confirmation',
            label: 'A confirmação é idêntica à senha',
            met: value.length > 0 && value === confirmation,
          },
        ]
      : []),
  ]

  return (
    <ul role="list" aria-live="polite" className="space-y-1 text-xs">
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
            <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
            {rule.label}
          </li>
        )
      })}
    </ul>
  )
}
```

Create `frontend/src/features/auth/lib/apiErrors.ts`:

```ts
export const INVALID_LINK_MESSAGE = 'Link inválido ou expirado'
export const GENERIC_ERROR_MESSAGE =
  'Não foi possível processar a solicitação agora. Tente novamente.'

type ErrorKind = 'policy' | 'token' | 'generic'

/**
 * Classifies an API failure into exactly one of three presentations. Arbitrary
 * backend exception text is never surfaced: only controlled password-policy
 * messages are shown, token defects always use the fixed generic link message,
 * and everything else uses the retry message.
 */
export function describeApiError(error: unknown): { kind: ErrorKind; messages: string[] } {
  const response = (error as { response?: { status?: number; data?: unknown } })?.response

  if (!response) return { kind: 'generic', messages: [GENERIC_ERROR_MESSAGE] }

  const raw = (response.data as { message?: unknown })?.message
  const messages = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : []

  if (messages.some((m) => m.includes(INVALID_LINK_MESSAGE))) {
    return { kind: 'token', messages: [INVALID_LINK_MESSAGE] }
  }

  // Only messages that look like our own policy text are trusted for display.
  const policy = messages.filter(
    (m) =>
      m.includes('caracteres') ||
      m.includes('muito comum') ||
      m.includes('confirmação') ||
      m.includes('diferente da senha atual') ||
      m.includes('Senha atual incorreta'),
  )

  if (response.status === 400 && policy.length > 0) {
    return { kind: 'policy', messages: policy }
  }

  return { kind: 'generic', messages: [GENERIC_ERROR_MESSAGE] }
}
```

- [ ] **Step 3: Make ConfirmDialog keyboard-dismissible and add the referrer policy**

In `frontend/src/components/feedback/ConfirmDialog.tsx`, pass `onOpenChange` so Escape and overlay clicks close the dialog:

```tsx
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
```

In `frontend/index.html`, add inside `<head>` after the charset meta:

```html
    <meta name="referrer" content="no-referrer" />
```

- [ ] **Step 4: Run the tests, suite and lint, then commit**

```bash
npx vitest run src/tests/auth
npm run test && npm run lint && npm run build
```

```bash
cd /home/userterras/Documents/inventory-manager
git add frontend/src/features/auth frontend/src/components/feedback/ConfirmDialog.tsx frontend/index.html frontend/src/tests/auth
git commit -m "$(cat <<'MSG'
feat(frontend): add password input, requirements, fragment token and error mapping

Tokens are read from the URL fragment and stripped immediately, held only in
component memory. API failures map to exactly three presentations so
arbitrary backend text is never rendered. ConfirmDialog now closes on Escape
and the app sends no referrer.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 17: Public pages — activate, forgot, reset

**Files:**
- Create: `frontend/src/features/auth/components/SetPasswordForm.tsx`
- Create: `frontend/src/features/auth/pages/ActivateAccountPage.tsx`
- Create: `frontend/src/features/auth/pages/ResetPasswordPage.tsx`
- Create: `frontend/src/features/auth/pages/ForgotPasswordPage.tsx`
- Modify: `frontend/src/app/routes.tsx`
- Modify: `frontend/src/features/auth/components/LoginForm.tsx`
- Test: `frontend/src/tests/auth/ActivateAccountPage.test.tsx`
- Test: `frontend/src/tests/auth/ResetPasswordPage.test.tsx`
- Test: `frontend/src/tests/auth/ForgotPasswordPage.test.tsx`

**Interfaces:**
- Consumes: Task 16's components and `describeApiError`, Task 14's `authApi` and schemas.
- Produces: routes `/activate-account`, `/reset-password`, `/forgot-password`; `<SetPasswordForm />` shared by the two token pages.

- [ ] **Step 1: Write the failing activation test**

Create `frontend/src/tests/auth/ActivateAccountPage.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const activateAccount = vi.fn()
vi.mock('@/lib/api/auth.api', () => ({ authApi: { activateAccount: (...a: unknown[]) => activateAccount(...a) } }))

import { ActivateAccountPage } from '@/features/auth/pages/ActivateAccountPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <ActivateAccountPage />
    </MemoryRouter>,
  )
}

const PASSWORD = 'uma senha bem comprida'

describe('ActivateAccountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    window.history.replaceState({}, '', '/activate-account#token=FRAGMENT_TOKEN')
  })

  it('renders the form when a token is present', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /definir senha/i })).toBeInTheDocument()
  })

  it('strips the token from the URL on mount', () => {
    renderPage()
    expect(window.location.hash).toBe('')
  })

  it('renders the invalid-link state and calls no API when the token is missing', () => {
    window.history.replaceState({}, '', '/activate-account')
    renderPage()

    expect(screen.getByText(/link inválido ou expirado/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /definir senha/i })).not.toBeInTheDocument()
    expect(activateAccount).not.toHaveBeenCalled()
  })

  it('submits the fragment token with the password', async () => {
    const user = userEvent.setup()
    activateAccount.mockResolvedValue({})
    renderPage()

    await user.type(screen.getByLabelText('Nova senha'), PASSWORD)
    await user.type(screen.getByLabelText('Confirmar nova senha'), PASSWORD)
    await user.click(screen.getByRole('button', { name: /definir senha/i }))

    await waitFor(() =>
      expect(activateAccount).toHaveBeenCalledWith('FRAGMENT_TOKEN', PASSWORD, PASSWORD),
    )
  })

  it('never writes the token to storage', async () => {
    const user = userEvent.setup()
    activateAccount.mockResolvedValue({})
    renderPage()

    await user.type(screen.getByLabelText('Nova senha'), PASSWORD)
    await user.type(screen.getByLabelText('Confirmar nova senha'), PASSWORD)
    await user.click(screen.getByRole('button', { name: /definir senha/i }))

    expect(JSON.stringify(localStorage)).not.toContain('FRAGMENT_TOKEN')
    expect(JSON.stringify(sessionStorage)).not.toContain('FRAGMENT_TOKEN')
  })

  it('redirects to login after success and never authenticates', async () => {
    const user = userEvent.setup()
    activateAccount.mockResolvedValue({})
    renderPage()

    await user.type(screen.getByLabelText('Nova senha'), PASSWORD)
    await user.type(screen.getByLabelText('Confirmar nova senha'), PASSWORD)
    await user.click(screen.getByRole('button', { name: /definir senha/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }))
    expect(localStorage.getItem('inventory-auth')).toBeNull()
  })

  it('shows the fixed message for a rejected token', async () => {
    const user = userEvent.setup()
    activateAccount.mockRejectedValue({
      response: { status: 400, data: { message: 'Link inválido ou expirado' } },
    })
    renderPage()

    await user.type(screen.getByLabelText('Nova senha'), PASSWORD)
    await user.type(screen.getByLabelText('Confirmar nova senha'), PASSWORD)
    await user.click(screen.getByRole('button', { name: /definir senha/i }))

    expect(await screen.findByText(/link inválido ou expirado/i)).toBeInTheDocument()
  })

  it('shows policy messages from the backend', async () => {
    const user = userEvent.setup()
    activateAccount.mockRejectedValue({
      response: { status: 400, data: { message: ['A senha deve ter no mínimo 12 caracteres'] } },
    })
    renderPage()

    await user.type(screen.getByLabelText('Nova senha'), PASSWORD)
    await user.type(screen.getByLabelText('Confirmar nova senha'), PASSWORD)
    await user.click(screen.getByRole('button', { name: /definir senha/i }))

    expect(await screen.findByText(/no mínimo 12 caracteres/i)).toBeInTheDocument()
  })

  it('does not render arbitrary backend exception text', async () => {
    const user = userEvent.setup()
    activateAccount.mockRejectedValue({
      response: { status: 500, data: { message: 'QueryFailedError: duplicate key value violates...' } },
    })
    renderPage()

    await user.type(screen.getByLabelText('Nova senha'), PASSWORD)
    await user.type(screen.getByLabelText('Confirmar nova senha'), PASSWORD)
    await user.click(screen.getByRole('button', { name: /definir senha/i }))

    expect(await screen.findByText(/não foi possível processar a solicitação/i)).toBeInTheDocument()
    expect(screen.queryByText(/QueryFailedError/)).not.toBeInTheDocument()
  })

  it('rejects a mismatched confirmation client-side', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Nova senha'), PASSWORD)
    await user.type(screen.getByLabelText('Confirmar nova senha'), 'outra senha bem comprida')
    await user.click(screen.getByRole('button', { name: /definir senha/i }))

    expect(await screen.findByText(/confirmação não corresponde/i)).toBeInTheDocument()
    expect(activateAccount).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails, then implement the shared form**

```bash
npx vitest run src/tests/auth/ActivateAccountPage.test.tsx
```

Create `frontend/src/features/auth/components/SetPasswordForm.tsx`:

```tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import { activateAccountSchema, type SetPasswordFormValues } from '@/schemas/password.schema'
import { PasswordInput } from './PasswordInput'
import { PasswordRequirements } from './PasswordRequirements'
import { describeApiError, INVALID_LINK_MESSAGE } from '../lib/apiErrors'

interface SetPasswordFormProps {
  title: string
  submitLabel: string
  token: string | null
  onSubmit: (token: string, password: string, passwordConfirmation: string) => Promise<unknown>
  onSuccess: () => void
}

export function SetPasswordForm({
  title, submitLabel, token, onSubmit, onSuccess,
}: SetPasswordFormProps) {
  const [tokenRejected, setTokenRejected] = useState(false)
  const [apiMessages, setApiMessages] = useState<string[]>([])

  const form = useForm<SetPasswordFormValues>({
    resolver: zodResolver(activateAccountSchema),
    defaultValues: { password: '', passwordConfirmation: '' },
  })

  const password = form.watch('password')
  const confirmation = form.watch('passwordConfirmation')

  // No token means nothing to validate — never call the API just to be told so.
  if (!token || tokenRejected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{INVALID_LINK_MESSAGE}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4" aria-live="polite">
          <p className="text-sm text-muted-foreground">
            Este link não é mais válido. Solicite um novo para continuar.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/forgot-password">Solicitar novo link</Link>
            </Button>
            <Button asChild variant="ghost" className="w-full sm:w-auto">
              <Link to="/login">Voltar ao login</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const handleSubmit = async (values: SetPasswordFormValues) => {
    setApiMessages([])
    try {
      await onSubmit(token, values.password, values.passwordConfirmation)
      onSuccess()
    } catch (error) {
      const { kind, messages } = describeApiError(error)
      if (kind === 'token') setTokenRejected(true)
      else setApiMessages(messages)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nova senha</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="passwordConfirmation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirmar nova senha</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <PasswordRequirements value={password} confirmation={confirmation} />

            {apiMessages.length > 0 && (
              <div aria-live="polite" className="space-y-1">
                {apiMessages.map((message) => (
                  <p key={message} className="text-sm font-medium text-destructive">
                    {message}
                  </p>
                ))}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitLabel}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Implement the three pages**

Create `frontend/src/features/auth/pages/ActivateAccountPage.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { authApi } from '@/lib/api/auth.api'
import { useFragmentToken } from '../hooks/useFragmentToken'
import { SetPasswordForm } from '../components/SetPasswordForm'

export function ActivateAccountPage() {
  const navigate = useNavigate()
  const token = useFragmentToken()

  return (
    <SetPasswordForm
      title="Ativar conta"
      submitLabel="Definir senha"
      token={token}
      onSubmit={authApi.activateAccount}
      onSuccess={() => {
        toast.success('Senha definida. Faça login para continuar.')
        navigate('/login', { replace: true })
      }}
    />
  )
}
```

Create `frontend/src/features/auth/pages/ResetPasswordPage.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { authApi } from '@/lib/api/auth.api'
import { useFragmentToken } from '../hooks/useFragmentToken'
import { SetPasswordForm } from '../components/SetPasswordForm'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const token = useFragmentToken()

  return (
    <SetPasswordForm
      title="Redefinir senha"
      submitLabel="Redefinir senha"
      token={token}
      onSubmit={authApi.resetPassword}
      onSuccess={() => {
        toast.success('Senha redefinida. Faça login para continuar.')
        navigate('/login', { replace: true })
      }}
    />
  )
}
```

Create `frontend/src/features/auth/pages/ForgotPasswordPage.tsx`:

```tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import { forgotPasswordSchema, type ForgotPasswordFormValues } from '@/schemas/password.schema'
import { authApi } from '@/lib/api/auth.api'
import { GENERIC_ERROR_MESSAGE } from '../lib/apiErrors'

const CONFIRMATION =
  'Se o e-mail estiver cadastrado, enviaremos as instruções para redefinição da senha.'

export function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false)
  const [transportError, setTransportError] = useState<string | null>(null)

  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  })

  const onSubmit = async (values: ForgotPasswordFormValues) => {
    setTransportError(null)
    try {
      await authApi.forgotPassword(values.email)
      // Any 2xx shows the account-independent confirmation. An SMTP failure is
      // invisible here because the backend returns the same success response.
      setSubmitted(true)
    } catch {
      // No response, or an error response (429, 400, 5xx): the request was not
      // processed, so claiming it was would be a lie.
      setTransportError(GENERIC_ERROR_MESSAGE)
    }
  }

  if (submitted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Verifique seu e-mail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4" aria-live="polite">
          <p className="text-sm text-muted-foreground">{CONFIRMATION}</p>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login">Voltar ao login</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Esqueci minha senha</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" placeholder="seu@email.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {transportError && (
              <p aria-live="polite" className="text-sm font-medium text-destructive">
                {transportError}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enviar instruções
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
```

- [ ] **Step 4: Write the forgot-password and reset tests**

Create `frontend/src/tests/auth/ForgotPasswordPage.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const forgotPassword = vi.fn()
vi.mock('@/lib/api/auth.api', () => ({ authApi: { forgotPassword: (...a: unknown[]) => forgotPassword(...a) } }))

import { ForgotPasswordPage } from '@/features/auth/pages/ForgotPasswordPage'

const renderPage = () =>
  render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  )

async function submit(email = 'maria@test.com') {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('E-mail'), email)
  await user.click(screen.getByRole('button', { name: /enviar instruções/i }))
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the account-independent confirmation on success', async () => {
    forgotPassword.mockResolvedValue({ message: 'ok' })
    renderPage()
    await submit()

    expect(
      await screen.findByText(/se o e-mail estiver cadastrado/i),
    ).toBeInTheDocument()
  })

  it('shows the same confirmation for an unknown e-mail', async () => {
    forgotPassword.mockResolvedValue({ message: 'ok' })
    renderPage()
    await submit('ninguem@test.com')

    expect(await screen.findByText(/se o e-mail estiver cadastrado/i)).toBeInTheDocument()
  })

  it('does not claim the request was processed on a network failure', async () => {
    forgotPassword.mockRejectedValue(new Error('Network Error'))
    renderPage()
    await submit()

    expect(
      await screen.findByText(/não foi possível processar a solicitação/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/se o e-mail estiver cadastrado/i)).not.toBeInTheDocument()
  })

  it('does not show the confirmation panel on a 429', async () => {
    forgotPassword.mockRejectedValue({ response: { status: 429, data: { message: 'Too many' } } })
    renderPage()
    await submit()

    expect(await screen.findByText(/não foi possível processar/i)).toBeInTheDocument()
    expect(screen.queryByText(/se o e-mail estiver cadastrado/i)).not.toBeInTheDocument()
  })

  it('validates the e-mail before calling the API', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('E-mail'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: /enviar instruções/i }))

    expect(await screen.findByText(/e-mail inválido/i)).toBeInTheDocument()
    expect(forgotPassword).not.toHaveBeenCalled()
  })
})
```

Create `frontend/src/tests/auth/ResetPasswordPage.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const resetPassword = vi.fn()
vi.mock('@/lib/api/auth.api', () => ({ authApi: { resetPassword: (...a: unknown[]) => resetPassword(...a) } }))

import { ResetPasswordPage } from '@/features/auth/pages/ResetPasswordPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <ResetPasswordPage />
    </MemoryRouter>,
  )
}

const PASSWORD = 'uma senha bem comprida'

async function fill() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Nova senha'), PASSWORD)
  await user.type(screen.getByLabelText('Confirmar nova senha'), PASSWORD)
  await user.click(screen.getByRole('button', { name: /redefinir senha/i }))
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/reset-password#token=FRAGMENT_TOKEN')
  })

  it('renders the form when a token is present', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /redefinir senha/i })).toBeInTheDocument()
  })

  it('strips the token from the URL on mount', () => {
    renderPage()
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/reset-password')
  })

  it('renders the invalid-link state and calls no API when the token is missing', () => {
    window.history.replaceState({}, '', '/reset-password')
    renderPage()

    expect(screen.getByText(/link inválido ou expirado/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /redefinir senha/i })).not.toBeInTheDocument()
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('submits the fragment token to the reset endpoint', async () => {
    resetPassword.mockResolvedValue({})
    renderPage()
    await fill()

    await waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith('FRAGMENT_TOKEN', PASSWORD, PASSWORD),
    )
  })

  it('never writes the token to storage', async () => {
    resetPassword.mockResolvedValue({})
    renderPage()
    await fill()

    expect(JSON.stringify(localStorage)).not.toContain('FRAGMENT_TOKEN')
    expect(JSON.stringify(sessionStorage)).not.toContain('FRAGMENT_TOKEN')
  })

  it('redirects to login after success and never authenticates', async () => {
    resetPassword.mockResolvedValue({})
    renderPage()
    await fill()

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }))
    expect(localStorage.getItem('inventory-auth')).toBeNull()
  })

  it('shows the fixed message for a rejected token', async () => {
    resetPassword.mockRejectedValue({
      response: { status: 400, data: { message: 'Link inválido ou expirado' } },
    })
    renderPage()
    await fill()

    expect(await screen.findByText(/link inválido ou expirado/i)).toBeInTheDocument()
  })

  it('shows policy messages from the backend', async () => {
    resetPassword.mockRejectedValue({
      response: { status: 400, data: { message: ['A senha deve ter no mínimo 12 caracteres'] } },
    })
    renderPage()
    await fill()

    expect(await screen.findByText(/no mínimo 12 caracteres/i)).toBeInTheDocument()
  })

  it('does not render arbitrary backend exception text', async () => {
    resetPassword.mockRejectedValue({
      response: { status: 500, data: { message: 'PrismaClientKnownRequestError: P2025' } },
    })
    renderPage()
    await fill()

    expect(await screen.findByText(/não foi possível processar a solicitação/i)).toBeInTheDocument()
    expect(screen.queryByText(/PrismaClient/)).not.toBeInTheDocument()
  })

  it('rejects a mismatched confirmation client-side', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Nova senha'), PASSWORD)
    await user.type(screen.getByLabelText('Confirmar nova senha'), 'outra senha bem comprida')
    await user.click(screen.getByRole('button', { name: /redefinir senha/i }))

    expect(await screen.findByText(/confirmação não corresponde/i)).toBeInTheDocument()
    expect(resetPassword).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Register the routes and the login link**

In `frontend/src/app/routes.tsx`, add the lazy imports and the public routes:

```tsx
const ActivateAccountPage = lazy(() =>
  import('@/features/auth/pages/ActivateAccountPage').then((m) => ({ default: m.ActivateAccountPage }))
)
const ForgotPasswordPage = lazy(() =>
  import('@/features/auth/pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage }))
)
const ResetPasswordPage = lazy(() =>
  import('@/features/auth/pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage }))
)
```

```tsx
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/activate-account" element={<ActivateAccountPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>
```

In `frontend/src/features/auth/components/LoginForm.tsx`, add the link below the submit button:

```tsx
            <Button asChild variant="link" className="w-full">
              <Link to="/forgot-password">Esqueci minha senha</Link>
            </Button>
```

and add `import { Link } from 'react-router-dom'` at the top.

- [ ] **Step 6: Run, lint, build, commit**

```bash
npx vitest run src/tests/auth
npm run test && npm run lint && npm run build
```

```bash
cd /home/userterras/Documents/inventory-manager
git add frontend/src/features/auth frontend/src/app/routes.tsx frontend/src/tests/auth
git commit -m "$(cat <<'MSG'
feat(frontend): add activation, forgot-password and reset pages

The two token pages share one form and render the invalid-link state without
calling the API when no fragment token is present. forgot-password shows the
account-independent confirmation only for a real 2xx, and a retry message
whenever the request did not go through.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 18: Admin users area

**Files:**
- Create: `frontend/src/features/users/hooks/useUsers.ts`
- Create: `frontend/src/features/users/components/InvitationStatusBadge.tsx`
- Create: `frontend/src/features/users/components/UserForm.tsx`
- Create: `frontend/src/features/users/pages/UsersListPage.tsx`
- Create: `frontend/src/features/users/pages/UserNewPage.tsx`
- Create: `frontend/src/features/users/pages/UserEditPage.tsx`
- Modify: `frontend/src/app/routes.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Modify: `frontend/src/lib/permissions.ts`
- Modify: `frontend/src/tests/layout/Sidebar.test.tsx`
- Test: `frontend/src/tests/users/UsersListPage.test.tsx`
- Test: `frontend/src/tests/users/UserForm.test.tsx`

**Interfaces:**
- Consumes: `usersApi` and `AdminUser` (Task 14), `ConfirmDialog`, `FilterPanel`, `usePagination`.
- Produces: `userKeys`, `useUsersList`, `useUser`, `useCreateUser`, `useUpdateUser`, `useUpdateUserStatus`, `useResendInvitation`, `useRevokeInvitation`; routes `/users`, `/users/new`, `/users/:id/edit`.

- [ ] **Step 1: Write the hooks**

Create `frontend/src/features/users/hooks/useUsers.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { usersApi, type ListUsersParams } from '@/lib/api/users.api'
import { GENERIC_ERROR_MESSAGE } from '@/features/auth/lib/apiErrors'

export const userKeys = {
  all: ['users'] as const,
  list: (params?: object) => [...userKeys.all, 'list', params] as const,
  detail: (id: string) => [...userKeys.all, 'detail', id] as const,
}

export const CREATED_MESSAGE =
  'Usuário criado. Um convite foi enviado para que ele valide o e-mail e defina sua senha.'
export const CREATED_MAIL_FAILED_MESSAGE =
  "Usuário criado, mas o convite não pôde ser enviado. Use 'Reenviar convite' na lista."

export function useUsersList(params?: ListUsersParams) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: () => usersApi.list(params),
  })
}

export function useUser(id: string) {
  return useQuery({
    queryKey: userKeys.detail(id),
    queryFn: () => usersApi.getById(id),
    enabled: !!id,
  })
}

function conflictMessage(error: unknown, fallback: string): string {
  const response = (error as { response?: { status?: number; data?: { message?: unknown } } })
    ?.response
  if (response?.status === 409 || response?.status === 403) {
    const raw = response.data?.message
    if (typeof raw === 'string') return raw
    if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0]
  }
  return fallback
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: usersApi.create,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: userKeys.all })
      if (result.invitationEmailSent) toast.success(CREATED_MESSAGE)
      else toast.warning(CREATED_MAIL_FAILED_MESSAGE)
    },
    onError: (error) => toast.error(conflictMessage(error, GENERIC_ERROR_MESSAGE)),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; role?: 'attendant' | 'financial' } }) =>
      usersApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all })
      toast.success('Usuário atualizado')
    },
    onError: (error) => toast.error(conflictMessage(error, GENERIC_ERROR_MESSAGE)),
  })
}

export function useUpdateUserStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      usersApi.updateStatus(id, isActive),
    onSuccess: (user) => {
      qc.invalidateQueries({ queryKey: userKeys.all })
      toast.success(user.isActive ? 'Usuário ativado' : 'Usuário desativado')
    },
    onError: (error) => toast.error(conflictMessage(error, GENERIC_ERROR_MESSAGE)),
  })
}

export function useResendInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => usersApi.resendInvitation(id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: userKeys.all })
      if (result.invitationEmailSent) toast.success('Convite reenviado')
      else toast.warning('O convite não pôde ser enviado. Tente novamente em instantes.')
    },
    onError: (error) => toast.error(conflictMessage(error, GENERIC_ERROR_MESSAGE)),
  })
}

export function useRevokeInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => usersApi.revokeInvitation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all })
      toast.success('Convite revogado')
    },
    onError: (error) => toast.error(conflictMessage(error, GENERIC_ERROR_MESSAGE)),
  })
}
```

- [ ] **Step 2: Write the badge and the form**

Create `frontend/src/features/users/components/InvitationStatusBadge.tsx`:

```tsx
import { Badge } from '@/components/ui/badge'
import type { InvitationStatus } from '@/types'

const LABELS: Record<InvitationStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  none: { label: 'Nenhum', variant: 'outline' },
  pending: { label: 'Pendente', variant: 'secondary' },
  expired: { label: 'Expirado', variant: 'destructive' },
  revoked: { label: 'Revogado', variant: 'destructive' },
  accepted: { label: 'Aceito', variant: 'default' },
}

export function InvitationStatusBadge({ status }: { status: InvitationStatus }) {
  const { label, variant } = LABELS[status]
  return <Badge variant={variant}>{label}</Badge>
}
```

Create `frontend/src/features/users/components/UserForm.tsx`:

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { createUserSchema, updateUserSchema, type CreateUserFormValues } from '@/schemas/user.schema'

interface UserFormProps {
  mode: 'create' | 'edit'
  defaultValues?: Partial<CreateUserFormValues>
  isSubmitting?: boolean
  onSubmit: (values: CreateUserFormValues) => void
  onCancel: () => void
}

/** No password field exists here: the user sets their own via the invitation. */
export function UserForm({ mode, defaultValues, isSubmitting, onSubmit, onCancel }: UserFormProps) {
  const form = useForm<CreateUserFormValues>({
    resolver: zodResolver(mode === 'create' ? createUserSchema : updateUserSchema),
    defaultValues: {
      name: defaultValues?.name ?? '',
      email: defaultValues?.email ?? '',
      role: defaultValues?.role ?? 'attendant',
    },
  })

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-lg space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome</FormLabel>
              <FormControl>
                <Input autoComplete="name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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
                  readOnly={mode === 'edit'}
                  disabled={mode === 'edit'}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Perfil</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um perfil" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="bg-white">
                  <SelectItem value="attendant">Atendente</SelectItem>
                  <SelectItem value="financial">Financeiro</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'create' ? 'Criar usuário' : 'Salvar'}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </Form>
  )
}
```

- [ ] **Step 3: Write the list page**

Create `frontend/src/features/users/pages/UsersListPage.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { FilterPanel } from '@/components/filters/FilterPanel'
import { usePagination } from '@/hooks/usePagination'
import { formatDate } from '@/lib/formatters'
import type { AdminUser, UserRole } from '@/types'
import { InvitationStatusBadge } from '../components/InvitationStatusBadge'
import {
  useUsersList, useUpdateUserStatus, useResendInvitation, useRevokeInvitation,
} from '../hooks/useUsers'

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  attendant: 'Atendente',
  financial: 'Financeiro',
}

// Declared above the component because the FilterPanel summary reads it.
type PendingAction =
  | { type: 'deactivate'; user: AdminUser }
  | { type: 'revoke'; user: AdminUser }
  | null

export function UsersListPage() {
  const navigate = useNavigate()
  const { page, limit, setPage } = usePagination()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<UserRole | 'all'>('all')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [pending, setPending] = useState<PendingAction>(null)

  const { data, isLoading, isError, refetch } = useUsersList({
    page,
    limit,
    search: search || undefined,
    role: role === 'all' ? undefined : role,
    status: status === 'all' ? undefined : status,
  })

  const updateStatus = useUpdateUserStatus()
  const resend = useResendInvitation()
  const revoke = useRevokeInvitation()

  // Admin rows are read-only here: admin management is out of scope and the
  // API refuses admin targets.
  const isManageable = (user: AdminUser) => user.role !== 'admin'
  const canResend = (user: AdminUser) =>
    isManageable(user) && user.isActive && !user.passwordSetAt
  const canRevoke = (user: AdminUser) =>
    isManageable(user) && user.invitationStatus === 'pending'

  const confirmPending = () => {
    if (!pending) return
    if (pending.type === 'deactivate') {
      updateStatus.mutate({ id: pending.user.id, isActive: false })
    } else {
      revoke.mutate(pending.user.id)
    }
    setPending(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Usuários</h2>
        <Button onClick={() => navigate('/users/new')}>
          <Plus className="mr-2 h-4 w-4" />
          Novo Usuário
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou e-mail..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="pl-9"
        />
      </div>

      <FilterPanel
        activeCount={(role === 'all' ? 0 : 1) + (status === 'all' ? 0 : 1)}
        summary={[
          role === 'all' ? null : ROLE_LABELS[role],
          status === 'all' ? null : status === 'active' ? 'Ativos' : 'Inativos',
        ]
          .filter(Boolean)
          .join(' · ')}
        onClear={() => { setRole('all'); setStatus('all'); setPage(1) }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            value={role}
            onValueChange={(value) => { setRole(value as UserRole | 'all'); setPage(1) }}
          >
            <SelectTrigger aria-label="Filtrar por perfil">
              <SelectValue placeholder="Perfil" />
            </SelectTrigger>
            <SelectContent className="bg-white">
              <SelectItem value="all">Todos os perfis</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="attendant">Atendente</SelectItem>
              <SelectItem value="financial">Financeiro</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={status}
            onValueChange={(value) => { setStatus(value as typeof status); setPage(1) }}
          >
            <SelectTrigger aria-label="Filtrar por status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-white">
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="inactive">Inativos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FilterPanel>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      )}
      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState
              title="Nenhum usuário encontrado"
              description={search ? 'Tente outra busca.' : 'Convide o primeiro usuário.'}
              action={{ label: 'Novo Usuário', onClick: () => navigate('/users/new') }}
            />
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>E-mail</TableHead>
                      <TableHead>Perfil</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Convite</TableHead>
                      <TableHead>E-mail verificado</TableHead>
                      <TableHead>Último login</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.name}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>{ROLE_LABELS[user.role]}</TableCell>
                        <TableCell>
                          <Badge variant={user.isActive ? 'default' : 'secondary'}>
                            {user.isActive ? 'Ativo' : 'Inativo'}
                          </Badge>
                        </TableCell>
                        <TableCell><InvitationStatusBadge status={user.invitationStatus} /></TableCell>
                        <TableCell>
                          <Badge variant={user.emailVerifiedAt ? 'default' : 'outline'}>
                            {user.emailVerifiedAt ? 'Verificado' : 'Pendente'}
                          </Badge>
                        </TableCell>
                        <TableCell>{user.lastLogin ? formatDate(user.lastLogin) : '—'}</TableCell>
                        <TableCell className="space-x-1 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!isManageable(user)}
                            onClick={() => navigate(`/users/${user.id}/edit`)}
                          >
                            Editar
                          </Button>
                          {canResend(user) && (
                            <Button variant="ghost" size="sm" onClick={() => resend.mutate(user.id)}>
                              Reenviar
                            </Button>
                          )}
                          {canRevoke(user) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPending({ type: 'revoke', user })}
                            >
                              Revogar
                            </Button>
                          )}
                          {isManageable(user) &&
                            (user.isActive ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setPending({ type: 'deactivate', user })}
                              >
                                Desativar
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => updateStatus.mutate({ id: user.id, isActive: true })}
                              >
                                Ativar
                              </Button>
                            ))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile */}
              <div className="divide-y rounded-md border md:hidden">
                {data.data.map((user) => (
                  <div key={user.id} className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{user.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                      </div>
                      <Badge variant={user.isActive ? 'default' : 'secondary'}>
                        {user.isActive ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline">{ROLE_LABELS[user.role]}</Badge>
                      <InvitationStatusBadge status={user.invitationStatus} />
                    </div>
                    {isManageable(user) && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" variant="outline" onClick={() => navigate(`/users/${user.id}/edit`)}>
                          Editar
                        </Button>
                        {canResend(user) && (
                          <Button size="sm" variant="outline" onClick={() => resend.mutate(user.id)}>
                            Reenviar
                          </Button>
                        )}
                        {canRevoke(user) && (
                          <Button size="sm" variant="outline" onClick={() => setPending({ type: 'revoke', user })}>
                            Revogar
                          </Button>
                        )}
                        {user.isActive ? (
                          <Button size="sm" variant="outline" onClick={() => setPending({ type: 'deactivate', user })}>
                            Desativar
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: user.id, isActive: true })}>
                            Ativar
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {data.total > limit && (
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">
                Mostrando {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} de {data.total}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * limit >= data.total}
                  onClick={() => setPage(page + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={pending !== null}
        destructive
        title={pending?.type === 'revoke' ? 'Revogar convite' : 'Desativar usuário'}
        description={
          pending?.type === 'revoke'
            ? `O convite pendente de ${pending.user.name} deixará de funcionar. Você poderá enviar um novo depois.`
            : `${pending?.user.name ?? 'O usuário'} não conseguirá mais entrar no sistema e todas as sessões serão encerradas.`
        }
        confirmLabel={pending?.type === 'revoke' ? 'Revogar' : 'Desativar'}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
```

- [ ] **Step 4: Write the two page wrappers**

Create `frontend/src/features/users/pages/UserNewPage.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
import { UserForm } from '../components/UserForm'
import { useCreateUser } from '../hooks/useUsers'

export function UserNewPage() {
  const navigate = useNavigate()
  const createUser = useCreateUser()

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Novo Usuário</h2>
      <UserForm
        mode="create"
        isSubmitting={createUser.isPending}
        onCancel={() => navigate('/users')}
        onSubmit={(values) =>
          createUser.mutate(values, { onSuccess: () => navigate('/users') })
        }
      />
    </div>
  )
}
```

Create `frontend/src/features/users/pages/UserEditPage.tsx`:

```tsx
import { useNavigate, useParams } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { UserForm } from '../components/UserForm'
import { useUpdateUser, useUser } from '../hooks/useUsers'

export function UserEditPage() {
  const navigate = useNavigate()
  const { id = '' } = useParams()
  const { data, isLoading, isError, refetch } = useUser(id)
  const updateUser = useUpdateUser()

  if (isLoading) return <Skeleton className="h-64 w-full max-w-lg" />
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Editar Usuário</h2>
      <UserForm
        mode="edit"
        defaultValues={{
          name: data.name,
          email: data.email,
          role: data.role === 'admin' ? 'attendant' : data.role,
        }}
        isSubmitting={updateUser.isPending}
        onCancel={() => navigate('/users')}
        onSubmit={(values) =>
          updateUser.mutate(
            { id, data: { name: values.name, role: values.role } },
            { onSuccess: () => navigate('/users') },
          )
        }
      />
    </div>
  )
}
```

- [ ] **Step 5: Write the failing page tests**

Create `frontend/src/tests/users/UsersListPage.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AdminUser } from '@/types'

const list = vi.fn()
const updateStatus = vi.fn()
const revokeInvitation = vi.fn()
const resendInvitation = vi.fn()

vi.mock('@/lib/api/users.api', () => ({
  usersApi: {
    list: (...a: unknown[]) => list(...a),
    updateStatus: (...a: unknown[]) => updateStatus(...a),
    revokeInvitation: (...a: unknown[]) => revokeInvitation(...a),
    resendInvitation: (...a: unknown[]) => resendInvitation(...a),
  },
}))

import { UsersListPage } from '@/features/users/pages/UsersListPage'
import { RoleGuard } from '@/components/layout/RoleGuard'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { useAuthStore } from '@/stores/auth.store'

function user(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'u1',
    name: 'Maria',
    email: 'maria@test.com',
    role: 'attendant',
    isActive: true,
    emailVerifiedAt: null,
    passwordSetAt: null,
    lastLogin: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    invitationStatus: 'pending',
    invitationExpiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/users']}>
        <Routes>
          <Route path="/users" element={<UsersListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function renderGuarded(initialRole: 'admin' | 'attendant' | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (initialRole) {
    useAuthStore.getState().setAuth(
      { id: 'me', name: 'Eu', email: 'eu@test.com', role: initialRole, isActive: true, createdAt: '2026-01-01' },
      'at', 'rt',
    )
  } else {
    useAuthStore.getState().clearAuth()
  }

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/users']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route element={<RoleGuard allowedRoles={['admin']} />}>
              <Route path="/users" element={<UsersListPage />} />
            </Route>
          </Route>
          <Route path="/login" element={<div>LOGIN</div>} />
          <Route path="/403" element={<div>FORBIDDEN</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('UsersListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    list.mockResolvedValue({ data: [user()], total: 1, page: 1, limit: 20 })
  })

  describe('access control', () => {
    it('redirects an unauthenticated visitor to login', async () => {
      renderGuarded(null)
      expect(await screen.findByText('LOGIN')).toBeInTheDocument()
    })

    it('redirects a non-admin to 403', async () => {
      renderGuarded('attendant')
      expect(await screen.findByText('FORBIDDEN')).toBeInTheDocument()
    })

    it('renders for an admin', async () => {
      renderGuarded('admin')
      expect(await screen.findByRole('heading', { name: 'Usuários' })).toBeInTheDocument()
    })
  })

  it('shows a loading skeleton then the rows', async () => {
    renderPage()
    expect(await screen.findByText('maria@test.com')).toBeInTheDocument()
  })

  it('shows the error state and retries', async () => {
    list.mockRejectedValue(new Error('boom'))
    renderPage()
    expect(await screen.findByText(/erro/i)).toBeInTheDocument()
  })

  it('shows the empty state when there are no users', async () => {
    list.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 })
    renderPage()
    expect(await screen.findByText(/nenhum usuário encontrado/i)).toBeInTheDocument()
  })

  it('renders the invitation and verification status', async () => {
    renderPage()
    expect(await screen.findByText('Pendente')).toBeInTheDocument()
  })

  it('passes the search term to the API', async () => {
    const localUser = userEvent.setup()
    renderPage()
    await screen.findByText('maria@test.com')

    await localUser.type(screen.getByPlaceholderText(/buscar por nome ou e-mail/i), 'mar')

    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ search: 'mar' })),
    )
  })

  it('confirms before deactivating', async () => {
    const localUser = userEvent.setup()
    updateStatus.mockResolvedValue(user({ isActive: false }))
    renderPage()
    await screen.findByText('maria@test.com')

    await localUser.click(screen.getAllByRole('button', { name: 'Desativar' })[0])
    expect(await screen.findByText(/todas as sessões serão encerradas/i)).toBeInTheDocument()
    expect(updateStatus).not.toHaveBeenCalled()

    // Two "Desativar" buttons exist now (row + dialog) — scope to the dialog.
    const dialog = screen.getByRole('alertdialog')
    await localUser.click(within(dialog).getByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(updateStatus).toHaveBeenCalledWith('u1', false))
  })

  it('confirms before revoking an invitation', async () => {
    const localUser = userEvent.setup()
    revokeInvitation.mockResolvedValue({})
    renderPage()
    await screen.findByText('maria@test.com')

    await localUser.click(screen.getAllByRole('button', { name: 'Revogar' })[0])
    expect(await screen.findByText(/deixará de funcionar/i)).toBeInTheDocument()
  })

  it('offers no actions for an admin row', async () => {
    list.mockResolvedValue({
      data: [user({ id: 'a1', name: 'Chefe', role: 'admin', invitationStatus: 'accepted', passwordSetAt: '2026-01-01' })],
      total: 1, page: 1, limit: 20,
    })
    renderPage()
    await screen.findByText('Chefe')

    expect(screen.getByRole('button', { name: 'Editar' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Desativar' })).not.toBeInTheDocument()
  })

  it('hides resend for a user who already activated', async () => {
    list.mockResolvedValue({
      data: [user({ passwordSetAt: '2026-09-02', invitationStatus: 'accepted' })],
      total: 1, page: 1, limit: 20,
    })
    renderPage()
    await screen.findByText('maria@test.com')

    expect(screen.queryByRole('button', { name: 'Reenviar' })).not.toBeInTheDocument()
  })

  it('renders a mobile list alongside the desktop table', async () => {
    renderPage()
    await screen.findByText('maria@test.com')
    // The same user appears once per layout; one container is hidden by CSS.
    expect(screen.getAllByText('Maria').length).toBeGreaterThanOrEqual(2)
  })

  it('never receives a password or tokenHash in the mapped response', async () => {
    renderPage()
    await screen.findByText('maria@test.com')

    const returned = await list.mock.results[0].value
    expect(JSON.stringify(returned)).not.toContain('password')
    expect(JSON.stringify(returned)).not.toContain('tokenHash')
  })
})
```

Create `frontend/src/tests/users/UserForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserForm } from '@/features/users/components/UserForm'

describe('UserForm', () => {
  it('has no password field', () => {
    render(<UserForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument()
  })

  it('rejects an invalid e-mail', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<UserForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('Nome'), 'Maria')
    await user.type(screen.getByLabelText('E-mail'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: /criar usuário/i }))

    expect(await screen.findByText(/e-mail inválido/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('requires a name', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<UserForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('E-mail'), 'maria@test.com')
    await user.click(screen.getByRole('button', { name: /criar usuário/i }))

    expect(await screen.findByText(/nome obrigatório/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('offers only attendant and financial', async () => {
    const user = userEvent.setup()
    render(<UserForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))

    expect(screen.getByRole('option', { name: 'Atendente' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Financeiro' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Admin' })).not.toBeInTheDocument()
  })

  it('submits normalized values', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<UserForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('Nome'), '  Maria  ')
    await user.type(screen.getByLabelText('E-mail'), '  MARIA@Test.COM  ')
    await user.click(screen.getByRole('button', { name: /criar usuário/i }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Maria', email: 'maria@test.com', role: 'attendant' }),
    )
  })

  it('makes the e-mail read-only in edit mode', () => {
    render(
      <UserForm
        mode="edit"
        defaultValues={{ name: 'Maria', email: 'maria@test.com', role: 'financial' }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('readonly')
  })
})
```

- [ ] **Step 6: Wire routes, sidebar and permissions**

In `frontend/src/app/routes.tsx`, add the lazy imports and nest the routes so **authentication wraps authorization**:

```tsx
const UsersListPage = lazy(() =>
  import('@/features/users/pages/UsersListPage').then((m) => ({ default: m.UsersListPage }))
)
const UserNewPage = lazy(() =>
  import('@/features/users/pages/UserNewPage').then((m) => ({ default: m.UserNewPage }))
)
const UserEditPage = lazy(() =>
  import('@/features/users/pages/UserEditPage').then((m) => ({ default: m.UserEditPage }))
)
```

Inside the existing `<Route element={<ProtectedRoute />}><Route element={<AppLayout />}>` block, after the financial routes:

```tsx
            <Route element={<RoleGuard allowedRoles={['admin']} />}>
              <Route path="/users" element={<UsersListPage />} />
              <Route path="/users/new" element={<UserNewPage />} />
              <Route path="/users/:id/edit" element={<UserEditPage />} />
            </Route>
```

and import `RoleGuard` at the top: `import { RoleGuard } from '@/components/layout/RoleGuard'`.

In `frontend/src/components/layout/Sidebar.tsx`, add `UserCog` and `ShieldCheck` to the `lucide-react` import and append to `navItems`:

```tsx
  { label: 'Usuários',     href: '/users',                      icon: UserCog,         roles: ['admin'] },
  { label: 'Minha conta',  href: '/account/security',           icon: ShieldCheck,     roles: ['admin', 'attendant', 'financial'] },
```

In `frontend/src/lib/permissions.ts`, add to `PERMISSIONS`:

```ts
  users: {
    view: ['admin'] as UserRole[],
    manage: ['admin'] as UserRole[],
  },
```

Then update `frontend/src/tests/layout/Sidebar.test.tsx`: admins see "Usuários", attendant and financial do not, and all three see "Minha conta".

- [ ] **Step 7: Run, lint, build, commit**

```bash
npx vitest run src/tests/users src/tests/layout
npm run test && npm run lint && npm run build
```

```bash
cd /home/userterras/Documents/inventory-manager
git add frontend/src/features/users frontend/src/app/routes.tsx frontend/src/components/layout/Sidebar.tsx frontend/src/lib/permissions.ts frontend/src/tests
git commit -m "$(cat <<'MSG'
feat(frontend): add admin users area

Listing with search, role and status filters, desktop table plus mobile
compact list, derived invitation badges, and confirmation before deactivating
or revoking. The create form has no password field and offers only attendant
and financial. Routes sit inside ProtectedRoute and RoleGuard.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 19: Account security page

**Files:**
- Create: `frontend/src/features/account/pages/AccountSecurityPage.tsx`
- Modify: `frontend/src/app/routes.tsx`
- Test: `frontend/src/tests/account/AccountSecurityPage.test.tsx`

**Interfaces:**
- Consumes: `authApi.changePassword`, Task 16's components, `changePasswordSchema`.
- Produces: route `/account/security`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/account/AccountSecurityPage.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const changePassword = vi.fn()
vi.mock('@/lib/api/auth.api', () => ({
  authApi: { changePassword: (...a: unknown[]) => changePassword(...a) },
}))

import { AccountSecurityPage } from '@/features/account/pages/AccountSecurityPage'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { useAuthStore } from '@/stores/auth.store'

const CURRENT = 'a senha atual comprida'
const NEXT = 'a senha nova bem comprida'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AccountSecurityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function fillAndSubmit(current = CURRENT, next = NEXT, confirmation = NEXT) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Senha atual'), current)
  await user.type(screen.getByLabelText('Nova senha'), next)
  await user.type(screen.getByLabelText('Confirmar nova senha'), confirmation)
  await user.click(screen.getByRole('button', { name: /alterar senha/i }))
}

describe('AccountSecurityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useAuthStore.getState().setAuth(
      { id: 'u1', name: 'Maria', email: 'maria@test.com', role: 'attendant', isActive: true, createdAt: '2026-01-01' },
      'at-1', 'rt-1',
    )
  })

  it('warns that all sessions will end', () => {
    renderPage()
    expect(screen.getByText(/todas as sessões serão encerradas/i)).toBeInTheDocument()
  })

  it('submits the three fields', async () => {
    changePassword.mockResolvedValue({})
    renderPage()
    await fillAndSubmit()

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith(CURRENT, NEXT, NEXT))
  })

  it('clears auth state and redirects to login on success', async () => {
    changePassword.mockResolvedValue({})
    renderPage()
    await fillAndSubmit()

    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false))
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true })
  })

  it('rejects a mismatched confirmation client-side', async () => {
    renderPage()
    await fillAndSubmit(CURRENT, NEXT, 'outra senha bem comprida')

    expect(await screen.findByText(/confirmação não corresponde/i)).toBeInTheDocument()
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('rejects reusing the current password client-side', async () => {
    renderPage()
    await fillAndSubmit(CURRENT, CURRENT, CURRENT)

    expect(await screen.findByText(/diferente da senha atual/i)).toBeInTheDocument()
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('shows the controlled message for a wrong current password', async () => {
    changePassword.mockRejectedValue({
      response: { status: 400, data: { message: 'Senha atual incorreta' } },
    })
    renderPage()
    await fillAndSubmit()

    expect(await screen.findByText(/senha atual incorreta/i)).toBeInTheDocument()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('does not render arbitrary backend exception text', async () => {
    changePassword.mockRejectedValue({
      response: { status: 500, data: { message: 'PrismaClientKnownRequestError: P2025' } },
    })
    renderPage()
    await fillAndSubmit()

    expect(await screen.findByText(/não foi possível processar/i)).toBeInTheDocument()
    expect(screen.queryByText(/PrismaClient/)).not.toBeInTheDocument()
  })

  it('exposes accessible show/hide controls for every field', () => {
    renderPage()
    expect(screen.getAllByLabelText('Mostrar senha')).toHaveLength(3)
    for (const toggle of screen.getAllByLabelText('Mostrar senha')) {
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
    }
  })
})
```

- [ ] **Step 2: Run it to make sure it fails, then implement the page**

```bash
npx vitest run src/tests/account/AccountSecurityPage.test.tsx
```

Create `frontend/src/features/account/pages/AccountSecurityPage.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import { changePasswordSchema, type ChangePasswordFormValues } from '@/schemas/password.schema'
import { authApi } from '@/lib/api/auth.api'
import { useAuthStore } from '@/stores/auth.store'
import { PasswordInput } from '@/features/auth/components/PasswordInput'
import { PasswordRequirements } from '@/features/auth/components/PasswordRequirements'
import { describeApiError } from '@/features/auth/lib/apiErrors'

export function AccountSecurityPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const [apiMessages, setApiMessages] = useState<string[]>([])

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', newPasswordConfirmation: '' },
  })

  const newPassword = form.watch('newPassword')
  const confirmation = form.watch('newPasswordConfirmation')

  const onSubmit = async (values: ChangePasswordFormValues) => {
    setApiMessages([])
    try {
      await authApi.changePassword(
        values.currentPassword,
        values.newPassword,
        values.newPasswordConfirmation,
      )

      // The backend has revoked every refresh token, this session included.
      // Cancel in-flight requests first so nothing can repopulate the cache,
      // then clear, then leave.
      await queryClient.cancelQueries()
      queryClient.clear()
      clearAuth()
      toast.success('Senha alterada. Entre novamente com a nova senha.')
      navigate('/login', { replace: true })
    } catch (error) {
      setApiMessages(describeApiError(error).messages)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Minha conta</h2>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Alterar senha</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Por segurança, todas as sessões serão encerradas e você precisará entrar novamente.
          </p>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                    <FormControl>
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
                      <PasswordInput autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <PasswordRequirements value={newPassword} confirmation={confirmation} />

              {apiMessages.length > 0 && (
                <div aria-live="polite" className="space-y-1">
                  {apiMessages.map((message) => (
                    <p key={message} className="text-sm font-medium text-destructive">
                      {message}
                    </p>
                  ))}
                </div>
              )}

              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Alterar senha
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
```

React Hook Form focuses the first invalid field on a failed submit by default (`shouldFocusError` defaults to `true`), which satisfies the focus requirement — do not disable it.

- [ ] **Step 3: Register the route**

In `frontend/src/app/routes.tsx`, add the lazy import and the route **inside** `ProtectedRoute`/`AppLayout` but outside the admin `RoleGuard`, since every role needs it:

```tsx
const AccountSecurityPage = lazy(() =>
  import('@/features/account/pages/AccountSecurityPage').then((m) => ({ default: m.AccountSecurityPage }))
)
```

```tsx
            <Route path="/account/security" element={<AccountSecurityPage />} />
```

- [ ] **Step 4: Run, lint, build, commit**

```bash
npx vitest run src/tests/account
npm run test && npm run lint && npm run build
```

```bash
cd /home/userterras/Documents/inventory-manager
git add frontend/src/features/account frontend/src/app/routes.tsx frontend/src/tests/account
git commit -m "$(cat <<'MSG'
feat(frontend): add authenticated password change under /account/security

Warns that all sessions end, then cancels in-flight queries, clears the
cache and the auth state, and redirects to login — in that order, so no
late response can revive the session.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Phase 5 — Documentation

### Task 20: Update the docs

**Files:**
- Modify: `README.md:718` and the Auth/RBAC, Environment Variables, Database, Testing and Security sections
- Modify: `README.pt-BR.md` (same sections)
- Modify: `backend/.env.example` (already done in Task 1 — verify)
- Modify: `docs/security-checklist-deploy.md`

- [ ] **Step 1: Correct the bcrypt claims**

`README.md:718` currently reads `| Authentication | JWT with refresh rotation, bcrypt password hashing |`. Replace with:

```markdown
| Authentication | JWT with refresh rotation, Argon2id password hashing with pepper |
```

`README.pt-BR.md:718` — the equivalent line:

```markdown
| Autenticação | JWT com refresh rotation, hash de senha com Argon2id e pepper |
```

- [ ] **Step 2: Rewrite the Authentication and RBAC section**

In both READMEs, under "Authentication and RBAC" / "Autenticação e RBAC", document:

```markdown
### Password hashing

New passwords are hashed with **Argon2id** (`memoryCost` 65536 KiB, `timeCost` 3,
`parallelism` 1, `hashLength` 32). Before hashing, the password is passed through
HMAC-SHA-256 keyed with a server-side **pepper**, using the versioned
domain-separation label `inventory-manager:password:v1`.

- The **salt** is generated by the `argon2` library, is random and distinct per
  password, and stays embedded in the returned PHC string. There is no separate
  salt column.
- The **pepper** comes exclusively from the `PASSWORD_PEPPER` environment
  variable. It is never stored in the database, never sent to the frontend, and
  never logged. The application refuses to start without it, and refuses to start
  in production if it is shorter than 32 characters or looks like a placeholder.
- **Existing bcrypt users keep working.** A bcrypt hash (prefix `$2a$`, `$2b$` or
  `$2y$`) is verified with bcrypt; immediately after a *successful* login the
  password is rehashed to Argon2id and the row is updated. No new flow ever
  produces a bcrypt hash.
- **Rotating the pepper or the derivation is not a drop-in change.** Bumping `v1`
  invalidates every stored hash. A rotation requires adding a
  `password_hash_version` column and a dual-verify window (try the new version,
  fall back to the old, rehash on success). Not implemented — do not change the
  label without it.

Generate a pepper with:

```bash
openssl rand -base64 48
```

### Account lifecycle

Administrators never set or see another user's password.

1. An admin creates a user with name, e-mail and role (`attendant` or
   `financial` only) at `POST /users`. The user is created active but **cannot log
   in yet**: it has no password and no verified e-mail.
2. The user receives an invitation e-mail with a single-use link valid for 24
   hours. Only a SHA-256 digest of the token is stored; the raw token exists only
   in the e-mail.
3. The user opens the link, which carries the token in the **URL fragment** (so it
   never reaches a server log or a `Referer`), and sets their own password.
   Activation stamps `email_verified_at` and `password_set_at` and does **not** log
   the user in.
4. Login requires `is_active`, a verified e-mail and a stored password. All
   failures return the same generic message.

Password recovery: `POST /auth/forgot-password` always returns the same generic
response, whether or not the account exists, and is rate limited by IP and per
normalized e-mail. Reset tokens are single-use and valid for 30 minutes.
`POST /auth/reset-password` and `POST /auth/change-password` both revoke every
refresh token for the user, so all sessions end and a fresh login is required.

### Password policy

Minimum 12 characters, maximum 128, counted on the raw string. Spaces and
Unicode are allowed and nothing is trimmed or truncated. Extremely common
passwords are blocked. No artificial mix of uppercase, lowercase, digit and
symbol is required, and long passphrases are encouraged. The backend is
authoritative; the frontend mirrors the rules for feedback only.

### Endpoints

| Method | Path | Auth |
|---|---|---|
| `GET` | `/users` | admin |
| `POST` | `/users` | admin |
| `GET` | `/users/:id` | admin |
| `PATCH` | `/users/:id` | admin |
| `PATCH` | `/users/:id/status` | admin |
| `POST` | `/users/:id/resend-invitation` | admin |
| `POST` | `/users/:id/revoke-invitation` | admin |
| `POST` | `/auth/activate-account` | public |
| `POST` | `/auth/forgot-password` | public |
| `POST` | `/auth/reset-password` | public |
| `POST` | `/auth/change-password` | authenticated |

The access token's `role` claim is informational only. `JwtStrategy` reloads the
user from the database on every request, so `RolesGuard` authorizes against the
current stored role and deactivation takes effect immediately.
```

- [ ] **Step 3: Update the environment-variable and development-credential sections**

In both READMEs, add to the backend env block:

```env
# Password hashing (required in every environment)
PASSWORD_PEPPER=          # openssl rand -base64 48

# Mail — "fake" logs instead of sending; production requires "smtp"
MAIL_DRIVER=fake
SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

# Development seed password (must satisfy the password policy)
SEED_ADMIN_PASSWORD=
```

Replace the "Development Credentials" block. The old shared `Admin@123456` is
blocked by the new policy:

```markdown
### Development Credentials

Seeded users are `admin@inventory.local`, `atendente@inventory.local` and
`financeiro@inventory.local`. Their password comes from `SEED_ADMIN_PASSWORD`,
which you generate locally and never commit:

```bash
export SEED_ADMIN_PASSWORD="$(openssl rand -base64 24)"
npx ts-node prisma/seed-demo.ts
```

The seed aborts with an explanation if `SEED_ADMIN_PASSWORD` is unset or fails
the password policy.
```

Also add to the "Applied Migrations" table a row for
`<timestamp>_user_invitations_and_password_tokens` describing: nullable password,
three lifecycle timestamps with a backfill for existing users, the
`user_action_tokens` table, and the `users_email_normalized_key` functional
unique index on `lower(btrim(email))` — noting that `prisma db pull` does not
round-trip that index and it must not be dropped.

- [ ] **Step 4: Update the security checklist**

In `docs/security-checklist-deploy.md`, section 2 ("Variáveis de ambiente obrigatórias [BLOQUEANTE]"), add:

```markdown
- [ ] `PASSWORD_PEPPER` definido, com pelo menos 32 caracteres, gerado com
      `openssl rand -base64 48`, guardado no gerenciador de segredos e **nunca**
      versionado. A aplicação recusa iniciar sem ele.
- [ ] `MAIL_DRIVER=smtp` e o conjunto SMTP completo (`SMTP_HOST`, `SMTP_PORT`,
      `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`) configurados.
      A aplicação recusa iniciar em produção com `MAIL_DRIVER=fake`.
- [ ] `FRONTEND_URL` aponta para o domínio público correto — ele compõe os links
      de convite e de redefinição enviados por e-mail.
- [ ] `SEED_ADMIN_PASSWORD` **não** definido em produção (é apenas para seeds de
      desenvolvimento).
```

Add a new section before the final checklist:

```markdown
## Ordem de deploy da migration [BLOQUEANTE]

1. Aplicar `prisma migrate deploy` **antes** de subir o backend novo.
2. **Se a migration falhar, parar o release.** O backend novo nunca deve iniciar
   contra o schema antigo: o gate de login rejeita `email_verified_at IS NULL` e,
   sem o backfill da migration, todas as contas existentes ficam trancadas.
3. A migration aborta sozinha se houver e-mails que colidam após normalização
   (`lower(btrim(email))`). Resolva os duplicados manualmente — não force.
4. Conferir após aplicar:

```sql
SELECT count(*) FROM users WHERE password IS NOT NULL AND email_verified_at IS NULL;
-- Deve retornar 0
```
```

In section 9 ("Refresh tokens"), add:

```markdown
- [ ] Redefinição e troca de senha revogam todos os refresh tokens do usuário.
- [ ] Desativação de usuário revoga os refresh tokens na mesma transação.
- [ ] Tokens de convite e recuperação são armazenados apenas como digest SHA-256,
      são de uso único e têm validade de 24h e 30min respectivamente.
- [ ] Rate limit de IP é em memória: **suficiente para instância única**, mas
      exige Redis (ou outro store compartilhado) antes de rodar múltiplas
      réplicas. O limite por usuário no forgot-password é derivado do banco e
      permanece efetivo entre réplicas.
```

- [ ] **Step 5: Verify no secret leaked into the docs**

```bash
cd /home/userterras/Documents/inventory-manager
grep -rn "PASSWORD_PEPPER=" README.md README.pt-BR.md backend/.env.example docs/ | grep -v "PASSWORD_PEPPER=$" | grep -v "openssl"
grep -rn "Admin@123456" README.md README.pt-BR.md docs/security-checklist-deploy.md
git diff --cached --stat
```

Expected: the first command prints nothing (no pepper ever has a value); the second prints nothing outside a blocklist example. Confirm `backend/.env` is **not** staged:

```bash
git status --porcelain backend/.env
```

Expected: no output, because `.env` is gitignored.

- [ ] **Step 6: Final full verification**

```bash
cd /home/userterras/Documents/inventory-manager/backend
source ~/.nvm/nvm.sh && nvm use 20.19.4
npm run test && npm run build

docker-compose -f ../docker-compose.dev.yml up -d postgres
npm run test:e2e

cd ../frontend
npm run test && npm run lint && npm run build
```

Record the actual counts. Do not claim success without the output in front of you.

- [ ] **Step 7: Commit**

```bash
cd /home/userterras/Documents/inventory-manager
git add README.md README.pt-BR.md docs/security-checklist-deploy.md backend/.env.example
git commit -m "$(cat <<'MSG'
docs: document Argon2id, invitations and password flows

Corrects the bcrypt claims, documents the pepper and the rotation strategy it
would require, the invitation and recovery lifecycle, the password policy, the
new endpoints and env vars, the blocking migration deploy order, and the
single-instance limitation of the in-memory IP rate limiter.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Verification Summary

Before reporting the work complete, all of the following must have been run with their output observed:

| Command | Expectation |
|---|---|
| `cd backend && npm run test` | All unit suites pass, including the 215 pre-existing tests |
| `cd backend && npm run build` | `nest build` succeeds |
| `cd backend && npm run test:e2e` | Both e2e suites pass against Postgres on 5440 |
| `cd frontend && npm run test` | All suites pass, including the 193 pre-existing tests |
| `cd frontend && npm run lint` | Exit 0 |
| `cd frontend && npm run build` | `tsc -b && vite build` succeeds |
| `SELECT count(*) FROM users WHERE password IS NOT NULL AND email_verified_at IS NULL` | `0` |
| `SELECT left(password,10) FROM users` | No row starts with `$2a$`, `$2b$` or `$2y$` after logging in as each seeded user |
| `grep -rn "bcrypt.hash" backend/src backend/prisma \| grep -v spec` | No output — no non-test code generates a bcrypt hash |
| `grep -rn "bcrypt" backend/src \| grep -v spec` | One hit only: `bcrypt.compare` in `hashing.service.ts` |

Do not open a PR or push. Report the results and wait for explicit authorization.
