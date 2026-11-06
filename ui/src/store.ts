import type { ReactNode } from 'react';
import { create } from 'zustand';
import type {
  App, CleanProgress, CleanResult, DupeGroup, Drive, FileRow, Game, Hint, PageId, Recycle, ScanProgress, Summary, TypeRow,
} from './types';

export interface MenuEntry {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export interface MenuState { x: number; y: number; title?: string; items: (MenuEntry | '-')[] }

export interface ConfirmButton { label: string; value: string | null; appearance?: 'primary' | 'danger' | 'secondary' }

export interface ConfirmState {
  title: string;
  body: ReactNode;
  buttons: ConfirmButton[];
  resolve: (value: string | null) => void;
}

/** The cleanup dialog: choose → run (cannot be closed, only cancelled) → done. */
export type CleanDialog =
  | { phase: 'select'; items: Hint[]; selected: string[] }
  | { phase: 'run'; items: Hint[]; progress: CleanProgress | null; cancelling: boolean }
  | { phase: 'done'; items: Hint[]; result: CleanResult };

export interface State {
  ready: boolean;
  page: PageId;
  admin: boolean;
  demo: boolean;
  version: string;
  drives: Drive[];
  recycle: Recycle;
  summary: Summary | null;

  scanning: boolean;
  fullScan: boolean;
  scanPath: string;
  progress: ScanProgress | null;

  nodeId: number | null;
  chartMode: 'sunburst' | 'treemap';
  hints: Hint[] | null;
  games: Game[] | null;
  apps: App[] | null;
  files: FileRow[] | null;
  fileExt: string | null;
  types: TypeRow[] | null;
  dupes: DupeGroup[] | null;
  deleted: ReadonlySet<number>;

  menu: MenuState | null;
  confirm: ConfirmState | null;
  clean: CleanDialog | null;
}

export const useStore = create<State>(() => ({
  ready: false,
  page: 'overview',
  admin: false,
  demo: false,
  version: '',
  drives: [],
  recycle: { size: 0, count: 0 },
  summary: null,

  scanning: false,
  fullScan: false,
  scanPath: '',
  progress: null,

  nodeId: null,
  chartMode: 'sunburst',
  hints: null,
  games: null,
  apps: null,
  files: null,
  fileExt: null,
  types: null,
  dupes: null,
  deleted: new Set(),

  menu: null,
  confirm: null,
  clean: null,
}));

export const get = useStore.getState;
export const set = useStore.setState;
