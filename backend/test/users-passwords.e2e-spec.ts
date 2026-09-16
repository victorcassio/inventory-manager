import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import helmet from 'helmet';
import * as bcrypt from 'bcrypt';
import { ThrottlerStorage } from '@nestjs/throttler';
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

// The single message every token defect must produce. Expired, already-used and
// revoked have to be indistinguishable from outside: any divergence is an
// enumeration oracle, so each of the three asserts this exact string.
const INVALID_TOKEN_MESSAGE = 'Link inválido ou expirado';

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

describe('Users and passwords (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: FakeMailService;
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
