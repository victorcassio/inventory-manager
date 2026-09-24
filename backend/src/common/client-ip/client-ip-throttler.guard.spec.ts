import { ClientIpThrottlerGuard } from './client-ip-throttler.guard';

describe('ClientIpThrottlerGuard', () => {
  // getTracker never touches the injected options/storage/reflector.
  const guard = new ClientIpThrottlerGuard({} as any, {} as any, {} as any);
  const track = (r: Record<string, any>) => (guard as any).getTracker(r) as Promise<string>;

  it('tracks by CF-Connecting-IP, not by the proxy address in req.ip', async () => {
    await expect(
      track({ headers: { 'cf-connecting-ip': '198.51.100.7' }, socket: { remoteAddress: '10.0.0.1' }, ip: '10.0.0.1' }),
    ).resolves.toBe('198.51.100.7');
  });

  it('gives two different client IPs two different trackers', async () => {
    const a = await track({ headers: { 'cf-connecting-ip': '198.51.100.7' }, socket: { remoteAddress: '10.0.0.1' } });
    const b = await track({ headers: { 'cf-connecting-ip': '198.51.100.8' }, socket: { remoteAddress: '10.0.0.1' } });
    expect(a).not.toBe(b);
  });

  it('buckets IPv6 clients by /64, so rotating addresses inside one prefix shares a quota', async () => {
    const t = (ip: string) => track({ headers: { 'cf-connecting-ip': ip }, socket: { remoteAddress: '10.0.0.1' } });
    const a = await t('2001:db8:0:1::a');
    expect(a).toBe('2001:db8:0:1::/64');
    expect(await t('2001:db8:0:1:ffff:ffff:ffff:ffff')).toBe(a);
    expect(await t('2001:DB8:0000:0001:0:0:0:1')).toBe(a);
    expect(await t('2001:db8:0:2::a')).not.toBe(a);
  });

  it('keeps IPv4 (including IPv4-mapped) as the full address', async () => {
    await expect(
      track({ headers: { 'cf-connecting-ip': '::ffff:192.0.2.10' }, socket: { remoteAddress: '10.0.0.1' } }),
    ).resolves.toBe('192.0.2.10');
  });

  it('ignores X-Forwarded-For', async () => {
    await expect(
      track({ headers: { 'x-forwarded-for': '203.0.113.66' }, socket: { remoteAddress: '10.0.0.1' } }),
    ).resolves.toBe('10.0.0.1');
  });

  it('still returns a stable string when no address can be resolved', async () => {
    await expect(track({ headers: {}, socket: {} })).resolves.toBe('unknown');
  });
});
