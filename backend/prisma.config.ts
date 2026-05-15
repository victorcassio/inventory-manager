import path from 'node:path';
import { defineConfig, env } from '@prisma/config';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: {
    seed: 'ts-node --project tsconfig.json prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
