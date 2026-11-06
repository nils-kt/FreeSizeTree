import { Badge, Button, Tooltip } from '@fluentui/react-components';
import {
  AppFolder24Regular, ArrowDownload24Regular, BrainCircuit24Regular, Box24Regular, Clock24Regular, Code24Regular,
  DataPie20Regular, Delete20Regular, Delete24Regular, ErrorCircle24Regular, Flash24Regular, Folder24Regular, HardDrive24Regular,
  Layer24Regular, Open20Regular, Shield24Regular, Sparkle20Regular, WeatherMoon24Regular,
} from '@fluentui/react-icons';
import { useEffect, useState, type ReactNode } from 'react';
import { AUTO_ACTIONS, deleteItem, loadHints, navigate, openAutoClean, openHintClean, reveal, runSpecialHint } from '../actions';
import { Loading, NeedScan, PageHead } from '../components/common';
import { plural, size, sum } from '../format';
import { notifyError } from '../notify';
import { useStore } from '../store';
import type { Hint, Safety } from '../types';

export const SAFETY: Record<Safety, { label: string; c: string; badge: 'success' | 'brand' | 'warning' | 'danger' }> = {
  safe: { label: 'Sicher löschbar', c: 'var(--green)', badge: 'success' },
  tool: { label: 'Mit Windows-Tool', c: 'var(--blue)', badge: 'brand' },
  review: { label: 'Prüfen', c: 'var(--amber)', badge: 'warning' },
  keep: { label: 'Nicht löschen', c: 'var(--red)', badge: 'danger' },
};

const ACTION_LABEL: Partial<Record<Hint['action'], string>> = {
  EmptyRecycleBin: 'Papierkorb leeren', CleanContents: 'Inhalt löschen', DeleteFolder: 'Ordner löschen',
  DeleteFile: 'Datei löschen', Hibernate: 'Ruhezustand aus', StorageSettings: 'Speichereinstellungen',
};

function hintIcon(cat: string): ReactNode {
  const m: [RegExp, ReactNode][] = [
    [/Papierkorb/, <Delete24Regular />], [/Temp/, <Clock24Regular />], [/Absturz|Speicherabbild/, <ErrorCircle24Regular />],
    [/Paket|npm/, <Box24Regular />], [/Cache/, <Flash24Regular />], [/Rust|Next|Python/, <Code24Regular />],
    [/KI|Pinokio/, <BrainCircuit24Regular />], [/Download/, <ArrowDownload24Regular />],
    [/Virtuelle|Disk|Auslagerung/, <HardDrive24Regular />], [/Ruhezustand/, <WeatherMoon24Regular />],
    [/Windows|Wiederherstellung|Übermittlung/, <Shield24Regular />], [/Backup/, <Layer24Regular />], [/App/, <AppFolder24Regular />],
  ];
  return m.find(([re]) => re.test(cat))?.[1] ?? <Folder24Regular />;
}

export function Cleanup() {
  const summary = useStore(s => s.summary);
  const hints = useStore(s => s.hints);
  const [filter, setFilter] = useState<Safety | 'all'>('all');

  useEffect(() => { if (summary && !hints) loadHints().catch(notifyError); }, [summary, hints]);

  if (!summary) return <NeedScan />;
  if (!hints) return <div className="page"><Loading label="Suche Möglichkeiten zum Aufräumen …" /></div>;
  const by = (k: Safety) => hints.filter(h => h.safety === k);
  const list = filter === 'all' ? hints : by(filter);

  return (
    <div className="page">
      <PageHead title="Aufräumen"
        sub={<>{plural(hints.length, 'Empfehlung', 'Empfehlungen')} · {size(sum(by('safe'), h => h.size))} sofort sicher freigebbar</>}>
        <Button appearance="primary" icon={<Sparkle20Regular />} onClick={openAutoClean}>Automatisch bereinigen</Button>
      </PageHead>

      <div className="safety-sum">
        {(Object.keys(SAFETY) as Safety[]).map(k => (
          <button key={k} className={`card${filter === k ? ' on' : ''}`} style={{ ['--c' as string]: SAFETY[k].c }}
            onClick={() => setFilter(filter === k ? 'all' : k)} aria-pressed={filter === k}>
            <div className="k"><i />{SAFETY[k].label}</div>
            <div className="v">{size(sum(by(k), h => h.size))}</div>
            <div className="caption">{plural(by(k).length, 'Eintrag', 'Einträge')}</div>
          </button>
        ))}
      </div>

      <div className="rows">
        {list.map(h => <HintRow key={h.path} h={h} />)}
        {!list.length && <div className="empty">Nichts gefunden – hier ist bereits aufgeräumt.</div>}
      </div>
    </div>
  );
}

function HintRow({ h }: { h: Hint }) {
  const sf = SAFETY[h.safety];
  const act = ACTION_LABEL[h.action];
  const run = () => AUTO_ACTIONS.has(h.action) ? openHintClean(h) : runSpecialHint(h);
  return (
    <div className="row hint">
      <div className="ico">{hintIcon(h.category)}</div>
      <div className="main">
        <div className="title">{h.category}<Badge appearance="tint" color={sf.badge} size="small">{sf.label}</Badge></div>
        <div className="desc path ellipsis" title={h.path}>{h.path}</div>
        <div className="advice">{h.advice}</div>
      </div>
      <div className="size num">{size(h.size)}</div>
      <div className="side">
        {act && <Button size="small" appearance={h.safety === 'safe' ? 'primary' : 'secondary'} onClick={run}>{act}</Button>}
        {h.isDir && (
          <Tooltip content="Im Analyse-Explorer anzeigen" relationship="label">
            <Button size="small" appearance="subtle" icon={<DataPie20Regular />} onClick={() => navigate(h.itemId)} />
          </Tooltip>
        )}
        <Tooltip content="Im Windows-Explorer zeigen" relationship="label">
          <Button size="small" appearance="subtle" icon={<Open20Regular />} onClick={() => reveal(h.path)} />
        </Tooltip>
        {h.safety === 'review' && (
          <Tooltip content="Löschen" relationship="label">
            <Button size="small" appearance="subtle" icon={<Delete20Regular />}
              onClick={() => deleteItem({ id: h.itemId, kind: h.isDir ? 'dir' : 'file', name: h.path.split('\\').pop() ?? h.path, size: h.size, path: h.path })} />
          </Tooltip>
        )}
      </div>
    </div>
  );
}
