// Screenshot helper for the 737NG preview (development only, not bundled).
// Usage: node src/avionics/boeing-737/dev/shoot.mjs <url-query> <out.png> [selector] [width] [height]
// Expects `npx vite --port 5199` running from the repository root.
import { chromium } from 'playwright-core';

const [query = 'state=cruise', out = 'preview.png', selector = '', width = '1400', height = '900'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const pageName = process.env.PAGE ?? "preview";
await page.goto(`http://localhost:5199/src/avionics/boeing-737/dev/${pageName}.html?${query}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await page.waitForTimeout(200);
if (selector) await page.locator(selector).first().screenshot({ path: out });
else await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote', out);
