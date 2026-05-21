import { registerAs } from '@nestjs/config';

export default registerAs('app', () => {
  const required = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  if (process.env.JWT_ACCESS_SECRET && process.env.JWT_ACCESS_SECRET.length < 32) {
    throw new Error('JWT_ACCESS_SECRET must be at least 32 characters');
  }

  if (process.env.JWT_REFRESH_SECRET && process.env.JWT_REFRESH_SECRET.length < 32) {
    throw new Error('JWT_REFRESH_SECRET must be at least 32 characters');
  }

  // Warn (or fail) if running in production with obviously insecure placeholder secrets
  const insecurePatterns = ['secret', 'test', 'example', 'changeme', 'placeholder'];
  if (process.env.NODE_ENV === 'production') {
    for (const secret of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
      const val = (process.env[secret] ?? '').toLowerCase();
      if (insecurePatterns.some(p => val.includes(p))) {
        throw new Error(`${secret} contains an insecure placeholder value. Generate a strong random secret for production.`);
      }
    }
  }

  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET,
      refreshSecret: process.env.JWT_REFRESH_SECRET,
      accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    },
  };
});
