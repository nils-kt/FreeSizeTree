import {
  Badge, Button, Dropdown, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, MessageBar, MessageBarActions, MessageBarBody,
  MessageBarTitle, Option, Tooltip,
} from '@fluentui/react-components';
import { ArrowClockwise20Regular, Delete20Regular, FolderOpen20Regular, Globe20Regular, MoreHorizontal20Regular, Play20Filled } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { gameTotal, isStale, loadGames, openUrl, reveal, uninstallGame } from '../actions';
import { Loading, Meter, PageHead } from '../components/common';
import { Pill } from '../components/Pill';
import { ago, date, hashHue, initials, plural, size, sum } from '../format';
import { useStore } from '../store';
import { LAUNCHER_COLORS } from '../theme';
import type { Game } from '../types';

type Sort = 'size' | 'played' | 'name';
const SORT_LABEL: Record<Sort, string> = { size: 'Größe', played: 'Zuletzt gespielt', name: 'Name' };
const steamCdn = (g: Game) =>
  g.key.startsWith('steam:') ? `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${g.key.slice(6)}/library_600x900.jpg` : '';

export function Games() {
  const games = useStore(s => s.games);
  const [source, setSource] = useState('Alle');
  const [sort, setSort] = useState<Sort>('size');
  const [staleOnly, setStaleOnly] = useState(false);

  useEffect(() => { if (!games) loadGames(); }, [games]);
  if (!games) return <div className="page"><Loading label="Suche Spiele in Steam, Epic, EA, Rockstar, Xbox …" /></div>;

  const count = (s: string) => games.filter(g => g.source === s).length;
  const sources = [...new Set(games.map(g => g.source))].sort((a, b) => count(b) - count(a));
  let list = source === 'Alle' ? games : games.filter(g => g.source === source);
  if (staleOnly) list = list.filter(isStale);
  const sorters: Record<Sort, (a: Game, b: Game) => number> = {
    size: (a, b) => gameTotal(b) - gameTotal(a),
    played: (a, b) => (a.lastPlayed || 9e15) - (b.lastPlayed || 9e15),
    name: (a, b) => a.name.localeCompare(b.name, 'de'),
  };
  list = [...list].sort(sorters[sort]);
  const max = Math.max(1, ...games.map(gameTotal));
  const stale = games.filter(isStale);

  return (
    <div className="page">
      <PageHead title="Spiele"
        sub={<>{plural(games.length, 'Spiel', 'Spiele und Engines')} aus {plural(sources.length, 'Launcher', 'Launchern')} · {size(sum(games, gameTotal))}</>}>
        <Dropdown value={`Sortieren: ${SORT_LABEL[sort]}`} selectedOptions={[sort]} onOptionSelect={(_, d) => setSort(d.optionValue as Sort)} style={{ minWidth: 200 }}>
          {(Object.keys(SORT_LABEL) as Sort[]).map(k => <Option key={k} value={k}>{SORT_LABEL[k]}</Option>)}
        </Dropdown>
        <Tooltip content="Neu suchen" relationship="label">
          <Button icon={<ArrowClockwise20Regular />} onClick={() => loadGames(true)} />
        </Tooltip>
      </PageHead>

      {stale.length > 0 && (
        <MessageBar intent="info" style={{ marginBottom: 16 }}>
          <MessageBarBody>
            <MessageBarTitle>{plural(stale.length, 'Spiel', 'Spiele')} seit über 6 Monaten nicht gespielt</MessageBarTitle>
            Zusammen {size(sum(stale, gameTotal))} – du kannst sie jederzeit wieder herunterladen.
          </MessageBarBody>
          <MessageBarActions>
            <Button size="small" onClick={() => setStaleOnly(!staleOnly)}>{staleOnly ? 'Alle anzeigen' : 'Nur diese anzeigen'}</Button>
          </MessageBarActions>
        </MessageBar>
      )}

      <div className="filters">
        {['Alle', ...sources].map(s => (
          <Pill key={s} on={source === s} onClick={() => setSource(s)}>{s} ({s === 'Alle' ? games.length : count(s)})</Pill>
        ))}
      </div>

      <div className="games">
        {list.map(g => <GameCard key={g.key} g={g} max={max} />)}
      </div>
      {!list.length && <div className="empty">Keine Spiele gefunden.</div>}
    </div>
  );
}

function GameCard({ g, max }: { g: Game; max: number }) {
  const [art, setArt] = useState(g.image);
  const [icon, setIcon] = useState(!!g.icon);
  const extras = g.extras.filter(x => x.size > 0).map(x => `${x.label} ${size(x.size)}`).join(' · ');
  const meta = g.lastPlayed ? `Gespielt ${ago(g.lastPlayed)}` : g.installed ? `Installiert am ${date(g.installed)}` : g.kind;
  return (
    <div className="card game">
      <div className="cover" style={{ ['--h' as string]: hashHue(g.name) }}>
        <div className="fallback">
          {icon && g.icon
            ? <img src={`https://app.local/icon?p=${encodeURIComponent(g.icon)}`} alt="" onError={() => setIcon(false)} />
            : <span className="ini">{initials(g.name)}</span>}
        </div>
        {art && <img className="art" src={art} alt="" onError={() => setArt(art === g.image && steamCdn(g) ? steamCdn(g) : null)} />}
        <div className="badges">
          {g.kind !== 'Spiel' && <Badge appearance="filled" color="informative" size="small">{g.kind}</Badge>}
          {isStale(g) && <Badge appearance="filled" color="warning" size="small">{ago(g.lastPlayed)}</Badge>}
        </div>
      </div>
      <div className="info">
        <div className="name" title={g.name}>{g.name}</div>
        <div className="line"><span className="dot" style={{ ['--c' as string]: LAUNCHER_COLORS[g.source] ?? '#8a8886' }} />{g.source}<span className="grow" />
          <b style={{ color: 'var(--colorNeutralForeground1)', fontWeight: 600 }}>{size(gameTotal(g))}</b></div>
        <div className="line ellipsis" title={extras ? `+ ${extras}` : meta}>{meta}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
          <div className="grow"><Meter value={gameTotal(g) / max} /></div>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button size="small" appearance="subtle" icon={<MoreHorizontal20Regular />} aria-label="Aktionen" />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {g.launchUrl && <MenuItem icon={<Play20Filled />} onClick={() => openUrl(g.launchUrl!)}>Spielen</MenuItem>}
                <MenuItem icon={<FolderOpen20Regular />} onClick={() => reveal(g.path)}>Ordner öffnen</MenuItem>
                {g.storeUrl && <MenuItem icon={<Globe20Regular />} onClick={() => openUrl(g.storeUrl!)}>Shop-Seite</MenuItem>}
                {g.uninstallKind !== 'none' && <MenuItem icon={<Delete20Regular />} onClick={() => uninstallGame(g)}>Deinstallieren …</MenuItem>}
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      </div>
    </div>
  );
}
