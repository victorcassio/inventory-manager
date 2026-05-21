import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('returns status ok', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
  });

  it('returns a valid ISO timestamp', () => {
    const result = controller.check();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it('returns uptime as a non-negative integer', () => {
    const result = controller.check();
    expect(typeof result.uptime).toBe('number');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.uptime)).toBe(true);
  });

  it('returns environment field', () => {
    const result = controller.check();
    expect(result.environment).toBeDefined();
  });

  it('does not expose sensitive data (no secrets, paths, versions, tokens)', () => {
    const result = controller.check();
    const keys = Object.keys(result);
    const forbidden = ['password', 'secret', 'token', 'key', 'path', 'version', 'dependencies', 'database'];
    for (const field of forbidden) {
      expect(keys).not.toContain(field);
    }
  });

  it('response has exactly the expected shape', () => {
    const result = controller.check();
    expect(Object.keys(result).sort()).toEqual(['environment', 'status', 'timestamp', 'uptime'].sort());
  });
});
