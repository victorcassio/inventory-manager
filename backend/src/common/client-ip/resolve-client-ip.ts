import { isIP } from 'net';

/**
 * The minimal request shape this needs — satisfied by an Express request and
 * by plain test objects alike.
 */
export interface ClientIpSource {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  ip?: string;
}

const CF_CONNECTING_IP = 'cf-connecting-ip';

/**
 * The single source of truth for "which client made this request", shared by
 * the rate limiter (ClientIpThrottlerGuard) and every audit/log call site
 * (@ClientIp()), so both always agree on the address.
 *
 * Production runs on Render, where — per Render support — 100% of public
 * traffic passes through Cloudflare and Render's routing layer, which the
 * client cannot bypass, and the visitor's address is in CF-Connecting-IP.
 * That header is therefore the ONLY forwarded header read here.
 * X-Forwarded-For is deliberately never consulted: any client can put
 * anything in it, and Express's `trust proxy` (which is what makes req.ip
 * read it) stays at its default of trusting nothing.
 *
 * A header that is not exactly one IPv4/IPv6 address — empty, garbage, a
 * comma/space-separated list, or repeated — is ignored rather than
 * "repaired", and the socket's own address is used instead. That fallback is
 * only meaningful off Render (local development, e2e tests); behind Render
 * the socket address is the proxy's.
 *
 * Trust assumption: this backend must only be reachable through Render's
 * public edge. Exposed any other way, CF-Connecting-IP is client-controlled.
 */
export function resolveClientIp(req: ClientIpSource): string | undefined {
  return (
    parseSingleIp(req.headers?.[CF_CONNECTING_IP]) ??
    parseSingleIp(req.socket?.remoteAddress) ??
    parseSingleIp(req.ip)
  );
}

function parseSingleIp(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined; // absent, or a repeated header
  const candidate = raw.trim();
  // A zone id (fe80::1%eth0) passes isIP but is never a public client, and an
  // arbitrary-length one would overflow the audit log's ipAddress column.
  if (candidate.includes('%')) return undefined;
  const version = isIP(candidate);
  if (version === 0) return undefined;
  if (version === 4) return candidate;
  return formatIpv6(expandIpv6(candidate));
}

/**
 * The eight 16-bit groups of an address isIP() has already accepted as IPv6,
 * including the `::` shorthand and a dotted IPv4 tail (::ffff:192.0.2.10).
 */
export function expandIpv6(address: string): number[] {
  let text = address.toLowerCase();
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const [a, b, c, d] = tail.split('.').map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const parse = (part: string | undefined) => (part ? part.split(':').map(g => parseInt(g, 16)) : []);
  const left = parse(head);
  if (rest === undefined) return left;
  const right = parse(rest);
  return [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
}

/**
 * RFC 5952 text for eight groups — so one client never shows up under two
 * spellings — except that an IPv4-mapped address (::ffff:a.b.c.d, which is
 * how Node reports IPv4 clients on a dual-stack socket) becomes plain IPv4.
 */
function formatIpv6(groups: number[]): string {
  if (groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
  }
  // Longest run of two or more zero groups (the first, on a tie) becomes "::".
  let bestStart = -1;
  let bestLen = 1;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) { bestStart = i; bestLen = j - i; }
    i = j;
  }
  const hex = groups.map(g => g.toString(16));
  if (bestStart === -1) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`;
}

/**
 * The /64 an IPv6 address belongs to, as "2001:db8:0:1::/64". A single
 * subscriber is normally handed a whole /64 and can pick a new source
 * address inside it for every request, so rate limits keyed by the full
 * address would give each request a fresh quota.
 */
export function ipv6Prefix64(address: string): string {
  const groups = expandIpv6(address);
  return `${formatIpv6([...groups.slice(0, 4), 0, 0, 0, 0])}/64`;
}
