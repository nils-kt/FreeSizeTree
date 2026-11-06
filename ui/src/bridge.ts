// Message based RPC to the C# host (see Bridge.cs): {id, cmd, args} → {type:"reply", id, ok, result|error},
// plus pushed events {type:"event", ev, data}.

interface WebView {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
}

const webview: WebView | undefined = (window as unknown as { chrome?: { webview?: WebView } }).chrome?.webview;
export const hasHost = !!webview;

const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
const listeners = new Map<string, Set<(data: any) => void>>();
let seq = 0;

webview?.addEventListener('message', e => {
  const m = e.data;
  if (m.type === 'reply') {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error));
  } else if (m.type === 'event') {
    listeners.get(m.ev)?.forEach(f => f(m.data));
  }
});

export function api<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!webview) return reject(new Error('Keine Verbindung zur App.'));
    const id = ++seq;
    pending.set(id, { resolve, reject });
    webview.postMessage({ id, cmd, args });
  });
}

export function on<T = any>(ev: string, fn: (data: T) => void): () => void {
  let set = listeners.get(ev);
  if (!set) listeners.set(ev, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}
