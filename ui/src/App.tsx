import { Button, FluentProvider, ProgressBar } from '@fluentui/react-components';
import {
  AppsList20Regular, Broom20Regular, DataPie20Regular, Delete20Regular, DocumentCopy20Regular, DocumentData20Regular,
  Games20Regular, Home20Regular, Shapes20Regular, Shield20Regular, ShieldCheckmark20Regular,
} from '@fluentui/react-icons';
import { Component, type ReactNode } from 'react';
import { elevate, emptyRecycle, gameTotal, go, NEEDS_SCAN } from './actions';
import { hasHost } from './bridge';
import { CleanDialog } from './components/CleanDialog';
import { Empty } from './components/common';
import { ConfirmHost, MenuHost, ToastHost } from './components/Hosts';
import { size, sum } from './format';
import { Apps } from './pages/Apps';
import { Cleanup } from './pages/Cleanup';
import { Dupes } from './pages/Dupes';
import { Explorer } from './pages/Explorer';
import { Files } from './pages/Files';
import { Games } from './pages/Games';
import { Overview } from './pages/Overview';
import { Types } from './pages/Types';
import { useStore } from './store';
import { darkTheme, lightTheme, useDarkMode } from './theme';
import type { PageId } from './types';

const PAGES: { id: PageId; label: string; icon: ReactNode }[] = [
  { id: 'overview', label: 'Übersicht', icon: <Home20Regular /> },
  { id: 'explorer', label: 'Explorer', icon: <DataPie20Regular /> },
  { id: 'cleanup', label: 'Aufräumen', icon: <Broom20Regular /> },
  { id: 'games', label: 'Spiele', icon: <Games20Regular /> },
  { id: 'apps', label: 'Programme', icon: <AppsList20Regular /> },
  { id: 'files', label: 'Große Dateien', icon: <DocumentData20Regular /> },
  { id: 'dupes', label: 'Duplikate', icon: <DocumentCopy20Regular /> },
  { id: 'types', label: 'Dateitypen', icon: <Shapes20Regular /> },
];

export function App() {
  const dark = useDarkMode();
  const page = useStore(s => s.page);
  const ready = useStore(s => s.ready);
  const scanning = useStore(s => s.scanning && !s.fullScan);
  const progress = useStore(s => s.progress);

  return (
    <FluentProvider theme={dark ? darkTheme : lightTheme}>
      <div className={`app ${dark ? 'dark' : 'light'}`}>
        <Nav />
        <main className="content">
          {/* folder rescans run in the background: only a thin bar at the top */}
          {scanning && <div className="topbar"><ProgressBar value={progress && progress.pct >= 0 ? progress.pct : undefined} thickness="medium" /></div>}
          <div className={`scroll${page === 'explorer' ? ' fill' : ''}`}>
            {!hasHost
              ? <Empty title="FreeSizeTree">Diese Oberfläche läuft nur innerhalb der App.</Empty>
              : ready && <PageBoundary page={page}><Page page={page} dark={dark} /></PageBoundary>}
          </div>
        </main>
        <ConfirmHost />
        <CleanDialog />
        <MenuHost />
        <ToastHost />
      </div>
    </FluentProvider>
  );
}

/** Shows a broken page as an error instead of an empty window. */
class PageBoundary extends Component<{ page: PageId; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { page: PageId }) { if (prev.page !== this.props.page && this.state.error) this.setState({ error: null }); }
  render() {
    return this.state.error
      ? <Empty title="Diese Ansicht konnte nicht angezeigt werden">{this.state.error.message}</Empty>
      : this.props.children;
  }
}

function Page({ page, dark }: { page: PageId; dark: boolean }) {
  switch (page) {
    case 'overview': return <Overview dark={dark} />;
    case 'explorer': return <Explorer dark={dark} />;
    case 'cleanup': return <Cleanup />;
    case 'games': return <Games />;
    case 'apps': return <Apps />;
    case 'files': return <Files />;
    case 'dupes': return <Dupes />;
    case 'types': return <Types dark={dark} />;
  }
}

function Nav() {
  const page = useStore(s => s.page);
  const summary = useStore(s => s.summary);
  const games = useStore(s => s.games);
  const apps = useStore(s => s.apps);
  const recycle = useStore(s => s.recycle);
  const admin = useStore(s => s.admin);

  const count = (id: PageId) => {
    if (id === 'cleanup' && summary) return size(summary.reclaim.safe + summary.reclaim.tool);
    if (id === 'games' && games) return size(sum(games, gameTotal));
    if (id === 'apps' && apps) return String(apps.length);
    return null;
  };

  return (
    <nav className="nav">
      <div className="nav-title"><img src="logo.svg" alt="" />FreeSizeTree</div>
      <div className="nav-list">
        {PAGES.map(p => (
          <button key={p.id} className={`nav-item${page === p.id ? ' active' : ''}`} disabled={NEEDS_SCAN.has(p.id) && !summary}
            aria-current={page === p.id ? 'page' : undefined} onClick={() => go(p.id)}>
            {p.icon}<span className="lbl">{p.label}</span>
            {count(p.id) && <span className="count">{count(p.id)}</span>}
          </button>
        ))}
      </div>
      <div className="nav-foot">
        <div className="nav-status">
          <Delete20Regular />
          <div className="grow">Papierkorb<b>{recycle.count ? size(recycle.size) : 'Leer'}</b></div>
          {recycle.count > 0 && <Button size="small" onClick={emptyRecycle}>Leeren</Button>}
        </div>
        <div className="nav-status">
          {admin ? <ShieldCheckmark20Regular /> : <Shield20Regular />}
          <div className="grow">{admin ? 'Administrator' : 'Eingeschränkte Rechte'}<b>{admin ? 'Voller Zugriff' : 'Kein Admin'}</b></div>
          {!admin && <Button size="small" onClick={elevate} title="Als Administrator neu starten – zählt auch geschützte Systemordner">Neu starten</Button>}
        </div>
      </div>
    </nav>
  );
}
