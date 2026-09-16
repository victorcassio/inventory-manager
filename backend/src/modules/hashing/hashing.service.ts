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

    if (this.isBcryptHash(storedHash)) {
      try {
        // Legacy hashes were produced from the RAW password, not the HMAC
        // material — they must be compared the same way they were created.
        const valid = await bcrypt.compare(password, storedHash);
        return { valid, needsRehash: valid };
      } catch {
        // A damaged/unparseable bcrypt hash is indistinguishable from a
        // wrong password. bcrypt.compare never touches the pepper, so there
        // is no configuration failure this catch could be hiding.
        return { valid: false, needsRehash: false };
      }
    }

    if (this.isArgon2Hash(storedHash)) {
      // Configuration failures must propagate. deriveMaterial() is called
      // OUTSIDE the try below, deliberately: that makes "a missing pepper
      // throws" a structural property of this method, not something that
      // depends on the catch below staying narrow. If someone later widens
      // that catch, a missing pepper still cannot become `{valid: false}`.
      const material = this.deriveMaterial(password);

      try {
        const valid = await argon2.verify(storedHash, material);
        return { valid, needsRehash: false };
      } catch {
        // Only malformed/unsupported stored Argon2 hashes are treated as
        // invalid here.
        //
        // This catch is intentionally broad rather than narrowed to a
        // specific error type. Investigated against the installed
        // argon2@0.45.1 + @phc/format@1.0.0: PHC-string parse failures
        // (missing "$", too many/unrecognized fields, bad id) throw
        // TypeError from @phc/format's deserialize() — always before any
        // native call. But a *recognized-shape*, corrupt-bodied digest (for
        // example a truncated or too-short encoded hash) can fail native
        // validation with a plain Error ("Output is too short") from the
        // same code path (Napi::Error via AsyncWorker::OnError) that a
        // genuine operational failure — e.g. ARGON2_MEMORY_ALLOCATION_ERROR
        // — would also use. Neither carries an error code or subclass that
        // distinguishes "corrupt stored hash" from "the box ran out of
        // memory computing this hash". So narrowing to TypeError alone
        // would let a corrupt-but-well-formed hash escape as a propagated
        // 500 instead of the invalid-credential result required here. See
        // the Task 2 report's "Fix round 2" section for the investigation.
        return { valid: false, needsRehash: false };
      }
    }

    // Unrecognized hash shape — indistinguishable from a wrong password.
    return { valid: false, needsRehash: false };
  }

  isBcryptHash(hash: string): boolean {
    return typeof hash === 'string' && BCRYPT_PREFIXES.some(p => hash.startsWith(p));
  }

  isArgon2Hash(hash: string): boolean {
    return typeof hash === 'string' && hash.startsWith(ARGON2_PREFIX);
  }

  /**
   * Best-effort timing mitigation. Verifies against the startup dummy hash so
   * that "no such user", "inactive", "unverified" and "no password" cost
   * roughly the same as a real verification. Always resolves to false.
   */
  async verifyDummy(password: string): Promise<false> {
    if (!this.dummyHash) {
      // Nest calls onModuleInit() before any request-handling code can run,
      // and the test suite drives it explicitly in beforeEach. There is no
      // legitimate way to reach this method uninitialized — fail loudly
      // instead of masking the bug with a lazy re-init.
      throw new Error(
        'HashingService.verifyDummy() called before onModuleInit() — no dummy hash available',
      );
    }

    // Configuration failures must propagate here too, for the same
    // structural reason as in verify(): deriveMaterial() is called OUTSIDE
    // the try below.
    const material = this.deriveMaterial(password);

    try {
      // A mismatch against the dummy hash resolves to `false` without
      // throwing — that is the expected, silent path this method exists
      // for. The dummy hash is generated once at startup from parameters we
      // control, so it is always well-formed: unlike verify()'s Argon2id
      // branch, there is no "corrupt stored hash" case to worry about here.
      // Anything that throws from this call can therefore only be a genuine
      // operational failure, and must not be swallowed — that would
      // silently collapse the timing equalization this method exists to
      // provide.
      await argon2.verify(this.dummyHash, material);
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
