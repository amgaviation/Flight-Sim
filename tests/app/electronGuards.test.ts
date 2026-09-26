import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isTrustedSenderUrl, isAllowedHttpsUrl } = require('../../electron/guards.cjs') as {
  isTrustedSenderUrl: (url: string | undefined, appOrigin: string, devUrl: string) => boolean;
  isAllowedHttpsUrl: (url: string, hosts: Set<string>) => boolean;
};

describe('Electron main-process guards', () => {
  it('IPC is accepted only from the app page (or the dev server in dev runs)', () => {
    expect(isTrustedSenderUrl('app://app/index.html', 'app://app', '')).toBe(true);
    expect(isTrustedSenderUrl('app://app.evil/index.html', 'app://app', '')).toBe(false);
    expect(isTrustedSenderUrl('https://example.com/', 'app://app', '')).toBe(false);
    expect(isTrustedSenderUrl(undefined, 'app://app', '')).toBe(false);
    expect(isTrustedSenderUrl('http://localhost:5173/', 'app://app', '')).toBe(false);
    expect(isTrustedSenderUrl('http://localhost:5173/index.html', 'app://app', 'http://localhost:5173')).toBe(true);
  });

  it('http:get only reaches allow-listed https hosts (also checked on the final URL after redirects)', () => {
    const hosts = new Set(['aviationweather.gov']);
    expect(isAllowedHttpsUrl('https://aviationweather.gov/api/data/metar?ids=KTEB&format=json', hosts)).toBe(true);
    expect(isAllowedHttpsUrl('http://aviationweather.gov/api/data/metar', hosts)).toBe(false);
    expect(isAllowedHttpsUrl('https://aviationweather.gov.evil.com/', hosts)).toBe(false);
    expect(isAllowedHttpsUrl('https://evil.com/?h=aviationweather.gov', hosts)).toBe(false);
    expect(isAllowedHttpsUrl('file:///etc/passwd', hosts)).toBe(false);
    expect(isAllowedHttpsUrl('not a url', hosts)).toBe(false);
  });
});
