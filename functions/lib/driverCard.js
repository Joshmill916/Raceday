// driverCard: the link preview for a driver's public Driven page.
//
// Facebook, Messenger and text apps don't run JavaScript when they build a link preview.
// They read the <meta property="og:..."> tags in the HTML the link returns. The public
// page (victoryraceday.com/d/?CODE) is a static GitHub Pages file, so every driver's link
// used to show the same generic preview. This module serves two things per driver code:
//
//   /d/CODE      a tiny HTML page with that driver's og:title/og:description/og:image,
//                which sends a person straight on to the real page at victoryraceday.com/d/?CODE
//   /d/CODE.png  a 1200x630 card image: photo, name, number, hometown, career stats
//
// Everything is read from the same PUBLIC paths the /d/ page reads over REST (no admin
// access needed, nothing private can leak): profiles_short/<CODE>, profiles/<id>/card,
// profileTracks/<id>, results/<trackId>. The card is drawn with satori (HTML/CSS layout to
// SVG) and rasterized with resvg. Pure helpers are exported for lib/driverCard.test.js.
const fs = require('fs');
const path = require('path');

const DB = 'https://raceday-d32dd-default-rtdb.firebaseio.com';
const SITE = 'https://victoryraceday.com';
const W = 1200, H = 630;

const C = { bg: '#0b0c10', panel: '#12141a', panel2: '#1a1d25', text: '#f5f6f8', mute: '#8f939d',
            brand: '#1f6fd6', plate: '#ffc400', blue: '#6892e4', red: '#ba453c' };

function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
function hex(v) { return /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : ''; }
function imgOK(src) { return typeof src === 'string' && src.length <= 80000 && /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(src); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function ord(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

// "/d/abc123.png" -> { code: "ABC123", image: true }. Same cleanup as /d/'s codeFromUrl().
function parseRequest(urlPath, query) {
  let raw = (query && (query.c || query.code)) || decodeURIComponent(String(urlPath || '').split('/').filter(Boolean).pop() || '');
  const image = /\.png$/i.test(raw) || !!(query && query.img);
  raw = raw.replace(/\.png$/i, '');
  return { code: raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), image };
}

async function get(p, fetchImpl) {
  try { const r = await (fetchImpl || fetch)(DB + '/' + p + '.json'); return r.ok ? await r.json() : null; }
  catch (e) { return null; }
}

// Career numbers from track-published results only (the verified ones /d/ calls "results").
function computeStats(rows) {
  const starts = rows.length;
  const wins = rows.filter(r => r.pos === 1).length;
  const top3 = rows.filter(r => r.pos >= 1 && r.pos <= 3).length;
  const best = rows.reduce((b, r) => (r.pos >= 1 && (b === 0 || r.pos < b) ? r.pos : b), 0);
  return { starts, wins, top3, best };
}

async function loadDriver(code, fetchImpl) {
  if (!/^[A-Z0-9]{4,20}$/.test(code)) return null;
  const profileId = await get('profiles_short/' + code, fetchImpl);
  if (typeof profileId !== 'string' || !/^prof_[a-z0-9]{6,20}$/i.test(profileId)) return null;
  const card = await get('profiles/' + profileId + '/card', fetchImpl);
  if (!card || typeof card !== 'object' || !str(card.name, 40)) return null;
  const tracks = await get('profileTracks/' + profileId, fetchImpl);
  const rows = [];
  if (tracks && typeof tracks === 'object') {
    for (const trackId of Object.keys(tracks).slice(0, 20)) {
      const byDate = await get('results/' + encodeURIComponent(trackId), fetchImpl);
      for (const date of Object.keys(byDate || {})) {
        for (const cls of Object.keys(byDate[date] || {})) {
          for (const row of Object.values(byDate[date][cls] || {})) {
            if (row && row.profileId === profileId && typeof row.position === 'number') rows.push({ date, pos: row.position });
          }
        }
      }
    }
  }
  return {
    code, profileId,
    name: str(card.name, 40).trim(),
    num: str(card.num, 8).trim(),
    hometown: str(card.hometown, 60).trim(),
    color: hex(card.teamColor) || C.brand,
    photo: imgOK(card.photo) ? card.photo : '',
    stats: computeStats(rows),
  };
}

// --- the image ---------------------------------------------------------------------
const h = (type, style, ...children) => ({ type, props: { style: Object.assign({ display: 'flex' }, style), children: children.flat().filter(c => c !== null && c !== undefined && c !== false) } });
const img = (src, style) => ({ type: 'img', props: { src, style } });

let fontsCache = null, logoCache = null;
function fonts() {
  if (!fontsCache) {
    const f = w => fs.readFileSync(path.join(__dirname, '..', 'assets', 'SairaCondensed-' + w + '.ttf'));
    fontsCache = [
      { name: 'Saira', data: f('SemiBold'), weight: 600, style: 'normal' },
      { name: 'Saira', data: f('Bold'), weight: 700, style: 'normal' },
      { name: 'Saira', data: f('ExtraBold'), weight: 800, style: 'normal' },
    ];
  }
  return fontsCache;
}
function logo() {
  if (!logoCache) logoCache = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(__dirname, '..', 'assets', 'logo-driven.svg')).toString('base64');
  return logoCache;
}

// Saira Condensed caps run about half an em wide; the name column is ~660px.
function nameSize(name) { return Math.max(48, Math.min(104, Math.floor(660 / (0.5 * Math.max(1, name.length))))); }

function cardTree(d) {
  const s = d.stats;
  const statBox = (label, value) => h('div', { flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 150, height: 112, background: C.panel2, borderRadius: 14, borderTop: '5px solid ' + d.color },
    h('div', { fontSize: 54, fontWeight: 800, color: C.text, lineHeight: 1 }, String(value)),
    h('div', { fontSize: 22, fontWeight: 700, color: C.mute, letterSpacing: 3, marginTop: 6 }, label));
  const stats = s.starts > 0
    ? h('div', { gap: 16, marginTop: 30 },
        statBox('STARTS', s.starts), statBox('WINS', s.wins), statBox('TOP 3', s.top3), statBox('BEST', s.best ? ord(s.best) : '—'))
    : h('div', { marginTop: 34, fontSize: 32, fontWeight: 700, color: C.mute, letterSpacing: 2 }, 'RESULTS POSTED BY THE TRACKS');

  const portrait = d.photo
    ? img(d.photo, { width: 330, height: 330, borderRadius: 165, border: '10px solid ' + d.color, objectFit: 'cover' })
    : h('div', { width: 330, height: 330, borderRadius: 165, border: '10px solid ' + d.color, background: C.panel2, alignItems: 'center', justifyContent: 'center' },
        h('div', { fontSize: d.num.length > 3 ? 110 : 150, fontWeight: 800, color: C.text }, d.num ? '#' + d.num : 'D'));

  return h('div', { width: W, height: H, background: C.bg, fontFamily: 'Saira', color: C.text, position: 'relative' },
    h('div', { position: 'absolute', left: 0, top: 0, width: 22, height: H, background: d.color }),
    h('div', { position: 'absolute', left: 22, top: 0, width: W - 22, height: 8, background: d.color, opacity: 0.35 }),
    h('div', { flexDirection: 'column', width: W, height: H, padding: '44px 64px 40px 86px' },
      h('div', { justifyContent: 'space-between', alignItems: 'center', height: 50 },
        img(logo(), { width: 236, height: 46 }),
        h('div', { fontSize: 26, fontWeight: 700, color: C.mute, letterSpacing: 4 }, 'DRIVER PROFILE')),
      h('div', { height: 446, alignItems: 'center', gap: 56 },
        portrait,
        h('div', { flexDirection: 'column', flexGrow: 1, flexShrink: 1 },
          d.num && d.photo ? h('div', { alignSelf: 'flex-start', background: C.plate, color: '#111', fontSize: 44, fontWeight: 800, padding: '0 22px', borderRadius: 10, lineHeight: 1.25 }, '#' + d.num) : null,
          h('div', { fontSize: nameSize(d.name), fontWeight: 800, lineHeight: 1, marginTop: d.num && d.photo ? 14 : 0, textTransform: 'uppercase' }, d.name),
          d.hometown ? h('div', { fontSize: 32, fontWeight: 600, color: C.mute, marginTop: 10 }, d.hometown) : null,
          stats)),
      h('div', { height: 50, justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 26, fontWeight: 700, color: C.mute, letterSpacing: 1 },
        h('div', {}, 'victoryraceday.com/d/?' + d.code),
        h('div', { color: C.text }, 'Free racing page for every driver'))));
}

async function renderPng(d) {
  const satori = require('satori').default || require('satori');
  const { Resvg } = require('@resvg/resvg-js');
  const svg = await satori(cardTree(d), { width: W, height: H, fonts: fonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
}

// --- the HTML ----------------------------------------------------------------------
function describe(d) {
  const s = d.stats, bits = [];
  if (s.starts) bits.push(s.starts + (s.starts === 1 ? ' start' : ' starts'));
  if (s.wins) bits.push(s.wins + (s.wins === 1 ? ' win' : ' wins'));
  if (s.top3) bits.push(s.top3 + ' top 3');
  const lead = d.hometown ? d.hometown + '. ' : '';
  return lead + (bits.length ? bits.join(' · ') + '. ' : '') + 'Race results posted by the tracks, on Driven.';
}

function pageHtml(d, selfBase) {
  const target = SITE + '/d/?' + encodeURIComponent(d.code);
  const title = d.name + (d.num ? ' #' + d.num : '') + ' | Driven';
  const image = selfBase + '/d/' + encodeURIComponent(d.code) + '.png?v=' + d.stats.starts;
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + esc(title) + '</title>'
    + '<meta name="description" content="' + esc(describe(d)) + '">'
    + '<meta property="og:type" content="profile">'
    + '<meta property="og:site_name" content="Driven">'
    + '<meta property="og:title" content="' + esc(title) + '">'
    + '<meta property="og:description" content="' + esc(describe(d)) + '">'
    + '<meta property="og:image" content="' + esc(image) + '">'
    + '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
    + '<meta property="og:image:alt" content="' + esc(title) + ' driver card">'
    + '<meta name="twitter:card" content="summary_large_image">'
    + '<meta http-equiv="refresh" content="0; url=' + esc(target) + '">'
    + '<script>location.replace(' + JSON.stringify(target) + ')</script>'
    + '</head><body style="background:#0b0c10;color:#f5f6f8;font-family:sans-serif">'
    + '<p><a style="color:#6892e4" href="' + esc(target) + '">Open ' + esc(d.name) + "'s Driven page</a></p></body></html>";
}

function fallbackHtml(code) {
  const target = SITE + '/d/' + (code ? '?' + encodeURIComponent(code) : '');
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Driven</title>'
    + '<meta property="og:title" content="Driven | racing results for every driver">'
    + '<meta property="og:image" content="' + SITE + '/img/share-driven.png">'
    + '<meta http-equiv="refresh" content="0; url=' + esc(target) + '"></head><body></body></html>';
}

module.exports = { parseRequest, computeStats, loadDriver, cardTree, renderPng, pageHtml, fallbackHtml, describe, W, H };
