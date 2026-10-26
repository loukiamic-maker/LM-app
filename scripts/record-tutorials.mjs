// Record captioned Greek walkthroughs of the real React UI using isolated
// HTTP fixtures. Requires Chromium, ffmpeg and Playwright recording support.
// Set PLAYWRIGHT_BROWSERS_PATH to a writable cache when installing its FFmpeg.
// The supplied video assets require no recording dependency at runtime.
import { spawn } from 'node:child_process';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { installTutorialFixtures, demoBooking, demoAlert, demoFuture } from './tutorial-fixtures.mjs';

const root = resolve(import.meta.dirname, '..');
const assets = resolve(root, 'public/tutorials');
const work = process.env.TUTORIAL_WORK_DIR || '/tmp/eneres-tutorial-recordings';
const origin = process.env.TUTORIAL_ORIGIN || 'http://127.0.0.1:5202';
const snapshot = resolve(work, 'site-snapshot');
const quick = process.argv.includes('--quick');
const audience = process.argv.find(value => value.startsWith('--audience='))?.split('=')[1];
// Reuse an installed local FFmpeg in a writable Playwright cache, avoiding a
// separate recording-binary download in restricted build environments.
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve(work, 'playwright-cache');
if (process.platform === 'linux' && existsSync('/usr/bin/ffmpeg')) {
  const registry = JSON.parse(await readFile(resolve(root, 'node_modules/playwright-core/browsers.json'), 'utf8'));
  const revision = registry.browsers.find(item => item.name === 'ffmpeg').revision;
  const directory = resolve(process.env.PLAYWRIGHT_BROWSERS_PATH, `ffmpeg-${revision}`);
  await mkdir(directory, { recursive: true });
  if (!existsSync(resolve(directory, 'ffmpeg-linux'))) await symlink('/usr/bin/ffmpeg', resolve(directory, 'ffmpeg-linux'));
}
const { chromium, expect } = await import('@playwright/test');
const delay = ms => new Promise(done => setTimeout(done, ms));
const run = (command, args) => new Promise((done, reject) => {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' }, stdio: ['ignore', 'ignore', 'pipe'] }); let error = '';
  child.stderr.on('data', chunk => { error += chunk; });
  child.on('error', reject); child.on('close', code => code ? reject(new Error(`${command} exited ${code}: ${error.slice(-2500)}`)) : done());
});
const assTime = seconds => { const total = Math.max(0, Math.round(seconds * 100)); return `${Math.floor(total / 360000)}:${String(Math.floor(total / 6000) % 60).padStart(2, '0')}:${String(Math.floor(total / 100) % 60).padStart(2, '0')}.${String(total % 100).padStart(2, '0')}`; };
const vttTime = seconds => { const total = Math.max(0, Math.round(seconds * 1000)); return `${String(Math.floor(total / 3600000)).padStart(2, '0')}:${String(Math.floor(total / 60000) % 60).padStart(2, '0')}:${String(Math.floor(total / 1000) % 60).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}`; };

async function login(page, email, showSignup = false) {
  await page.getByRole('button', { name: 'Το προφίλ μου', exact: true }).click();
  const panel = page.locator('.account-panel');
  if (showSignup) {
    await panel.locator('.account-switch').getByRole('button', { name: 'Δημιουργία λογαριασμού', exact: true }).click();
    await panel.getByLabel('Όνομα', { exact: true }).fill('Μαρία Παράδειγμα');
    await panel.locator('.phone-field select').selectOption('GR');
    await panel.locator('.phone-field input[type=tel]').fill('0000000000');
    await delay(1500);
    await panel.getByRole('button', { name: 'Έχω ήδη λογαριασμό', exact: true }).click();
  }
  await panel.getByLabel('Email', { exact: true }).fill(email);
  await panel.getByLabel(/^Κωδικός πρόσβασης/).fill('ExamplePassword-2026');
  await delay(500);
  await panel.getByRole('button', { name: 'Σύνδεση', exact: true }).click();
  await expect(panel.getByRole('heading', { name: /^Το προφίλ σας/ })).toBeVisible();
  await delay(700);
  await panel.getByRole('button', { name: 'Κλείσιμο λογαριασμού' }).click();
}

async function record(kind, browser) {
  const directory = resolve(work, kind); await mkdir(directory, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1, locale: 'el-GR', timezoneId: 'Europe/Athens', reducedMotion: 'reduce', recordVideo: { dir: directory, size: { width: 960, height: 600 } } });
  const state = await installTutorialFixtures(context, kind, origin);
  await context.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style'); style.textContent = '#tutorial-pointer{position:fixed;z-index:2147483647;pointer-events:none;width:25px;height:25px;border:3px solid #c96a3f;border-radius:50%;background:#f9dfbc38;transform:translate(-50%,-50%);transition:left .15s,top .15s;display:none}'; document.head.append(style);
      const pointer = document.createElement('i'); pointer.id = 'tutorial-pointer'; document.body.append(pointer);
      addEventListener('pointermove', event => { pointer.style.cssText = `left:${event.clientX}px;top:${event.clientY}px;display:block`; });
      addEventListener('pointerdown', () => { pointer.animate([{ scale: 1 }, { scale: 1.7 }, { scale: 1 }], { duration: 550 }); });
    });
  });
  const began = performance.now(); const page = await context.newPage(); const video = page.video(); const captions = [];
  const stage = async (title, text, action, duration = 8) => {
    const start = (performance.now() - began) / 1000;
    console.log(`${kind}: ${title}`);
    await action();
    const elapsed = (performance.now() - began) / 1000 - start;
    await delay(Math.max(0, (quick ? 1.2 : duration) - elapsed) * 1000);
    captions.push({ start, end: (performance.now() - began) / 1000, title, text });
  };
  await page.goto(origin); await page.locator('.category-grid').waitFor(); await page.evaluate(() => document.fonts.ready);
  if (kind === 'client') {
    await stage('1. Επιλέξτε υπηρεσία', 'Από τα εικονίδια, διαλέξτε τη φροντίδα που χρειάζεστε', async () => {
      await page.locator('.category-grid').scrollIntoViewIfNeeded(); await delay(700); await page.getByRole('button', { name: 'Μαλλιά', exact: true }).click();
    });
    await stage('2. Πόλη και ημερομηνία', 'Επιλέξτε την πόλη και την ημέρα σας και πατήστε «Αναζήτηση»', async () => {
      await page.getByRole('combobox', { name: 'Πόλη ή περιοχή' }).click(); await delay(800); await page.getByRole('option', { name: 'Αθήνα', exact: true }).click();
      await page.getByLabel('Ημερομηνία ραντεβού').fill(demoFuture()); await delay(600); await page.getByRole('button', { name: 'Αναζήτηση', exact: true }).click(); await page.locator('.salon-card').waitFor();
    });
    await stage('3. Λογαριασμός και επιβεβαιωμένο email', 'Στην εγγραφή δηλώστε κινητό με κωδικό χώρας. Επιβεβαιώστε το email και συνδεθείτε', async () => {
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await login(page, 'client@example.test', true);
    }, 9);
    await stage('4. Επιλέξτε την υπηρεσία του χώρου', 'Ανοίξτε τον χώρο, ελέγξτε την υπηρεσία και πατήστε «Συνέχεια»', async () => {
      await page.getByRole('button', { name: 'Δείτε υπηρεσίες στο Studio Παράδειγμα' }).click();
      const dialog = page.locator('.booking-dialog'); await dialog.getByRole('button', { name: /Κούρεμα & χτένισμα/ }).click(); await delay(900); await dialog.getByRole('button', { name: 'Συνέχεια', exact: true }).click();
    });
    await stage('5. Επαγγελματίας, ημέρα και ώρα', 'Οι ώρες που εμφανίζονται είναι διαθέσιμες. Επιλέξτε αυτή που σας εξυπηρετεί', async () => {
      const dialog = page.locator('.booking-dialog'); await dialog.getByRole('button', { name: /Ελένη Παράδειγμα/ }).click(); await delay(800); await dialog.getByRole('button', { name: /10:00/ }).click(); await delay(1000); await dialog.getByRole('button', { name: 'Συνέχεια στην επιβεβαίωση' }).click();
    });
    await stage('6. Κινητό και στοιχεία κράτησης', 'Επιλέξτε κωδικό χώρας και κινητό. Προσθέστε σημειώσεις και ελέγξτε την πολιτική ακύρωσης', async () => {
      const dialog = page.locator('.booking-dialog'); await dialog.locator('.phone-field select').selectOption('GR'); await delay(500); await dialog.locator('.phone-field input[type=tel]').fill('0000000000'); await dialog.getByLabel('Σημειώσεις για την επιχείρηση (προαιρετικό)').fill('Ενδεικτική σημείωση για την παρουσίαση'); await dialog.getByRole('checkbox').check();
    }, 9);
    await stage('7. Επιβεβαίωση και πληρωμή στο κατάστημα', 'Η κράτηση καταχωρίζεται στο ημερολόγιο του χώρου. Δεν χρειάζεται κάρτα στο Eneres', async () => {
      const dialog = page.locator('.booking-dialog'); await dialog.getByRole('button', { name: /Επιβεβαίωση ραντεβού/ }).click(); await expect(dialog.getByRole('heading', { name: /Το ραντεβού σας.*επιβεβαιώθηκε/ })).toBeVisible();
    });
    await stage('8. Τα ραντεβού σας, σε ένα μέρος', 'Δείτε την κράτησή σας. Αλλαγή ή ακύρωση γίνεται μέσα στην επιτρεπόμενη προθεσμία', async () => {
      await page.locator('.booking-dialog').getByRole('button', { name: 'Ολοκλήρωση', exact: true }).click();
      await page.locator('.desktop-nav').getByRole('button', { name: /Τα ραντεβού μου/ }).click(); await page.locator('.appointment-card').waitFor(); await delay(900); await page.getByRole('button', { name: 'Ακύρωση ραντεβού', exact: true }).click();
    });
  } else {
    await stage('1. Ο επαγγελματικός σας λογαριασμός', 'Συνδεθείτε και ανοίξτε την ενότητα «Για επαγγελματίες»', async () => {
      await login(page, 'owner@example.test'); await page.locator('.header-actions').getByRole('button', { name: /Για επαγγελματίες/ }).click(); await page.locator('.lb-sidebar').waitFor();
    }, 9);
    await stage('2. Στοιχεία, φωτογραφία και υπηρεσίες', 'Συμπληρώστε την επιχείρησή σας. Η φωτογραφία έχει προεπισκόπηση πριν από την αποθήκευση', async () => {
      await page.getByRole('navigation', { name: 'Διαχείριση επιχείρησης' }).getByRole('button', { name: 'Η επιχείρησή μου', exact: true }).click();
      const input = page.locator('input[type=file]'); await input.setInputFiles(resolve(assets, 'demo-salon.jpg')); await page.locator('.lb-photo-pending').scrollIntoViewIfNeeded();
    });
    await stage('3. Ομάδα και ωράριο', 'Προσθέστε επαγγελματίες και τις ώρες εργασίας τους πριν στείλετε τον χώρο για έγκριση', async () => {
      await page.getByRole('navigation', { name: 'Διαχείριση επιχείρησης' }).getByRole('button', { name: 'Ομάδα & ωράριο', exact: true }).click(); await page.locator('.lb-hours-editor').scrollIntoViewIfNeeded();
    });
    await stage('4. Ολόκληρη η ημέρα στο ημερολόγιο', 'Πορτοκαλί: από Eneres. Γαλάζιο: χειροκίνητα. Επιλέξτε κενή ώρα για νέα κράτηση', async () => {
      await page.getByRole('navigation', { name: 'Διαχείριση επιχείρησης' }).getByRole('button', { name: 'Ημερολόγιο', exact: true }).click(); await page.locator('.lb-calendar').scrollIntoViewIfNeeded(); await delay(900); await page.getByRole('button', { name: 'Νέο ραντεβού', exact: true }).click();
    });
    await stage('5. Καταχώριση χειροκίνητου ραντεβού', 'Υποχρεωτικά: όνομα, τηλέφωνο, υπηρεσία, τιμή, επαγγελματίας, ημερομηνία και ώρα', async () => {
      const dialog = page.getByRole('dialog'); await dialog.getByLabel('Όνομα πελάτη', { exact: true }).fill('Άννα Παράδειγμα'); await dialog.getByLabel('Τηλέφωνο πελάτη').fill('+30 000 000 0000'); await dialog.getByLabel('Ώρα', { exact: true }).fill('15:00'); await dialog.getByRole('button', { name: 'Προσθήκη ραντεβού', exact: true }).click();
    }, 9);
    await stage('6. Νέα κράτηση από το Eneres', 'Η online κράτηση μπαίνει αυτόματα στο ημερολόγιο και εμφανίζεται στις ειδοποιήσεις', async () => {
      const entry = demoBooking({ name: 'Σοφία Παράδειγμα', hour: 11, minute: 15 }); state.bookings.push(entry); state.alerts.unshift(demoAlert(entry));
      await page.evaluate(() => { scrollTo({ top: 0, behavior: 'instant' }); dispatchEvent(new Event('focus')); }); await page.getByRole('button', { name: 'Ειδοποιήσεις κρατήσεων', exact: true }).click(); await page.getByRole('button', { name: 'Λεπτομέρειες κράτησης Σοφία Παράδειγμα', exact: true }).click();
    });
    await stage('7. Κινητό πελάτη και «Η κράτηση σημειώθηκε»', 'Ανοίξτε τα στοιχεία και τις σημειώσεις. Σημειώστε ότι ενημερωθήκατε για τη νέα κράτηση', async () => {
      const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Η κράτηση σημειώθηκε', exact: true }).click(); await delay(900); await dialog.getByRole('button', { name: 'Ακύρωση κράτησης', exact: true }).click(); await dialog.getByLabel('Λόγος ακύρωσης', { exact: true }).fill('Ενδεικτική αλλαγή προγράμματος για την παρουσίαση');
    }, 9);
    await stage('8. Ακύρωση με αιτιολογία και ιστορικό', 'Η ακύρωση καταγράφεται στο ιστορικό και αποδεσμεύει την ώρα. Ο πελάτης βλέπει τον λόγο', async () => {
      const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Επιβεβαίωση ακύρωσης', exact: true }).click(); await delay(1000); await dialog.getByRole('button', { name: 'Κλείσιμο λεπτομερειών κράτησης', exact: true }).click();
    });
  }
  if (state.unexpected.length) throw new Error(`Unmocked tutorial calls: ${state.unexpected.join(', ')}`);
  await page.close(); const file = await video.path(); await context.close();
  const subtitle = resolve(directory, 'captions.ass');
  const header = '[Script Info]\nScriptType: v4.00+\nPlayResX: 960\nPlayResY: 720\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Noto Sans,23,&H002E333A,&H002E333A,&H00F7F3ED,&H00F7F3ED,0,0,0,0,100,100,0,0,1,0,0,2,35,35,22,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  const slash = String.fromCharCode(92);
  const lines = captions.map(caption => `Dialogue: 0,${assTime(caption.start)},${assTime(caption.end)},Default,,0,0,0,,{${slash}b1${slash}c&H3858B5&}${caption.title}{${slash}r}${slash}N${caption.text}`);
  await writeFile(subtitle, header + lines.join('\n') + '\n');
  const vtt = 'WEBVTT\n\n' + captions.map((caption, index) => `${index + 1}\n${vttTime(caption.start)} --> ${vttTime(caption.end)}\n${caption.title}\n${caption.text}\n`).join('\n');
  await writeFile(resolve(assets, `eneres-${kind}-guide-el.vtt`), vtt);
  await writeFile(resolve(directory, 'timing.json'), JSON.stringify(captions, null, 2));
  const output = resolve(assets, `eneres-${kind}-guide-el.mp4`);
  await run('ffmpeg', ['-y', '-i', file, '-vf', `pad=960:720:0:0:color=0xf7f3ed,subtitles=${subtitle}:fontsdir=/usr/share/fonts/truetype/noto,drawtext=fontfile=/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf:text='ΠΑΡΟΥΣΙΑΣΗ ΜΕ ΕΝΔΕΙΚΤΙΚΑ ΣΤΟΙΧΕΙΑ · ΧΩΡΙΣ ΗΧΟ':fontsize=10:fontcolor=0x96836d:x=(w-tw)/2:y=h-13,scale=in_range=pc:out_range=tv,format=yuv420p`, '-an', '-color_range', 'tv', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '24', '-movflags', '+faststart', '-metadata', `title=Eneres — ${kind === 'client' ? 'Οδηγός για πελάτες' : 'Οδηγός για επιχειρήσεις'}`, output]);
  await run('ffmpeg', ['-y', '-ss', '4', '-i', output, '-frames:v', '1', '-q:v', '3', resolve(assets, `eneres-${kind}-guide-el.jpg`)]);
  console.log(`Created ${output}`);
}

await mkdir(assets, { recursive: true }); await mkdir(work, { recursive: true });
await run('ffmpeg', ['-y', '-i', resolve(root, 'public/images/beauty-grid.png'), '-vf', 'crop=362:362:0:724,scale=724:724', '-frames:v', '1', '-q:v', '3', resolve(assets, 'demo-salon.jpg')]);
// Freeze the UI before recording so source edits or Vite HMR cannot reset a
// booking midway through a long tutorial. Recordings use this local build only.
await run('npm', ['run', 'build', '--', '--base=/', `--outDir=${snapshot}`, '--emptyOutDir']);
let server;
try { const response = await fetch(origin); if (!response.ok) throw new Error(); }
catch { server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', new URL(origin).port, '--strictPort', `--outDir=${snapshot}`], { cwd: root, stdio: 'ignore' }); }
let browser;
try {
  for (let index = 0; index < 80; index++) { try { if ((await fetch(origin)).ok) break; } catch {} await delay(100); }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  await Promise.all((audience ? [audience] : ['client', 'business']).map(kind => record(kind, browser)));
} finally { if (browser) await browser.close(); if (server) server.kill('SIGTERM'); }
