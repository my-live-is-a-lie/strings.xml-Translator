import { describe, expect, it } from 'vitest';
import { isBlockedAddress, parseSafeBaseUrl } from '../server/safeHttp';

describe('isBlockedAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])(
    'blocks %s',
    (ip) => expect(isBlockedAddress(ip)).toBe(true)
  );
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111'])('allows %s', (ip) =>
    expect(isBlockedAddress(ip)).toBe(false)
  );
});

describe('parseSafeBaseUrl', () => {
  it('accepts a plain https domain and strips query and hash', () => {
    expect(parseSafeBaseUrl('https://translate.example.com/?a=1#x').href).toBe('https://translate.example.com/');
  });
  it.each([
    'http://translate.example.com',
    'https://user:pw@translate.example.com',
    'https://translate.example.com:8443',
    'https://127.0.0.1',
    'https://[::1]',
    'ftp://example.com',
    'not a url',
    '',
  ])('rejects %s', (u) => expect(() => parseSafeBaseUrl(u)).toThrow());
});
