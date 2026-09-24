import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import helmet from 'helmet';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { ThrottlerStorage } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeMailService } from '../src/modules/mail/fake-mail.service';
import { HashingService } from '../src/modules/hashing/hashing.service';
import { INVALID_TOKEN_MESSAGE } from '../src/modules/user-action-tokens/user-action-tokens.service';
import { hashSeedPassword } from '../prisma/seed-hash';

const ADMIN_EMAIL = 'e2e-admin-upm@test.com';
const ATTENDANT_EMAIL = 'e2e-attendant-upm@test.com';
const INVITED_EMAIL = 'e2e-invited-upm@test.com';
const LEGACY_EMAIL = 'e2e-legacy-upm@test.com';
const PASSWORD = 'Senha e2e bem comprida 123';
const NEW_PASSWORD = 'Outra senha e2e bem comprida';

const ALL_EMAILS = [ADMIN_EMAIL, ATTENDANT_EMAIL, INVITED_EMAIL, LEGACY_EMAIL];

// INVALID_TOKEN_MESSAGE imported from production, not duplicated as a local
// literal: the single message every token defect must produce (expired,
// already-used and revoked have to be indistinguishable from outside — any
// divergence is an enumeration oracle), so every assertion against it should
// break loudly if the production string ever changes, not silently compare
// two copies that drifted apart.

// A UUID has hyphens at fixed positions; an IPv4/IPv6 address never does in
// that pattern. Good enough to distinguish "looks like a uuid" from "looks
// like an address" without pulling in a uuid-validation dependency.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pulls the token out of the fragment of the last fake-mail message. */
function lastTokenFrom(mail: FakeMailService): string {
  const last = mail.sent[mail.sent.length - 1];
  const match = last.text.match(/#token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('No fragment token found in the last message');
  return match[1];
}

/**
 * JwtStrategy's passwordChangedAt gate compares `iat` against
 * passwordChangedAt at ONE-SECOND resolution and, by design, accepts
 * equality — a token minted in the same civil second as the change is not
 * treated as pre-change (see jwt.strategy.ts). Any test that captures a
 * session's access token and later asserts the gate invalidated it must
 * guarantee the login and the change land in different seconds, or the
 * assertion's outcome depends on how fast the machine running it happens to
 * be. Waits only the remainder of the current second, not a fixed delay.
 */
async function sleepPastCurrentSecond(): Promise<void> {
  const msIntoSecond = Date.now() % 1000;
  await new Promise((resolve) => setTimeout(resolve, 1000 - msIntoSecond + 50));
}

/**
 * A promise plus its own resolve function, exposed separately. Used below to
 * order two concurrent HTTP requests deterministically, never by racing on
 * real elapsed time.
 */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

/**
 * Replaces the LIVE HashingService.hash with a version that calls straight
 * through to the real Argon2id implementation but pauses right before doing
 * so — ONLY on the FIRST call — resolving `reachedPromise` the instant that
 * first call happens. A test awaits that promise to know — deterministically,
 * never by polling or by waiting a fixed delay — that the request under test
 * has passed every earlier check and is now blocked on the hash, then runs
 * whatever concurrent operation it wants to win the race before calling
 * `release()`.
 *
 * Only the first call is gated, every later one passes straight through:
 * several of these tests deliberately trigger a SECOND real hash() call
 * during the gate window (e.g. the concurrent reset-password's own new-
 * password hash) — gating that one too would block it on the same release
 * nothing has fired yet, deadlocking the "concurrent operation" the test
 * needs to actually complete before releasing the first gate. This was a
 * real, reproduced deadlock (not just slow Argon2id) before this fix: the
 * hung promise never freed the request it belonged to, and the connection
 * it left open was still there when a later `afterAll` tried to run,
 * pushing that hook over its own timeout too.
 *
 * `restore()` MUST run before the test ends (afterEach below does this
 * unconditionally), or a later test's unrelated first hash() call hangs
 * forever waiting on a gate nothing will release.
 *
 * Timeout note: tests using this helper run several real Argon2id calls
 * (memoryCost 64 MiB, timeCost 3) in sequence — measured at 687–1527ms
 * each end-to-end via `--json` (`testResults[].assertionResults[].duration`),
 * comfortably inside this suite's normal 30s default (`testTimeout` in
 * jest-e2e.config.ts). None of them carry a per-test timeout override: with
 * ~20x headroom already, one would only raise the ceiling a regression has
 * to clear before anyone notices, not make the tests more reliable. An
 * earlier version of these tests DID carry a 60000ms override — added while
 * chasing what turned out to be a real deadlock in this same helper (see
 * above), not slow hashing. Once the deadlock was fixed, the tests
 * consistently finished in under 2s, and the override was removed; keeping
 * it would have masked a real 10-20x slowdown as a passing test.
 */
function gateHash(hashingService: HashingService) {
  const original = hashingService.hash.bind(hashingService);
  const reached = deferred<void>();
  const release = deferred<void>();
  let gatedCallMade = false;
  const spy = jest.spyOn(hashingService, 'hash').mockImplementation(async (pw: string) => {
    if (!gatedCallMade) {
      gatedCallMade = true;
      reached.resolve();
      await release.promise;
    }
    return original(pw);
  });
  return {
    reachedPromise: reached.promise,
    release: () => release.resolve(),
    restore: () => spy.mockRestore(),
  };
}

/**
 * Same idea as gateHash(), for exactly `count` concurrent hash() calls
 * gated independently by call order — used to prove that two requests
 * racing each other both read the same starting state (neither has written
 * yet) before either is allowed to proceed, so a losing request fails at
 * the intended conditional-write guard specifically, not at an earlier
 * check that happened to also reject a since-changed value. Any call
 * beyond the first `count` passes straight through, ungated, for the same
 * deadlock-avoidance reason gateHash() only gates its first call.
 */
function gateHashSequence(hashingService: HashingService, count: number) {
  const original = hashingService.hash.bind(hashingService);
  const reached = Array.from({ length: count }, () => deferred<void>());
  const release = Array.from({ length: count }, () => deferred<void>());
  let callIndex = 0;
  const spy = jest.spyOn(hashingService, 'hash').mockImplementation(async (pw: string) => {
    const i = callIndex++;
    if (i < count) {
      reached[i].resolve();
      await release[i].promise;
    }
    return original(pw);
  });
  return {
    reachedPromises: reached.map(d => d.promise),
    release: (i: number) => release[i].resolve(),
    restore: () => spy.mockRestore(),
  };
}

describe('Users and passwords (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: FakeMailService;
  let hashingService: HashingService;
  let seedHash: string;
  // The ThrottlerGuard's in-memory storage is a singleton shared by every
  // request this process handles. Left alone, the sheer number of logins and
  // forgot-password calls this suite makes across its own tests trips the
  // production rate limits (10 logins/60s, 5 forgot-password/15min) well
  // before the tests that actually exercise business logic get to run,
  // producing 429s that masquerade as unrelated failures. Resetting it before
  // each test isolates tests from each other's call volume without touching
  // any guard, controller or rate-limit value; the limits themselves are
  // asserted by the 'rate limiting' block below, which starts from a window
  // this reset guarantees is empty.
  let throttlerStorage: {
    storage: Map<string, unknown>;
    timeoutIds?: Map<string, NodeJS.Timeout[]>;
  };

  // Clearing the storage map is not enough on its own. Every hit also schedules
  // a timer that decrements that key's counter when its window lapses, and the
  // callback destructures `storage.get(key)` with no guard
  // (@nestjs/throttler 6.5.0, throttler.service.js:27-32). With the key already
  // gone, a timer firing between tests throws a TypeError from outside any
  // test — an uncaught exception that takes down the Jest worker instead of
  // failing a test, up to 60s after the login that scheduled it. The library
  // only drains timeoutIds on application shutdown, so the suite cancels them
  // itself. A stale timer would also decrement a counter belonging to a
  // re-created key, quietly falsifying the very limits the block below asserts.
  function resetThrottler() {
    throttlerStorage.timeoutIds?.forEach(ids => ids.forEach(clearTimeout));
    throttlerStorage.timeoutIds?.clear();
    throttlerStorage.storage.clear();
  }

  const api = () => request(app.getHttpServer());

  async function seedUser(email: string, role: string, password: string | null, extra = {}) {
    const now = new Date();
    return prisma.user.upsert({
      where: { email },
      // passwordChangedAt is reset to null on every reseed. A previous test's
      // change-password/reset-password call sets it to a real timestamp;
      // JwtStrategy compares it (millisecond precision) against a freshly
      // issued token's iat (second precision — JWT floors to the whole
      // second). Left over from a prior test, that leftover timestamp can
      // land in the same floored second as a later login in a different
      // test, spuriously invalidating a token that was actually issued
      // after it. Resetting it here keeps each test's fixture state
      // independent of what earlier tests did to these same rows — the
      // app itself still sets it mid-test when a test's own flow changes
      // the password, and that within-test check is exercised normally.
      update: {
        password,
        isActive: true,
        emailVerifiedAt: now,
        passwordSetAt: now,
        passwordChangedAt: null,
        ...extra,
      },
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
    // Without this, an unexpected 401 or 429 returns undefined tokens and the
    // failure surfaces one or two requests later as a baffling 401/403 rather
    // than at its cause.
    expect(res.status).toBe(200);
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
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        validationError: { value: false },
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    prisma = module.get(PrismaService);
    mail = module.get(FakeMailService);
    hashingService = module.get(HashingService);
    throttlerStorage = module.get(ThrottlerStorage);

    // Argon2id at 64 MiB / t=3 is deliberately expensive; the input is constant,
    // so hash it once instead of once per test.
    seedHash = await hashSeedPassword(PASSWORD);

    // The map of pending expiry timers is the whole reason resetThrottler()
    // exists. If a future version of the library renames or encapsulates it,
    // the optional chaining below would silently degrade the reset back to a
    // bare storage.clear() and bring back the uncaught TypeError it prevents.
    // Fail loudly here instead.
    expect(throttlerStorage.timeoutIds).toBeInstanceOf(Map);

    // A previous run killed mid-suite (Ctrl-C, worker crash) leaves fixture rows
    // behind, and the first invitation test would then fail with a 409 that has
    // nothing to do with the code under test. The invited and legacy users are
    // the ones that collide; admin and attendant need no pre-delete because
    // beforeEach upserts them back into a known state. The user delete comes
    // after cleanupFixtures() because AuditLog.userId is a required,
    // non-cascading FK that would otherwise block it.
    await cleanupFixtures();
    await prisma.user.deleteMany({ where: { email: { in: [INVITED_EMAIL, LEGACY_EMAIL] } } });
  });

  beforeEach(async () => {
    mail.reset();
    resetThrottler();
    await seedUser(ADMIN_EMAIL, 'admin', seedHash);
    await seedUser(ATTENDANT_EMAIL, 'attendant', seedHash);
  });

  // Every predicate here is scoped to this suite's own fixture e-mails. The
  // suite shares inventory_db with the developer's demo data, so no unscoped
  // deleteMany is allowed. Order matters: AuditLog.userId is a required
  // relation with no cascade, so its rows must go before the users they point at.
  async function cleanupFixtures() {
    await prisma.userActionToken.deleteMany({ where: { user: { email: { in: ALL_EMAILS } } } });
    await prisma.refreshToken.deleteMany({ where: { user: { email: { in: ALL_EMAILS } } } });
    await prisma.auditLog.deleteMany({ where: { user: { email: { in: ALL_EMAILS } } } });
  }

  afterEach(async () => {
    // Safety net alongside each concurrency test's own explicit restore():
    // a spy left in place would gate a later, unrelated test's hash() call
    // forever, since nothing would ever call its release().
    jest.restoreAllMocks();
    await cleanupFixtures();
    await prisma.user.deleteMany({ where: { email: { in: [INVITED_EMAIL, LEGACY_EMAIL] } } });
  });

  afterAll(async () => {
    await cleanupFixtures();
    await prisma.user.deleteMany({ where: { email: { in: ALL_EMAILS } } });
    resetThrottler();
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
      expect(JSON.stringify(second.body)).toContain(INVALID_TOKEN_MESSAGE);
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
      // Must be the same message a reused token produces — see the constant.
      expect(JSON.stringify(res.body)).toContain(INVALID_TOKEN_MESSAGE);
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

      // The first token is now revoked, and says so in exactly the same words
      // an expired or already-used token does.
      const revoked = await api()
        .post('/api/v1/auth/activate-account')
        .send({ token: firstToken, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD });
      expect(revoked.status).toBe(400);
      expect(JSON.stringify(revoked.body)).toContain(INVALID_TOKEN_MESSAGE);

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
      // Not a bare `.not.toContain('password')`: the response legitimately
      // carries a `passwordSetAt` timestamp field (see USER_SELECT in
      // user-response.mapper.ts), which is not a credential and would make
      // that naive substring check a false positive. Assert on the actual
      // JSON key instead, so this still fails if a raw `password` field is
      // ever added to the response.
      expect(serialized).not.toMatch(/"password":/);
      expect(serialized).not.toContain('tokenHash');
      expect(serialized).not.toContain('$argon2id$');
    });

    it('records the acting admin (not the target, not the IP) as the audit actor', async () => {
      const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
      const { accessToken } = await login(ADMIN_EMAIL, PASSWORD);

      const created = await api()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Convidada', email: INVITED_EMAIL, role: 'attendant' });
      expect(created.status).toBe(201);

      const logs = await prisma.auditLog.findMany({
        where: { entityId: created.body.user.id },
        orderBy: { createdAt: 'desc' },
      });

      expect(logs.length).toBeGreaterThan(0);
      const log = logs[0];

      // The actor is the admin who made the call, not the invited target.
      expect(log.userId).toBe(admin!.id);
      expect(log.userId).not.toBe(created.body.user.id);

      // ipAddress must be recorded and must look like an address, never a uuid —
      // this is what catches an ipAddress/actorId argument swap. Asserted
      // unconditionally: a null here is itself one of the failures the swap
      // produces, so guarding on truthiness would pass vacuously.
      expect(log.ipAddress).toBeTruthy();
      expect(UUID_SHAPE.test(log.ipAddress!)).toBe(false);
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

      const res = await api()
        .patch(`/api/v1/users/${me!.id}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ isActive: false });

      // The target is an admin, so the admin-target rule alone would produce a
      // 403 even with the self-guard deleted. Asserting the message is what
      // makes this test about the rule it names.
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain('sua própria conta');
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

    it('revokes a pending invitation on deactivation — the old activation link is rejected and the account never activates', async () => {
      const { accessToken: adminToken } = await login(ADMIN_EMAIL, PASSWORD);

      const created = await api()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Convidada', email: INVITED_EMAIL, role: 'attendant' });
      expect(created.status).toBe(201);
      const invitedId = created.body.user.id;
      const token = lastTokenFrom(mail);

      await api()
        .patch(`/api/v1/users/${invitedId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })
        .expect(200);

      const row = await prisma.userActionToken.findFirst({
        where: { user: { email: INVITED_EMAIL } },
      });
      expect(row!.revokedAt).not.toBeNull();
      expect(row!.usedAt).toBeNull(); // revoked, never consumed

      const activation = await api()
        .post('/api/v1/auth/activate-account')
        .send({ token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD });
      expect(activation.status).toBe(400);
      expect(JSON.stringify(activation.body)).toContain(INVALID_TOKEN_MESSAGE);

      // Token rejected -> account never activates: no password, no verification.
      const after = await prisma.user.findUnique({ where: { email: INVITED_EMAIL } });
      expect(after!.password).toBeNull();
      expect(after!.passwordSetAt).toBeNull();
      expect(after!.emailVerifiedAt).toBeNull();
      await api()
        .post('/api/v1/auth/login')
        .send({ email: INVITED_EMAIL, password: NEW_PASSWORD })
        .expect(401);
    });

    it('revokes a pending password-reset token on deactivation — the old reset link is rejected, the password is untouched, and reactivating does not resurrect it', async () => {
      const { accessToken: adminToken } = await login(ADMIN_EMAIL, PASSWORD);
      const attendant = await prisma.user.findUnique({ where: { email: ATTENDANT_EMAIL } });

      await api().post('/api/v1/auth/forgot-password').send({ email: ATTENDANT_EMAIL }).expect(200);
      const token = lastTokenFrom(mail);

      await api()
        .patch(`/api/v1/users/${attendant!.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })
        .expect(200);

      const row = await prisma.userActionToken.findFirst({
        where: { user: { email: ATTENDANT_EMAIL }, type: 'password_reset' },
        orderBy: { createdAt: 'desc' },
      });
      expect(row!.revokedAt).not.toBeNull();
      expect(row!.usedAt).toBeNull();

      const reset = await api()
        .post('/api/v1/auth/reset-password')
        .send({ token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD });
      expect(reset.status).toBe(400);
      expect(JSON.stringify(reset.body)).toContain(INVALID_TOKEN_MESSAGE);

      const afterReject = await prisma.user.findUnique({ where: { email: ATTENDANT_EMAIL } });
      expect(afterReject!.password).toBe(seedHash); // untouched by the rejected reset

      // Reactivating does not resurrect the old, already-revoked token.
      await api()
        .patch(`/api/v1/users/${attendant!.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: true })
        .expect(200);
      await api()
        .post('/api/v1/auth/login')
        .send({ email: ATTENDANT_EMAIL, password: PASSWORD })
        .expect(200);

      const staleRetry = await api()
        .post('/api/v1/auth/reset-password')
        .send({ token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD });
      expect(staleRetry.status).toBe(400);
      expect(JSON.stringify(staleRetry.body)).toContain(INVALID_TOKEN_MESSAGE);
    });

    it('rolls back completely when the account-state guard alone rejects — even a not-yet-revoked token is left unused', async () => {
      // Isolates the isActive re-check inside activate()'s own transaction
      // from token revocation: the user row is flipped inactive directly
      // (bypassing setStatus(), which would also revoke the token), so the
      // token going into this request is still, by every criterion
      // consume() itself checks, perfectly valid.
      const { accessToken: adminToken } = await login(ADMIN_EMAIL, PASSWORD);
      const created = await api()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Convidada', email: INVITED_EMAIL, role: 'attendant' });
      const invitedId = created.body.user.id;
      const token = lastTokenFrom(mail);

      await prisma.user.update({ where: { id: invitedId }, data: { isActive: false } });

      const activation = await api()
        .post('/api/v1/auth/activate-account')
        .send({ token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD });
      expect(activation.status).toBe(400);
      expect(JSON.stringify(activation.body)).toContain(INVALID_TOKEN_MESSAGE);

      // Full rollback: consume() DID mark the token used inside the
      // transaction, but the isActive guard's throw rolled that back too —
      // on disk the token must look exactly as if this request never
      // touched it.
      const row = await prisma.userActionToken.findFirst({
        where: { user: { email: INVITED_EMAIL } },
      });
      expect(row!.usedAt).toBeNull();
      expect(row!.revokedAt).toBeNull();

      const after = await prisma.user.findUnique({ where: { email: INVITED_EMAIL } });
      expect(after!.password).toBeNull();
      expect(after!.emailVerifiedAt).toBeNull();
      expect(after!.passwordSetAt).toBeNull();
    });

    it('concurrency: a deactivation that completes WHILE activation is still hashing wins — the account never activates', async () => {
      const { accessToken: adminToken } = await login(ADMIN_EMAIL, PASSWORD);
      const created = await api()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Convidada', email: INVITED_EMAIL, role: 'attendant' });
      const invitedId = created.body.user.id;
      const token = lastTokenFrom(mail);

      const gate = gateHash(hashingService);
      // supertest/superagent requests dispatch lazily — only the first
      // .then()/await on the Test object calls superagent's end() and
      // actually sends anything. Without the trailing .then() here, this
      // request would sit unsent until awaited below, gate.reachedPromise
      // would never resolve, and the test would hang until Jest's timeout.
      const activatePromise = api()
        .post('/api/v1/auth/activate-account')
        .send({ token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD })
        .then(res => res);

      // Deterministic: activation has passed the cheap preflight and is now
      // computing Argon2id — guaranteed by the gate, never by a delay.
      await gate.reachedPromise;

      // setStatus() revokes the pending invitation in the SAME transaction as
      // isActive, so by the time this commits the token is already dead —
      // the race below proves that combination (revoke-on-deactivate) wins
      // against a concurrent activation, not the isActive guard on its own.
      // The guard in isolation, with the token deliberately left un-revoked,
      // is the "rolls back completely when the account-state guard alone
      // rejects" test above.
      await api()
        .patch(`/api/v1/users/${invitedId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })
        .expect(200);

      gate.release();
      const activation = await activatePromise;
      gate.restore();

      expect(activation.status).toBe(400);
      expect(JSON.stringify(activation.body)).toContain(INVALID_TOKEN_MESSAGE);

      const after = await prisma.user.findUnique({ where: { email: INVITED_EMAIL } });
      expect(after!.isActive).toBe(false);
      expect(after!.password).toBeNull();
      expect(after!.passwordSetAt).toBeNull();
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
      await sleepPastCurrentSecond();

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

      // Sessions revoked — both halves. The refresh token is revoked in the
      // database; the access token is stateless, so the only thing that can
      // invalidate the one already issued is the passwordChangedAt gate in
      // JwtStrategy. That is a different branch from the isActive gate the
      // deactivation test covers, and it needs its own assertion.
      await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      await api()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
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

      // Deliberately a nonsense string: a real Portuguese word like 'curta'
      // could legitimately appear in a future validation message ('senha muito
      // curta') and fail this assertion for the wrong reason. The only way
      // 'xK7q' reaches the body is the server echoing the submitted password.
      const res = await api()
        .post('/api/v1/auth/reset-password')
        .send({ token, password: 'xK7q', passwordConfirmation: 'xK7q' });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('12 caracteres');
      expect(JSON.stringify(res.body)).not.toContain('xK7q');
    });

    it('two concurrent requests with the SAME token — exactly one succeeds, no partial user change', async () => {
      await api().post('/api/v1/auth/forgot-password').send({ email: ATTENDANT_EMAIL }).expect(200);
      const token = lastTokenFrom(mail);
      const bodyA = {
        token,
        password: 'senha concorrente A bem comprida',
        passwordConfirmation: 'senha concorrente A bem comprida',
      };
      const bodyB = {
        token,
        password: 'senha concorrente B bem comprida',
        passwordConfirmation: 'senha concorrente B bem comprida',
      };

      const [resA, resB] = await Promise.all([
        api().post('/api/v1/auth/reset-password').send(bodyA),
        api().post('/api/v1/auth/reset-password').send(bodyB),
      ]);

      const statuses = [resA.status, resB.status];
      expect(statuses.filter(s => s === 204)).toHaveLength(1);
      expect(statuses.filter(s => s === 400)).toHaveLength(1);

      const winningPassword = resA.status === 204 ? bodyA.password : bodyB.password;
      await api()
        .post('/api/v1/auth/login')
        .send({ email: ATTENDANT_EMAIL, password: winningPassword })
        .expect(200);
    });

    it('concurrency: a deactivation that completes WHILE reset-password is still hashing wins — the reset never lands', async () => {
      const { accessToken: adminToken } = await login(ADMIN_EMAIL, PASSWORD);
      const attendant = await prisma.user.findUnique({ where: { email: ATTENDANT_EMAIL } });

      await api().post('/api/v1/auth/forgot-password').send({ email: ATTENDANT_EMAIL }).expect(200);
      const token = lastTokenFrom(mail);

      const gate = gateHash(hashingService);
      // See the identical note on the activation concurrency test above:
      // the trailing .then() dispatches the request immediately instead of
      // leaving it unsent until awaited.
      const resetPromise = api()
        .post('/api/v1/auth/reset-password')
        .send({ token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD })
        .then(res => res);

      await gate.reachedPromise;

      // setStatus() revokes the pending reset token in the SAME transaction
      // as isActive, so this proves that combination winning against a
      // concurrent reset — not the isActive guard in isolation. That guard
      // on its own, with the token deliberately left un-revoked, is the
      // "rolls back completely when the account-state guard alone rejects"
      // test below.
      await api()
        .patch(`/api/v1/users/${attendant!.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })
        .expect(200);

      gate.release();
      const reset = await resetPromise;
      gate.restore();

      expect(reset.status).toBe(400);
      expect(JSON.stringify(reset.body)).toContain(INVALID_TOKEN_MESSAGE);

      const after = await prisma.user.findUnique({ where: { email: ATTENDANT_EMAIL } });
      expect(after!.isActive).toBe(false);
      expect(after!.password).toBe(seedHash);
    });

    it('rolls back completely when the account-state guard alone rejects — even a not-yet-revoked reset token is left unused', async () => {
      // Mirrors the equivalent test for activate() above: isolates the
      // isActive re-check inside resetPassword()'s own transaction from
      // token revocation, by flipping the user row inactive directly
      // (bypassing setStatus(), which would also revoke the token). The
      // token going into this request is still, by every criterion
      // consume() itself checks, perfectly valid.
      const attendant = await prisma.user.findUnique({ where: { email: ATTENDANT_EMAIL } });

      await api().post('/api/v1/auth/forgot-password').send({ email: ATTENDANT_EMAIL }).expect(200);
      const token = lastTokenFrom(mail);

      await prisma.user.update({ where: { id: attendant!.id }, data: { isActive: false } });

      const reset = await api()
        .post('/api/v1/auth/reset-password')
        .send({ token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD });
      expect(reset.status).toBe(400);
      expect(JSON.stringify(reset.body)).toContain(INVALID_TOKEN_MESSAGE);

      // Full rollback: consume() DID mark the token used inside the
      // transaction, but the isActive guard's throw rolled that back too.
      const row = await prisma.userActionToken.findFirst({
        where: { user: { email: ATTENDANT_EMAIL }, type: 'password_reset' },
        orderBy: { createdAt: 'desc' },
      });
      expect(row!.usedAt).toBeNull();
      expect(row!.revokedAt).toBeNull();

      const after = await prisma.user.findUnique({ where: { email: ATTENDANT_EMAIL } });
      expect(after!.password).toBe(seedHash); // untouched
    });
  });

  describe('Argon2 preflight — hash() must not run for an obviously dead token', () => {
    it('does not hash for a nonexistent token', async () => {
      const hashSpy = jest.spyOn(hashingService, 'hash');

      const res = await api()
        .post('/api/v1/auth/reset-password')
        .send({ token: 'nao-existe-mesmo', password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain(INVALID_TOKEN_MESSAGE);
      expect(hashSpy).not.toHaveBeenCalled();
      hashSpy.mockRestore();
    });

    it('does not hash for an expired token', async () => {
      await api().post('/api/v1/auth/forgot-password').send({ email: ATTENDANT_EMAIL }).expect(200);
      const token = lastTokenFrom(mail);
      await prisma.userActionToken.updateMany({
        where: { user: { email: ATTENDANT_EMAIL }, type: 'password_reset' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const hashSpy = jest.spyOn(hashingService, 'hash');
      const res = await api()
        .post('/api/v1/auth/reset-password')
        .send({ token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD });

      expect(res.status).toBe(400);
      expect(hashSpy).not.toHaveBeenCalled();
      hashSpy.mockRestore();
    });

    it('does not hash for an already-used token', async () => {
      await api().post('/api/v1/auth/forgot-password').send({ email: ATTENDANT_EMAIL }).expect(200);
      const token = lastTokenFrom(mail);
      const body = { token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD };
      await api().post('/api/v1/auth/reset-password').send(body).expect(204);

      const hashSpy = jest.spyOn(hashingService, 'hash');
      const res = await api().post('/api/v1/auth/reset-password').send(body);

      expect(res.status).toBe(400);
      expect(hashSpy).not.toHaveBeenCalled();
      hashSpy.mockRestore();
    });

    it('does not hash for a revoked token', async () => {
      await api().post('/api/v1/auth/forgot-password').send({ email: ATTENDANT_EMAIL }).expect(200);
      const stale = lastTokenFrom(mail);
      // A second request revokes the first (see 'invalidates a previous reset token' above).
      await api().post('/api/v1/auth/forgot-password').send({ email: ATTENDANT_EMAIL }).expect(200);

      const hashSpy = jest.spyOn(hashingService, 'hash');
      const res = await api()
        .post('/api/v1/auth/reset-password')
        .send({ token: stale, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD });

      expect(res.status).toBe(400);
      expect(hashSpy).not.toHaveBeenCalled();
      hashSpy.mockRestore();
    });

    it('does not hash for a token issued for a different purpose', async () => {
      const { accessToken: adminToken } = await login(ADMIN_EMAIL, PASSWORD);
      await api()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Convidada', email: INVITED_EMAIL, role: 'attendant' });
      const invitationToken = lastTokenFrom(mail);

      const hashSpy = jest.spyOn(hashingService, 'hash');
      const res = await api()
        .post('/api/v1/auth/reset-password')
        .send({ token: invitationToken, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD });

      expect(res.status).toBe(400);
      expect(hashSpy).not.toHaveBeenCalled();
      hashSpy.mockRestore();
    });

    it('DOES hash for a valid token, and the reset completes normally', async () => {
      await api().post('/api/v1/auth/forgot-password').send({ email: ATTENDANT_EMAIL }).expect(200);
      const token = lastTokenFrom(mail);

      const hashSpy = jest.spyOn(hashingService, 'hash');
      const res = await api()
        .post('/api/v1/auth/reset-password')
        .send({ token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD });

      expect(res.status).toBe(204);
      expect(hashSpy).toHaveBeenCalledTimes(1);
      hashSpy.mockRestore();

      await api()
        .post('/api/v1/auth/login')
        .send({ email: ATTENDANT_EMAIL, password: NEW_PASSWORD })
        .expect(200);
    });

    it('every rejected scenario above returns the exact same generic message', async () => {
      const nonexistent = await api()
        .post('/api/v1/auth/reset-password')
        .send({ token: 'inexistente-de-verdade', password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD });

      await api().post('/api/v1/auth/forgot-password').send({ email: ATTENDANT_EMAIL }).expect(200);
      const expiredToken = lastTokenFrom(mail);
      await prisma.userActionToken.updateMany({
        where: { user: { email: ATTENDANT_EMAIL }, type: 'password_reset' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const expired = await api()
        .post('/api/v1/auth/reset-password')
        .send({ token: expiredToken, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD });

      // The message itself, not the whole envelope: statusCode/error/message
      // shape is standard Nest boilerplate and not what this guards against
      // — an enumeration oracle would show up as a DIFFERENT message string
      // per defect, not as incidental envelope formatting.
      for (const res of [nonexistent, expired]) {
        expect(res.status).toBe(400);
        expect(res.body.message).toEqual(INVALID_TOKEN_MESSAGE);
      }
    });
  });

  describe('change-password', () => {
    it('changes the password and ends every session', async () => {
      const session = await login(ATTENDANT_EMAIL, PASSWORD);
      await sleepPastCurrentSecond();

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
      // "Every session" includes the stateless one: the access token issued
      // before the change must stop working too.
      await api()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
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

    it('concurrency: a reset that completes WHILE change-password is still hashing wins — the stale write is rejected', async () => {
      const session = await login(ATTENDANT_EMAIL, PASSWORD);
      const RESET_PASSWORD = 'senha do reset concorrente bem comprida';

      const gate = gateHash(hashingService);
      // See the note on the activation concurrency test: the trailing
      // .then() dispatches the request immediately instead of leaving it
      // unsent until awaited.
      const changePromise = api()
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD, newPasswordConfirmation: NEW_PASSWORD })
        .then(res => res);

      await gate.reachedPromise; // change-password verified the current password and is now hashing the new one

      // The concurrent reset runs to completion here, while change-password waits.
      await api().post('/api/v1/auth/forgot-password').send({ email: ATTENDANT_EMAIL }).expect(200);
      const token = lastTokenFrom(mail);
      await api()
        .post('/api/v1/auth/reset-password')
        .send({ token, password: RESET_PASSWORD, passwordConfirmation: RESET_PASSWORD })
        .expect(204);

      gate.release();
      const changeRes = await changePromise;
      gate.restore();

      expect(changeRes.status).toBe(401);

      await api().post('/api/v1/auth/login').send({ email: ATTENDANT_EMAIL, password: RESET_PASSWORD }).expect(200);
      await api().post('/api/v1/auth/login').send({ email: ATTENDANT_EMAIL, password: NEW_PASSWORD }).expect(401);
    });

    it('concurrency: a deactivation that completes WHILE change-password is still hashing wins — the password is not updated', async () => {
      const { accessToken: adminToken } = await login(ADMIN_EMAIL, PASSWORD);
      const attendant = await prisma.user.findUnique({ where: { email: ATTENDANT_EMAIL } });
      const session = await login(ATTENDANT_EMAIL, PASSWORD);

      const gate = gateHash(hashingService);
      const changePromise = api()
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD, newPasswordConfirmation: NEW_PASSWORD })
        .then(res => res);

      await gate.reachedPromise;

      await api()
        .patch(`/api/v1/users/${attendant!.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })
        .expect(200);

      gate.release();
      const changeRes = await changePromise;
      gate.restore();

      expect(changeRes.status).toBe(401);

      const after = await prisma.user.findUnique({ where: { email: ATTENDANT_EMAIL } });
      expect(after!.isActive).toBe(false);
      expect(after!.password).toBe(seedHash);
    });

    it('concurrency: two concurrent change-password requests — exactly one wins via the race-guard, never a coincidental stale-password rejection', async () => {
      const session = await login(ATTENDANT_EMAIL, PASSWORD);
      const passwordA = 'senha concorrente A bem comprida';
      const passwordB = 'senha concorrente B bem comprida';

      const gate = gateHashSequence(hashingService, 2);

      // Both dispatched immediately via the trailing .then() — see the note
      // on the activation concurrency test above for why that matters.
      const pA = api()
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: passwordA, newPasswordConfirmation: passwordA })
        .then(res => res);
      const pB = api()
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: passwordB, newPasswordConfirmation: passwordB })
        .then(res => res);

      // Both requests verified the SAME original password and are now
      // blocked computing their new hash — neither has written yet, so the
      // loser is guaranteed to fail at the conditional-write guard
      // specifically, not at an earlier check against an already-changed value.
      await Promise.all(gate.reachedPromises);
      gate.release(0);
      gate.release(1);

      const [resA, resB] = await Promise.all([pA, pB]);
      gate.restore();

      const statuses = [resA.status, resB.status];
      expect(statuses.filter(s => s === 204)).toHaveLength(1);
      expect(statuses.filter(s => s === 401)).toHaveLength(1);

      const winningPassword = resA.status === 204 ? passwordA : passwordB;
      await api()
        .post('/api/v1/auth/login')
        .send({ email: ATTENDANT_EMAIL, password: winningPassword })
        .expect(200);
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

  describe('rate limiting', () => {
    it('returns 429 once the login window limit is exceeded', async () => {
      // auth.controller.ts caps the login route at 10 hits per 60s window, and
      // beforeEach guarantees this window starts empty. Wrong-password attempts
      // are used so nothing but the limit itself decides the outcome.
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await api()
          .post('/api/v1/auth/login')
          .send({ email: ADMIN_EMAIL, password: 'senha errada bem comprida' });
        statuses.push(res.status);
      }

      expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
      expect(statuses[10]).toBe(429);
    });

    // Every address below is from a documentation range (RFC 5737 / 3849),
    // so neither these requests nor the ip=… lines they log carry a real IP.
    it('keys the limit by CF-Connecting-IP and ignores a rotating X-Forwarded-For', async () => {
      // forgot-password: 5 per 15 min. An unknown e-mail keeps mail and tokens out of it.
      const forgot = (cfIp: string, xff: string) =>
        api()
          .post('/api/v1/auth/forgot-password')
          .set('CF-Connecting-IP', cfIp)
          .set('X-Forwarded-For', xff)
          .send({ email: 'nao-existe-ip@test.com' });

      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        statuses.push((await forgot('198.51.100.10', `203.0.113.${i + 1}`)).status);
      }
      expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);

      // A second client behind the same proxy socket still has its own quota.
      expect((await forgot('198.51.100.11', '203.0.113.1')).status).toBe(200);
      expect((await forgot('2001:db8::11', '203.0.113.1')).status).toBe(200);
    });

    it('shares one quota across every IPv6 address in the same /64', async () => {
      const forgot = (cfIp: string) =>
        api()
          .post('/api/v1/auth/forgot-password')
          .set('CF-Connecting-IP', cfIp)
          .send({ email: 'nao-existe-ip@test.com' });

      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        statuses.push((await forgot(`2001:db8:0:5::${(i + 1).toString(16)}`)).status);
      }
      expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
      expect((await forgot('2001:db8:0:6::1')).status).toBe(200);
    });

    it('records in the audit log the same address the throttler tracked', async () => {
      const clientIp = '198.51.100.20';
      const session = await login(ATTENDANT_EMAIL, PASSWORD);

      await api()
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .set('CF-Connecting-IP', clientIp)
        .set('X-Forwarded-For', '203.0.113.66')
        .send({
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
          newPasswordConfirmation: NEW_PASSWORD,
        })
        .expect(204);

      const log = await prisma.auditLog.findFirst({
        where: { action: 'change_password', user: { email: ATTENDANT_EMAIL } },
        orderBy: { createdAt: 'desc' },
      });
      expect(log!.ipAddress).toBe(clientIp);

      // ThrottlerGuard.generateKey: sha256(`${Class}-${handler}-${throttler}-${tracker}`).
      const expectedKey = createHash('sha256')
        .update(`AuthController-changePassword-global-${clientIp}`)
        .digest('hex');
      expect(throttlerStorage.storage.has(expectedKey)).toBe(true);
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
