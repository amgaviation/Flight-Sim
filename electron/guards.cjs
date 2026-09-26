/**
 * Pure request guards for the Electron main process (no Electron imports, so
 * they are unit-tested in tests/app/electronGuards.test.ts).
 *
 * Electron security checklist (electronjs.org/docs/latest/tutorial/security):
 * #17 validate the sender of all IPC messages; the http:get bridge must only
 * reach allow-listed https hosts, including after redirects.
 */
'use strict';

/** True when `senderUrl` (event.senderFrame.url) is the app's own page or the dev server. */
function isTrustedSenderUrl(senderUrl, appOrigin, devUrl) {
  const url = String(senderUrl || '');
  if (url.startsWith(`${appOrigin}/`)) return true;
  return Boolean(devUrl) && url.startsWith(devUrl);
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
