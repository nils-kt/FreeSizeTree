export const MB = 1024 ** 2;
export const GB = 1024 ** 3;
export const DAY = 86_400_000;

export function size(b: number | null | undefined): string {
  if (b == null || isNaN(b)) return '–';
  if (b < 1024) return Math.round(b) + ' B';
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = b, i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
  return v.toLocaleString('de-DE', { maximumFractionDigits: v >= 100 ? 0 : v >= 10 ? 1 : 2 }) + ' ' + units[i];
}

export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('de-DE');

export const percent = (p: number) => (p >= 10 ? Math.round(p).toString() : p.toFixed(1).replace('.', ',')) + ' %';

export const seconds = (s: number) => s.toFixed(1).replace('.', ',') + ' s';

export const date = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';

const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
export function ago(ms: number | null | undefined): string {
  if (!ms) return 'unbekannt';
  const d = (Date.now() - ms) / DAY;
  if (d < 1) return 'heute';
  if (d < 30) return rtf.format(-Math.round(d), 'day');
  if (d < 365) return rtf.format(-Math.round(d / 30.4), 'month');
  return rtf.format(-Math.round(d / 365), 'year');
}

export const sum = <T,>(a: readonly T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);

export const joinPath = (dir: string, name: string) => (dir.endsWith('\\') ? dir + name : dir + '\\' + name);

export function hashHue(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

export const initials = (s: string) =>
  s.replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

export const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;
