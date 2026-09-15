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
  });
});
