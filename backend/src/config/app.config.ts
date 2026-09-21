import { registerAs } from '@nestjs/config';

/**
 * Express's `trust proxy` setting, parsed from TRUST_PROXY. Unset/"false"
 * keeps Express's own default (do not trust X-Forwarded-For at all) — safe
 * only when nothing sits in front of this process. Deploying behind any
 * reverse proxy/load balancer/ingress WITHOUT setting this correctly makes
 * every client share one req.ip: per-IP rate limiting on /auth/* becomes a
 * single GLOBAL quota (one attacker can lock out every user), and the
 * ipAddress recorded in AuditLog is the proxy's, not the real client's.
 *
 * "true" is accepted (Express itself supports it) but should not be used as
 * a default: it trusts every hop and reads the LEFTMOST X-Forwarded-For
 * entry, which a client can forge by prepending fake addresses if the real
 * proxy appends to the header instead of replacing it. Prefer a hop count
 * ("1" for exactly one proxy — Express then trusts the entry the Nth
 * position from the RIGHT, the one only your own proxy could have written)
 * or the proxy's exact IP/CIDR. See docs/security-checklist-deploy.md.
 */
function parseTrustProxy(raw: string | undefined): boolean | number | string {
  if (raw === undefined || raw === '') return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return raw; // comma-separated IPs/subnets/interfaces — Express parses this itself.
}

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
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
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
