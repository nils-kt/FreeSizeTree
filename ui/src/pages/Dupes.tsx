import { Badge, Button, ProgressBar, Radio, RadioGroup, Tooltip } from '@fluentui/react-components';
import { Checkmark24Regular, DocumentCopy20Regular, DocumentCopy24Regular, Open20Regular, Search20Regular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { deleteItem, reveal } from '../actions';
import { api, on } from '../bridge';
import { Empty, NeedScan, PageHead } from '../components/common';
import { date, GB, joinPath, MB, num, size, sum } from '../format';
import { notifyError } from '../notify';
import { set, useStore } from '../store';
import type { DupeGroup } from '../types';

const MINS = [[10 * MB, '10 MB'], [100 * MB, '100 MB'], [GB, '1 GB']] as const;

export function Dupes() {
  const summary = useStore(s => s.summary);
  const dupes = useStore(s => s.dupes);
  const deleted = useStore(s => s.deleted);
  const [min, setMin] = useState<number>(100 * MB);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => on<{ done: number; total: number }>('dupesProgress', setProg), []);

  if (!summary) return <NeedScan />;

  const start = async () => {
    setBusy(true);
    setProg(null);
    set({ dupes: null });
    try {
      const r = await api<DupeGroup[] | null>('dupes', { minSize: min });
      if (r) set({ dupes: r });
    } catch (e) { notifyError(e); }
    setBusy(false);
  };

  return (
    <div className="page">
      <PageHead title="Duplikate" sub="Gleiche Dateien an mehreren Orten – eine Kopie reicht meist." />

      <div className="row" style={{ marginBottom: 20 }}>
        <div className="ico"><DocumentCopy24Regular /></div>
        <div className="main">
          <div>Mindestgröße</div>
          <div className="desc">Dateien gleicher Größe werden per Prüfsumme verglichen.</div>
        </div>
        <RadioGroup layout="horizontal" value={String(min)} onChange={(_, d) => setMin(+d.value)} disabled={busy}>
          {MINS.map(([v, l]) => <Radio key={v} value={String(v)} label={l} />)}
        </RadioGroup>
        {busy
          ? <Button onClick={() => api('cancelDupes')}>Abbrechen</Button>
          : <Button appearance="primary" icon={<Search20Regular />} onClick={start}>{dupes ? 'Erneut suchen' : 'Suche starten'}</Button>}
      </div>

      {busy ? (
        <div className="card pad">
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Vergleiche Dateien …</div>
          <ProgressBar value={prog ? prog.done / Math.max(1, prog.total) : undefined} thickness="large" />
          <div className="caption" style={{ marginTop: 8 }}>{prog ? `${num(prog.done)} von ${num(prog.total)} Kandidaten` : 'Gruppiere nach Größe …'}</div>
        </div>
      ) : dupes ? (
        dupes.length ? <>
          <div className="section-title">{num(dupes.length)} Gruppen · {size(sum(dupes, g => g.wasted))} doppelt belegt</div>
          {dupes.map((g, gi) => (
            <div key={gi} className="card dupe-group">
              <div className="gh">
                <DocumentCopy20Regular />
                <b>{g.files.length} × {size(g.size)}</b>
                <Badge appearance="tint" color={g.exact ? 'success' : 'warning'} size="small">{g.exact ? 'identisch' : 'sehr wahrscheinlich identisch'}</Badge>
                <span className="grow" />
                <span className="caption">{size(g.wasted)} verschwendet</span>
              </div>
              {g.files.map(f => {
                const path = joinPath(f.dir, f.name);
                return (
                  <div key={f.id} className={`dupe-file${deleted.has(f.id) ? ' gone' : ''}`}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="ellipsis">{f.name}</div>
                      <div className="caption mono ellipsis">{f.dir}</div>
                    </div>
                    <span className="caption">{date(f.mod)}</span>
                    <Tooltip content="Im Explorer zeigen" relationship="label">
                      <Button size="small" appearance="subtle" icon={<Open20Regular />} onClick={() => reveal(path)} />
                    </Tooltip>
                    <Button size="small" disabled={deleted.has(f.id)} onClick={() => deleteItem({ id: f.id, kind: 'file', name: f.name, size: g.size, path })}>Diese löschen …</Button>
                  </div>
                );
              })}
            </div>
          ))}
        </> : <Empty icon={<Checkmark24Regular style={{ width: 48, height: 48 }} />} title="Keine Duplikate gefunden">Ab {size(min)} gibt es keine doppelten Dateien.</Empty>
      ) : (
        <Empty icon={<DocumentCopy24Regular style={{ width: 48, height: 48 }} />} title="Doppelte Dateien finden">
          Wähle eine Mindestgröße und starte die Suche.
        </Empty>
      )}
    </div>
  );
}
