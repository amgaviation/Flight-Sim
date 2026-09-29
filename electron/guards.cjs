/**
 * Pure request guards for the Electron main process (no Electron imports, so
 * they are unit-tested in tests/app/electronGuards.test.ts).
 *
 * Electron security checklist (electronjs.org/docs/latest/tutorial/security):
 * #17 validate the sender of all IPC messages; the http:get bridge must only
 * reach allow-listed https hosts, including after redirects.
 */
'use strict';

/** Origin of an http(s) URL, or '' when it does not parse. */
function httpOrigin(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.origin : '';
  } catch {
    return '';
  }
}

/**
 * True when `senderUrl` (event.senderFrame.url, or a navigation target) is
 * the app's own page or, in dev runs, a page of the dev server's exact
 * origin. `app://app` is matched by prefix up to the path slash (a custom
 * scheme has an opaque URL origin); the dev server by origin, so
 * `http://localhost:51730` or `http://localhost:5173.evil.com` do not pass
 * for `http://localhost:5173`.
 */
function isTrustedSenderUrl(senderUrl, appOrigin, devUrl) {
  const url = String(senderUrl || '');
  if (url.startsWith(`${appOrigin}/`)) return true;
  if (!devUrl) return false;
  const dev = httpOrigin(devUrl);
  return dev !== '' && httpOrigin(url) === dev;
}

/** True when `rawUrl` is an https URL on one of `allowedHosts` (exact host match). */
function isAllowedHttpsUrl(rawUrl, allowedHosts) {
  let u;
  try {
    u = new URL(String(rawUrl));
  } catch {
    return false;
  }
  return u.protocol === 'https:' && allowedHosts.has(u.hostname);
}

module.exports = { isTrustedSenderUrl, isAllowedHttpsUrl };
