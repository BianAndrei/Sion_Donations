// Video în buclă al afișului animat, pentru proiector, ProPresenter, PowerPoint sau TV.
//
//   npm run poster          # întâi: QR-ul și capturile la zi
//   npm run video           # → poster/sion-donatii-afis.mp4 (1920×1080, 30 fps)
//   npm run video -- --4k   # → 3840×2160
//
// Cere ffmpeg instalat (macOS: `brew install ffmpeg`).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSTER = path.join(ROOT, 'poster');
const UHD = process.argv.includes('--4k');
const FPS = 30;
const OUT = path.join(POSTER, UHD ? 'sion-donatii-afis-4k.mp4' : 'sion-donatii-afis.mp4');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: UHD ? 2 : 1 });
// ?t= oprește animația automată; cadrele le cerem noi, unul câte unul.
await page.goto(`${pathToFileURL(path.join(POSTER, 'index.html'))}?t=0`);
await page.evaluate(() => document.fonts.ready);
const loop = await page.evaluate(() => window.POSTER_LOOP);
const frames = Math.round(loop * FPS);

const ffmpeg = spawn('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', OUT,
], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((resolve, reject) => {
  ffmpeg.on('error', (err) => reject(err.code === 'ENOENT' ? new Error('ffmpeg lipsește: brew install ffmpeg') : err));
  ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg a ieșit cu ${code}`))));
});

for (let i = 0; i < frames; i++) {
  await page.evaluate((t) => window.posterFrame(t), i / FPS);
  const png = await page.screenshot({ type: 'png' });
  if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
  if (i % FPS === 0) process.stdout.write(`\r${Math.round((i / frames) * 100)}%`);
}
ffmpeg.stdin.end();
await done;
await browser.close();
console.log(`\rVideo generat: ${path.relative(ROOT, OUT)} (${loop}s, se reia perfect în buclă)`);
