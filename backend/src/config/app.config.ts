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
