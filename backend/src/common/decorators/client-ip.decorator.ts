import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { resolveClientIp } from '../client-ip/resolve-client-ip';

export function clientIpFromContext(_: unknown, ctx: ExecutionContext): string | undefined {
  return resolveClientIp(ctx.switchToHttp().getRequest());
}

/**
 * The client address for audit logs — the same one ClientIpThrottlerGuard
 * rate-limits by. Use this instead of Nest's @Ip(), which returns req.ip.
 */
export const ClientIp = createParamDecorator(clientIpFromContext);
