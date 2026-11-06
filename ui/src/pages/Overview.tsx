import { Button, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle, ProgressBar } from '@fluentui/react-components';
import {
  ArrowClockwise20Regular, Broom20Regular, ChevronRight20Regular, Clock20Regular, DataPie24Regular, Document20Regular,
  Folder20Filled, Folder20Regular, FolderOpen20Regular, Games24Regular, HardDrive20Regular, Search20Regular,
  Sparkle24Regular, Storage20Regular,
} from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { cancelScan, elevate, gameTotal, go, navigate, openAutoClean, pickFolder, startScan } from '../actions';
import { Meter, PageHead } from '../components/common';
import { num, plural, seconds, size, sum } from '../format';
import { useStore } from '../store';
import { topColor } from '../theme';
import type { Drive, Game, Summary } from '../types';

export function Overview({ dark }: { dark: boolean }) {
  const summary = useStore(s => s.summary);
  const scanning = useStore(s => s.scanning && s.fullScan);
  const drives = useStore(s => s.drives);

  return (
    <div className="page">
      <PageHead title={summary ? 'Übersicht' : 'Willkommen'}
        sub={summary
          ? <>Zuletzt gescannt: {summary.path}{summary.cancelled ? ' (abgebrochen – Teilergebnis)' : ''}</>
          : 'Finde heraus, was deine Laufwerke füllt, und gib Speicherplatz frei.'}>
        <Button icon={<FolderOpen20Regular />} disabled={scanning} onClick={pickFolder}>Ordner scannen …</Button>
      </PageHead>

      <div className="section-title">Laufwerke</div>
      <div className="drives">
        {drives.map(d => <DriveCard key={d.path} d={d} current={!!summary && summary.path.toUpperCase().startsWith(d.path.toUpperCase())} />)}
      </div>

      {scanning ? <ScanCard /> : summary ? <Result s={summary} dark={dark} /> : <Welcome />}
    </div>
  );
}

function DriveCard({ d, current }: { d: Drive; current: boolean }) {
  const busy = useStore(s => s.scanning);
  const used = d.total - d.free, p = d.total ? used / d.total : 0;
  const name = `${d.label || (d.system ? 'System' : 'Lokaler Datenträger')} (${d.path.replace('\\', '')})`;
  return (
    <div className={`card drive${current ? ' current' : ''}`}>
      <HardDrive20Regular className="drive-ico" style={{ width: 32, height: 32 }} />
      <div className="di">
        <div className="dn">{name}</div>
        <Meter value={p} warn={p > 0.9} tall />
        <div className="caption">{size(d.free)} frei von {size(d.total)}</div>
      </div>
      <Button size="small" appearance={current ? 'secondary' : 'primary'} disabled={busy}
        icon={current ? <ArrowClockwise20Regular /> : <Search20Regular />} onClick={() => startScan(d.path)}>
        {current ? 'Neu scannen' : 'Scannen'}
      </Button>
    </div>
  );
}

function ScanCard() {
  const p = useStore(s => s.progress);
  const path = useStore(s => s.scanPath);
  return <>
    <div className="section-title">Scan</div>
    <div className="card scan-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div className="grow">
          <div style={{ fontWeight: 600 }}>{path} wird gescannt …</div>
          <div className="caption">{p ? (p.pct >= 0 ? `${Math.round(p.pct * 100)} % · ${seconds(p.elapsed)}` : seconds(p.elapsed)) : 'Wird gestartet …'}</div>
        </div>
        <Button onClick={cancelScan}>Abbrechen</Button>
      </div>
      <div style={{ marginTop: 16 }}><ProgressBar value={p && p.pct >= 0 ? p.pct : undefined} thickness="large" /></div>
      <div className="scan-grid">
        <div><div className="k">Dateien</div><div className="v num">{num(p?.files)}</div></div>
        <div><div className="k">Ordner</div><div className="v num">{num(p?.dirs)}</div></div>
        <div><div className="k">Größe</div><div className="v num">{size(p?.bytes ?? 0)}</div></div>
      </div>
      <div className="caption mono ellipsis">{p?.current}</div>
    </div>
  </>;
}

function Welcome() {
  const features = [
    [<DataPie24Regular />, 'Sehen, was Platz belegt', 'Sunburst und Treemap zeigen jeden Ordner nach Größe.'],
    [<Sparkle24Regular />, 'Automatisch bereinigen', 'Caches, temporäre Dateien und Build-Ordner mit einem Klick.'],
    [<Games24Regular />, 'Spiele und Programme', 'Steam, Epic, EA, Xbox … mit Größe und letzter Spielzeit.'],
  ] as const;
  return <>
    <div className="section-title">Erste Schritte</div>
    <div className="card welcome">
      <div>
        <h2>Wähle oben ein Laufwerk zum Scannen</h2>
        <p className="muted" style={{ margin: 0 }}>Der Scan liest alle Ordner parallel ein und dauert meist nur ein bis zwei Minuten. Danach siehst du genau, was sich zu löschen lohnt.</p>
      </div>
      <div className="features">
        {features.map(([icon, t, d]) => <div key={t}>{icon}<div><b>{t}</b><span className="caption">{d}</span></div></div>)}
      </div>
    </div>
  </>;
}

function Result({ s, dark }: { s: Summary; dark: boolean }) {
  const admin = useStore(st => st.admin);
  const games = useStore(st => st.games);
  const r = s.reclaim;
  const reclaim = r.safe + r.tool;
  const total = r.safe + r.tool + r.review || 1;
  const parts = [
    { label: 'Zwischenspeicher & Temp', v: r.quick, c: 'var(--green)' },
    { label: 'Build-Ordner & Co.', v: r.safe - r.quick, c: 'var(--teal)' },
    { label: 'Mit Windows-Tool', v: r.tool, c: 'var(--blue)' },
    { label: 'Prüfen', v: r.review, c: 'var(--amber)' },
  ];
  const big = size(reclaim).split(' ');
  const topMax = s.top[0]?.size || 1;

  return <>
    {s.errors > 0 && !admin && (
      <MessageBar intent="warning" style={{ marginTop: 16 }}>
        <MessageBarBody>
          <MessageBarTitle>{plural(s.errors, 'Ordner', 'Ordner')} ohne Zugriff</MessageBarTitle>
          Als Administrator werden auch Systemordner und andere Benutzerprofile mitgezählt.
        </MessageBarBody>
        <MessageBarActions><Button size="small" onClick={elevate}>Als Administrator neu starten</Button></MessageBarActions>
      </MessageBar>
    )}

    <div className="section-title">Bereinigungsempfehlungen</div>
    <div className="card pad">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div className="grow">
          <div className="caption">Kann freigegeben werden</div>
          <div className="reclaim-num">{big[0]}<small>{big[1]}</small></div>
          <div className="caption">{size(r.safe)} davon sind sicher löschbar · {plural(s.hintCount, 'Empfehlung', 'Empfehlungen')}</div>
        </div>
        <Broom20Regular style={{ width: 40, height: 40, color: 'var(--text3)' }} />
      </div>
      <div className="stack" style={{ marginTop: 16 }}>
        {parts.map(p => p.v > 0 && <i key={p.label} style={{ width: `${(p.v / total * 100).toFixed(2)}%`, background: p.c }} />)}
      </div>
      <div className="legend">
        {parts.map(p => <div key={p.label}><i style={{ background: p.c }} /><span>{p.label}</span>{size(p.v)}</div>)}
      </div>
      <div className="reclaim-actions">
        <Button appearance="primary" icon={<Sparkle24Regular />} onClick={openAutoClean}>Automatisch bereinigen</Button>
        <Button onClick={() => go('cleanup')}>Alle Empfehlungen anzeigen</Button>
      </div>
    </div>

    <div className="section-title">Scan</div>
    <div className="stats">
      <Stat icon={<HardDrive20Regular />} k="Gescannt" v={size(s.size)} sub={s.path} />
      <Stat icon={<Clock20Regular />} k="Dauer" v={seconds(s.seconds)} sub={`${num(Math.round(s.files / Math.max(s.seconds, 0.1)))} Dateien pro Sekunde`} />
      <Stat icon={<Document20Regular />} k="Dateien" v={num(s.files)} sub={s.cloud ? `${size(s.cloud)} nur in der Cloud` : 'alle lokal gespeichert'} />
      <Stat icon={<Folder20Regular />} k="Ordner" v={num(s.dirs)} sub={s.drive ? `${size(s.drive.free)} frei auf ${s.drive.path}` : ''} />
    </div>

    <div className="two" style={{ marginTop: 28 }}>
      <div>
        <div className="section-title" style={{ marginTop: 0 }}>Größte Ordner</div>
        <div className="card" style={{ padding: 6 }}>
          {s.top.map((t, i) => (
            <div key={t.id} className="folder-row" onClick={() => navigate(t.id)}>
              <Folder20Filled style={{ color: '#e8b443' }} />
              <span className="ellipsis">{t.name}</span>
              <span className="sz">{size(t.size)}</span>
              <Meter value={t.size / topMax} color={topColor(i, dark)} />
            </div>
          ))}
          <div className="folder-row" onClick={() => go('explorer')} style={{ gridTemplateRows: 'auto' }}>
            <Storage20Regular /><span>Alle Ordner im Explorer anzeigen</span><span className="sz"><ChevronRight20Regular /></span>
          </div>
        </div>
      </div>
      <div>
        <div className="section-title" style={{ marginTop: 0 }}>Spiele</div>
        <GamesCard games={games} />
      </div>
    </div>
  </>;
}

const Stat = ({ icon, k, v, sub }: { icon: ReactNode; k: string; v: string; sub: string }) => (
  <div className="card stat">
    <div className="k">{icon}{k}</div>
    <div className="v num">{v}</div>
    <div className="s ellipsis" title={sub}>{sub}</div>
  </div>
);

function GamesCard({ games }: { games: Game[] | null }) {
  if (!games) return <div className="card pad caption">Spiele werden gesucht …</div>;
  if (!games.length) return <div className="card pad caption">Keine Spiele gefunden.</div>;
  const top = [...games].sort((a, b) => gameTotal(b) - gameTotal(a)).slice(0, 5);
  return (
    <div className="card pad" style={{ cursor: 'default' }} onClick={() => go('games')}>
      <div className="covers">
        {top.map(g => (
          <div key={g.key} className="mini-cover" title={`${g.name} – ${size(gameTotal(g))}`}>
            <div className="fb">{g.name}</div>
            {g.image && <img src={g.image} alt="" onError={e => e.currentTarget.remove()} />}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 12 }}>
        <span className="grow caption">{games.length} Spiele belegen <b style={{ color: 'var(--colorNeutralForeground1)' }}>{size(sum(games, gameTotal))}</b></span>
        <ChevronRight20Regular />
      </div>
    </div>
  );
}
