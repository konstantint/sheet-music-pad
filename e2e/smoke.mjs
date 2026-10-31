// End-to-end smoke test: drives the main flows in headless Chromium.
// Usage: npm run build && npm run e2e [-- screenshotDir]   (or set SMP_URL to test a running server)
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preview } from 'vite';

const server = process.env.SMP_URL ? null : await preview({ preview: { port: 4174, strictPort: true }, logLevel: 'silent' });
const URL = process.env.SMP_URL ?? 'http://localhost:4174/';
const shots = process.argv[2];
const S = 12;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
};
const shot = async (name) => shots && (await page.screenshot({ path: join(shots, `${name}.png`) }));

await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.evaluate(() => document.fonts.ready);

const svg = page.locator('svg.score');
const box = async () => svg.boundingBox();
/** Client point of staff position p at svg x on the first system. */
const at = async (x, p, system = 0) => {
  const b = await box();
  const staffTop = 0.5 * S + system * (16 * S + S) + 6 * S;
  return { x: b.x + x, y: b.y + staffTop + ((8 - p) * S) / 2 };
};
const exportJson = async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
  return JSON.parse(readFileSync(await dl.path(), 'utf8'));
};
const dragFromPalette = async (label, to, { shift = false } = {}) => {
  const btn = page.getByRole('button', { name: label, exact: true });
  const b = await btn.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 40, b.y + 10, { steps: 3 });
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
};

// AC-1
check((await page.locator('svg.score').getAttribute('aria-label')) === 'treble clef, 4/4, 0 events', 'AC-1 empty treble staff in 4/4');
await shot('01-empty');

// AC-3: drag a quarter onto the second line (G4)
await dragFromPalette('quarter note', await at(200, 2));
let doc = await exportJson();
check(doc.composition.events.length === 1 && doc.composition.events[0].notes[0].step === 'G', 'AC-3 drag inserts G4');

// AC-4: build a chord (E4 + C5) in the same column
const headCenter = async () => {
  const r = await page.locator('[data-note-id]').first().boundingBox();
  return r.x + r.width / 2;
};
let cx = (await headCenter()) - (await box()).x;
await dragFromPalette('quarter note', await at(cx, 0));
await dragFromPalette('quarter note', await at(cx, 5));
doc = await exportJson();
const notes0 = doc.composition.events[0].notes.map((n) => `${n.step}${n.octave}`);
check(doc.composition.events.length === 1 && notes0.join(' ') === 'E4 G4 C5', `AC-4 chord built: ${notes0.join(' ')}`);

// AC-5: half note in the gap to the right
await dragFromPalette('half note', await at(cx + 6 * S, 4));
doc = await exportJson();
check(doc.composition.events.length === 2 && doc.composition.events[1].duration.base === 'half', 'AC-5 next event is a half note');

// AC-6: Shift forces insert over the chord column
await dragFromPalette('quarter note', await at(cx + 2, 3), { shift: true });
doc = await exportJson();
check(doc.composition.events.length === 3 && doc.composition.events[0].notes.length === 3, 'AC-6 Shift inserts a new event');

// AC-7: ledger lines — drag to p=14 above, check label during drag
{
  const btn = page.getByRole('button', { name: 'quarter note', exact: true });
  const b = await btn.boundingBox();
  await page.mouse.move(b.x + 20, b.y + 20);
  await page.mouse.down();
  const end = await at(cx + 30 * S, 14);
  await page.mouse.move(end.x, end.y, { steps: 10 });
  const label = await page.locator('.ghost-label').textContent();
  await shot('02-ledger-drag');
  await page.mouse.up();
  check(label === 'E6', `AC-7 ghost label at 3rd ledger line: ${label}`);
}
doc = await exportJson();
const last = doc.composition.events.at(-1);
check(last.notes[0].step === 'E' && last.notes[0].octave === 6, 'AC-7 E6 placed');

// Click-to-place: select eighth, click the staff
await page.getByRole('button', { name: 'eighth note', exact: true }).click();
const clickPt = await at(cx + 40 * S, 6);
await page.mouse.click(clickPt.x, clickPt.y);
doc = await exportJson();
check(doc.composition.events.at(-1).duration.base === 'eighth', 'FR-DRAG-10 click places an eighth');

// AC-8: bar line drag between events 2 and 3 (index 2)
{
  const heads = await page.locator('[data-note-id]').all();
  const xs = [];
  for (const h of heads) {
    const r = await h.boundingBox();
    xs.push(r.x + r.width / 2);
  }
  const uniq = [...new Set(xs.map((x) => Math.round(x)))].sort((a, b) => a - b);
  const mid = (uniq[1] + uniq[2]) / 2 - (await box()).x;
  await dragFromPalette('single bar line', await at(mid, 4));
}
doc = await exportJson();
check(doc.composition.events[2]?.type === 'barline', `AC-8 bar line at index 2 (types: ${doc.composition.events.map((e) => e.type[0]).join('')})`);
await shot('03-composed');

// Selection + keyboard: click first note, arrow up, sharp
{
  const r = await page.locator('[data-note-id]').first().boundingBox();
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
}
const selText = await page.locator('.status-sel').textContent();
check(selText.startsWith('Note E4'), `click selects a note: ${selText}`);
await page.keyboard.press('ArrowUp');
await page.keyboard.press('=');
doc = await exportJson();
const first = doc.composition.events[0].notes[0];
check(first.step === 'F' && first.alter === 1, 'ArrowUp + "=" makes F♯4');

// AC-14: undo/redo
const before = JSON.stringify((await exportJson()).composition.events);
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+Shift+z');
await page.keyboard.press('Control+Shift+z');
check(JSON.stringify((await exportJson()).composition.events) === before, 'AC-14 undo/redo restores state');

// AC-15: drag a note out of the score to delete it
{
  const count = (await exportJson()).composition.events.length;
  const heads = page.locator('[data-note-id]');
  const r = await heads.last().boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + 30, r.y + 30, { steps: 3 });
  await page.mouse.move(100, 30, { steps: 8 });
  const chip = await page.locator('.drag-chip.deleting').count();
  await page.mouse.up();
  check(chip === 1 && (await exportJson()).composition.events.length === count - 1, 'AC-15 drag out deletes');
}

// AC-12: round trip export -> new -> import
const exported = await exportJson();
await page.getByRole('banner').getByRole('button', { name: 'New' }).click();
check((await svg.getAttribute('aria-label')).endsWith('0 events'), 'New clears the score');
const tmp = join(mkdtempSync(join(tmpdir(), 'smp-')), 'roundtrip.smp.json');
writeFileSync(tmp, JSON.stringify(exported));
await page.locator('input[type=file]').setInputFiles(tmp);
await page.waitForTimeout(100);
check(JSON.stringify((await exportJson()).composition) === JSON.stringify(exported.composition), 'AC-12 export/import round trip');

// AC-13: invalid import
const bad = structuredClone(exported);
bad.composition.events[0].notes[0].octave = 12;
writeFileSync(tmp, JSON.stringify(bad));
await page.locator('input[type=file]').setInputFiles(tmp);
await page.waitForTimeout(100);
const toast = await page.locator('.toast.error').textContent();
check(/events\[0\]\.notes\[0\]\.octave/.test(toast ?? ''), `AC-13 invalid import rejected: ${toast}`);

// AC-2: settings
await page.getByRole('combobox', { name: 'Clef' }).selectOption('bass');
await page.getByLabel('Beats per measure').fill('3');
doc = await exportJson();
check(doc.composition.clef === 'bass' && doc.composition.timeSignature.beats === 3, 'AC-2 clef/time settings exported');
await shot('04-bass-3-4');

// Example + playback (AC-10)
await page.getByRole('button', { name: 'Load example' }).click();
await page.waitForTimeout(300);
await shot('05-example');
await page.getByRole('button', { name: 'Play' }).click();
await page.waitForTimeout(1200);
const playing = await page.locator('.playing').count();
await shot('06-playing');
await page.getByRole('button', { name: 'Pause' }).click();
check(playing > 0, 'AC-10 playback highlights the current event');
check((await page.getByRole('button', { name: 'Play' }).count()) === 1, 'AC-10 pause returns to Play');

// Narrow viewport
await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(200);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check(!overflow, 'no horizontal page scroll at phone width');
await shot('07-phone');

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
await server?.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
