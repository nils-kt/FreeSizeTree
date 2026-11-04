'use strict';

/* =====================================================================
   Bridge to the C# host
   ===================================================================== */
const hasHost = !!(window.chrome && chrome.webview);
const pending = new Map();
const listeners = {};
let seq = 0;

function api(cmd, args = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    chrome.webview.postMessage({ id, cmd, args });
  });
}
function on(ev, fn) { (listeners[ev] ||= []).push(fn); }
if (hasHost) {
  chrome.webview.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'reply') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
    } else if (m.type === 'event') {
      (listeners[m.ev] || []).forEach(f => f(m.data));
    }
  });
}

/* =====================================================================
   State & helpers
   ===================================================================== */
const MB = 1024 ** 2, GB = 1024 ** 3, DAY = 86400000;
const S = {
  page: 'overview', tok: 0, admin: false, drives: [], recycle: { size: 0, count: 0 },
  summary: null, scanning: false, fullScan: false, progress: null, scanPath: '',
  nodeId: null, node: null, chartData: null, chartMode: 'sunburst', query: '', showAll: false, rows: [],
  hints: null, hintFilter: 'all', busyHints: new Set(),
  games: null, gameFilter: 'Alle', gameSort: 'size', staleOnly: false,
  apps: null, appSort: 'size', appQuery: '',
  files: null, fileFilter: 'all', fileExt: null, fileQuery: '',
  types: null, dupes: null, dupesBusy: false, dupesProg: null, dupeMin: 100 * MB, deleted: new Set(),
};
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => (n ?? 0).toLocaleString('de-DE');
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const joinPath = (dir, name) => dir.endsWith('\\') ? dir + name : dir + '\\' + name;

function size(b) {
  if (b == null || isNaN(b)) return '–';
  if (b < 1024) return Math.round(b) + ' B';
  const u = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = b, i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return v.toLocaleString('de-DE', { maximumFractionDigits: v >= 100 ? 0 : v >= 10 ? 1 : 2 }) + ' ' + u[i];
}
function sizeParts(b) { const s = size(b).split(' '); return { v: s[0], u: s[1] || '' }; }
const pctFmt = p => (p >= 10 ? Math.round(p) : p.toFixed(1).replace('.', ',')) + ' %';
const date = ms => ms ? new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';
const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
function ago(ms) {
  if (!ms) return 'unbekannt';
  const d = (Date.now() - ms) / DAY;
  if (d < 1) return 'heute';
  if (d < 30) return rtf.format(-Math.round(d), 'day');
  if (d < 365) return rtf.format(-Math.round(d / 30.4), 'month');
  return rtf.format(-Math.round(d / 365), 'year');
}
function hashHue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
function initials(s) { return s.replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'; }

const HUES = [262, 196, 328, 152, 30, 222, 288, 48, 172, 352, 240, 95];
const hueAt = i => HUES[i % HUES.length];
const topColor = h => `hsl(${h} 80% 66%)`;

const TYPE_GROUPS = [
  { c: '#f472b6', label: 'Video', ext: ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.wmv', '.m4v'] },
  { c: '#34d399', label: 'Bild', ext: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.psd', '.raw', '.cr2', '.nef', '.heic', '.tif', '.tiff', '.bmp', '.exr'] },
  { c: '#fbbf24', label: 'Audio', ext: ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.bnk', '.wem'] },
  { c: '#fb923c', label: 'Archiv', ext: ['.zip', '.7z', '.rar', '.tar', '.gz', '.xz', '.cab'] },
  { c: '#60a5fa', label: 'Disk', ext: ['.iso', '.img', '.vhd', '.vhdx', '.vmdk', '.qcow2', '.dmp'] },
  { c: '#a78bfa', label: 'Programm', ext: ['.exe', '.msi', '.dll', '.sys', '.msix', '.appx'] },
  { c: '#e879f9', label: 'KI-Modell', ext: ['.gguf', '.safetensors', '.ckpt', '.pt', '.pth', '.onnx', '.bin'] },
  { c: '#fb7185', label: 'Spieldaten', ext: ['.pak', '.rpf', '.uasset', '.ubulk', '.forge', '.vpk', '.big', '.wad', '.ucas', '.utoc', '.arc'] },
  { c: '#22d3ee', label: 'Dokument', ext: ['.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.md', '.csv', '.db', '.sqlite', '.vscdb', '.sqlite3'] },
];
const typeColor = ext => (TYPE_GROUPS.find(g => g.ext.includes(ext)) || { c: '#94a3b8' }).c;

const LAUNCHERS = {
  Steam: '#66c0f4', Epic: '#e5e7eb', EA: '#ff5a5a', Rockstar: '#fcaf17', Xbox: '#4ade80', GOG: '#c084fc',
  Ubisoft: '#60a5fa', 'Battle.net': '#38bdf8', Riot: '#ff4655', Amazon: '#ff9900',
};

/* =====================================================================
   Icons (stroke, 24x24)
   ===================================================================== */
const ICONS = {
  home: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
  pie: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15.5 3.7A9 9 0 0 1 20.3 8.5H15.5z"/>',
  sparkles: '<path d="M12 3l1.9 4.9L19 9.8l-5.1 1.9L12 17l-1.9-5.3L5 9.8l5.1-1.9z"/><path d="M19 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  gamepad: '<rect x="2" y="6" width="20" height="12" rx="6"/><path d="M6.5 12h4M8.5 10v4"/><circle cx="15.5" cy="11" r=".9" fill="currentColor"/><circle cx="18" cy="13.5" r=".9" fill="currentColor"/>',
  package: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/>',
  shapes: '<circle cx="7" cy="7" r="4"/><rect x="13" y="3" width="8" height="8" rx="1.6"/><path d="M7 13l4.5 8h-9z"/><circle cx="17" cy="17" r="4"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  drive: '<rect x="2.5" y="13" width="19" height="8" rx="2"/><path d="M5 13l2.6-8h8.8L19 13"/><circle cx="17.5" cy="17" r=".9" fill="currentColor"/>',
  trash: '<path d="M3 6h18M8.5 6V4h7v2M5.5 6l1 14a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6"/>',
  external: '<path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6L20.5 8.5"/><path d="M20.5 3.5v5h-5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  up: '<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  zap: '<path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
  brain: '<path d="M9 4.5a3 3 0 0 0-3 3v.3A3.5 3.5 0 0 0 4 14a3.5 3.5 0 0 0 3 3.5A3 3 0 0 0 12 19V6.5A2.5 2.5 0 0 0 9 4.5z"/><path d="M15 4.5a3 3 0 0 1 3 3v.3a3.5 3.5 0 0 1 2 6.2 3.5 3.5 0 0 1-3 3.5A3 3 0 0 1 12 19"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M12 3v18M12 12.5h9"/>',
  store: '<path d="M4 9l1.5-5h13L20 9M4 9h16v10.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5zM9 13h6"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  folderOpen: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7a2 2 0 0 1 2 2v1.5"/><path d="M3 18.5l2.6-6.6A2 2 0 0 1 7.5 10.5H21l-3 8.5H4z"/>',
  dots: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
};
const icon = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;
const extBadge = ext => esc((ext || '').replace('.', '').slice(0, 4) || 'file');

/* =====================================================================
   Shell: navigation, scan bar, tooltip, menu, dialogs, toasts
   ===================================================================== */
const PAGES = [
  { id: 'overview', label: 'Übersicht', icon: 'home' },
  { id: 'explorer', label: 'Explorer', icon: 'pie', scan: true },
  { id: 'cleanup', label: 'Aufräumen', icon: 'sparkles', scan: true },
  { id: 'games', label: 'Spiele', icon: 'gamepad' },
  { id: 'apps', label: 'Programme', icon: 'package' },
  { id: 'files', label: 'Große Dateien', icon: 'file', scan: true },
  { id: 'dupes', label: 'Duplikate', icon: 'copy', scan: true },
  { id: 'types', label: 'Dateitypen', icon: 'shapes', scan: true },
];

function renderNav() {
  const badge = id => {
    if (id === 'cleanup' && S.summary) return `<span class="badge hot">${size(S.summary.reclaim.safe + S.summary.reclaim.tool)}</span>`;
    if (id === 'games' && S.games) return `<span class="badge">${size(sum(S.games, gameTotal))}</span>`;
    if (id === 'apps' && S.apps) return `<span class="badge">${S.apps.length}</span>`;
    return '';
  };
  $('#navlist').innerHTML = PAGES.map(p => `
    <button class="nav-item ${S.page === p.id ? 'active' : ''} ${p.scan && !S.summary ? 'disabled' : ''}" data-act="nav" data-page="${p.id}">
      ${icon(p.icon, 19)}<span class="lbl">${p.label}</span>${badge(p.id)}
    </button>`).join('');
  $('#navfoot').innerHTML = `
    <div class="foot-card">${icon('trash', 18)}<div class="grow">Papierkorb<br><b>${S.recycle.count ? size(S.recycle.size) : 'leer'}</b></div>
      ${S.recycle.count ? `<button class="btn sm" data-act="emptyRecycle">Leeren</button>` : ''}</div>
    ${S.admin
      ? `<div class="foot-card" style="color:var(--green)">${icon('shield', 18)}<div class="grow"><b style="color:var(--green)">Administrator</b><br>Voller Zugriff</div></div>`
      : `<div class="foot-card">${icon('shield', 18)}<div class="grow">Eingeschränkt<br><b>Kein Admin</b></div><button class="btn sm" data-act="elevate" title="Als Administrator neu starten – zählt auch geschützte Systemordner">Admin</button></div>`}`;
}

function go(page, opts = {}) {
  const p = PAGES.find(x => x.id === page) || PAGES[0];
  if (p.scan && !S.summary && !opts.force) page = 'overview';
  S.page = page;
  renderNav();
  render();
}

async function render() {
  const tok = ++S.tok;
  hideMenu(); hideTip(); chartStop();
  view.className = '';
  view.scrollTop = 0;
  const fn = { overview: pageOverview, explorer: pageExplorer, cleanup: pageCleanup, games: pageGames, apps: pageApps, files: pageFiles, dupes: pageDupes, types: pageTypes }[S.page];
  try { await fn(tok); }
  catch (e) {
    if (tok === S.tok) view.innerHTML = `<div class="empty"><div class="big-ico">${icon('alert', 34)}</div><h3>Das hat nicht geklappt</h3><p>${esc(e.message)}</p></div>`;
  }
}
const loading = (msg = 'Lade …') => { view.innerHTML = `<div class="loading"><div class="spinner"></div>${esc(msg)}</div>`; };

function updateScanbar() {
  const bar = $('#scanbar'), p = S.progress;
  bar.classList.toggle('on', S.scanning);
  bar.classList.toggle('indet', S.scanning && (!p || p.pct < 0));
  if (p && p.pct >= 0) bar.firstElementChild.style.width = (p.pct * 100).toFixed(1) + '%';
}

// tooltip
const tip = $('#tooltip');
function showTip(x, y, html) {
  tip.innerHTML = html;
  tip.classList.add('on');
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(x + 16, innerWidth - r.width - 10) + 'px';
  tip.style.top = Math.min(y + 18, innerHeight - r.height - 10) + 'px';
}
function hideTip() { tip.classList.remove('on'); }

// context menu
const menu = $('#menu');
let menuItems = [];
function showMenu(x, y, title, items) {
  menuItems = items.filter(Boolean);
  menu.innerHTML = (title ? `<div class="mh">${esc(title)}</div>` : '') + menuItems.map((it, i) => it === '-' ? '<hr>' :
    `<button data-mi="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>${icon(it.icon || 'dots', 16)}${esc(it.label)}</button>`).join('');
  menu.classList.add('on');
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
}
function hideMenu() { menu.classList.remove('on'); }
menu.addEventListener('click', e => {
  const b = e.target.closest('[data-mi]');
  if (!b) return;
  hideMenu();
  menuItems[+b.dataset.mi].fn();
});

// dialogs
function dialog({ title, body = '', ic = 'alert', danger = false, buttons }) {
  return new Promise(resolve => {
    const m = $('#modal');
    m.innerHTML = `<div class="dialog ${danger ? 'danger' : ''}"><div class="dico">${icon(ic, 24)}</div><h2>${esc(title)}</h2>
      <div class="body">${body}</div><div class="btns">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-bi="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    m.classList.add('on');
    // Guard against confirming by accident: focus the cancel button and ignore
    // confirmations that arrive right after opening (double clicks, stray Enter).
    const opened = performance.now();
    const close = v => { m.classList.remove('on'); m.innerHTML = ''; document.removeEventListener('keydown', key); resolve(v); };
    const key = e => { if (e.key === 'Escape') close(null); };
    m.onclick = e => {
      const b = e.target.closest('[data-bi]');
      if (b) {
        const value = buttons[+b.dataset.bi].value;
        if (value && performance.now() - opened < 500) return;
        close(value);
      } else if (e.target === m) close(null);
    };
    document.addEventListener('keydown', key);
    const cancel = buttons.findIndex(b => !b.value);
    m.querySelector(`[data-bi="${cancel >= 0 ? cancel : buttons.length - 1}"]`)?.focus();
  });
}
const CANCEL = { label: 'Abbrechen', value: null, cls: 'ghost' };

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<div class="ti">${icon(kind === 'err' ? 'alert' : kind === 'info' ? 'zap' : 'check', 17)}</div><div>${esc(msg)}</div>`;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, kind === 'err' ? 6500 : 4200);
}

function animateNumber(el, to, fmt = size, ms = 1100) {
  if (!el) return;
  const t0 = performance.now();
  const step = t => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.innerHTML = fmt(to * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const bigSize = b => { const p = sizeParts(b); return `${p.v}<small> ${p.u}</small>`; };

function ring(p, id, sz = 74, sw = 8) {
  const r = (sz - sw) / 2, c = 2 * Math.PI * r;
  const col = p > .9 ? ['#f87171', '#fb923c'] : p > .75 ? ['#fbbf24', '#f97316'] : ['#a78bfa', '#22d3ee'];
  return `<div class="ring"><svg viewBox="0 0 ${sz} ${sz}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${col[0]}"/><stop offset="1" stop-color="${col[1]}"/></linearGradient></defs>
    <circle class="track" cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke-width="${sw}"/>
    <circle class="val" cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="url(#${id})" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${c * (1 - p)}"/></svg>
    <span>${Math.round(p * 100)}%</span></div>`;
}
function playRings() { requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll('.ring .val').forEach(c => c.style.strokeDashoffset = c.dataset.off))); }

function needScan(text = 'Für diese Ansicht muss zuerst ein Laufwerk gescannt werden.') {
  view.innerHTML = `<div class="page empty"><div class="big-ico">${icon('drive', 34)}</div><h3>Noch kein Scan</h3><p>${esc(text)}</p>
    <div class="head-actions" style="justify-content:center;margin-top:18px">${S.drives.map(d => `<button class="btn ${d.system ? 'primary' : ''}" data-act="scan" data-path="${esc(d.path)}">${icon('drive', 16)}${esc(d.path)} scannen</button>`).join('')}</div></div>`;
}

/* =====================================================================
   Page: overview
   ===================================================================== */
async function pageOverview() {
  const s = S.summary;
  const drives = S.drives.map((d, i) => {
    const used = d.total - d.free, p = d.total ? used / d.total : 0;
    const current = s && s.path.toUpperCase().startsWith(d.path.toUpperCase());
    return `<div class="card drive ${current ? 'current' : ''}">${ring(p, 'rg' + i)}
      <div class="dinfo"><div class="dname">${esc(d.path.replace('\\', ''))} <small>${esc(d.label || (d.system ? 'System' : d.type))}</small></div>
        <div class="dsub">${size(used)} von ${size(d.total)} · <b style="color:var(--text)">${size(d.free)}</b> frei</div>
        <button class="btn sm ${current ? '' : 'primary'}" data-act="scan" data-path="${esc(d.path)}" ${S.scanning ? 'disabled' : ''}>${icon(current ? 'refresh' : 'search', 15)}${current ? 'Neu scannen' : 'Scannen'}</button></div></div>`;
  }).join('');

  let body = '';
  if (S.scanning && S.fullScan) body = scanPanel();
  else if (s) body = resultHtml(s);
  else body = welcomeHtml();

  view.innerHTML = `<div class="page">
    <div class="page-head"><div class="grow"><h1>${s ? 'Übersicht' : 'Willkommen'}</h1><p>${s ? `Zuletzt gescannt: <b>${esc(s.path)}</b>${s.cancelled ? ' (abgebrochen – Teilergebnis)' : ''}` : 'Finde heraus, was deine Festplatten füllt – und räume in Minuten auf.'}</p></div>
      <div class="head-actions"><button class="btn" data-act="pickFolder" ${S.scanning ? 'disabled' : ''}>${icon('folderOpen', 16)}Ordner scannen …</button></div></div>
    <div class="drives">${drives}</div>${body}</div>`;
  playRings();
  if (S.scanning && S.fullScan) updateScanPanel();
  if (!S.scanning && s) {
    animateNumber($('#reclaimNum'), s.reclaim.safe + s.reclaim.tool, bigSize);
    requestAnimationFrame(() => document.querySelectorAll('.stack i').forEach(i => i.style.width = i.dataset.w));
  }
}

function welcomeHtml() {
  const f = [
    ['pie', 'Visualisieren', 'Sunburst & Treemap zeigen sofort, wo der Platz hingeht.'],
    ['sparkles', 'Aufräumen', 'Caches, Temp-Dateien, node_modules & Co. mit einem Klick.'],
    ['gamepad', 'Spiele', 'Steam, Epic, EA, Rockstar, Xbox … mit Größe & letzter Spielzeit.'],
    ['copy', 'Duplikate', 'Doppelte Dateien finden und gezielt entfernen.'],
  ];
  return `<div class="card welcome glow"><div class="big-ico" style="width:84px;height:84px">${icon('drive', 40)}</div>
    <h2>Wähle oben ein Laufwerk zum Scannen</h2><p>Der Scan liest alle Ordner parallel ein – meist dauert das nur ein bis zwei Minuten. Danach siehst du genau, was sich lohnt zu löschen.</p>
    <div class="feature-row">${f.map(([i, t, d]) => `<div class="feature"><div class="fi">${icon(i, 18)}</div><b>${t}</b><span>${d}</span></div>`).join('')}</div></div>`;
}

function scanPanel() {
  return `<div class="card scan-panel glow" id="scanPanel">
    <div class="orbit"><svg viewBox="0 0 150 150"><defs><linearGradient id="og" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
      <circle cx="75" cy="75" r="64" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="10"/>
      <circle id="spRing" class="val" cx="75" cy="75" r="64" fill="none" stroke="url(#og)" stroke-width="10" stroke-linecap="round" stroke-dasharray="402" stroke-dashoffset="402"/></svg>
      <span id="spPct">…</span></div>
    <div><div class="scan-title"><i class="live-dot"></i>Scanne ${esc(S.scanPath)}</div>
      <div class="scan-stats"><div class="k">Dateien</div><div class="k">Ordner</div><div class="k">Größe</div>
        <div class="v" id="spFiles">0</div><div class="v" id="spDirs">0</div><div class="v" id="spBytes">0 B</div>
        <div class="scan-path mono ellipsis" id="spPath"></div></div></div>
    <button class="btn danger" data-act="cancelScan">${icon('stop', 14)}Stopp</button></div>`;
}

function updateScanPanel() {
  const p = S.progress;
  if (!p || !$('#scanPanel')) return;
  $('#spFiles').textContent = num(p.files);
  $('#spDirs').textContent = num(p.dirs);
  $('#spBytes').textContent = size(p.bytes);
  $('#spPath').textContent = p.current;
  const ring = $('#spRing'), pct = $('#spPct');
  if (p.pct >= 0) {
    ring.classList.remove('spin');
    ring.style.strokeDashoffset = 402 * (1 - p.pct);
    pct.textContent = Math.round(p.pct * 100) + '%';
  } else {
    ring.classList.add('spin');
    ring.style.strokeDashoffset = 300;
    pct.textContent = Math.round(p.elapsed) + ' s';
  }
}

function resultHtml(s) {
  const r = s.reclaim, total = r.safe + r.tool + r.review || 1;
  const w = v => (v / total * 100).toFixed(1) + '%';
  const topMax = s.top[0]?.size || 1;
  const topFolders = s.top.map((t, i) => `<div class="mini-row" data-act="openNode" data-id="${t.id}">
      <div class="t">${icon('folder', 16)}<span class="ellipsis">${esc(t.name)}</span></div><div class="sz">${size(t.size)}</div>
      <div class="bar" style="--c:${topColor(hueAt(i))}"><i style="width:${(t.size / topMax * 100).toFixed(1)}%"></i></div></div>`).join('');
  const covers = S.games?.length ? [...S.games].sort((a, b) => b.size - a.size).slice(0, 5).map(g =>
    `<div class="cv" data-act="nav" data-page="games" title="${esc(g.name)} – ${size(g.size)}" style="background:linear-gradient(160deg,hsl(${hashHue(g.name)} 55% 32%),hsl(${hashHue(g.name) + 40} 50% 14%))">
      <span class="cv-name">${esc(g.name)}</span>${g.image ? `<img src="${g.image}" data-alt="${steamCdn(g)}" onerror="artFail(this)">` : ''}<b>${size(g.size)}</b></div>`).join('') : '';
  const warn = s.errors > 0 && !S.admin ? `<div class="card tile warn">${icon('shield', 22)}<div class="grow"><b>${num(s.errors)} Ordner ohne Zugriff</b><div class="s">Als Administrator werden auch Systemordner und andere Benutzerprofile mitgezählt.</div></div><button class="btn sm" data-act="elevate">Als Admin neu starten</button></div>` : '';
  return `
    <div class="hero">
      <div class="card reclaim glow"><div class="k">Freigebbarer Speicher</div>
        <div class="bignum" id="reclaimNum">0</div>
        <div class="muted"><b style="color:var(--green)">${size(r.safe)}</b> sicher löschbar · ${s.hintCount} Tipps gefunden</div>
        <div class="stack"><i data-w="${w(r.quick)}" style="width:0;background:var(--green)"></i><i data-w="${w(r.safe - r.quick)}" style="width:0;background:var(--teal)"></i><i data-w="${w(r.tool)}" style="width:0;background:var(--blue)"></i><i data-w="${w(r.review)}" style="width:0;background:var(--amber)"></i></div>
        <div class="legend"><span><i style="--c:var(--green)"></i>Caches & Temp <b>${size(r.quick)}</b></span><span><i style="--c:var(--teal)"></i>Build-Ordner & Co. <b>${size(r.safe - r.quick)}</b></span><span><i style="--c:var(--blue)"></i>Mit Windows-Tool <b>${size(r.tool)}</b></span><span><i style="--c:var(--amber)"></i>Prüfen <b>${size(r.review)}</b></span></div>
        <div class="acts"><button class="btn primary lg" data-act="quickClean">${icon('sparkles', 18)}${quickLabel(r)}</button><button class="btn lg" data-act="nav" data-page="cleanup">Alle Tipps ansehen</button></div></div>
      <div class="tiles">
        <div class="card tile"><div class="k">${icon('drive', 15)}Gescannt</div><div class="v">${size(s.size)}</div><div class="s">${esc(s.path)}</div></div>
        <div class="card tile"><div class="k">${icon('clock', 15)}Dauer</div><div class="v">${s.seconds.toFixed(1).replace('.', ',')} s</div><div class="s">${num(Math.round(s.files / Math.max(s.seconds, .1)))} Dateien/s</div></div>
        <div class="card tile"><div class="k">${icon('file', 15)}Dateien</div><div class="v">${num(s.files)}</div><div class="s">${s.cloud ? size(s.cloud) + ' nur in der Cloud' : 'alle lokal'}</div></div>
        <div class="card tile"><div class="k">${icon('folder', 15)}Ordner</div><div class="v">${num(s.dirs)}</div><div class="s">${s.drive ? size(s.drive.free) + ' frei auf ' + esc(s.drive.path) : ''}</div></div>
        ${warn}
      </div>
    </div>
    <div class="grid2" style="margin-top:14px">
      <div class="card pad"><div class="card-head"><h3>Größte Ordner</h3><button class="btn sm ghost" data-act="nav" data-page="explorer">Explorer ${icon('external', 14)}</button></div><div class="mini-list">${topFolders}</div></div>
      <div class="card pad"><div class="card-head"><h3>Spiele</h3><button class="btn sm ghost" data-act="nav" data-page="games">Alle ${icon('external', 14)}</button></div>
        ${covers ? `<div class="covers">${covers}</div><div class="muted" style="margin-top:12px">${S.games.length} Spiele belegen <b style="color:var(--text)">${size(sum(S.games, gameTotal))}</b></div>` : `<div class="muted">Spiele werden gesucht …</div>`}</div>
    </div>`;
}

/* =====================================================================
   Page: explorer (sunburst / treemap + list)
   ===================================================================== */
async function pageExplorer(tok) {
  if (!S.summary) return needScan();
  let node;
  try { node = await api('node', { id: S.nodeId ?? S.summary.rootId }); }
  catch { S.nodeId = S.summary.rootId; node = await api('node', { id: S.nodeId }); }
  const data = await api('chart', { id: node.id });
  if (tok !== S.tok) return;
  S.node = node; S.nodeId = node.id; S.chartData = data;

  // color per top-level element, shared by chart and list
  S.colorById = new Map();
  (data.c || []).forEach((c, i) => { if (c.t !== 'o') S.colorById.set(c.i, topColor(hueAt(i))); });

  const crumbs = node.crumbs.map((c, i) => i === node.crumbs.length - 1
    ? `<span class="crumb last" title="${esc(node.path)}">${esc(c.name)}</span>`
    : `<span class="crumb" data-act="openNode" data-id="${c.id}">${esc(c.name)}</span><span class="sep">›</span>`).join('');

  view.className = 'fill';
  view.innerHTML = `<div class="page" style="display:flex;flex-direction:column;flex:1;min-height:0">
    <div class="page-head" style="margin-bottom:16px"><div class="grow"><div class="crumbs">${crumbs}</div>
      <p>${size(node.size)} · ${num(node.files)} Dateien · ${num(node.dirs)} Ordner${node.denied ? ' · <span style="color:var(--red)">kein Zugriff</span>' : ''}</p></div>
      <div class="head-actions">
        <div class="search">${icon('search', 16)}<input id="q" placeholder="In diesem Ordner filtern" value="${esc(S.query)}"></div>
        <div class="seg"><button class="${S.chartMode === 'sunburst' ? 'on' : ''}" data-act="chartMode" data-mode="sunburst">${icon('pie', 15)}Sunburst</button><button class="${S.chartMode === 'treemap' ? 'on' : ''}" data-act="chartMode" data-mode="treemap">${icon('grid', 15)}Treemap</button></div>
        <button class="btn icon" data-act="up" title="Übergeordneter Ordner (Rücktaste)" ${node.parentId < 0 ? 'disabled' : ''}>${icon('up', 17)}</button>
        <button class="btn icon" data-act="rescanNode" title="Diesen Ordner neu scannen">${icon('refresh', 17)}</button>
        <button class="btn icon" data-act="reveal" data-path="${esc(node.path)}" title="Im Explorer öffnen">${icon('external', 16)}</button>
      </div></div>
    <div class="explorer">
      <div class="card chart-card"><div class="chart-wrap" id="chartWrap"><div class="chart-center" id="chartCenter"></div></div>
        <div class="chart-foot"><span class="grow">${S.chartMode === 'sunburst' ? 'Klick = hineinzoomen · Mitte = zurück · Rechtsklick = Aktionen' : 'Klick = hineinzoomen · Rechtsklick = Aktionen'}</span></div></div>
      <div class="card list-card"><div class="list-head"><span>Name</span><span>Anteil</span><span style="text-align:right">Größe</span><span></span></div><div class="list" id="list"></div></div>
    </div></div>`;
  renderList();
  setCenter(null);
  $('#q').addEventListener('input', e => { S.query = e.target.value; S.showAll = false; renderList(); });
  chartStart($('#chartWrap'));
}

function renderList() {
  const node = S.node, q = S.query.trim().toLowerCase();
  S.rows = q ? node.items.filter(it => it.name.toLowerCase().includes(q)) : node.items;
  const limit = S.showAll ? 3000 : 300;
  const rows = S.rows.slice(0, limit);
  const total = node.size || 1;
  const html = rows.map((it, i) => {
    const c = S.colorById.get(it.id) || (it.kind === 'dir' ? '#64748b' : typeColor(it.ext));
    const pct = it.size / total * 100;
    const sub = it.kind === 'dir'
      ? `${num(it.files)} Dateien · ${num(it.dirs)} Ordner${it.denied ? ' · kein Zugriff' : ''}`
      : `${date(it.mod)}${it.cloud ? ' · nur in der Cloud' : ''}`;
    return `<div class="row" data-act="row" data-i="${i}" style="animation-delay:${Math.min(i, 25) * 14}ms">
      <div class="nm"><div class="fico" style="--c:${c}">${it.kind === 'dir' ? icon('folder', 18) : extBadge(it.ext)}</div><div><div class="t">${esc(it.name)}</div><div class="s">${sub}</div></div></div>
      <div class="bar" style="--c:${c}"><i style="width:${Math.max(pct, .3).toFixed(2)}%"></i></div>
      <div class="sz">${size(it.size)}<small>${pctFmt(pct)}</small></div>
      <div class="acts"><button data-act="rowReveal" data-i="${i}" title="Im Explorer zeigen">${icon('external', 15)}</button><button class="del" data-act="rowDelete" data-i="${i}" title="Löschen">${icon('trash', 15)}</button></div></div>`;
  }).join('');
  const more = S.rows.length > rows.length ? `<div class="list-more"><button class="btn sm" data-act="showAll">Alle ${num(S.rows.length)} anzeigen</button></div>` : '';
  const hidden = node.moreFiles ? `<div class="list-more">+ ${num(node.moreFiles)} kleinere Dateien nicht aufgeführt</div>` : '';
  $('#list').innerHTML = html + more + hidden || `<div class="empty">Keine Einträge</div>`;
}

function rowItem(i) {
  const it = S.rows[+i];
  return it && { ...it, path: joinPath(S.node.path, it.name) };
}

function setCenter(n) {
  const el = $('#chartCenter');
  if (!el) return;
  if (S.chartMode !== 'sunburst') { el.innerHTML = ''; return; }
  const node = S.node;
  el.innerHTML = n
    ? `<div class="v">${size(n.s)}</div><div class="n">${esc(n.n)}</div><div class="p">${pctFmt(n.s / (node.size || 1) * 100)}</div>`
    : `<div class="v">${size(node.size)}</div><div class="n">${esc(node.name)}</div>${node.parentId >= 0 ? '<div class="p">▲ zurück</div>' : ''}`;
}

function navigate(id) {
  S.nodeId = id; S.query = ''; S.showAll = false;
  if (S.page !== 'explorer') go('explorer'); else render();
}

/* =====================================================================
   Charts (canvas)
   ===================================================================== */
const CH = { wrap: null, canvas: null, ctx: null, ro: null, w: 0, h: 0, dpr: 1, shapes: [], hover: null, t: 1, raf: 0, start: 0, geo: null };

function chartStart(wrap) {
  CH.wrap = wrap;
  CH.canvas = document.createElement('canvas');
  wrap.prepend(CH.canvas);
  CH.ctx = CH.canvas.getContext('2d');
  CH.ro = new ResizeObserver(() => { chartResize(); chartLayout(); chartDraw(); });
  CH.ro.observe(wrap);
  const c = CH.canvas;
  c.onmousemove = e => chartHover(e);
  c.onmouseleave = () => { CH.hover = null; hideTip(); setCenter(null); chartDraw(); };
  c.onclick = e => chartClick(e, false);
  c.oncontextmenu = e => { e.preventDefault(); chartClick(e, true); };
  CH.start = performance.now();
  CH.t = 0;
  const anim = now => {
    CH.t = Math.min(1, (now - CH.start) / 700);
    chartDraw();
    if (CH.t < 1) CH.raf = requestAnimationFrame(anim);
  };
  CH.raf = requestAnimationFrame(anim);
}
function chartStop() {
  cancelAnimationFrame(CH.raf);
  CH.ro?.disconnect();
  CH.ro = null; CH.canvas = null; CH.shapes = []; CH.hover = null;
}
function chartResize() {
  if (!CH.canvas) return;
  const r = CH.wrap.getBoundingClientRect();
  CH.dpr = devicePixelRatio || 1;
  CH.w = r.width; CH.h = r.height;
  CH.canvas.width = Math.max(1, r.width * CH.dpr);
  CH.canvas.height = Math.max(1, r.height * CH.dpr);
}
function chartLayout() {
  CH.shapes = [];
  const d = S.chartData;
  if (!d || !CH.w) return;
  if (S.chartMode === 'sunburst') layoutSunburst(d); else layoutTreemap(d);
}

function nodeColor(s, light = 0) {
  if (s.n.t === 'o') return `hsl(225 12% ${24 + light}%)`;
  const l = Math.max(34, 64 - (s.depth - 1) * 7) + light;
  return s.n.t === 'f' ? `hsl(${s.hue} 38% ${Math.min(80, l + 6)}%)` : `hsl(${s.hue} 78% ${l}%)`;
}

// ---- sunburst
function layoutSunburst(root) {
  let maxDepth = 0;
  const walk = (n, d) => { maxDepth = Math.max(maxDepth, d); (n.c || []).forEach(c => walk(c, d + 1)); };
  walk(root, 0);
  maxDepth = Math.min(5, Math.max(1, maxDepth));
  const R = Math.min(CH.w, CH.h) / 2 - 14, r0 = R * .32, ring = (R - r0) / maxDepth;
  CH.geo = { cx: CH.w / 2, cy: CH.h / 2, R, r0, ring, maxDepth };
  const rec = (n, a0, a1, depth, hue, path) => {
    if (!n.c || depth >= maxDepth) return;
    let a = a0;
    n.c.forEach((c, i) => {
      const da = (a1 - a0) * c.s / (n.s || 1);
      const h = depth === 0 ? hueAt(i) : hue;
      const p = c.t === 'o' ? path : joinPath(path, c.n);
      CH.shapes.push({ n: c, a0: a, a1: a + da, depth: depth + 1, hue: h, path: p });
      if (da > .006 && c.t === 'd') rec(c, a, a + da, depth + 1, h, p);
      a += da;
    });
  };
  rec(root, -Math.PI / 2, Math.PI * 1.5, 0, 0, S.node.path);
}

// ---- treemap
function squarify(items, x, y, w, h, out) {
  const total = sum(items, i => i.s);
  if (total <= 0 || w <= 0 || h <= 0) return;
  const scale = w * h / total;
  let i = 0;
  while (i < items.length) {
    const side = Math.min(w, h);
    let j = i, rowSum = 0, best = Infinity;
    while (j < items.length) {
      const s = items[j].s * scale, ns = rowSum + s, max = items[i].s * scale;
      const worst = Math.max(side * side * max / (ns * ns), ns * ns / (side * side * s));
      if (worst > best) break;
      best = worst; rowSum = ns; j++;
    }
    const thick = rowSum / side;
    let pos = 0;
    for (let k = i; k < j; k++) {
      const len = items[k].s * scale / thick;
      out.push(w >= h ? { item: items[k], x, y: y + pos, w: thick, h: len } : { item: items[k], x: x + pos, y, w: len, h: thick });
      pos += len;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    i = j;
  }
}
function layoutTreemap(root) {
  const head = 20;
  const rec = (n, x, y, w, h, depth, hue, path) => {
    const kids = (n.c || []).filter(c => c.s > 0);
    const out = [];
    squarify(kids, x, y, w, h, out);
    out.forEach((r, i) => {
      if (r.w < 1 || r.h < 1) return;
      const c = r.item, hh = depth === 0 ? hueAt(i) : hue;
      const p = c.t === 'o' ? path : joinPath(path, c.n);
      const shape = { n: c, x: r.x, y: r.y, w: r.w, h: r.h, depth: depth + 1, hue: hh, path: p };
      if (c.t === 'd' && c.c && depth < 5 && r.w > 34 && r.h > 34) {
        shape.frame = true;
        CH.shapes.push(shape);
        const top = r.h > head * 2.4 && r.w > 60 ? head : 3;
        rec(c, r.x + 3, r.y + top, r.w - 6, r.h - top - 3, depth + 1, hh, p);
      } else CH.shapes.push(shape);
    });
  };
  rec(root, 2, 2, CH.w - 4, CH.h - 4, 0, 0, S.node.path);
}

function chartDraw() {
  const ctx = CH.ctx;
  if (!ctx) return;
  ctx.setTransform(CH.dpr, 0, 0, CH.dpr, 0, 0);
  ctx.clearRect(0, 0, CH.w, CH.h);
  if (!CH.shapes.length) {
    ctx.fillStyle = '#5c6477'; ctx.font = '14px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText('Keine Unterelemente', CH.w / 2, CH.h / 2);
    return;
  }
  const e = 1 - Math.pow(1 - CH.t, 3);
  if (S.chartMode === 'sunburst') drawSunburst(ctx, e); else drawTreemap(ctx, e);
}

function drawSunburst(ctx, e) {
  const { cx, cy, r0, ring } = CH.geo, start = -Math.PI / 2;
  // inner disc
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r0);
  g.addColorStop(0, 'rgba(139,92,246,.16)'); g.addColorStop(1, 'rgba(255,255,255,.02)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r0 - 4, 0, Math.PI * 2); ctx.fill();
  for (const s of CH.shapes) {
    const a0 = start + (s.a0 - start) * e, a1 = start + (s.a1 - start) * e;
    if (a1 - a0 < .0015) continue;
    const ri = r0 + (s.depth - 1) * ring + 1.5, ro = ri + ring - 3;
    const gap = Math.min(.004, (a1 - a0) / 4);
    const hov = CH.hover === s;
    ctx.beginPath();
    ctx.arc(cx, cy, hov ? ro + 4 : ro, a0 + gap, a1 - gap);
    ctx.arc(cx, cy, ri, a1 - gap, a0 + gap, true);
    ctx.closePath();
    ctx.fillStyle = nodeColor(s, hov ? 10 : 0);
    ctx.fill();
    if (hov) { ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  // labels on the first ring for big segments
  if (e > .95) {
    ctx.font = '600 11.5px "Segoe UI Variable Text", Segoe UI';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const s of CH.shapes) {
      if (s.depth !== 1 || s.a1 - s.a0 < .22 || s.n.t === 'o') continue;
      const a = (s.a0 + s.a1) / 2, rm = r0 + ring / 2;
      const x = cx + Math.cos(a) * rm, y = cy + Math.sin(a) * rm;
      ctx.fillStyle = 'rgba(10,12,17,.85)';
      ctx.fillText(fit(ctx, s.n.n, ring * 1.6), x, y);
    }
  }
}

function drawTreemap(ctx, e) {
  ctx.globalAlpha = e;
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  for (const s of CH.shapes) {
    const { x, y, w, h } = s;
    if (s.frame) {
      ctx.fillStyle = `hsl(${s.hue} 35% ${Math.max(8, 15 - s.depth * 2)}%)`;
      roundRect(ctx, x, y, w, h, 6); ctx.fill();
      if (h > 48 && w > 60) {
        ctx.font = '600 11.5px "Segoe UI Variable Text", Segoe UI';
        ctx.fillStyle = `hsl(${s.hue} 80% 80%)`;
        ctx.fillText(fit(ctx, `${s.n.n}  ·  ${size(s.n.s)}`, w - 12), x + 7, y + 4);
      }
      continue;
    }
    const base = nodeColor(s, CH.hover === s ? 10 : 0);
    const gr = ctx.createLinearGradient(x, y, x + w, y + h);
    gr.addColorStop(0, base);
    gr.addColorStop(1, nodeColor(s, -14));
    ctx.fillStyle = gr;
    roundRect(ctx, x + .5, y + .5, w - 1, h - 1, Math.min(5, w / 4, h / 4)); ctx.fill();
    if (CH.hover === s) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    if (w > 54 && h > 22) {
      ctx.fillStyle = 'rgba(8,10,15,.88)';
      ctx.font = '600 12px "Segoe UI Variable Text", Segoe UI';
      ctx.fillText(fit(ctx, s.n.n, w - 10), x + 6, y + 5);
      if (h > 40) { ctx.font = '11.5px Segoe UI'; ctx.fillText(size(s.n.s), x + 6, y + 21); }
    }
  }
  ctx.globalAlpha = 1;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), r);
}
function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; ctx.measureText(text.slice(0, m) + '…').width <= max ? lo = m : hi = m - 1; }
  return lo > 0 ? text.slice(0, lo) + '…' : '';
}

function chartHit(e) {
  const r = CH.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (S.chartMode === 'sunburst') {
    const { cx, cy, r0, ring } = CH.geo, dx = x - cx, dy = y - cy, dist = Math.hypot(dx, dy);
    if (dist < r0) return 'center';
    const depth = Math.floor((dist - r0) / ring) + 1;
    let a = Math.atan2(dy, dx);
    if (a < -Math.PI / 2) a += Math.PI * 2;
    return CH.shapes.find(s => s.depth === depth && a >= s.a0 && a < s.a1) || null;
  }
  for (let i = CH.shapes.length - 1; i >= 0; i--) {
    const s = CH.shapes[i];
    if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) return s;
  }
  return null;
}
function chartHover(e) {
  const h = chartHit(e);
  const s = h === 'center' ? null : h;
  CH.canvas.style.cursor = h === 'center' ? (S.node.parentId >= 0 ? 'pointer' : 'default') : s && s.n.t !== 'o' ? 'pointer' : 'default';
  if (s !== CH.hover) { CH.hover = s; chartDraw(); setCenter(s ? s.n : null); }
  if (s) showTip(e.clientX, e.clientY, `<b>${esc(s.n.n)}</b><div class="tv">${size(s.n.s)}</div><div class="muted">${pctFmt(s.n.s / (S.node.size || 1) * 100)} von ${esc(S.node.name)}${s.n.t === 'f' ? ' · Datei' : s.n.t === 'o' ? '' : ' · Ordner'}</div>`);
  else hideTip();
}
function chartClick(e, context) {
  const h = chartHit(e);
  if (h === 'center') { if (!context && S.node.parentId >= 0) navigate(S.node.parentId); return; }
  if (!h || h.n.t === 'o') return;
  const it = { id: h.n.i, kind: h.n.t === 'd' ? 'dir' : 'file', name: h.n.n, size: h.n.s, path: h.path };
  if (context || it.kind === 'file') itemMenu(e.clientX, e.clientY, it);
  else navigate(it.id);
}

/* =====================================================================
   Item actions (shared)
   ===================================================================== */
function itemMenu(x, y, it) {
  showMenu(x, y, it.path, [
    it.kind === 'dir' && { label: 'Hineinzoomen', icon: 'pie', fn: () => navigate(it.id) },
    { label: 'Im Explorer zeigen', icon: 'external', fn: () => api('reveal', { path: it.path }) },
    { label: it.kind === 'dir' ? 'Ordner öffnen' : 'Öffnen', icon: 'folderOpen', fn: () => api('open', { path: it.path }).catch(e => toast(e.message, 'err')) },
    { label: 'Pfad kopieren', icon: 'copy', fn: () => api('copy', { text: it.path }).then(() => toast('Pfad kopiert', 'info')) },
    it.kind === 'dir' && { label: 'Neu scannen', icon: 'refresh', fn: () => rescan(it.id) },
    '-',
    { label: `Löschen … (${size(it.size)})`, icon: 'trash', danger: true, fn: () => deleteFlow(it) },
  ]);
}

async function deleteFlow(it) {
  const sys = /^[a-z]:\\(windows|program files|program files \(x86\)|programdata)(\\|$)/i.test(it.path);
  const choice = await dialog({
    title: `„${it.name}“ löschen?`, ic: 'trash', danger: true,
    body: `<span class="mono">${esc(it.path)}</span>Größe: <b style="color:var(--text)">${size(it.size)}</b>
      ${sys ? '<div class="warnbox">⚠ Das liegt in einem System- oder Programmordner. Löschen kann Windows oder Programme beschädigen – besser über „Programme“ deinstallieren.</div>' : ''}
      <p>Im Papierkorb belegt es weiter Platz, bis du ihn leerst. „Endgültig löschen“ gibt den Platz sofort frei.</p>`,
    buttons: [CANCEL, { label: 'In den Papierkorb', value: 'recycle' }, { label: 'Endgültig löschen', value: 'permanent', cls: 'danger' }],
  });
  if (!choice) return;
  try {
    const r = await api('delete', { id: it.id, mode: choice });
    S.deleted.add(it.id);
    if (r.exists) toast('Nur teilweise gelöscht – einige Dateien werden gerade benutzt.', 'info');
    else toast(choice === 'recycle' ? `In den Papierkorb verschoben (${size(it.size)})` : `${size(r.freed || it.size)} freigegeben`);
    refreshRecycle();
  } catch (e) { toast(e.message, 'err'); }
}

async function rescan(id) {
  try { await api('rescan', { id }); } catch (e) { toast(e.message, 'err'); }
}
async function refreshRecycle() {
  S.recycle = await api('recycleInfo');
  renderNav();
}
async function refreshDrives() {
  S.drives = await api('drives');
}

/* =====================================================================
   Page: cleanup
   ===================================================================== */
const SAFETY = {
  safe: { label: 'Sicher löschbar', c: 'var(--green)' },
  tool: { label: 'Mit Windows-Tool', c: 'var(--blue)' },
  review: { label: 'Prüfen', c: 'var(--amber)' },
  keep: { label: 'Nicht löschen', c: 'var(--red)' },
};
const ACTION_LABEL = {
  EmptyRecycleBin: 'Papierkorb leeren', CleanContents: 'Inhalt löschen', DeleteFolder: 'Ordner löschen',
  DeleteFile: 'Datei löschen', Hibernate: 'Ruhezustand aus', StorageSettings: 'Windows-Speicher öffnen',
};
function hintIcon(cat) {
  const m = [[/Papierkorb/, 'trash'], [/Temp/, 'clock'], [/Absturz|Speicherabbild/, 'alert'], [/Paket|npm/, 'package'], [/Cache/, 'zap'],
    [/Rust|Next|Python/, 'code'], [/KI|Pinokio/, 'brain'], [/Download/, 'download'], [/Virtuelle|Disk|Auslagerung/, 'disc'],
    [/Ruhezustand/, 'moon'], [/Windows|Wiederherstellung|Übermittlung/, 'shield'], [/Backup/, 'layers']];
  return (m.find(([re]) => re.test(cat)) || [0, 'folder'])[1];
}

async function pageCleanup(tok) {
  if (!S.summary) return needScan();
  if (!S.hints) { loading('Suche Aufräum-Möglichkeiten …'); S.hints = await api('hints'); }
  if (tok !== S.tok) return;
  const hs = S.hints, by = k => hs.filter(h => h.safety === k);
  const list = S.hintFilter === 'all' ? hs : by(S.hintFilter);
  const tiles = Object.entries(SAFETY).map(([k, v]) => `<div class="card stile ${S.hintFilter === k ? 'on' : ''}" style="--c:${v.c}" data-act="hintFilter" data-f="${k}">
      <div class="k"><i></i>${v.label}</div><div class="v">${size(sum(by(k), h => h.size))}</div><div class="s">${by(k).length} Einträge</div></div>`).join('');
  view.innerHTML = `<div class="page">
    <div class="page-head"><div class="grow"><h1>Aufräumen</h1><p>${hs.length} Fundstellen · <b style="color:var(--green)">${size(sum(by('safe'), h => h.size))}</b> sofort sicher freigebbar</p></div>
      <div class="head-actions">${S.hintFilter !== 'all' ? `<button class="btn ghost" data-act="hintFilter" data-f="all">Filter aufheben</button>` : ''}
        <button class="btn primary" data-act="quickClean">${icon('sparkles', 17)}${quickLabel(S.summary.reclaim)}</button></div></div>
    <div class="safety-tiles">${tiles}</div>
    <div class="hints">${list.map(hintHtml).join('') || `<div class="empty">Nichts gefunden – sehr aufgeräumt! ✨</div>`}</div></div>`;
}

function hintHtml(h, i) {
  const sf = SAFETY[h.safety];
  const busy = S.busyHints.has(h.path);
  const act = ACTION_LABEL[h.action];
  return `<div class="card hint" style="--c:${sf.c};animation-delay:${Math.min(i, 20) * 25}ms">
    <div class="hico">${icon(hintIcon(h.category), 22)}</div>
    <div style="min-width:0"><div class="htitle">${esc(h.category)}<span class="pill ${h.safety}">${sf.label}</span></div>
      <div class="hpath mono ellipsis" title="${esc(h.path)}">${esc(h.path)}</div><div class="hadv">${esc(h.advice)}</div></div>
    <div class="hsize">${size(h.size)}</div>
    <div class="hact">
      ${act ? `<button class="btn sm ${h.safety === 'safe' ? 'success' : ''} ${busy ? 'busy' : ''}" data-act="cleanHint" data-path="${esc(h.path)}">${esc(act)}</button>` : ''}
      ${h.isDir ? `<button class="btn sm icon" data-act="openNode" data-id="${h.itemId}" title="Im Explorer anzeigen">${icon('pie', 15)}</button>` : ''}
      <button class="btn sm icon" data-act="reveal" data-path="${esc(h.path)}" title="Im Windows-Explorer zeigen">${icon('external', 15)}</button>
      ${h.safety === 'review' ? `<button class="btn sm icon" data-act="hintDelete" data-path="${esc(h.path)}" title="Löschen">${icon('trash', 15)}</button>` : ''}
    </div></div>`;
}

async function cleanHint(path) {
  const h = S.hints?.find(x => x.path === path);
  if (!h) return;
  const destructive = ['CleanContents', 'DeleteFolder', 'DeleteFile'].includes(h.action);
  if (destructive) {
    const what = h.action === 'CleanContents' ? 'Der Inhalt dieses Ordners wird endgültig gelöscht (der Ordner selbst bleibt).' : 'Wird endgültig gelöscht.';
    const ok = await dialog({
      title: `${h.category} bereinigen?`, ic: 'sparkles',
      body: `<span class="mono">${esc(h.path)}</span>${what} Gerade benutzte Dateien werden übersprungen.<p>${esc(h.advice)}</p>`,
      buttons: [CANCEL, { label: `${size(h.size)} freigeben`, value: true, cls: 'primary' }],
    });
    if (!ok) return;
  } else if (h.action === 'Hibernate') {
    const ok = await dialog({
      title: 'Ruhezustand deaktivieren?', ic: 'moon',
      body: `Damit wird <b>hiberfil.sys (${size(h.size)})</b> entfernt. Ruhezustand und Windows-Schnellstart sind danach aus – „Energie sparen“ funktioniert weiterhin. Windows fragt nach Administratorrechten.`,
      buttons: [CANCEL, { label: 'Deaktivieren', value: true, cls: 'primary' }],
    });
    if (!ok) return;
  }
  S.busyHints.add(path);
  if (S.page === 'cleanup') render();
  try {
    const r = await api('clean', { path });
    if (r.note) toast(r.note, 'info'); else toast(`${size(r.freed)} freigegeben 🎉`);
    refreshRecycle();
  } catch (e) { toast(e.message, 'err'); }
  S.busyHints.delete(path);
  S.hints = null;
  if (S.page === 'cleanup') render();
}

// Quick cleanup always empties caches & Temp; build folders (node_modules, target, .next) are opt-in.
function quickLabel(r) {
  if (r.quick > 0) return `Schnellbereinigung · ${size(r.quick)}`;
  if (r.dev > 0) return `Build-Ordner bereinigen · ${size(r.dev)}`;
  return 'Schnellbereinigung';
}

async function quickClean() {
  const all = (S.hints ||= await api('hints'));
  const caches = all.filter(h => h.safety === 'safe' && (h.action === 'CleanContents' || h.action === 'EmptyRecycleBin'));
  const dev = all.filter(h => h.safety === 'safe' && h.action === 'DeleteFolder');
  if (!caches.length && !dev.length) return toast('Nichts zu tun – es gibt keine Caches, Temp-Dateien oder Build-Ordner zum Bereinigen.', 'info');
  const cTotal = sum(caches, h => h.size), dTotal = sum(dev, h => h.size);
  const li = h => `<li><b style="color:var(--text)">${esc(h.category)}</b> – ${size(h.size)}<br><span class="mono" style="display:inline;padding:0;background:none;color:var(--dim)">${esc(h.path)}</span></li>`;
  let withDev = !caches.length;
  const amount = () => cTotal + (withDev ? dTotal : 0);
  const pending = dialog({
    title: 'Schnellbereinigung', ic: 'sparkles',
    body: `${caches.length
        ? `Diese ${caches.length} Bereiche enthalten nur Zwischenspeicher und werden geleert:<ul>${caches.map(li).join('')}</ul>`
        : `<p>Papierkorb, Temp-Ordner und Caches sind bereits sauber.</p>`}
      ${dev.length ? `<label class="check"><input type="checkbox" id="qcDev" ${withDev ? 'checked' : ''}>
        <span><b>Auch ${dev.length} Build-Ordner löschen (${size(dTotal)})</b><br>
        node_modules, Rust-target, .next & Co. Sie entstehen beim nächsten <span class="kbd">npm install</span> bzw. Build neu – die betroffenen Projekte müssen danach einmal neu gebaut werden.</span></label>
        <ul class="devlist">${dev.slice(0, 6).map(li).join('')}${dev.length > 6 ? `<li>… und ${dev.length - 6} weitere</li>` : ''}</ul>` : ''}
      Gerade benutzte Dateien werden übersprungen. Downloads, Spiele und Projektdateien bleiben unberührt.`,
    buttons: [CANCEL, { label: '', value: true, cls: 'primary' }],
  });
  const cb = $('#qcDev'), okBtn = $('#modal .btn:last-child');
  const sync = () => { okBtn.textContent = `${size(amount())} freigeben`; okBtn.disabled = amount() === 0; };
  cb?.addEventListener('change', () => { withDev = cb.checked; sync(); });
  sync();
  if (!(await pending)) return;
  const hs = withDev ? [...caches, ...dev] : caches;
  let freed = 0;
  toast(`Bereinige ${hs.length} Bereiche …`, 'info');
  for (const h of hs) {
    try { freed += (await api('clean', { path: h.path })).freed || 0; } catch (e) { toast(`${h.category}: ${e.message}`, 'err'); }
  }
  S.hints = null;
  toast(`Schnellbereinigung fertig: ${size(freed)} freigegeben 🎉`);
  refreshRecycle();
  refreshDrives().then(() => S.page === 'overview' && render());
}

/* =====================================================================
   Page: games
   ===================================================================== */
const steamId = g => g.key.startsWith('steam:') ? g.key.slice(6) : null;
const steamCdn = g => steamId(g) ? `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${steamId(g)}/library_600x900.jpg` : '';
window.artFail = img => {
  const alt = img.dataset.alt;
  if (alt) { img.dataset.alt = ''; img.src = alt; } else img.remove();
};
const isStale = g => g.lastPlayed && Date.now() - g.lastPlayed > 180 * DAY;
const gameTotal = g => g.size + sum(g.extras || [], x => x.size);

async function pageGames(tok) {
  if (!S.games) { loading('Suche Spiele in Steam, Epic, EA, Rockstar, Xbox …'); S.games = await api('games'); renderNav(); }
  if (tok !== S.tok) return;
  const all = S.games;
  const sources = [...new Set(all.map(g => g.source))].sort((a, b) => all.filter(g => g.source === b).length - all.filter(g => g.source === a).length);
  let list = S.gameFilter === 'Alle' ? all : all.filter(g => g.source === S.gameFilter);
  if (S.staleOnly) list = list.filter(isStale);
  const sorters = { size: (a, b) => gameTotal(b) - gameTotal(a), played: (a, b) => (a.lastPlayed || 9e15) - (b.lastPlayed || 9e15), name: (a, b) => a.name.localeCompare(b.name, 'de') };
  list = [...list].sort(sorters[S.gameSort]);
  const max = Math.max(1, ...all.map(gameTotal));
  const stale = all.filter(isStale);
  const chips = ['Alle', ...sources].map(s => `<button class="chip ${S.gameFilter === s ? 'on' : ''}" data-act="gameFilter" data-f="${esc(s)}">${s !== 'Alle' ? `<span class="dot" style="--c:${LAUNCHERS[s] || '#94a3b8'}"></span>` : ''}${esc(s)}<span class="n">${s === 'Alle' ? all.length : all.filter(g => g.source === s).length}</span></button>`).join('');

  view.innerHTML = `<div class="page">
    <div class="page-head"><div class="grow"><h1>Spiele</h1><p>${all.length} Spiele & Engines aus ${sources.length} Launchern belegen <b style="color:var(--text)" id="gTotal">${size(sum(all, gameTotal))}</b></p></div>
      <div class="head-actions"><div class="seg">
        <button class="${S.gameSort === 'size' ? 'on' : ''}" data-act="gameSort" data-s="size">Größe</button>
        <button class="${S.gameSort === 'played' ? 'on' : ''}" data-act="gameSort" data-s="played">Zuletzt gespielt</button>
        <button class="${S.gameSort === 'name' ? 'on' : ''}" data-act="gameSort" data-s="name">Name</button></div>
        <button class="btn icon" data-act="gamesRefresh" title="Neu suchen">${icon('refresh', 17)}</button></div></div>
    ${stale.length ? `<div class="card insight"><div class="ico">${icon('clock', 22)}</div><div class="grow"><b>${stale.length === 1 ? '1 Spiel' : stale.length + ' Spiele'} seit über 6 Monaten nicht gespielt</b><div class="muted">Zusammen ${size(sum(stale, gameTotal))} – du kannst sie jederzeit wieder herunterladen.</div></div>
      <button class="btn ${S.staleOnly ? 'primary' : ''}" data-act="staleOnly">${S.staleOnly ? 'Alle zeigen' : 'Nur diese zeigen'}</button></div>` : ''}
    <div class="chips">${chips}</div>
    <div class="games">${list.map((g, i) => gameCard(g, i, max)).join('') || `<div class="empty">Keine Spiele gefunden.</div>`}</div></div>`;
}

function gameCard(g, i, max) {
  const hue = hashHue(g.name);
  const fallback = `<div class="fallback">${g.icon ? `<img src="https://app.local/icon?p=${encodeURIComponent(g.icon)}" onerror="this.outerHTML='<div class=ini>${esc(initials(g.name))}</div>'">` : `<div class="ini">${esc(initials(g.name))}</div>`}</div>`;
  const art = g.image ? `<img class="art" src="${g.image}" data-alt="${steamCdn(g)}" onerror="artFail(this)">` : '';
  const extras = (g.extras || []).filter(x => x.size > 0).map(x => `${esc(x.label)} ${size(x.size)}`).join(' · ');
  const meta = g.lastPlayed ? `gespielt ${ago(g.lastPlayed)}` : g.installed ? `installiert ${date(g.installed)}` : esc(g.kind);
  return `<div class="gcard" data-key="${esc(g.key)}" style="animation-delay:${Math.min(i, 24) * 22}ms">
    <div class="cover" style="--h:${hue}">${fallback}${art}</div>
    <div class="gsrc" style="--c:${LAUNCHERS[g.source] || '#94a3b8'}"><i></i>${esc(g.source)}</div>
    ${g.kind !== 'Spiel' ? `<div class="gkind pill neutral">${esc(g.kind)}</div>` : ''}
    ${isStale(g) ? `<div class="gstale">💤 ${ago(g.lastPlayed)}</div>` : ''}
    <div class="ginfo"><div class="gname">${esc(g.name)}</div><div class="gsize" data-gs>${size(gameTotal(g))}</div><div class="gmeta">${meta}</div>
      <div class="gextra" data-gx>${extras ? '+ ' + extras : ''}</div>
      <div class="bar"><i data-gb style="width:${(gameTotal(g) / max * 100).toFixed(1)}%;background:${LAUNCHERS[g.source] || 'var(--grad)'}"></i></div></div>
    <div class="gactions"><div class="gtitle">${esc(g.name)}</div><div class="gsub mono ellipsis" title="${esc(g.path)}">${esc(g.path)}</div>
      ${g.launchUrl ? `<button class="btn primary sm" data-act="gplay" data-key="${esc(g.key)}">${icon('play', 14)}Spielen</button>` : ''}
      <button class="btn sm" data-act="reveal" data-path="${esc(g.path)}">${icon('folderOpen', 15)}Ordner öffnen</button>
      ${g.storeUrl ? `<button class="btn sm" data-act="openUrl" data-url="${esc(g.storeUrl)}">${icon('store', 15)}Shop-Seite</button>` : ''}
      ${g.uninstallKind !== 'none' ? `<button class="btn danger sm" data-act="guninstall" data-key="${esc(g.key)}">${icon('trash', 15)}Deinstallieren</button>` : ''}
    </div></div>`;
}

async function uninstallGame(key) {
  const g = S.games.find(x => x.key === key);
  if (!g) return;
  const how = { url: `${g.source} öffnet sich und fragt noch einmal nach.`, cmd: `Das Deinstallationsprogramm von ${g.source} wird gestartet.`, launcher: g.uninstallHint || '', settings: g.uninstallHint || '' }[g.uninstallKind] || '';
  const ok = await dialog({
    title: `${g.name} deinstallieren?`, ic: 'gamepad', danger: true,
    body: `Belegt <b style="color:var(--text)">${size(gameTotal(g))}</b>${g.lastPlayed ? `, zuletzt gespielt ${ago(g.lastPlayed)}` : ''}.<span class="mono">${esc(g.path)}</span>${esc(how)}
      <p>Spielstände in der Cloud bleiben erhalten; das Spiel lässt sich jederzeit wieder installieren.</p>`,
    buttons: [CANCEL, { label: g.uninstallKind === 'launcher' || g.uninstallKind === 'settings' ? 'Launcher öffnen' : 'Deinstallieren', value: true, cls: 'danger' }],
  });
  if (!ok) return;
  try {
    const r = await api('uninstallGame', { key });
    toast(r?.hint || `Deinstallation von ${g.name} gestartet. Danach hier auf „Neu suchen“ klicken.`, 'info');
  } catch (e) { toast(e.message, 'err'); }
}

/* =====================================================================
   Page: programs
   ===================================================================== */
const appSize = a => a.missing ? 0 : a.size;

async function pageApps(tok) {
  if (!S.apps) { loading('Lese installierte Programme …'); S.apps = await api('apps'); renderNav(); }
  if (tok !== S.tok) return;
  const orphans = S.apps.filter(a => a.missing).length;
  view.innerHTML = `<div class="page">
    <div class="page-head"><div class="grow"><h1>Programme</h1><p>${S.apps.length} installierte Programme · zusammen <b style="color:var(--text)">${size(sum(S.apps, appSize))}</b>${orphans ? ` · <span style="color:var(--amber)">${orphans} ${orphans === 1 ? 'verwaister Eintrag' : 'verwaiste Einträge'}</span>` : ''}</p></div>
      <div class="head-actions"><div class="search">${icon('search', 16)}<input id="aq" placeholder="Programm suchen" value="${esc(S.appQuery)}"></div>
        <div class="seg"><button class="${S.appSort === 'size' ? 'on' : ''}" data-act="appSort" data-s="size">Größe</button><button class="${S.appSort === 'name' ? 'on' : ''}" data-act="appSort" data-s="name">Name</button><button class="${S.appSort === 'date' ? 'on' : ''}" data-act="appSort" data-s="date">Installiert</button></div>
        <button class="btn icon" data-act="appsRefresh" title="Neu laden">${icon('refresh', 17)}</button></div></div>
    <div class="card pad table apps" id="appTable"></div></div>`;
  $('#aq').addEventListener('input', e => { S.appQuery = e.target.value; renderApps(); });
  renderApps();
}

function renderApps() {
  const q = S.appQuery.trim().toLowerCase();
  let list = q ? S.apps.filter(a => (a.name + ' ' + (a.publisher || '')).toLowerCase().includes(q)) : S.apps;
  const sorters = { size: (a, b) => appSize(b) - appSize(a), name: (a, b) => a.name.localeCompare(b.name, 'de'), date: (a, b) => (b.installed || 0) - (a.installed || 0) };
  list = [...list].sort(sorters[S.appSort]);
  const max = Math.max(1, ...S.apps.map(appSize));
  $('#appTable').innerHTML = `<div class="trow thead"><span></span><span>Name</span><span>Version</span><span>Installiert</span><span>Größe</span><span></span></div>` +
    list.map((a, i) => `<div class="trow" data-app="${esc(a.key)}" style="animation-delay:${Math.min(i, 25) * 12}ms">
      <div class="app-ico">${a.icon ? `<img src="${a.icon}" onerror="this.outerHTML='${esc(initials(a.name))}'">` : esc(initials(a.name))}</div>
      <div style="min-width:0"><div class="t">${esc(a.name)}${a.missing ? ' <span class="pill review" title="Der Programmordner existiert nicht mehr – nur der Eintrag in der Windows-Programmliste ist übrig.">Ordner fehlt</span>' : ''}</div><div class="s">${esc(a.publisher || '')}${a.user ? ' · nur für diesen Benutzer' : ''}</div></div>
      <div class="s">${esc(a.version || '')}</div><div class="s">${date(a.installed)}</div>
      <div class="szbar">${a.missing
        ? `<div class="sz est">belegt nichts mehr</div>`
        : `<div class="sz" data-as>${a.size ? size(a.size) : '–'}${a.size && !a.exact ? '<span class="est"> geschätzt</span>' : ''}</div><div class="bar"><i data-ab style="width:${(a.size / max * 100).toFixed(1)}%"></i></div>`}</div>
      <div class="acts">${a.location ? `<button class="btn sm icon" data-act="reveal" data-path="${esc(a.location)}" title="Installationsordner">${icon('folderOpen', 15)}</button>` : ''}
        ${a.canUninstall ? `<button class="btn sm danger" data-act="appUninstall" data-key="${esc(a.key)}">Deinstallieren</button>` : ''}</div></div>`).join('');
}

async function uninstallApp(key) {
  const a = S.apps.find(x => x.key === key);
  if (!a) return;
  const ok = await dialog({
    title: `${a.name} deinstallieren?`, ic: 'package', danger: true,
    body: `${a.publisher ? esc(a.publisher) + ' · ' : ''}${a.size ? size(a.size) : ''}<p>Das Deinstallationsprogramm des Herstellers wird gestartet – folge dort den Anweisungen.</p>`,
    buttons: [CANCEL, { label: 'Deinstallieren', value: true, cls: 'danger' }],
  });
  if (!ok) return;
  try { await api('uninstallApp', { key }); toast(`Deinstallation von ${a.name} gestartet.`, 'info'); }
  catch (e) { toast(e.message, 'err'); }
}

/* =====================================================================
   Page: large & old files
   ===================================================================== */
const FILE_FILTERS = [
  { id: 'all', label: 'Alle', fn: () => true },
  { id: 'huge', label: 'Über 1 GB', fn: f => f.size >= GB },
  { id: 'old', label: 'Älter als 1 Jahr', fn: f => f.mod && Date.now() - f.mod > 365 * DAY },
  ...TYPE_GROUPS.filter(g => ['Video', 'Archiv', 'Disk', 'Programm', 'KI-Modell', 'Bild'].includes(g.label))
    .map(g => ({ id: g.label, label: g.label, c: g.c, fn: f => g.ext.includes(f.ext) })),
];

async function pageFiles(tok) {
  if (!S.summary) return needScan();
  if (!S.files) { loading('Sammle große Dateien …'); S.files = await api('files'); }
  if (tok !== S.tok) return;
  view.innerHTML = `<div class="page">
    <div class="page-head"><div class="grow"><h1>Große Dateien</h1><p>Die ${num(S.files.length)} größten Dateien – filtere nach Alter oder Typ.</p></div>
      <div class="head-actions"><div class="search">${icon('search', 16)}<input id="fq" placeholder="Name oder Ordner" value="${esc(S.fileQuery)}"></div></div></div>
    <div class="chips">${FILE_FILTERS.map(f => `<button class="chip ${S.fileFilter === f.id && !S.fileExt ? 'on' : ''}" data-act="fileFilter" data-f="${f.id}">${f.c ? `<span class="dot" style="--c:${f.c}"></span>` : ''}${f.label}</button>`).join('')}
      ${S.fileExt ? `<button class="chip on" data-act="fileFilter" data-f="all">${esc(S.fileExt)} ${icon('x', 13)}</button>` : ''}</div>
    <div class="card pad table files" id="fileTable"></div></div>`;
  $('#fq').addEventListener('input', e => { S.fileQuery = e.target.value; renderFiles(); });
  renderFiles();
}

function renderFiles() {
  const f = FILE_FILTERS.find(x => x.id === S.fileFilter) || FILE_FILTERS[0];
  const q = S.fileQuery.trim().toLowerCase();
  const list = S.files.filter(x => !S.deleted.has(x.id) && (S.fileExt ? x.ext === S.fileExt : f.fn(x)) && (!q || (x.dir + '\\' + x.name).toLowerCase().includes(q)));
  const shown = list.slice(0, 500);
  const max = Math.max(1, shown[0]?.size || 1);
  S.fileRows = shown;
  $('#fileTable').innerHTML = `<div class="trow thead"><span></span><span>Datei</span><span>Geändert</span><span>Größe</span><span></span></div>` +
    shown.map((x, i) => `<div class="trow" data-act="fileRow" data-i="${i}" style="animation-delay:${Math.min(i, 25) * 12}ms">
      <div class="fico" style="--c:${typeColor(x.ext)}">${extBadge(x.ext)}</div>
      <div style="min-width:0"><div class="t">${esc(x.name)}</div><div class="s mono">${esc(x.dir)}</div></div>
      <div class="s">${date(x.mod)}<br>${ago(x.mod)}</div>
      <div class="szbar"><div class="sz">${size(x.size)}</div><div class="bar" style="--c:${typeColor(x.ext)}"><i style="width:${(x.size / max * 100).toFixed(1)}%"></i></div></div>
      <div class="acts"><button class="btn sm icon" data-act="fileReveal" data-i="${i}" title="Im Explorer zeigen">${icon('external', 15)}</button><button class="btn sm icon danger" data-act="fileDelete" data-i="${i}" title="Löschen">${icon('trash', 15)}</button></div></div>`).join('') +
    (list.length > shown.length ? `<div class="list-more">+ ${num(list.length - shown.length)} weitere</div>` : '') +
    (!list.length ? `<div class="empty">Keine passenden Dateien.</div>` : '');
}
const fileItem = i => { const x = S.fileRows[+i]; return { id: x.id, kind: 'file', name: x.name, size: x.size, path: joinPath(x.dir, x.name) }; };

/* =====================================================================
   Page: duplicates
   ===================================================================== */
async function pageDupes() {
  if (!S.summary) return needScan();
  const mins = [[10 * MB, '10 MB'], [100 * MB, '100 MB'], [GB, '1 GB']];
  const d = S.dupes;
  let body = '';
  if (S.dupesBusy) {
    const p = S.dupesProg;
    body = `<div class="card pad"><div class="scan-title"><i class="live-dot"></i>Vergleiche Dateien …</div><div class="progress"><i id="dpBar" style="width:${p ? (p.done / Math.max(1, p.total) * 100).toFixed(1) : 0}%"></i></div><div class="muted" id="dpTxt" style="margin-top:8px">${p ? `${num(p.done)} von ${num(p.total)} Kandidaten` : 'Gruppiere nach Größe …'}</div></div>`;
  } else if (d) {
    const wasted = sum(d, g => g.wasted);
    body = d.length ? `<div class="muted" style="margin-bottom:14px">${d.length} Gruppen · <b style="color:var(--amber)">${size(wasted)}</b> doppelt belegt</div>` + d.map((g, gi) => `
      <div class="card dgroup" style="animation-delay:${Math.min(gi, 15) * 30}ms"><div class="dh">${icon('copy', 18)}<b>${g.files.length} × ${size(g.size)}</b>
        <span class="pill ${g.exact ? 'safe' : 'review'}">${g.exact ? 'identisch' : 'sehr wahrscheinlich identisch'}</span><span class="grow"></span><span class="muted">${size(g.wasted)} verschwendet</span></div>
        ${g.files.map((f, fi) => `<div class="dfile ${S.deleted.has(f.id) ? 'gone' : ''}"><div style="min-width:0"><div class="t ellipsis">${esc(f.name)}</div><div class="s mono ellipsis">${esc(f.dir)}</div></div>
          <div class="s">${date(f.mod)}</div><div class="head-actions"><button class="btn sm icon" data-act="reveal" data-path="${esc(joinPath(f.dir, f.name))}" title="Im Explorer zeigen">${icon('external', 15)}</button>
          <button class="btn sm danger" data-act="dupeDelete" data-g="${gi}" data-f="${fi}">Diese löschen</button></div></div>`).join('')}</div>`).join('')
      : `<div class="empty"><div class="big-ico">${icon('check', 34)}</div><h3>Keine Duplikate gefunden</h3><p>Ab ${size(S.dupeMin)} gibt es keine doppelten Dateien.</p></div>`;
  } else {
    body = `<div class="empty"><div class="big-ico">${icon('copy', 34)}</div><h3>Doppelte Dateien finden</h3><p>Vergleicht Dateien gleicher Größe per Prüfsumme. Wähle eine Mindestgröße und starte die Suche.</p></div>`;
  }
  view.innerHTML = `<div class="page">
    <div class="page-head"><div class="grow"><h1>Duplikate</h1><p>Gleiche Dateien an mehreren Orten – eine Kopie reicht meist.</p></div></div>
    <div class="card dupe-controls"><span class="muted">Mindestgröße</span><div class="seg">${mins.map(([v, l]) => `<button class="${S.dupeMin === v ? 'on' : ''}" data-act="dupeMin" data-v="${v}">${l}</button>`).join('')}</div><span class="grow"></span>
      ${S.dupesBusy ? `<button class="btn danger" data-act="dupesCancel">${icon('stop', 13)}Abbrechen</button>` : `<button class="btn primary" data-act="dupesStart">${icon('search', 16)}${d ? 'Erneut suchen' : 'Suche starten'}</button>`}</div>
    ${body}</div>`;
}

async function startDupes() {
  S.dupesBusy = true; S.dupesProg = null; S.dupes = null;
  render();
  try { const r = await api('dupes', { minSize: S.dupeMin }); if (r) S.dupes = r; }
  catch (e) { toast(e.message, 'err'); }
  S.dupesBusy = false;
  if (S.page === 'dupes') render();
}

/* =====================================================================
   Page: file types
   ===================================================================== */
async function pageTypes(tok) {
  if (!S.summary) return needScan();
  if (!S.types) { loading(); S.types = await api('types'); }
  if (tok !== S.tok) return;
  const t = S.types, top = t.slice(0, 12), rest = sum(t.slice(12), x => x.bytes);
  const max = Math.max(1, t[0]?.bytes || 1);
  view.innerHTML = `<div class="page">
    <div class="page-head"><div class="grow"><h1>Dateitypen</h1><p>Welche Arten von Dateien den meisten Platz belegen.</p></div></div>
    <div class="types-top"><div class="card pad"><div class="donut-wrap"><canvas id="donut"></canvas></div></div>
      <div class="card pad type-legend">${top.map((x, i) => `<div data-act="typeClick" data-ext="${esc(x.ext)}"><i style="--c:${topColor(hueAt(i))}"></i><span class="e">${x.ext ? '.' + esc(x.ext) : '(ohne)'}</span><span class="b">${size(x.bytes)}</span></div>`).join('')}
        ${rest ? `<div><i style="--c:#3b4252"></i><span class="e">Sonstige</span><span class="b">${size(rest)}</span></div>` : ''}</div></div>
    <div class="card pad table types"><div class="trow thead"><span></span><span>Typ</span><span>Größe</span><span>Anteil</span><span>Anzahl</span><span>Ø Größe</span></div>
      ${t.slice(0, 150).map((x, i) => `<div class="trow" data-act="typeClick" data-ext="${esc(x.ext)}" style="cursor:pointer;animation-delay:${Math.min(i, 25) * 12}ms">
        <div class="fico" style="--c:${i < 12 ? topColor(hueAt(i)) : typeColor('.' + x.ext)}">${extBadge(x.ext)}</div><div class="t">${x.ext ? '.' + esc(x.ext) : '(ohne Endung)'}</div>
        <div class="sz" style="text-align:left">${size(x.bytes)}</div><div class="bar"><i style="width:${(x.bytes / max * 100).toFixed(1)}%"></i></div>
        <div class="s num">${num(x.count)} Dateien</div><div class="s num">${size(x.bytes / Math.max(1, x.count))}</div></div>`).join('')}</div></div>`;
  drawDonut($('#donut'), top.map((x, i) => ({ v: x.bytes, c: topColor(hueAt(i)) })).concat(rest ? [{ v: rest, c: '#3b4252' }] : []), sum(t, x => x.bytes));
}

function drawDonut(canvas, parts, total) {
  const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const cx = r.width / 2, cy = r.height / 2, R = Math.min(cx, cy) - 6, w = R * .32;
  const t0 = performance.now();
  const frame = now => {
    const k = Math.min(1, (now - t0) / 800), e = 1 - Math.pow(1 - k, 3);
    ctx.clearRect(0, 0, r.width, r.height);
    let a = -Math.PI / 2;
    for (const p of parts) {
      const da = Math.PI * 2 * p.v / total * e;
      ctx.beginPath(); ctx.arc(cx, cy, R, a + .01, a + da - .01); ctx.arc(cx, cy, R - w, a + da - .01, a + .01, true); ctx.closePath();
      ctx.fillStyle = p.c; ctx.fill();
      a += da;
    }
    ctx.fillStyle = '#e9ecf3'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 24px "Segoe UI Variable Display", Segoe UI'; ctx.fillText(size(total), cx, cy - 8);
    ctx.font = '12px Segoe UI'; ctx.fillStyle = '#8d96aa'; ctx.fillText('alle Dateien', cx, cy + 16);
    if (k < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* =====================================================================
   Actions & events
   ===================================================================== */
async function startScan(path) {
  if (S.scanning) return;
  S.scanning = true; S.fullScan = true; S.progress = null; S.scanPath = path;
  updateScanbar();
  go('overview');
  try { await api('scan', { path }); }
  catch (e) { S.scanning = false; S.fullScan = false; updateScanbar(); toast(e.message, 'err'); render(); }
}

const ACT = {
  nav: d => go(d.page),
  scan: d => startScan(d.path),
  pickFolder: async () => { const p = await api('pickFolder'); if (p) startScan(p); },
  cancelScan: () => api('cancel'),
  elevate: async () => { if (!(await api('elevate'))) toast('Administratorrechte wurden nicht erteilt.', 'info'); },
  emptyRecycle: async () => { S.recycle = await api('emptyRecycle'); renderNav(); refreshDrives(); },
  openNode: d => navigate(+d.id),
  up: () => S.node?.parentId >= 0 && navigate(S.node.parentId),
  rescanNode: () => rescan(S.nodeId),
  chartMode: d => { S.chartMode = d.mode; render(); },
  showAll: () => { S.showAll = true; renderList(); },
  reveal: d => api('reveal', { path: d.path }),
  openUrl: d => api('openUrl', { url: d.url }).catch(e => toast(e.message, 'err')),
  row: (d, el, e) => {
    const it = rowItem(d.i);
    if (it.kind === 'dir') navigate(it.id); else itemMenu(e.clientX, e.clientY, it);
  },
  rowReveal: d => api('reveal', { path: rowItem(d.i).path }),
  rowDelete: d => deleteFlow(rowItem(d.i)),
  quickClean: () => quickClean(),
  hintFilter: d => { S.hintFilter = S.hintFilter === d.f ? 'all' : d.f; render(); },
  cleanHint: d => cleanHint(d.path),
  hintDelete: d => {
    const h = S.hints.find(x => x.path === d.path);
    deleteFlow({ id: h.itemId, kind: h.isDir ? 'dir' : 'file', name: h.path.split('\\').pop(), size: h.size, path: h.path });
  },
  gameFilter: d => { S.gameFilter = d.f; render(); },
  gameSort: d => { S.gameSort = d.s; render(); },
  staleOnly: () => { S.staleOnly = !S.staleOnly; render(); },
  gamesRefresh: async () => { S.games = null; render(); },
  gplay: d => api('openUrl', { url: S.games.find(g => g.key === d.key).launchUrl }).catch(e => toast(e.message, 'err')),
  guninstall: d => uninstallGame(d.key),
  appSort: d => { S.appSort = d.s; render(); },
  appsRefresh: () => { S.apps = null; render(); },
  appUninstall: d => uninstallApp(d.key),
  fileFilter: d => { S.fileFilter = d.f; S.fileExt = null; render(); },
  fileRow: (d, el, e) => itemMenu(e.clientX, e.clientY, fileItem(d.i)),
  fileReveal: d => api('reveal', { path: fileItem(d.i).path }),
  fileDelete: d => deleteFlow(fileItem(d.i)),
  typeClick: d => { S.fileExt = d.ext ? '.' + d.ext : ''; S.fileFilter = 'all'; go('files'); },
  dupeMin: d => { S.dupeMin = +d.v; render(); },
  dupesStart: () => startDupes(),
  dupesCancel: () => api('cancelDupes'),
  dupeDelete: d => {
    const f = S.dupes[+d.g].files[+d.f];
    deleteFlow({ id: f.id, kind: 'file', name: f.name, size: S.dupes[+d.g].size, path: joinPath(f.dir, f.name) });
  },
};

document.addEventListener('click', e => {
  if (!e.target.closest('#menu')) hideMenu();
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || !view.contains(el) && !el.closest('.nav')) return;
  ACT[el.dataset.act]?.(el.dataset, el, e);
});
document.addEventListener('contextmenu', e => {
  e.preventDefault();
  const row = e.target.closest('[data-act="row"]');
  if (row) return itemMenu(e.clientX, e.clientY, rowItem(row.dataset.i));
  const fr = e.target.closest('[data-act="fileRow"]');
  if (fr) return itemMenu(e.clientX, e.clientY, fileItem(fr.dataset.i));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') hideMenu();
  if (e.key === 'Backspace' && S.page === 'explorer' && !/INPUT/.test(document.activeElement?.tagName)) ACT.up();
});
window.addEventListener('blur', hideMenu);

on('scanStart', () => { S.scanning = true; updateScanbar(); });
on('scanProgress', p => { S.progress = p; updateScanbar(); if (S.page === 'overview') updateScanPanel(); });
on('scanDone', async s => {
  const wasFull = S.fullScan;
  S.scanning = false; S.fullScan = false; S.progress = null;
  updateScanbar();
  if (s.error) { toast(s.error, 'err'); render(); return; }
  Object.assign(S, { summary: s, nodeId: s.rootId, hints: null, files: null, types: null, dupes: null, query: '' });
  S.deleted.clear();
  await refreshDrives();
  renderNav();
  if (wasFull) toast(`Scan fertig: ${size(s.size)} in ${s.seconds.toFixed(1).replace('.', ',')} s`);
  render();
  S.games && api('games', { refresh: true }).then(g => { S.games = g; renderNav(); });
});
on('treeChanged', async s => {
  S.scanning = false; S.progress = null;
  updateScanbar();
  Object.assign(S, { summary: s, hints: null, files: null });
  await refreshDrives();
  renderNav();
  if (S.page !== 'dupes' && !$('#modal').classList.contains('on')) render();
  else if (S.page === 'dupes') render();
});
on('gameSize', g => {
  const game = S.games?.find(x => x.key === g.key);
  if (!game) return;
  game.size = g.size; game.extras = g.extras; game.exact = true;
  const card = document.querySelector(`.gcard[data-key="${CSS.escape(g.key)}"]`);
  if (card) {
    card.querySelector('[data-gs]').textContent = size(gameTotal(game));
    const ex = game.extras.filter(x => x.size > 0).map(x => `${x.label} ${size(x.size)}`).join(' · ');
    card.querySelector('[data-gx]').textContent = ex ? '+ ' + ex : '';
  }
  const tot = $('#gTotal');
  if (tot) tot.textContent = size(sum(S.games, gameTotal));
  renderNav();
});
on('appSize', a => {
  const app = S.apps?.find(x => x.key === a.key);
  if (!app) return;
  app.size = a.size; app.exact = true;
  const el = document.querySelector(`[data-app="${CSS.escape(a.key)}"] [data-as]`);
  if (el) el.textContent = size(a.size);
});
on('dupesProgress', p => {
  S.dupesProg = p;
  const bar = $('#dpBar'), txt = $('#dpTxt');
  if (bar) bar.style.width = (p.done / Math.max(1, p.total) * 100).toFixed(1) + '%';
  if (txt) txt.textContent = `${num(p.done)} von ${num(p.total)} Kandidaten`;
});

async function boot() {
  if (!hasHost) { view.innerHTML = '<div class="empty"><h3>FreeSizeTree</h3><p>Diese Oberfläche läuft nur innerhalb der App.</p></div>'; return; }
  const init = await api('init');
  Object.assign(S, { admin: init.admin, drives: init.drives, recycle: init.recycle, summary: init.summary });
  if (init.summary) S.nodeId = init.summary.rootId;
  go(init.startPage || 'overview', { force: !!init.startScan });
  if (init.startScan) startScan(init.startScan);
  api('games').then(g => {
    S.games = g;
    renderNav();
    if (S.page === 'overview' && !S.scanning) render();
  }).catch(() => { });
}
boot();
