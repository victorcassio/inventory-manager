import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { isIP } from 'net';
import { ipv6Prefix64, resolveClientIp } from './resolve-client-ip';

/**
 * ThrottlerGuard keyed by the real client address (CF-Connecting-IP on
 * Render) instead of req.ip, which behind Render is the proxy's address and
 * would turn every per-IP limit into one quota shared by all users.
 *
 * IPv6 clients are tracked by their /64, not the full address (see
 * ipv6Prefix64). Audit logs still record the full address via @ClientIp().
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const ip = resolveClientIp(req as any);
    if (!ip) return 'unknown';
    return isIP(ip) === 6 ? ipv6Prefix64(ip) : ip;
  }
}
