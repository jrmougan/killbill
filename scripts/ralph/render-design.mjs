// Renders every phone mockup of the chosen design (docs/design/EQUIL Rediseño.dc.html)
// to scripts/ralph/design/<NN>-<label>.png so the Ralph loop can compare the real
// app against a picture instead of reading inline styles.
//
// The .dc.html needs the claude.ai design runtime, but its mockups are plain HTML with
// inline styles + lucide icons: unwrapping <helmet>/<x-dc> into a static page is enough.
//
// Usage: node scripts/ralph/render-design.mjs
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { chromium } from '@playwright/test';

const SOURCE = 'docs/design/EQUIL Rediseño.dc.html';
const OUT = 'scripts/ralph/design';

const src = readFileSync(SOURCE, 'utf8');
const head = src.match(/<helmet[^>]*>([\s\S]*?)<\/helmet>/)[1];
const body = src.match(/<\/helmet>([\s\S]*?)<\/x-dc>/)[1];
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">${head}</head><body>${body}
<script>window.addEventListener('load', () => window.lucide && window.lucide.createIcons());</script></body></html>`;

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.querySelectorAll('svg.lucide').length > 0, null, { timeout: 15_000 })
  .catch(() => console.warn('lucide icons did not load (offline?) — screenshots will lack icons'));
await page.evaluate(() => document.fonts.ready);

// Each mockup is a 360×760 frame preceded by a monospace caption span ("INICIO", "GASTOS"…).
const frames = page.locator('div[style*="width:360px;height:760px"]');
const count = await frames.count();
const seen = new Map();
for (let i = 0; i < count; i++) {
  const frame = frames.nth(i);
  const section = await frame.evaluate((el) => el.closest('.dv-opt')?.id ?? 'x');
  const label = await frame.evaluate((el) => el.previousElementSibling?.textContent?.trim() || 'pantalla');
  let name = `${section}-${slug(label)}`;
  const n = (seen.get(name) ?? 0) + 1;
  seen.set(name, n);
  if (n > 1) name += `-${n}`;
  await frame.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${OUT}/${name}.png`);
}
await browser.close();
