import {
  Button, Dialog, DialogSurface, Menu, MenuDivider, MenuGroup, MenuGroupHeader, MenuItem, MenuList, MenuPopover,
  Toast, Toaster, ToastTitle, useId, useToastController,
} from '@fluentui/react-components';
import { useEffect, useRef } from 'react';
import { setNotifier } from '../notify';
import { set, useStore } from '../store';

/** Promise based confirmation dialog (see actions.confirm). */
export function ConfirmHost() {
  const c = useStore(s => s.confirm);
  const opened = useRef(0);
  useEffect(() => { if (c) opened.current = performance.now(); }, [c]);
  if (!c) return null;

  const close = (value: string | null) => {
    // Guard against accidental confirmation: ignore clicks right after opening (double clicks, stray Enter).
    if (value && performance.now() - opened.current < 500) return;
    set({ confirm: null });
    c.resolve(value);
  };
  return (
    <Dialog open modalType="modal" onOpenChange={(_, d) => { if (!d.open) close(null); }}>
      <DialogSurface className="dlg">
        <div className="dlg-body">
          <h2>{c.title}</h2>
          {c.body}
        </div>
        <div className={`dlg-foot${c.buttons.length > 2 ? ' three' : ''}`}>
          {c.buttons.map(b => (
            <Button key={b.label} autoFocus={b.value === null}
              appearance={b.appearance === 'primary' ? 'primary' : 'secondary'}
              style={b.appearance === 'danger' ? { color: 'var(--red)' } : undefined}
              onClick={() => close(b.value)}>
              {b.label}
            </Button>
          ))}
        </div>
      </DialogSurface>
    </Dialog>
  );
}

/** Context menu at the mouse position. */
export function MenuHost() {
  const m = useStore(s => s.menu);
  if (!m) return null;
  const target = { getBoundingClientRect: () => new DOMRect(m.x, m.y, 0, 0) };
  return (
    <Menu key={`${m.x},${m.y}`} open positioning={{ target, position: 'below', align: 'start', offset: 2 }}
      onOpenChange={(_, d) => { if (!d.open) set({ menu: null }); }}>
      <MenuPopover style={{ maxWidth: 420 }}>
        <MenuList>
          <MenuGroup>
            {m.title && <MenuGroupHeader className="ellipsis" style={{ maxWidth: 380 }}>{m.title}</MenuGroupHeader>}
            {m.items.map((it, i) => it === '-'
              ? <MenuDivider key={i} />
              : (
                <MenuItem key={i} icon={it.icon as any} disabled={it.disabled}
                  style={it.danger ? { color: 'var(--red)' } : undefined}
                  onClick={() => { set({ menu: null }); it.onClick(); }}>
                  {it.label}
                </MenuItem>
              ))}
          </MenuGroup>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

export function ToastHost() {
  const id = useId('toaster');
  const { dispatchToast } = useToastController(id);
  useEffect(() => {
    setNotifier((message, intent) => dispatchToast(
      <Toast><ToastTitle>{message}</ToastTitle></Toast>,
      { intent, timeout: intent === 'error' ? 7000 : 4500 },
    ));
  }, [dispatchToast]);
  return <Toaster toasterId={id} position="bottom-end" />;
}
