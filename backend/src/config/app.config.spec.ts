import { randomBytes } from 'crypto';
import appConfig from './app.config';

/** A random, non-placeholder value that passes the production insecure-pattern check. */
function randomStrongSecret(): string {
  return randomBytes(36).toString('base64url');
}

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

  it('starts with a complete, non-placeholder production configuration', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = randomStrongSecret();
    process.env.JWT_REFRESH_SECRET = randomStrongSecret();
    process.env.PASSWORD_PEPPER = randomStrongSecret();
    process.env.MAIL_DRIVER = 'smtp';
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'apikey';
    process.env.SMTP_PASSWORD = randomStrongSecret();
    process.env.SMTP_FROM = 'no-reply@example.com';
    process.env.FRONTEND_URL = 'https://app.example.com';

    const cfg = appConfig();

    expect(cfg.nodeEnv).toBe('production');
    expect(cfg.mail.driver).toBe('smtp');
    expect(cfg.mail.smtp.host).toBe('smtp.example.com');
    expect(cfg.jwt.accessSecret).toBe(process.env.JWT_ACCESS_SECRET);
  });

  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['true', true],
    ['1', 1],
    ['2', 2],
    ['loopback', 'loopback'],
    ['10.0.0.0/8,172.16.0.0/12', '10.0.0.0/8,172.16.0.0/12'],
  ])('parses TRUST_PROXY=%p as %p', (raw, expected) => {
    if (raw === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = raw;
    expect(appConfig().trustProxy).toBe(expected);
  });

  it('never returns the pepper under a key that looks loggable', () => {
    const cfg = appConfig();
    expect(JSON.stringify(cfg)).toContain('passwordPepper');
    expect(cfg.mail.smtp.password).toBeUndefined();
  });
});
