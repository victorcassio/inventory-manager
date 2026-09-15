import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
const ARGON2_PREFIX = '$argon2';

export interface VerifyResult {
  valid: boolean;
  /** True only for legacy bcrypt hashes that should be upgraded to Argon2id. */
  needsRehash: boolean;
}

@Injectable()
export class HashingService implements OnModuleInit {
  private readonly logger = new Logger(HashingService.name);

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

    const isBcrypt = this.isBcryptHash(storedHash);

    // Validate the stored hash's *shape* before calling into either library.
    // A hash we don't recognize at all is indistinguishable from a wrong
    // password from the caller's point of view. Anything that escapes the
    // library calls below is therefore NOT a parse problem — it is a real
    // failure (allocation, missing native binding, missing pepper) and must
    // propagate rather than be reported as an ordinary invalid credential.
    if (!isBcrypt && !storedHash.startsWith(ARGON2_PREFIX)) {
      return { valid: false, needsRehash: false };
    }

    try {
      if (isBcrypt) {
        // Legacy hashes were produced from the RAW password, not the HMAC
        // material — they must be compared the same way they were created.
        const valid = await bcrypt.compare(password, storedHash);
        return { valid, needsRehash: valid };
      }

      const valid = await argon2.verify(storedHash, this.deriveMaterial(password));
      return { valid, needsRehash: false };
    } catch (error) {
      this.logFailure(error);
      throw error;
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
      // A mismatch against the dummy hash resolves to `false` without
      // throwing — that is the expected, silent path this method exists
      // for. Anything that DOES throw here (a derivation failure from a
      // missing pepper, an allocation error, ...) is a real failure and
      // must not be swallowed, or it would silently collapse the timing
      // equalization this method provides.
      await argon2.verify(this.dummyHash as string, this.deriveMaterial(password));
    } catch (error) {
      this.logFailure(error);
      throw error;
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

  /**
   * Logs an unexpected verification failure without ever including the
   * stored hash, the password, the pepper, or which hash family (bcrypt vs
   * Argon2id) was involved.
   */
  private logFailure(error: unknown): void {
    this.logger.error(
      `Password verification failed unexpectedly: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}
