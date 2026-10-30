// Copies the RaceDay web app into www/ for the native build. raceday/ stays the one
// source of truth — never edit www/ by hand. sw.js is left out on purpose: the native
// app ships its files inside the app, and index.html skips service-worker registration
// when it runs natively.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'raceday');
const out = join(here, '..', 'www');
const FILES = ['index.html', 'icon-rd.png', 'manifest.webmanifest'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of FILES) cpSync(join(src, f), join(out, f));
console.log('Copied ' + FILES.length + ' files from raceday/ to native/www/');
