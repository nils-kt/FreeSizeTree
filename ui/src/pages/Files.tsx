import { Button, SearchBox, Tooltip } from '@fluentui/react-components';
import { Delete20Regular, Dismiss12Regular, Open20Regular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { deleteItem, itemMenu, reveal } from '../actions';
import { api } from '../bridge';
import { ExtBadge, Loading, Meter, NeedScan, PageHead } from '../components/common';
import { Pill } from '../components/Pill';
import { ago, DAY, date, GB, joinPath, num, size } from '../format';
import { notifyError } from '../notify';
import { set, useStore } from '../store';
import { TYPE_GROUPS, typeColor } from '../theme';
import type { FileRow, Item } from '../types';

const FILTERS: { id: string; label: string; fn: (f: FileRow) => boolean }[] = [
  { id: 'all', label: 'Alle', fn: () => true },
  { id: 'huge', label: 'Über 1 GB', fn: f => f.size >= GB },
  { id: 'old', label: 'Älter als 1 Jahr', fn: f => !!f.mod && Date.now() - f.mod > 365 * DAY },
  ...TYPE_GROUPS.filter(g => ['Video', 'Archiv', 'Disk', 'Programm', 'KI-Modell', 'Bild'].includes(g.label))
    .map(g => ({ id: g.label, label: g.label, fn: (f: FileRow) => g.ext.includes(f.ext) })),
];

export function Files() {
  const summary = useStore(s => s.summary);
  const files = useStore(s => s.files);
  const ext = useStore(s => s.fileExt);
  const deleted = useStore(s => s.deleted);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (summary && !files) api<FileRow[]>('files').then(f => set({ files: f }), notifyError);
  }, [summary, files]);

  if (!summary) return <NeedScan />;
  if (!files) return <div className="page"><Loading label="Sammle große Dateien …" /></div>;

  const f = FILTERS.find(x => x.id === filter) ?? FILTERS[0];
  const q = query.trim().toLowerCase();
  const list = files.filter(x => !deleted.has(x.id) && (ext != null ? x.ext === ext : f.fn(x)) && (!q || joinPath(x.dir, x.name).toLowerCase().includes(q)));
  const shown = list.slice(0, 500);
  const max = Math.max(1, shown[0]?.size ?? 1);
  const asItem = (x: FileRow): Item => ({ id: x.id, kind: 'file', name: x.name, size: x.size, path: joinPath(x.dir, x.name) });

  return (
    <div className="page">
      <PageHead title="Große Dateien" sub={`Die ${num(files.length)} größten Dateien – nach Alter oder Typ filtern.`}>
        <SearchBox placeholder="Name oder Ordner" value={query} onChange={(_, d) => setQuery(d.value)} style={{ width: 260 }} />
      </PageHead>

      <div className="filters">
        {FILTERS.map(x => (
          <Pill key={x.id} on={filter === x.id && ext == null} onClick={() => { setFilter(x.id); set({ fileExt: null }); }}>{x.label}</Pill>
        ))}
        {ext != null && <Pill on icon={<Dismiss12Regular />} onClick={() => set({ fileExt: null })}>{ext || '(ohne Endung)'}</Pill>}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="dl">
          <colgroup><col /><col style={{ width: 130 }} /><col style={{ width: 170 }} /><col style={{ width: 80 }} /></colgroup>
          <thead><tr><th>Datei</th><th>Geändert</th><th className="r">Größe</th><th /></tr></thead>
          <tbody>
            {shown.map(x => (
              <tr key={x.id} onClick={e => itemMenu(e.clientX, e.clientY, asItem(x))}
                onContextMenu={e => { e.preventDefault(); itemMenu(e.clientX, e.clientY, asItem(x)); }}>
                <td>
                  <div className="namecell">
                    <ExtBadge ext={x.ext} />
                    <div><div className="t">{x.name}</div><div className="s mono" title={x.dir}>{x.dir}</div></div>
                  </div>
                </td>
                <td><div className="caption">{date(x.mod)}</div><div className="caption dim">{ago(x.mod)}</div></td>
                <td>
                  <div className="r num">{size(x.size)}</div>
                  <div style={{ marginTop: 6 }}><Meter value={x.size / max} color={typeColor(x.ext)} /></div>
                </td>
                <td onClick={e => e.stopPropagation()}>
                  <div className="acts">
                    <Tooltip content="Im Explorer zeigen" relationship="label">
                      <Button size="small" appearance="subtle" icon={<Open20Regular />} onClick={() => reveal(asItem(x).path)} />
                    </Tooltip>
                    <Tooltip content="Löschen" relationship="label">
                      <Button size="small" appearance="subtle" icon={<Delete20Regular />} onClick={() => deleteItem(asItem(x))} />
                    </Tooltip>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length > shown.length && <div className="list-more">+ {num(list.length - shown.length)} weitere</div>}
        {!list.length && <div className="list-more">Keine passenden Dateien.</div>}
      </div>
    </div>
  );
}
