import { useEffect, useRef, useState } from 'react';
import { joinPath, percent, size, sum } from '../format';
import { hueAt } from '../theme';
import type { ChartNode, Item, NodeInfo } from '../types';

interface Shape {
  n: ChartNode;
  depth: number;
  hue: number;
  path: string;
  // sunburst
  a0?: number; a1?: number;
  // treemap
  x?: number; y?: number; w?: number; h?: number; frame?: boolean;
}

interface Props {
  data: ChartNode;
  node: NodeInfo;
  mode: 'sunburst' | 'treemap';
  dark: boolean;
  onOpen: (id: number) => void;
  onMenu: (x: number, y: number, it: Item) => void;
}

/** Canvas sunburst / treemap of a folder. */
export function Chart({ data, node, mode, dark, onOpen, onMenu }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<ChartNode | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; s: Shape } | null>(null);
  const st = useRef({ shapes: [] as Shape[], hover: null as Shape | null, w: 0, h: 0, dpr: 1, t: 1, geo: { cx: 0, cy: 0, r0: 0, ring: 0 } });
  const props = useRef({ onOpen, onMenu, node });
  props.current = { onOpen, onMenu, node };

  useEffect(() => {
    const el = wrap.current!, cv = canvas.current!, ctx = cv.getContext('2d')!;
    const S = st.current;
    let raf = 0;

    const color = (s: Shape, light = 0) => {
      if (s.n.t === 'o') return dark ? `hsl(0 0% ${30 + light}%)` : `hsl(0 0% ${78 - light}%)`;
      const l = dark ? Math.max(36, 64 - (s.depth - 1) * 7) + light : Math.min(78, 46 + (s.depth - 1) * 7) - light;
      return s.n.t === 'f' ? `hsl(${s.hue} 30% ${l + (dark ? 8 : 6)}%)` : `hsl(${s.hue} ${dark ? 62 : 58}% ${l}%)`;
    };

    const layoutSunburst = () => {
      let maxDepth = 0;
      const walk = (n: ChartNode, d: number) => { maxDepth = Math.max(maxDepth, d); n.c?.forEach(c => walk(c, d + 1)); };
      walk(data, 0);
      maxDepth = Math.min(5, Math.max(1, maxDepth));
      const R = Math.min(S.w, S.h) / 2 - 8, r0 = R * 0.3, ring = (R - r0) / maxDepth;
      S.geo = { cx: S.w / 2, cy: S.h / 2, r0, ring };
      const rec = (n: ChartNode, a0: number, a1: number, depth: number, hue: number, path: string) => {
        if (!n.c || depth >= maxDepth) return;
        let a = a0;
        n.c.forEach((c, i) => {
          const da = (a1 - a0) * c.s / (n.s || 1);
          const h = depth === 0 ? hueAt(i) : hue;
          const p = c.t === 'o' ? path : joinPath(path, c.n);
          S.shapes.push({ n: c, a0: a, a1: a + da, depth: depth + 1, hue: h, path: p });
          if (da > 0.006 && c.t === 'd') rec(c, a, a + da, depth + 1, h, p);
          a += da;
        });
      };
      rec(data, -Math.PI / 2, Math.PI * 1.5, 0, 0, node.path);
    };

    const layoutTreemap = () => {
      const head = 20;
      const rec = (n: ChartNode, x: number, y: number, w: number, h: number, depth: number, hue: number, path: string) => {
        const out: { item: ChartNode; x: number; y: number; w: number; h: number }[] = [];
        squarify((n.c ?? []).filter(c => c.s > 0), x, y, w, h, out);
        out.forEach((r, i) => {
          if (r.w < 1 || r.h < 1) return;
          const c = r.item, hh = depth === 0 ? hueAt(i) : hue;
          const p = c.t === 'o' ? path : joinPath(path, c.n);
          const shape: Shape = { n: c, x: r.x, y: r.y, w: r.w, h: r.h, depth: depth + 1, hue: hh, path: p };
          S.shapes.push(shape);
          if (c.t === 'd' && c.c && depth < 5 && r.w > 34 && r.h > 34) {
            shape.frame = true;
            const top = r.h > head * 2.4 && r.w > 60 ? head : 3;
            rec(c, r.x + 3, r.y + top, r.w - 6, r.h - top - 3, depth + 1, hh, p);
          }
        });
      };
      rec(data, 1, 1, S.w - 2, S.h - 2, 0, 0, node.path);
    };

    const layout = () => {
      S.shapes = [];
      if (!S.w) return;
      if (mode === 'sunburst') layoutSunburst(); else layoutTreemap();
    };

    const text = dark ? 'rgba(0,0,0,.82)' : 'rgba(255,255,255,.95)';
    const draw = () => {
      ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
      ctx.clearRect(0, 0, S.w, S.h);
      if (!S.shapes.length) {
        ctx.fillStyle = dark ? '#9d9d9d' : '#616161';
        ctx.font = '14px "Segoe UI Variable Text", "Segoe UI"';
        ctx.textAlign = 'center';
        ctx.fillText('Keine Unterelemente', S.w / 2, S.h / 2);
        return;
      }
      const e = 1 - Math.pow(1 - S.t, 3);
      if (mode === 'sunburst') {
        const { cx, cy, r0, ring } = S.geo, start = -Math.PI / 2;
        for (const s of S.shapes) {
          const a0 = start + (s.a0! - start) * e, a1 = start + (s.a1! - start) * e;
          if (a1 - a0 < 0.0015) continue;
          const ri = r0 + (s.depth - 1) * ring + 1, ro = ri + ring - 2;
          const gap = Math.min(0.004, (a1 - a0) / 4);
          const hov = S.hover === s;
          ctx.beginPath();
          ctx.arc(cx, cy, ro, a0 + gap, a1 - gap);
          ctx.arc(cx, cy, ri, a1 - gap, a0 + gap, true);
          ctx.closePath();
          ctx.fillStyle = color(s, hov ? 10 : 0);
          ctx.fill();
          if (hov) { ctx.strokeStyle = dark ? '#fff' : '#000'; ctx.lineWidth = 1.5; ctx.stroke(); }
        }
        if (e > 0.95) {
          ctx.font = '600 12px "Segoe UI Variable Text", "Segoe UI"';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = text;
          for (const s of S.shapes) {
            if (s.depth !== 1 || s.a1! - s.a0! < 0.22 || s.n.t === 'o') continue;
            const a = (s.a0! + s.a1!) / 2, rm = r0 + ring / 2;
            ctx.fillText(fit(ctx, s.n.n, ring * 1.6), cx + Math.cos(a) * rm, cy + Math.sin(a) * rm);
          }
        }
      } else {
        ctx.globalAlpha = e;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        for (const s of S.shapes) {
          const x = s.x!, y = s.y!, w = s.w!, h = s.h!;
          if (s.frame) {
            ctx.fillStyle = dark ? `hsl(${s.hue} 20% ${Math.max(14, 22 - s.depth * 2)}%)` : `hsl(${s.hue} 30% ${Math.min(94, 86 + s.depth * 2)}%)`;
            ctx.fillRect(x, y, w, h);
            if (h > 48 && w > 60) {
              ctx.font = '600 12px "Segoe UI Variable Text", "Segoe UI"';
              ctx.fillStyle = dark ? `hsl(${s.hue} 70% 82%)` : `hsl(${s.hue} 60% 28%)`;
              ctx.fillText(fit(ctx, `${s.n.n}  ·  ${size(s.n.s)}`, w - 12), x + 6, y + 4);
            }
            continue;
          }
          ctx.fillStyle = color(s, S.hover === s ? 10 : 0);
          ctx.fillRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
          if (S.hover === s) { ctx.strokeStyle = dark ? '#fff' : '#000'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); }
          if (w > 54 && h > 22) {
            ctx.fillStyle = text;
            ctx.font = '600 12px "Segoe UI Variable Text", "Segoe UI"';
            ctx.fillText(fit(ctx, s.n.n, w - 10), x + 6, y + 5);
            if (h > 40) { ctx.font = '12px "Segoe UI Variable Text", "Segoe UI"'; ctx.fillText(size(s.n.s), x + 6, y + 21); }
          }
        }
        ctx.globalAlpha = 1;
      }
    };

    const resize = () => {
      const r = el.getBoundingClientRect();
      S.dpr = devicePixelRatio || 1;
      S.w = r.width;
      S.h = r.height;
      cv.width = Math.max(1, r.width * S.dpr);
      cv.height = Math.max(1, r.height * S.dpr);
      layout();
      draw();
    };

    const hit = (e: MouseEvent): Shape | 'center' | null => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (mode === 'sunburst') {
        const { cx, cy, r0, ring } = S.geo, dx = x - cx, dy = y - cy, dist = Math.hypot(dx, dy);
        if (dist < r0) return 'center';
        const depth = Math.floor((dist - r0) / ring) + 1;
        let a = Math.atan2(dy, dx);
        if (a < -Math.PI / 2) a += Math.PI * 2;
        return S.shapes.find(s => s.depth === depth && a >= s.a0! && a < s.a1!) ?? null;
      }
      for (let i = S.shapes.length - 1; i >= 0; i--) {
        const s = S.shapes[i];
        if (x >= s.x! && x < s.x! + s.w! && y >= s.y! && y < s.y! + s.h!) return s;
      }
      return null;
    };

    const onMove = (e: MouseEvent) => {
      const h = hit(e), s = h === 'center' ? null : h;
      const p = props.current;
      cv.style.cursor = h === 'center' ? (p.node.parentId >= 0 ? 'pointer' : 'default') : s && s.n.t !== 'o' ? 'pointer' : 'default';
      if (s !== S.hover) { S.hover = s; draw(); setHover(s?.n ?? null); }
      setTip(s ? { x: e.clientX, y: e.clientY, s } : null);
    };
    const onLeave = () => { S.hover = null; draw(); setHover(null); setTip(null); };
    const onClick = (e: MouseEvent, context: boolean) => {
      const h = hit(e), p = props.current;
      if (h === 'center') { if (!context && p.node.parentId >= 0) p.onOpen(p.node.parentId); return; }
      if (!h || h.n.t === 'o') return;
      const it: Item = { id: h.n.i, kind: h.n.t === 'd' ? 'dir' : 'file', name: h.n.n, size: h.n.s, path: h.path };
      setTip(null);
      if (context || it.kind === 'file') p.onMenu(e.clientX, e.clientY, it);
      else p.onOpen(it.id);
    };
    const click = (e: MouseEvent) => onClick(e, false);
    const ctxMenu = (e: MouseEvent) => { e.preventDefault(); onClick(e, true); };
    cv.addEventListener('mousemove', onMove);
    cv.addEventListener('mouseleave', onLeave);
    cv.addEventListener('click', click);
    cv.addEventListener('contextmenu', ctxMenu);

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const t0 = performance.now();
    S.t = 0;
    const anim = (now: number) => {
      S.t = Math.min(1, (now - t0) / 450);
      draw();
      if (S.t < 1) raf = requestAnimationFrame(anim);
    };
    raf = requestAnimationFrame(anim);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener('mousemove', onMove);
      cv.removeEventListener('mouseleave', onLeave);
      cv.removeEventListener('click', click);
      cv.removeEventListener('contextmenu', ctxMenu);
      S.hover = null;
    };
  }, [data, mode, dark, node.path]);

  const center = hover ?? null;
  return (
    <div className="chart-wrap" ref={wrap}>
      <canvas ref={canvas} />
      {mode === 'sunburst' && (
        <div className="chart-center">
          <div>
            <div className="v">{size(center ? center.s : node.size)}</div>
            <div className="n ellipsis">{center ? center.n : node.name}</div>
            <div className="n">{center ? percent(center.s / (node.size || 1) * 100) : node.parentId >= 0 ? 'Mitte: eine Ebene zurück' : ''}</div>
          </div>
        </div>
      )}
      {tip && (
        <div className="chart-tip" style={{ left: Math.min(tip.x + 16, innerWidth - 330), top: Math.min(tip.y + 18, innerHeight - 80) }}>
          <b>{tip.s.n.n}</b>
          {size(tip.s.n.s)} · {percent(tip.s.n.s / (node.size || 1) * 100)} von {node.name}
          {tip.s.n.t === 'f' ? ' · Datei' : tip.s.n.t === 'd' ? ' · Ordner' : ''}
        </div>
      )}
    </div>
  );
}

function squarify(items: ChartNode[], x: number, y: number, w: number, h: number, out: { item: ChartNode; x: number; y: number; w: number; h: number }[]) {
  const total = sum(items, i => i.s);
  if (total <= 0 || w <= 0 || h <= 0) return;
  const scale = w * h / total;
  let i = 0;
  while (i < items.length) {
    const side = Math.min(w, h);
    let j = i, rowSum = 0, best = Infinity;
    while (j < items.length) {
      const s = items[j].s * scale, ns = rowSum + s, max = items[i].s * scale;
      const worst = Math.max(side * side * max / (ns * ns), ns * ns / (side * side * s));
      if (worst > best) break;
      best = worst;
      rowSum = ns;
      j++;
    }
    const thick = rowSum / side;
    let pos = 0;
    for (let k = i; k < j; k++) {
      const len = items[k].s * scale / thick;
      out.push(w >= h ? { item: items[k], x, y: y + pos, w: thick, h: len } : { item: items[k], x: x + pos, y, w: len, h: thick });
      pos += len;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    i = j;
  }
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, m) + '…').width <= max) lo = m; else hi = m - 1;
  }
  return lo > 0 ? text.slice(0, lo) + '…' : '';
}
