import { resolveClientIp } from './resolve-client-ip';

// Addresses come only from the documentation ranges (RFC 5737 / RFC 3849),
// so nothing here can be a real visitor's IP.
function req(headers: Record<string, string | string[] | undefined>, remoteAddress?: string, ip?: string) {
  return { headers, socket: { remoteAddress }, ip };
}

describe('resolveClientIp', () => {
  it('uses a valid IPv4 CF-Connecting-IP', () => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': '198.51.100.7' }, '10.0.0.1'))).toBe('198.51.100.7');
  });

  it('uses a valid IPv6 CF-Connecting-IP, lower-cased', () => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': '2001:DB8::1' }, '10.0.0.1'))).toBe('2001:db8::1');
  });

  it('trims surrounding whitespace from the header', () => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': ' 198.51.100.7 ' }, '10.0.0.1'))).toBe('198.51.100.7');
  });

  it('normalizes an IPv4-mapped IPv6 address to plain IPv4', () => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': '::ffff:192.0.2.10' }, '10.0.0.1'))).toBe('192.0.2.10');
    expect(resolveClientIp(req({ 'cf-connecting-ip': '::FFFF:192.0.2.10' }, '10.0.0.1'))).toBe('192.0.2.10');
  });

  it.each([
    ['2001:db8:0:0:0:0:0:1', '2001:db8::1'],
    ['2001:0DB8:0000::0001', '2001:db8::1'],
    ['2001:db8:0:1:0:0:0:0', '2001:db8:0:1::'],
    ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'],
    ['0:0:0:0:0:ffff:c000:20a', '192.0.2.10'],
    ['::ffff:c000:20a', '192.0.2.10'],
  ])('canonicalizes IPv6 %p as %p so one client has one spelling', (raw, expected) => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': raw }, '10.0.0.1'))).toBe(expected);
  });

  it('rejects an IPv6 zone id (it would not fit the audit column and is never a public client)', () => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': 'fe80::1%eth0' }, '10.0.0.1'))).toBe('10.0.0.1');
    expect(resolveClientIp(req({}, `fe80::1%${'x'.repeat(40)}`, '10.0.0.2'))).toBe('10.0.0.2');
  });

  it('falls back to the socket address when the header is absent', () => {
    expect(resolveClientIp(req({}, '::ffff:127.0.0.1'))).toBe('127.0.0.1');
  });

  it('falls back to req.ip when there is neither a header nor a socket address', () => {
    expect(resolveClientIp(req({}, undefined, '::1'))).toBe('::1');
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['garbage', 'not-an-ip'],
    ['out-of-range octet', '198.51.100.256'],
    ['host:port', '198.51.100.7:443'],
    ['comma list', '198.51.100.7, 203.0.113.9'],
    ['space-separated list', '198.51.100.7 203.0.113.9'],
  ])('ignores an invalid header (%s) and falls back to the socket', (_label, value) => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': value }, '10.0.0.1'))).toBe('10.0.0.1');
  });

  it('ignores a repeated header delivered as an array', () => {
    expect(
      resolveClientIp(req({ 'cf-connecting-ip': ['198.51.100.7', '203.0.113.9'] }, '10.0.0.1')),
    ).toBe('10.0.0.1');
  });

  it('never reads X-Forwarded-For, with or without CF-Connecting-IP', () => {
    const forged = { 'x-forwarded-for': '203.0.113.66' };
    expect(resolveClientIp(req({ ...forged, 'cf-connecting-ip': '198.51.100.7' }, '10.0.0.1'))).toBe('198.51.100.7');
    expect(resolveClientIp(req(forged, '10.0.0.1'))).toBe('10.0.0.1');
    expect(resolveClientIp(req(forged, undefined, undefined))).toBeUndefined();
  });

  it('returns undefined when nothing valid is available', () => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': 'x' }, 'bogus', ''))).toBeUndefined();
  });
});
