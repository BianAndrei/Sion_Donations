// Generează afișul de la finalul serviciului: codul QR, capturile aplicației pentru
// telefonul animat, plus variantele statice PNG și PDF.
//
//   npm start                                    (aplicația trebuie să ruleze)
//   npm run poster -- --url https://doneaza.exemplu.ro
//
// Fără --url, codul QR duce la adresa din rețeaua locală, ca să poți testa cu telefonul.

import { chromium } from 'playwright';
import QRCode from 'qrcode';
import { networkInterfaces } from 'node:os';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSTER = path.join(ROOT, 'poster');
const ASSETS = path.join(POSTER, 'assets');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const lanIp = Object.values(networkInterfaces()).flat()
  .find((n) => n?.family === 'IPv4' && !n.internal)?.address ?? 'localhost';

const APP_URL = arg('app') ?? `http://localhost:${process.env.PORT ?? 4242}`;
const DONATE_URL = arg('url') ?? process.env.DONATE_URL ?? `http://${lanIp}:${process.env.PORT ?? 4242}`;
// Momentul din animație folosit pentru PNG și PDF (în secunde).
const STILL_AT = Number(arg('still') ?? 0.4);

await mkdir(ASSETS, { recursive: true });

// ── Cod QR ───────────────────────────────────────────────────────────────────
const qr = await QRCode.toString(DONATE_URL, {
  type: 'svg',
  errorCorrectionLevel: 'M',
  margin: 0,
  color: { dark: '#0B0B0CFF', light: '#FFFFFF00' },
});
await writeFile(path.join(ASSETS, 'qr.svg'), qr);

// ── Logo pentru colțul roșu (complet alb) ────────────────────────────────────
const lockup = await readFile(path.join(ROOT, 'public/assets/logo-lockup.svg'), 'utf8');
await writeFile(path.join(ASSETS, 'logo-lockup-white.svg'), lockup.replaceAll('#DD000D', '#fff').replaceAll('#000', '#fff'));

// ── Capturi din aplicație ────────────────────────────────────────────────────
const browser = await chromium.launch();
const phone = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ro-RO',
});
const page = await phone.newPage();
const box = async (selector) => {
  const b = await page.locator(selector).first().boundingBox();
  const scrollY = await page.evaluate(() => window.scrollY);
  return { x: b.x, y: b.y + scrollY, w: b.width, h: b.height };
};
const pageHeight = () => page.evaluate(() => document.documentElement.scrollHeight);

try {
  await page.goto(`${APP_URL}/?preview`, { waitUntil: 'networkidle' });
} catch {
  console.error(`Nu găsesc aplicația la ${APP_URL}. Pornește-o întâi cu „npm start”.`);
  process.exit(1);
}
await page.evaluate(() => document.fonts.ready);

const scenes = {};
scenes.form = {
  height: await pageHeight(),
  taps: { preset: await box('[data-preset="100"]'), cta: await box('#continue-btn') },
};
await page.screenshot({ path: path.join(ASSETS, 'screen-form.png'), fullPage: true });

await page.click('#continue-btn');
await page.fill('#email', 'maria@exemplu.ro');
await page.evaluate(() => document.activeElement.blur());
scenes.pay = {
  height: await pageHeight(),
  taps: { wallet: await box('.mock-wallet'), pay: await box('#pay-btn') },
};
await page.screenshot({ path: path.join(ASSETS, 'screen-pay.png'), fullPage: true });

await page.click('#pay-btn');
await page.waitForLoadState('networkidle');
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(700);
scenes.thanks = { height: await pageHeight(), taps: {} };
await page.screenshot({ path: path.join(ASSETS, 'screen-thanks.png'), fullPage: true });
await phone.close();

const display = DONATE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
await writeFile(
  path.join(ASSETS, 'scenes.js'),
  `// Generat de scripts/build-poster.mjs\nwindow.POSTER = ${JSON.stringify({ url: DONATE_URL, display, scenes }, null, 2)};\n`,
);

// ── PNG și PDF ───────────────────────────────────────────────────────────────
const stage = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const poster = await stage.newPage();
await poster.goto(`${pathToFileURL(path.join(POSTER, 'index.html'))}?t=${STILL_AT}`);
await poster.evaluate(() => document.fonts.ready);
await poster.waitForTimeout(300);
await poster.screenshot({ path: path.join(POSTER, 'sion-donatii-afis.png') });
await poster.pdf({
  path: path.join(POSTER, 'sion-donatii-afis.pdf'),
  width: '1920px',
  height: '1080px',
  printBackground: true,
  pageRanges: '1',
});
await browser.close();

console.log(`Afiș generat în ${path.relative(ROOT, POSTER)}/  ·  QR → ${DONATE_URL}`);
