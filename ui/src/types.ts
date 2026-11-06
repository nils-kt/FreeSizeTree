export type PageId = 'overview' | 'explorer' | 'cleanup' | 'games' | 'apps' | 'files' | 'dupes' | 'types';

export interface Drive {
  path: string;
  label: string;
  type: string;
  format?: string;
  total: number;
  free: number;
  system: boolean;
}

export interface Recycle { size: number; count: number }

export interface Reclaim { safe: number; tool: number; review: number; keep: number; quick: number; dev: number }

export interface Summary {
  rootId: number;
  path: string;
  size: number;
  files: number;
  dirs: number;
  errors: number;
  cloud: number;
  seconds: number;
  cancelled: boolean;
  drive: { path: string; total: number; free: number; label?: string } | null;
  reclaim: Reclaim;
  hintCount: number;
  top: { id: number; name: string; size: number }[];
}

export interface Init {
  admin: boolean;
  version: string;
  demo: boolean;
  drives: Drive[];
  recycle: Recycle;
  startPage: PageId | null;
  startScan: string | null;
  summary: Summary | null;
  busy: boolean;
}

export interface ScanProgress { files: number; dirs: number; bytes: number; current: string; pct: number; elapsed: number }

export interface NodeItem {
  id: number;
  name: string;
  kind: 'dir' | 'file';
  size: number;
  files?: number;
  dirs?: number;
  ext?: string;
  mod: number | null;
  denied?: boolean;
  cloud?: boolean;
}

export interface NodeInfo {
  id: number;
  name: string;
  path: string;
  size: number;
  files: number;
  dirs: number;
  mod: number | null;
  denied: boolean;
  parentId: number;
  crumbs: { id: number; name: string }[];
  items: NodeItem[];
  moreFiles: number;
}

/** Chart node: i = id, n = name, s = size, t = d(ir) | f(ile) | o(ther, small items) */
export interface ChartNode { i: number; n: string; s: number; t: 'd' | 'f' | 'o'; c?: ChartNode[] }

export type Safety = 'safe' | 'tool' | 'review' | 'keep';
export type HintAction = 'None' | 'EmptyRecycleBin' | 'CleanContents' | 'DeleteFolder' | 'DeleteFile' | 'Hibernate' | 'StorageSettings';

export interface Hint {
  hid: number;
  category: string;
  safety: Safety;
  advice: string;
  path: string;
  size: number;
  itemId: number;
  isDir: boolean;
  action: HintAction;
}

export interface GameExtra { label: string; path: string; size: number }

export interface Game {
  key: string;
  name: string;
  source: string;
  kind: string;
  path: string;
  size: number;
  exact: boolean;
  lastPlayed: number | null;
  installed: number | null;
  image: string | null;
  icon: string | null;
  launchUrl: string | null;
  storeUrl: string | null;
  uninstallKind: string;
  uninstallHint: string | null;
  extras: GameExtra[];
}

export interface App {
  key: string;
  name: string;
  publisher: string | null;
  version: string | null;
  installed: number | null;
  size: number;
  exact: boolean;
  location: string | null;
  icon: string | null;
  canUninstall: boolean;
  user: boolean;
  missing: boolean;
}

export interface FileRow { id: number; name: string; dir: string; size: number; ext: string; mod: number | null }

export interface TypeRow { ext: string; bytes: number; count: number; share: number }

export interface DupeGroup {
  size: number;
  wasted: number;
  exact: boolean;
  files: { id: number; name: string; dir: string; mod: number | null }[];
}

export interface CleanProgress {
  index: number;
  count: number;
  category: string;
  path: string;
  planned: number;
  done: number;
  itemSize: number;
  freed: number;
  files: number;
  cancelling: boolean;
}

export interface CleanResult { freed: number; files: number; cancelled: boolean; errors: string[]; recycle: Recycle }

/** Something that can be revealed, opened or deleted. */
export interface Item { id: number; kind: 'dir' | 'file'; name: string; size: number; path: string }
