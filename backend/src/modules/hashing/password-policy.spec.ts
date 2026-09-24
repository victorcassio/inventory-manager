import { validatePasswordPolicy } from './password-policy';

describe('validatePasswordPolicy', () => {
  it('accepts a 12-character password', () => {
    expect(validatePasswordPolicy('abcdefghijkl')).toEqual([]);
  });

  it('rejects an 11-character password', () => {
    expect(validatePasswordPolicy('abcdefghijk')).toContain(
      'A senha deve ter no mínimo 12 caracteres',
    );
  });

  it('rejects a password longer than 128 characters', () => {
    expect(validatePasswordPolicy('a'.repeat(129))).toContain(
      'A senha deve ter no máximo 128 caracteres',
    );
  });

  it('accepts a long passphrase with spaces', () => {
    expect(validatePasswordPolicy('cavalo de batalha azul e quadrado')).toEqual([]);
  });

  it('accepts Unicode characters', () => {
    expect(validatePasswordPolicy('çãoÇÃO-ñ-日本語-ok')).toEqual([]);
  });

  it('does not trim — leading and trailing spaces count toward the length', () => {
    // 10 visible chars + 2 spaces = 12 → valid only if spaces are counted
    expect(validatePasswordPolicy(' abcdefghij ')).toEqual([]);
  });

  it('rejects blocklisted passwords regardless of case', () => {
    for (const weak of ['123456', 'password', 'Admin@123456', 'PASSWORD']) {
      expect(validatePasswordPolicy(weak).length).toBeGreaterThan(0);
    }
  });

  it('does not require mixed character classes', () => {
    expect(validatePasswordPolicy('aaaaaaaaaaaaaaaa')).toEqual([]);
  });

  it('rejects non-string input without throwing', () => {
    expect(validatePasswordPolicy(undefined).length).toBeGreaterThan(0);
    expect(validatePasswordPolicy(12345678901234).length).toBeGreaterThan(0);
  });
});
