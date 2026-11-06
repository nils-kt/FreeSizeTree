import {
  ArrowClockwise20Regular, Copy20Regular, DataPie20Regular, Delete20Regular, FolderOpen20Regular, Open20Regular,
} from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { api, on } from './bridge';
import { ago, size, sum } from './format';
import { notify, notifyError } from './notify';
import { get, set, type ConfirmButton, type MenuEntry } from './store';
import type {
  App, CleanProgress, CleanResult, Drive, Game, Hint, Init, Item, PageId, Recycle, ScanProgress, Summary,
} from './types';

// ================================================================ navigation

export const NEEDS_SCAN: ReadonlySet<PageId> = new Set(['explorer', 'cleanup', 'files', 'dupes', 'types']);

export function go(page: PageId) {
  if (NEEDS_SCAN.has(page) && !get().summary) page = 'overview';
  set({ page, menu: null });
}

export function navigate(id: number) {
  set({ nodeId: id });
  go('explorer');
}

// ================================================================ dialogs & menus

export const CANCEL: ConfirmButton = { label: 'Abbrechen', value: null };

export function confirm(title: string, body: ReactNode, buttons: ConfirmButton[]): Promise<string | null> {
  return new Promise(resolve => set({ confirm: { title, body, buttons, resolve } }));
}

export function showMenu(x: number, y: number, title: string | undefined, items: (MenuEntry | '-' | false | null | undefined)[]) {
  set({ menu: { x, y, title, items: items.filter((i): i is MenuEntry | '-' => !!i) } });
}

export function itemMenu(x: number, y: number, it: Item) {
  showMenu(x, y, it.path, [
    it.kind === 'dir' && { label: 'Hineinzoomen', icon: <DataPie20Regular />, onClick: () => navigate(it.id) },
    { label: 'Im Explorer zeigen', icon: <Open20Regular />, onClick: () => reveal(it.path) },
    { label: it.kind === 'dir' ? 'Ordner öffnen' : 'Öffnen', icon: <FolderOpen20Regular />, onClick: () => api('open', { path: it.path }).catch(notifyError) },
    { label: 'Pfad kopieren', icon: <Copy20Regular />, onClick: () => api('copy', { text: it.path }).then(() => notify('Pfad kopiert', 'info'), notifyError) },
    it.kind === 'dir' && { label: 'Neu scannen', icon: <ArrowClockwise20Regular />, onClick: () => rescan(it.id) },
    '-',
    { label: `Löschen … (${size(it.size)})`, icon: <Delete20Regular />, danger: true, onClick: () => deleteItem(it) },
  ]);
}

// ================================================================ host actions

export const reveal = (path: string) => api('reveal', { path }).catch(notifyError);
export const openUrl = (url: string) => api('openUrl', { url }).catch(notifyError);

export async function refreshDrives() {
  set({ drives: await api<Drive[]>('drives') });
}

export async function refreshRecycle() {
  set({ recycle: await api<Recycle>('recycleInfo') });
}

/** Reloads everything that depends on free space after files were removed. */
export async function refreshAfterChange() {
  const [drives, recycle, summary] = await Promise.all([
    api<Drive[]>('drives'), api<Recycle>('recycleInfo'), api<Summary | null>('summary'),
  ]);
  set({ drives, recycle, summary, hints: null, files: null });
}

export async function startScan(path: string) {
  if (get().scanning) return;
  set({ scanning: true, fullScan: true, progress: null, scanPath: path });
  go('overview');
  try {
    await api('scan', { path });
  } catch (e) {
    set({ scanning: false, fullScan: false });
    notifyError(e);
  }
}

export const cancelScan = () => api('cancel').catch(notifyError);

export async function pickFolder() {
  const p = await api<string | null>('pickFolder').catch(notifyError);
  if (p) startScan(p);
}

export async function elevate() {
  const ok = await api<boolean>('elevate').catch(notifyError);
  if (ok === false) notify('Administratorrechte wurden nicht erteilt.', 'info');
}

export async function emptyRecycle() {
  try {
    set({ recycle: await api<Recycle>('emptyRecycle') });
    refreshDrives();
  } catch (e) { notifyError(e); }
}

export async function rescan(id: number) {
  try { await api('rescan', { id }); } catch (e) { notifyError(e); }
}

const SYSTEM_PATH = /^[a-z]:\\(windows|program files|program files \(x86\)|programdata)(\\|$)/i;

export async function deleteItem(it: Item) {
  const choice = await confirm(`„${it.name}“ löschen?`, <>
    <div className="dlg-path">{it.path}</div>
    <p>Größe: <b>{size(it.size)}</b></p>
    {SYSTEM_PATH.test(it.path) && <p className="dlg-warn">Das liegt in einem System- oder Programmordner. Löschen kann Windows oder Programme beschädigen – deinstalliere Programme besser über „Programme“.</p>}
    <p>Im Papierkorb belegt es weiter Platz, bis du ihn leerst. „Endgültig löschen“ gibt den Platz sofort frei.</p>
  </>, [{ label: 'Endgültig löschen', value: 'permanent', appearance: 'danger' }, { label: 'In den Papierkorb', value: 'recycle' }, CANCEL]);
  if (!choice) return;
  try {
    const r = await api<{ freed: number; exists: boolean }>('delete', { id: it.id, mode: choice });
    set({ deleted: new Set([...get().deleted, it.id]) });
    if (r.exists) notify('Nur teilweise gelöscht – einige Dateien werden gerade benutzt.', 'warning');
    else notify(choice === 'recycle' ? `In den Papierkorb verschoben (${size(it.size)})` : `${size(r.freed || it.size)} freigegeben`);
    refreshRecycle();
    refreshDrives();
  } catch (e) { notifyError(e); }
}

// ================================================================ cleanup

export const isCache = (h: Hint) => h.safety === 'safe' && (h.action === 'CleanContents' || h.action === 'EmptyRecycleBin');
export const isBuild = (h: Hint) => h.safety === 'safe' && h.action === 'DeleteFolder';
export const AUTO_ACTIONS: ReadonlySet<string> = new Set(['EmptyRecycleBin', 'CleanContents', 'DeleteFolder', 'DeleteFile']);

export async function loadHints(): Promise<Hint[]> {
  let hints = get().hints;
  if (!hints) set({ hints: (hints = await api<Hint[]>('hints')) });
  return hints;
}

/** Opens the automatic cleanup: caches and temp files are preselected, build folders are opt-in. */
export async function openAutoClean() {
  let all: Hint[];
  try { all = await loadHints(); } catch (e) { return notifyError(e); }
  const caches = all.filter(isCache), builds = all.filter(isBuild);
  if (!caches.length && !builds.length)
    return notify('Nichts zu tun – es gibt keine Caches, temporären Dateien oder Build-Ordner zum Bereinigen.', 'info');
  set({ clean: { phase: 'select', items: [...caches, ...builds], selected: (caches.length ? caches : builds).map(h => h.path) } });
}

/** Cleans a single recommendation through the same dialog. */
export function openHintClean(h: Hint) {
  set({ clean: { phase: 'select', items: [h], selected: [h.path] } });
}

export function toggleCleanItem(path: string, on: boolean) {
  const c = get().clean;
  if (c?.phase !== 'select') return;
  set({ clean: { ...c, selected: on ? [...c.selected, path] : c.selected.filter(p => p !== path) } });
}

export async function runClean() {
  const c = get().clean;
  if (c?.phase !== 'select') return;
  const items = c.items.filter(h => c.selected.includes(h.path));
  if (!items.length) return;
  set({ clean: { phase: 'run', items, progress: null, cancelling: false } });
  let result: CleanResult;
  try {
    result = await api<CleanResult>('autoClean', { paths: items.map(h => h.path) });
  } catch (e) {
    result = { freed: 0, files: 0, cancelled: false, errors: [e instanceof Error ? e.message : String(e)], recycle: get().recycle };
  }
  await refreshAfterChange().catch(() => {});
  set({ clean: { phase: 'done', items, result } });
}

export function cancelClean() {
  const c = get().clean;
  if (c?.phase !== 'run' || c.cancelling) return;
  set({ clean: { ...c, cancelling: true } });
  api('cancelClean').catch(notifyError);
}

export const closeClean = () => {
  if (get().clean?.phase !== 'run') set({ clean: null });
};

/** Hints that hand over to Windows (hibernation, storage settings). */
export async function runSpecialHint(h: Hint) {
  if (h.action === 'Hibernate') {
    const ok = await confirm('Ruhezustand deaktivieren?', <p>
      Damit wird <b>hiberfil.sys ({size(h.size)})</b> entfernt. Ruhezustand und Windows-Schnellstart sind danach aus – „Energie sparen“ funktioniert weiterhin. Windows fragt nach Administratorrechten.
    </p>, [{ label: 'Deaktivieren', value: 'ok', appearance: 'primary' }, CANCEL]);
    if (!ok) return;
  }
  try {
    const r = await api<{ freed: number; note?: string }>('clean', { path: h.path });
    notify(r.note ?? `${size(r.freed)} freigegeben`, r.note ? 'info' : 'success');
    await refreshAfterChange();
  } catch (e) { notifyError(e); }
}

// ================================================================ games & programs

export const gameTotal = (g: Game) => g.size + sum(g.extras ?? [], x => x.size);
export const isStale = (g: Game) => !!g.lastPlayed && Date.now() - g.lastPlayed > 180 * 86_400_000;
export const appSize = (a: App) => (a.missing ? 0 : a.size);

export async function loadGames(refresh = false) {
  if (refresh) set({ games: null });
  try { set({ games: await api<Game[]>('games', { refresh }) }); } catch (e) { notifyError(e); }
}

export async function loadApps(refresh = false) {
  if (refresh) set({ apps: null });
  try { set({ apps: await api<App[]>('apps', { refresh }) }); } catch (e) { notifyError(e); }
}

export async function uninstallGame(g: Game) {
  const how = {
    url: `${g.source} öffnet sich und fragt noch einmal nach.`,
    cmd: `Das Deinstallationsprogramm von ${g.source} wird gestartet.`,
    launcher: g.uninstallHint ?? '',
    settings: g.uninstallHint ?? '',
  }[g.uninstallKind] ?? '';
  const launcher = g.uninstallKind === 'launcher' || g.uninstallKind === 'settings';
  const ok = await confirm(`${g.name} deinstallieren?`, <>
    <p>Belegt <b>{size(gameTotal(g))}</b>{g.lastPlayed ? `, zuletzt gespielt ${ago(g.lastPlayed)}` : ''}.</p>
    <div className="dlg-path">{g.path}</div>
    <p>{how} Spielstände in der Cloud bleiben erhalten; das Spiel lässt sich jederzeit wieder installieren.</p>
  </>, [{ label: launcher ? 'Launcher öffnen' : 'Deinstallieren', value: 'ok', appearance: 'danger' }, CANCEL]);
  if (!ok) return;
  try {
    const r = await api<{ hint?: string }>('uninstallGame', { key: g.key });
    notify(r?.hint || `Deinstallation von ${g.name} gestartet. Danach hier auf „Neu suchen“ klicken.`, 'info');
  } catch (e) { notifyError(e); }
}

export async function uninstallApp(a: App) {
  const ok = await confirm(`${a.name} deinstallieren?`, <>
    <p>{[a.publisher, a.size ? size(a.size) : null].filter(Boolean).join(' · ')}</p>
    <p>Das Deinstallationsprogramm des Herstellers wird gestartet – folge dort den Anweisungen.</p>
  </>, [{ label: 'Deinstallieren', value: 'ok', appearance: 'danger' }, CANCEL]);
  if (!ok) return;
  try {
    await api('uninstallApp', { key: a.key });
    notify(`Deinstallation von ${a.name} gestartet.`, 'info');
  } catch (e) { notifyError(e); }
}

// ================================================================ host events

on('scanStart', () => set({ scanning: true }));
on<ScanProgress>('scanProgress', p => set({ progress: p }));

on<Summary & { error?: string }>('scanDone', async s => {
  const wasFull = get().fullScan;
  set({ scanning: false, fullScan: false, progress: null });
  if (s.error) return notify(s.error, 'error');
  set({ summary: s, nodeId: s.rootId, hints: null, files: null, types: null, dupes: null, deleted: new Set() });
  await refreshDrives().catch(() => {});
  if (wasFull) notify(`Scan fertig: ${size(s.size)} in ${s.seconds.toFixed(1).replace('.', ',')} s`);
  if (get().games) loadGames(true);
});

on<Summary>('treeChanged', s => {
  set({ summary: s, scanning: false, progress: null, hints: null, files: null });
  refreshDrives().catch(() => {});
});

let lastDriveRefresh = 0;
on<CleanProgress>('cleanProgress', p => {
  const c = get().clean;
  if (c?.phase === 'run') set({ clean: { ...c, progress: p } });
  // keep the free space behind the dialog current
  if (Date.now() - lastDriveRefresh > 1500) {
    lastDriveRefresh = Date.now();
    refreshDrives().catch(() => {});
  }
});

on<{ key: string; size: number; extras: Game['extras'] }>('gameSize', g => {
  const games = get().games;
  if (games) set({ games: games.map(x => x.key === g.key ? { ...x, size: g.size, extras: g.extras, exact: true } : x) });
});

on<{ key: string; size: number }>('appSize', a => {
  const apps = get().apps;
  if (apps) set({ apps: apps.map(x => x.key === a.key ? { ...x, size: a.size, exact: true } : x) });
});

// ================================================================ startup

export async function boot() {
  const init = await api<Init>('init');
  set({
    ready: true, admin: init.admin, demo: init.demo, version: init.version, drives: init.drives, recycle: init.recycle,
    summary: init.summary, nodeId: init.summary?.rootId ?? null,
  });
  if (init.startScan) startScan(init.startScan);
  else go(init.startPage ?? 'overview');
  loadGames();
  if (init.demo) (await import('./docs')).registerDocsHook();
}
