// Used by --render-docs (DocRenderer.cs) to put the demo app into the states shown in the README.
import { api } from './bridge';
import { go, isBuild, isCache, loadHints, openAutoClean } from './actions';
import { get, set } from './store';
import type { DupeGroup, PageId } from './types';

export function registerDocsHook() {
  (window as unknown as { fst: unknown }).fst = {
    go: (page: PageId) => go(page),
    reset: () => set({ scanning: false, fullScan: false, progress: null, clean: null, confirm: null, menu: null }),
    scan: () => {
      set({
        scanning: true, fullScan: true, scanPath: 'C:\\',
        progress: {
          files: 1_284_311, dirs: 203_118, bytes: 512e9, pct: 0.61, elapsed: 23.4,
          current: 'C:\\Users\\alex\\Projects\\web-shop\\node_modules\\@babel\\core\\lib',
        },
      });
      go('overview');
    },
    chart: (mode: 'sunburst' | 'treemap') => {
      set({ chartMode: mode, nodeId: get().summary?.rootId ?? null });
      go('explorer');
    },
    autoClean: () => openAutoClean(),
    cleaning: async () => {
      const all = await loadHints();
      const items = [...all.filter(isCache), ...all.filter(isBuild).slice(0, 2)];
      const planned = items.reduce((s, h) => s + h.size, 0);
      const i = Math.min(2, items.length - 1);
      const done = items.slice(0, i).reduce((s, h) => s + h.size, 0);
      set({
        clean: {
          phase: 'run', items, cancelling: false,
          progress: {
            index: i, count: items.length, category: items[i].category, planned, done, itemSize: items[i].size,
            freed: done + items[i].size * 0.4, files: 48_213, cancelling: false,
            path: items[i].path + '\\a4\\f19c2e7b0d.tmp',
          },
        },
      });
    },
    dupes: async () => {
      set({ dupes: await api<DupeGroup[]>('dupes', { minSize: 100 * 1024 ** 2 }) });
      go('dupes');
    },
  };
}
