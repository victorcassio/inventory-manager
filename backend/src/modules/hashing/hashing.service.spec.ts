import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as argon2 from 'argon2';
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
      // The installed argon2 native binding encodes PHC parameters
      // alphabetically (m, p, t), not in the m,t,p order of the PHC spec text.
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

  describe('rehashLegacy', () => {
    it('produces an argon2id PHC string', async () => {
      const hash = await service.rehashLegacy('uma senha bem comprida');
      expect(hash.startsWith('$argon2id$')).toBe(true);
      expect(hash).toContain('m=65536,p=1,t=3');
    });

    it('succeeds for a password that hash() rejects for policy violations', async () => {
      await expect(service.hash('Admin@123456')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.rehashLegacy('Admin@123456')).resolves.toMatch(/^\$argon2id\$/);
    });

    it('produces a hash that verify() accepts', async () => {
      const hash = await service.rehashLegacy('Admin@123456');
      await expect(service.verify(hash, 'Admin@123456')).resolves.toEqual({
        valid: true,
        needsRehash: false,
      });
    });

    it('propagates rather than swallows a failure when the pepper is absent', async () => {
      const module = await moduleWith(undefined);
      const unpeppered = module.get(HashingService);
      await expect(unpeppered.rehashLegacy('uma senha bem comprida')).rejects.toThrow(
        /PASSWORD_PEPPER/,
      );
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
      await expect(service.verify(hash, 'outra senha bem comprida')).resolves.toEqual({
        valid: false,
        needsRehash: false,
      });
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

    it('returns invalid instead of throwing on a stored Argon2id hash with a valid prefix but a corrupt/truncated body', async () => {
      // Valid $argon2id$ prefix and well-formed parameter segment, but a
      // hash/salt body too short to pass the native library's own
      // validation — this is what DB damage or truncation looks like on
      // the wire. Must come back as an ordinary invalid credential, not an
      // unhandled rejection.
      const corrupt = '$argon2id$v=19$m=65536,p=1,t=3$AAAA$BBBB';
      await expect(service.verify(corrupt, 'uma senha bem comprida')).resolves.toEqual({
        valid: false,
        needsRehash: false,
      });
    });

    it('accepts a password that predates the policy (verification is not gated by policy)', async () => {
      const legacy = await bcrypt.hash('short', 12);
      const result = await service.verify(legacy, 'short');
      expect(result.valid).toBe(true);
    });

    it('logs and returns invalid — without leaking the hash or password — when argon2.verify() fails operationally', async () => {
      // argon2.verify() resolves `false` for an ordinary mismatch rather
      // than throwing, so a genuine operational failure (allocation error,
      // native binding trouble, ...) is indistinguishable from a corrupt
      // stored hash from inside verify() — see the Argon2 branch's comment.
      // The required behaviour is: the caller still gets the safe answer,
      // but the failure must not be invisible to operations.
      const hash = await service.hash('uma senha bem comprida');
      const password = 'uma senha bem comprida';
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const verifySpy = jest
        .spyOn(argon2, 'verify')
        .mockRejectedValueOnce(new Error('ARGON2_MEMORY_ALLOCATION_ERROR'));

      try {
        await expect(service.verify(hash, password)).resolves.toEqual({
          valid: false,
          needsRehash: false,
        });

        expect(errorSpy).toHaveBeenCalled();
        const loggedText = errorSpy.mock.calls.map(call => String(call[0])).join('\n');
        expect(loggedText).not.toContain(password);
        expect(loggedText).not.toContain(hash);
      } finally {
        verifySpy.mockRestore();
        errorSpy.mockRestore();
      }
    });

    it('logs the real failure text even for a non-Error rejection, instead of falling back to "unknown error"', async () => {
      // instanceof Error is not a reliable signal for errors that cross a
      // realm/context boundary (observed with argon2's native binding
      // under Jest's sandboxed test environment — see "Fix round 3"). A
      // rejection with a bare string is the simplest reproduction: it was
      // never an Error to begin with, so this proves the extraction does
      // not depend on the prototype chain at all.
      const hash = await service.hash('uma senha bem comprida');
      const password = 'uma senha bem comprida';
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const verifySpy = jest
        .spyOn(argon2, 'verify')
        .mockRejectedValueOnce('ARGON2_MEMORY_ALLOCATION_ERROR');

      try {
        await expect(service.verify(hash, password)).resolves.toEqual({
          valid: false,
          needsRehash: false,
        });

        const loggedText = errorSpy.mock.calls.map(call => String(call[0])).join('\n');
        expect(loggedText).toContain('ARGON2_MEMORY_ALLOCATION_ERROR');
        expect(loggedText).not.toContain('unknown error');
        expect(loggedText).not.toContain(password);
        expect(loggedText).not.toContain(hash);
      } finally {
        verifySpy.mockRestore();
        errorSpy.mockRestore();
      }
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

    it('throws if called before onModuleInit() has run, rather than lazily initializing', async () => {
      const module = await moduleWith(TEST_PEPPER);
      const uninitialized = module.get(HashingService);
      await expect(uninitialized.verifyDummy('qualquer coisa')).rejects.toThrow(/onModuleInit/);
    });

    it('resolves false (not rejects) and logs when argon2.verify() fails operationally — symmetric with verify()', async () => {
      // Asymmetry here is an account-enumeration oracle: during a degraded
      // window (memory limit too low, broken native binding), an eligible
      // account routes through verify() -> {valid:false} -> 401, while an
      // ineligible account routes through verifyDummy(). If verifyDummy()
      // rethrew, that path would answer 500 instead — and a 500 vs. 401
      // would tell an attacker whether a live, activated account exists at
      // a given address. verifyDummy() must answer exactly like verify()
      // does: log it, then resolve false.
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const verifySpy = jest
        .spyOn(argon2, 'verify')
        .mockRejectedValueOnce(new Error('ARGON2_MEMORY_ALLOCATION_ERROR'));

      try {
        await expect(service.verifyDummy('qualquer coisa')).resolves.toBe(false);
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        verifySpy.mockRestore();
        errorSpy.mockRestore();
      }
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

    it('propagates rather than swallows a verify() failure when the pepper is absent', async () => {
      const hash = await service.hash('uma senha bem comprida');
      const module = await moduleWith(undefined);
      const unpeppered = module.get(HashingService);
      // A missing pepper is an operational failure, not a wrong password —
      // it must surface to the caller (as a 500), never come back as a
      // quiet { valid: false }.
      await expect(unpeppered.verify(hash, 'uma senha bem comprida')).rejects.toThrow(
        /PASSWORD_PEPPER/,
      );
    });

    it('propagates rather than swallows a verifyDummy() failure when the pepper is absent', async () => {
      const module = await moduleWith(undefined);
      const unpeppered = module.get(HashingService);
      // Simulate an already-initialized service (as it would be in a real
      // app — onModuleInit() runs once at boot) whose pepper then went
      // missing: dummyHash is present, but deriveMaterial() still has
      // nothing to HMAC with.
      (unpeppered as any).dummyHash = (service as any).dummyHash;
      await expect(unpeppered.verifyDummy('qualquer coisa')).rejects.toThrow(/PASSWORD_PEPPER/);
    });

    it('never includes the password or the pepper in a thrown configuration error', async () => {
      const password = 'uma senha usada apenas neste teste de vazamento';
      const module = await moduleWith(undefined);
      const unpeppered = module.get(HashingService);

      let caught: unknown;
      try {
        await unpeppered.hash(password);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      const message = (caught as Error).message;
      expect(message).not.toContain(password);
      expect(message).not.toContain(TEST_PEPPER);
    });
  });
});
