import {
  Badge, Button, Dropdown, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Option, SearchBox, Tooltip,
} from '@fluentui/react-components';
import { ArrowClockwise20Regular, Delete20Regular, FolderOpen20Regular, MoreHorizontal20Regular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { appSize, loadApps, reveal, uninstallApp } from '../actions';
import { Loading, PageHead } from '../components/common';
import { date, initials, plural, size, sum } from '../format';
import { useStore } from '../store';
import type { App } from '../types';

type Sort = 'size' | 'name' | 'date';
const SORT_LABEL: Record<Sort, string> = { size: 'Größe', name: 'Name', date: 'Installationsdatum' };

export function Apps() {
  const apps = useStore(s => s.apps);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('size');

  useEffect(() => { if (!apps) loadApps(); }, [apps]);
  if (!apps) return <div className="page"><Loading label="Lese installierte Programme …" /></div>;

  const q = query.trim().toLowerCase();
  let list = q ? apps.filter(a => `${a.name} ${a.publisher ?? ''}`.toLowerCase().includes(q)) : apps;
  const sorters: Record<Sort, (a: App, b: App) => number> = {
    size: (a, b) => appSize(b) - appSize(a),
    name: (a, b) => a.name.localeCompare(b.name, 'de'),
    date: (a, b) => (b.installed || 0) - (a.installed || 0),
  };
  list = [...list].sort(sorters[sort]);
  const orphans = apps.filter(a => a.missing).length;

  return (
    <div className="page">
      <PageHead title="Programme"
        sub={<>{plural(apps.length, 'Programm', 'Programme')} · zusammen {size(sum(apps, appSize))}
          {orphans > 0 && <span style={{ color: 'var(--amber)' }}> · {plural(orphans, 'verwaister Eintrag', 'verwaiste Einträge')}</span>}</>}>
        <Tooltip content="Neu laden" relationship="label">
          <Button icon={<ArrowClockwise20Regular />} onClick={() => loadApps(true)} />
        </Tooltip>
      </PageHead>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <SearchBox placeholder="Programm suchen" value={query} onChange={(_, d) => setQuery(d.value)} style={{ width: 300 }} />
        <span className="grow" />
        <Dropdown value={`Sortieren: ${SORT_LABEL[sort]}`} selectedOptions={[sort]} onOptionSelect={(_, d) => setSort(d.optionValue as Sort)} style={{ minWidth: 220 }}>
          {(Object.keys(SORT_LABEL) as Sort[]).map(k => <Option key={k} value={k}>{SORT_LABEL[k]}</Option>)}
        </Dropdown>
      </div>

      <div className="rows">
        {list.map(a => <AppRow key={a.key} a={a} />)}
        {!list.length && <div className="empty">Keine Programme gefunden.</div>}
      </div>
    </div>
  );
}

function AppRow({ a }: { a: App }) {
  const [icon, setIcon] = useState(!!a.icon);
  const details = [a.publisher, a.version, a.installed ? date(a.installed) : null].filter(Boolean).join(' | ');
  return (
    <div className="row" style={{ minHeight: 64 }}>
      {icon && a.icon
        ? <div className="app-ico"><img src={a.icon} alt="" onError={() => setIcon(false)} /></div>
        : <div className="app-ico ini">{initials(a.name)}</div>}
      <div className="main">
        <div className="title">
          <span className="ellipsis">{a.name}</span>
          {a.missing && (
            <Tooltip relationship="description" content="Der Programmordner existiert nicht mehr – nur der Eintrag in der Windows-Programmliste ist übrig.">
              <Badge appearance="tint" color="warning" size="small">Ordner fehlt</Badge>
            </Tooltip>
          )}
        </div>
        <div className="desc ellipsis">{details}{a.user ? ' | nur für diesen Benutzer' : ''}</div>
      </div>
      <div className="side num" style={{ minWidth: 110, justifyContent: 'flex-end' }}>
        {a.missing ? <span className="dim">belegt nichts</span> : a.size ? <>{size(a.size)}{!a.exact && <span className="dim">&nbsp;(geschätzt)</span>}</> : '–'}
      </div>
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button appearance="subtle" icon={<MoreHorizontal20Regular />} aria-label="Aktionen" />
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem icon={<FolderOpen20Regular />} disabled={!a.location} onClick={() => a.location && reveal(a.location)}>Installationsordner öffnen</MenuItem>
            <MenuItem icon={<Delete20Regular />} disabled={!a.canUninstall} onClick={() => uninstallApp(a)}>Deinstallieren …</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    </div>
  );
}
