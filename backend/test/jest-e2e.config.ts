import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testMatch: ['**/test/**/*.e2e-spec.ts'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  testTimeout: 30000,
  // Both e2e suites hit the same PostgreSQL database. Their fixture e-mails do
  // not overlap today, so parallel workers happen to be safe — but that is an
  // accident of naming, not a property anyone enforces. One worker makes the
  // isolation real and keeps the next suite from inheriting a half-written
  // fixture state.
  maxWorkers: 1,
};

export default config;
