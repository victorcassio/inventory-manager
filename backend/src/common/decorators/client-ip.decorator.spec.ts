import { ExecutionContext } from '@nestjs/common';
import { clientIpFromContext } from './client-ip.decorator';

function ctx(request: Record<string, any>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('ClientIp decorator', () => {
  it('resolves the same address the throttler tracks', () => {
    expect(
      clientIpFromContext(undefined, ctx({
        headers: { 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.66' },
        socket: { remoteAddress: '10.0.0.1' },
        ip: '10.0.0.1',
      })),
    ).toBe('198.51.100.7');
  });

  it('is undefined when no address can be resolved', () => {
    expect(clientIpFromContext(undefined, ctx({ headers: {}, socket: {} }))).toBeUndefined();
  });
});
