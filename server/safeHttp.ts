// Outbound HTTPS to a user-supplied host (e.g. a self-hosted LibreTranslate). Because the host comes from the
// user, every connection is checked so the server cannot be pointed at internal services (SSRF):
//  - https only, no credentials in the URL, standard ports only
//  - the address is validated at connect time (not just before), which also defeats DNS rebinding
//  - redirects are not followed and the response size is capped
import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';

const MAX_RESPONSE_BYTES = 1_000_000;

export function isBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast and reserved
    );
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') || lower.startsWith('ff');
  }
  return true; // not an IP at all: refuse
}

/** Parses and validates the instance URL; returns a normalized base without trailing slash. */
export function parseSafeBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('عنوان الخادم غير صالح / Invalid server URL.');
  }
  if (url.protocol !== 'https:') throw new Error('يجب أن يبدأ العنوان بـ https / The server URL must use https.');
  if (url.username || url.password) throw new Error('لا تضع بيانات الدخول داخل العنوان / Do not put credentials in the URL.');
  if (url.port && url.port !== '443') throw new Error('المنفذ غير مسموح / Only the default HTTPS port is allowed.');
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw new Error('استخدم اسم نطاق بدل عنوان IP / Use a domain name, not an IP address.');
  }
  url.search = '';
  url.hash = '';
  return url;
}

const guardedLookup: typeof dns.lookup = ((hostname: string, options: unknown, callback: unknown) => {
  const cb = (typeof options === 'function' ? options : callback) as (
    err: NodeJS.ErrnoException | null,
    address?: string | dns.LookupAddress[],
    family?: number
  ) => void;
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return cb(err);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      return cb(Object.assign(new Error('Address not allowed'), { code: 'EBLOCKED' }) as NodeJS.ErrnoException);
    }
    const wantsAll = typeof options === 'object' && options !== null && (options as { all?: boolean }).all;
    if (wantsAll) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}) as typeof dns.lookup;

export async function safeJsonPost(
  base: URL,
  pathname: string,
  body: unknown,
  timeoutMs = 15000
): Promise<{ status: number; json: unknown }> {
  const payload = JSON.stringify(body);
  const basePath = base.pathname.replace(/\/+$/, '');
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: 'https:',
        hostname: base.hostname,
        port: 443,
        path: `${basePath}${pathname}`,
        method: 'POST',
        lookup: guardedLookup,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          let json: unknown = null;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            // Non-JSON body: the caller treats it as a failure
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      }
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('Timeout'), { name: 'TimeoutError' })));
    req.on('error', reject);
    req.end(payload);
  });
}
