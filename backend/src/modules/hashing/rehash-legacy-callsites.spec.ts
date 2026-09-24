import * as fs from 'fs';
import * as path from 'path';

/**
 * `rehashLegacy()` is policy-FREE by design — it exists solely for the
 * login-time bcrypt -> Argon2id migration in auth.service.ts, where the
 * password has already been accepted by a prior policy (or predates any
 * policy at all). Calling it from a flow where a user CHOOSES a password
 * (activation, reset, change) would silently bypass the password policy for
 * that flow.
 *
 * This test walks the production source tree and asserts that the ONLY
 * production file referencing `rehashLegacy` is auth.service.ts (plus the
 * method's own definition in hashing.service.ts). If a future flow calls it
 * by mistake, this test fails and names the offending file.
 */

const SRC_ROOT = path.resolve(__dirname, '..', '..');

const ALLOWED_FILES = new Set([
  path.join('src', 'modules', 'auth', 'auth.service.ts'),
  path.join('src', 'modules', 'hashing', 'hashing.service.ts'),
]);

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('rehashLegacy call-site guard', () => {
  it('is referenced only from auth.service.ts among production files', () => {
    const productionFiles = walk(SRC_ROOT);

    const referencingFiles = productionFiles
      .filter(file => fs.readFileSync(file, 'utf8').includes('rehashLegacy'))
      .map(file => path.relative(path.resolve(SRC_ROOT, '..'), file));

    expect(new Set(referencingFiles)).toEqual(ALLOWED_FILES);
  });
});
