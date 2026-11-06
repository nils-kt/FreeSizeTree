import { Button, Checkbox, Dialog, DialogSurface, MessageBar, MessageBarBody, ProgressBar } from '@fluentui/react-components';
import { useEffect, useRef } from 'react';
import { cancelClean, closeClean, isBuild, runClean, toggleCleanItem } from '../actions';
import { num, plural, size, sum } from '../format';
import { useStore, type CleanDialog as State } from '../store';
import type { Hint } from '../types';

/**
 * Automatic cleanup in three steps. While it runs, the dialog cannot be closed (no Escape, no click
 * outside) – only cancelled, which stops after the file currently being deleted.
 */
export function CleanDialog() {
  const c = useStore(s => s.clean);
  if (!c) return null;
  const running = c.phase === 'run';
  return (
    <Dialog open modalType={running ? 'alert' : 'modal'} onOpenChange={(_, d) => { if (!d.open) closeClean(); }}>
      <DialogSurface className="dlg wide" aria-busy={running}>
        {c.phase === 'select' && <Select c={c} />}
        {c.phase === 'run' && <Run c={c} />}
        {c.phase === 'done' && <Done c={c} />}
      </DialogSurface>
    </Dialog>
  );
}

function Select({ c }: { c: Extract<State, { phase: 'select' }> }) {
  const opened = useRef(performance.now());
  const caches = c.items.filter(h => !isBuild(h)), builds = c.items.filter(isBuild);
  const total = sum(c.items.filter(h => c.selected.includes(h.path)), h => h.size);
  const single = c.items.length === 1 ? c.items[0] : null;

  const row = (h: Hint) => (
    <div className="clean-item" key={h.path}>
      <Checkbox checked={c.selected.includes(h.path)} onChange={(_, d) => toggleCleanItem(h.path, !!d.checked)} aria-label={h.category} />
      <div className="main">
        <div>{h.category}</div>
        <div className="caption ellipsis mono" title={h.path}>{h.path}</div>
      </div>
      <div className="sz">{size(h.size)}</div>
    </div>
  );

  return <>
    <div className="dlg-body">
      <h2>{single ? `${single.category} bereinigen` : 'Automatische Bereinigung'}</h2>
      {single ? <>
        <div className="dlg-path">{single.path}</div>
        <p>{single.action === 'CleanContents' ? 'Der Inhalt dieses Ordners wird endgültig gelöscht, der Ordner selbst bleibt.' : 'Wird endgültig gelöscht.'} {single.advice}</p>
      </> : <>
        <p>Wähle aus, was endgültig gelöscht werden soll. Gerade benutzte Dateien werden übersprungen; Downloads, Spiele und eigene Dateien bleiben unberührt.</p>
        <div className="clean-list">
          {caches.length > 0 && <div className="clean-group">Zwischenspeicher und temporäre Dateien</div>}
          {caches.map(row)}
          {builds.length > 0 && <div className="clean-group">Build-Ordner – entstehen beim nächsten Build bzw. „npm install“ neu</div>}
          {builds.map(row)}
        </div>
        <div className="clean-total"><span>Wird freigegeben</span><span>{size(total)}</span></div>
      </>}
    </div>
    <div className="dlg-foot">
      <Button appearance="primary" disabled={total === 0}
        onClick={() => { if (performance.now() - opened.current > 500) runClean(); }}>
        {size(total)} freigeben
      </Button>
      <Button autoFocus onClick={closeClean}>Abbrechen</Button>
    </div>
  </>;
}

function Run({ c }: { c: Extract<State, { phase: 'run' }> }) {
  const p = c.progress;
  const planned = p?.planned || sum(c.items, h => h.size) || 1;
  // finished items count fully; the running one by what was deleted so far
  const value = p ? Math.min(1, (p.done + Math.min(p.itemSize, Math.max(0, p.freed - p.done))) / planned) : 0;
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return <>
    <div className="dlg-body">
      <h2>{c.cancelling ? 'Wird abgebrochen …' : 'Bereinigung läuft'}</h2>
      <p>{p ? <><b>{p.category}</b> · Schritt {p.index + 1} von {p.count}</> : 'Wird vorbereitet …'}</p>
      <ProgressBar value={p ? value : undefined} thickness="large" />
      <div className="clean-total" style={{ fontWeight: 400 }}>
        <span className="muted">{p ? `${plural(p.files, 'Datei', 'Dateien')} gelöscht` : ''}</span>
        <span><b>{size(p?.freed ?? 0)}</b> <span className="muted">von {size(planned)}</span></span>
      </div>
      <div className="clean-file ellipsis">{p?.path}</div>
    </div>
    <div className="dlg-foot">
      <span />
      <Button ref={cancel} disabled={c.cancelling} onClick={cancelClean}>{c.cancelling ? 'Wird abgebrochen …' : 'Abbrechen'}</Button>
    </div>
  </>;
}

function Done({ c }: { c: Extract<State, { phase: 'done' }> }) {
  const r = c.result;
  const planned = sum(c.items, h => h.size);
  const skipped = !r.cancelled && r.freed < planned * 0.9 && planned - r.freed > 50 * 1024 ** 2;
  return <>
    <div className="dlg-body">
      <h2>{r.cancelled ? 'Bereinigung abgebrochen' : 'Bereinigung abgeschlossen'}</h2>
      <div className="clean-big">{size(r.freed)} freigegeben</div>
      <p>{num(r.files)} {r.files === 1 ? 'Datei' : 'Dateien'} gelöscht. Die Übersicht und der freie Speicher sind aktualisiert.</p>
      {skipped && (
        <MessageBar intent="info"><MessageBarBody>
          {size(planned - r.freed)} konnten nicht gelöscht werden, weil die Dateien gerade benutzt werden. Nach einem Neustart klappt es meist.
        </MessageBarBody></MessageBar>
      )}
      {r.errors.map(e => <MessageBar key={e} intent="error"><MessageBarBody>{e}</MessageBarBody></MessageBar>)}
    </div>
    <div className="dlg-foot">
      <span />
      <Button appearance="primary" autoFocus onClick={closeClean}>Fertig</Button>
    </div>
  </>;
}
