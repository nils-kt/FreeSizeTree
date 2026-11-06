import {
  Breadcrumb, BreadcrumbButton, BreadcrumbDivider, BreadcrumbItem, Button, SearchBox, Tooltip, ToggleButton,
} from '@fluentui/react-components';
import { ArrowClockwise20Regular, ArrowUp20Regular, DataPie20Regular, Delete20Regular, Grid20Regular, Open20Regular } from '@fluentui/react-icons';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { deleteItem, itemMenu, navigate, reveal, rescan } from '../actions';
import { api } from '../bridge';
import { Chart } from '../components/Chart';
import { ItemIcon, Loading, Meter, NeedScan, PageHead } from '../components/common';
import { date, joinPath, num, percent, size } from '../format';
import { notifyError } from '../notify';
import { set, useStore } from '../store';
import { topColor } from '../theme';
import type { ChartNode, Item, NodeInfo, NodeItem } from '../types';

export function Explorer({ dark }: { dark: boolean }) {
  const summary = useStore(s => s.summary);
  const nodeId = useStore(s => s.nodeId);
  const mode = useStore(s => s.chartMode);
  const [data, setData] = useState<{ node: NodeInfo; chart: ChartNode } | null>(null);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  // reload when the folder changes or the tree was updated (new summary object)
  useEffect(() => {
    if (!summary) return;
    let live = true;
    (async () => {
      let node: NodeInfo;
      try { node = await api<NodeInfo>('node', { id: nodeId ?? summary.rootId }); }
      catch { node = await api<NodeInfo>('node', { id: summary.rootId }); set({ nodeId: summary.rootId }); }
      const chart = await api<ChartNode>('chart', { id: node.id });
      if (live) setData({ node, chart });
    })().catch(notifyError);
    return () => { live = false; };
  }, [summary, nodeId]);

  useEffect(() => { setQuery(''); setShowAll(false); }, [nodeId]);

  // Backspace = up, like File Explorer
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' && !(document.activeElement instanceof HTMLInputElement) && data && data.node.parentId >= 0) navigate(data.node.parentId);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [data]);

  const colors = useMemo(() => {
    const m = new Map<number, string>();
    data?.chart.c?.forEach((c, i) => { if (c.t !== 'o') m.set(c.i, topColor(i, dark)); });
    return m;
  }, [data, dark]);

  if (!summary) return <NeedScan />;
  if (!data) return <div className="page"><Loading /></div>;
  const { node, chart } = data;
  const q = query.trim().toLowerCase();
  const rows = q ? node.items.filter(it => it.name.toLowerCase().includes(q)) : node.items;
  const shown = rows.slice(0, showAll ? 3000 : 300);
  const asItem = (it: NodeItem): Item => ({ id: it.id, kind: it.kind, name: it.name, size: it.size, path: joinPath(node.path, it.name) });

  return (
    <div className="page">
      <PageHead
        title={
          <Breadcrumb size="large" aria-label="Pfad">
            {node.crumbs.map((c, i) => (
              <Fragment key={c.id}>
                {i > 0 && <BreadcrumbDivider />}
                <BreadcrumbItem>
                  <BreadcrumbButton current={i === node.crumbs.length - 1} onClick={() => navigate(c.id)}
                    style={{ fontSize: i === node.crumbs.length - 1 ? 28 : 20, fontWeight: 600, height: 'auto', padding: '0 4px' }}>
                    {c.name.replace(/\\$/, '') || c.name}
                  </BreadcrumbButton>
                </BreadcrumbItem>
              </Fragment>
            ))}
          </Breadcrumb>
        }
        sub={<>{size(node.size)} · {num(node.files)} Dateien · {num(node.dirs)} Ordner{node.denied && <span style={{ color: 'var(--red)' }}> · kein Zugriff</span>}</>}>
        <SearchBox placeholder="In diesem Ordner suchen" value={query} onChange={(_, d) => { setQuery(d.value); setShowAll(false); }} style={{ width: 240 }} />
      </PageHead>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12, alignItems: 'center' }}>
        <Tooltip content="Übergeordneter Ordner (Rücktaste)" relationship="label">
          <Button appearance="subtle" icon={<ArrowUp20Regular />} disabled={node.parentId < 0} onClick={() => navigate(node.parentId)} />
        </Tooltip>
        <Tooltip content="Diesen Ordner neu scannen" relationship="label">
          <Button appearance="subtle" icon={<ArrowClockwise20Regular />} onClick={() => rescan(node.id)} />
        </Tooltip>
        <Button appearance="subtle" icon={<Open20Regular />} onClick={() => reveal(node.path)}>Im Explorer öffnen</Button>
        <span className="grow" />
        <ToggleButton appearance="subtle" checked={mode === 'sunburst'} icon={<DataPie20Regular />} onClick={() => set({ chartMode: 'sunburst' })}>Sunburst</ToggleButton>
        <ToggleButton appearance="subtle" checked={mode === 'treemap'} icon={<Grid20Regular />} onClick={() => set({ chartMode: 'treemap' })}>Treemap</ToggleButton>
      </div>

      <div className="explorer">
        <div className="card chart-card">
          <Chart data={chart} node={node} mode={mode} dark={dark} onOpen={navigate} onMenu={itemMenu} />
          <div className="chart-foot">Klick: hineinzoomen · {mode === 'sunburst' ? 'Mitte: zurück · ' : ''}Rechtsklick: Aktionen</div>
        </div>
        <div className="card list-card">
          <div className="list-scroll">
            <table className="dl">
              <colgroup><col /><col style={{ width: 150 }} /><col style={{ width: 96 }} /><col style={{ width: 76 }} /></colgroup>
              <thead><tr><th>Name</th><th>Anteil</th><th className="r">Größe</th><th /></tr></thead>
              <tbody>
                {shown.map(it => {
                  const pct = it.size / (node.size || 1);
                  const color = colors.get(it.id);
                  const sub = it.kind === 'dir'
                    ? `${num(it.files)} Dateien · ${num(it.dirs)} Ordner${it.denied ? ' · kein Zugriff' : ''}`
                    : `${date(it.mod)}${it.cloud ? ' · nur in der Cloud' : ''}`;
                  return (
                    <tr key={it.id}
                      onDoubleClick={() => it.kind === 'dir' && navigate(it.id)}
                      onClick={e => it.kind === 'dir' ? navigate(it.id) : itemMenu(e.clientX, e.clientY, asItem(it))}
                      onContextMenu={e => { e.preventDefault(); itemMenu(e.clientX, e.clientY, asItem(it)); }}>
                      <td>
                        <div className="namecell">
                          <ItemIcon kind={it.kind} ext={it.ext} />
                          <div><div className="t">{it.name}</div><div className="s">{sub}</div></div>
                        </div>
                      </td>
                      <td><div className="share"><Meter value={Math.max(pct, 0.003)} color={color} /><span>{percent(pct * 100)}</span></div></td>
                      <td className="r num">{size(it.size)}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="acts">
                          <Tooltip content="Im Explorer zeigen" relationship="label">
                            <Button size="small" appearance="subtle" icon={<Open20Regular />} onClick={() => reveal(asItem(it).path)} />
                          </Tooltip>
                          <Tooltip content="Löschen" relationship="label">
                            <Button size="small" appearance="subtle" icon={<Delete20Regular />} onClick={() => deleteItem(asItem(it))} />
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > shown.length && <div className="list-more"><Button size="small" onClick={() => setShowAll(true)}>Alle {num(rows.length)} anzeigen</Button></div>}
            {node.moreFiles > 0 && <div className="list-more">+ {num(node.moreFiles)} kleinere Dateien nicht aufgeführt</div>}
            {!rows.length && <div className="list-more">Keine Einträge</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
