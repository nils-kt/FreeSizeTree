import { useEffect, useRef } from 'react';
import { go } from '../actions';
import { api } from '../bridge';
import { ExtBadge, Loading, Meter, NeedScan, PageHead } from '../components/common';
import { num, percent, size, sum } from '../format';
import { notifyError } from '../notify';
import { set, useStore } from '../store';
import { topColor } from '../theme';
import type { TypeRow } from '../types';

export function Types({ dark }: { dark: boolean }) {
  const summary = useStore(s => s.summary);
  const types = useStore(s => s.types);
  useEffect(() => {
    if (summary && !types) api<TypeRow[]>('types').then(t => set({ types: t }), notifyError);
  }, [summary, types]);

  if (!summary) return <NeedScan />;
  if (!types) return <div className="page"><Loading /></div>;

  const top = types.slice(0, 12), rest = sum(types.slice(12), x => x.bytes);
  const total = sum(types, x => x.bytes);
  const max = Math.max(1, types[0]?.bytes ?? 1);
  const show = (ext: string) => { set({ fileExt: ext ? '.' + ext : '' }); go('files'); };
  const restColor = dark ? '#5d5d5d' : '#c8c8c8';

  return (
    <div className="page">
      <PageHead title="Dateitypen" sub="Welche Arten von Dateien den meisten Platz belegen." />
      <div className="types-top">
        <div className="card pad">
          <Donut parts={[...top.map((x, i) => ({ v: x.bytes, c: topColor(i, dark) })), ...(rest ? [{ v: rest, c: restColor }] : [])]} total={total} dark={dark} />
        </div>
        <div className="card pad type-legend">
          {top.map((x, i) => (
            <button key={x.ext} onClick={() => show(x.ext)}>
              <i style={{ background: topColor(i, dark) }} /><span>{x.ext ? '.' + x.ext : '(ohne Endung)'}</span><b>{size(x.bytes)}</b>
            </button>
          ))}
          {rest > 0 && <button disabled><i style={{ background: restColor }} /><span>Sonstige</span><b>{size(rest)}</b></button>}
        </div>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="dl">
          <colgroup><col /><col style={{ width: 110 }} /><col style={{ width: 200 }} /><col style={{ width: 130 }} /><col style={{ width: 110 }} /></colgroup>
          <thead><tr><th>Typ</th><th className="r">Größe</th><th>Anteil</th><th className="r">Anzahl</th><th className="r">Ø Größe</th></tr></thead>
          <tbody>
            {types.slice(0, 150).map((x, i) => (
              <tr key={x.ext} onClick={() => show(x.ext)}>
                <td><div className="namecell"><ExtBadge ext={'.' + x.ext} /><span className="t">{x.ext ? '.' + x.ext : '(ohne Endung)'}</span></div></td>
                <td className="r num">{size(x.bytes)}</td>
                <td><div className="share"><Meter value={x.bytes / max} color={i < 12 ? topColor(i, dark) : undefined} /><span>{percent(x.share * 100)}</span></div></td>
                <td className="r num caption">{num(x.count)} Dateien</td>
                <td className="r num caption">{size(x.bytes / Math.max(1, x.count))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Donut({ parts, total, dark }: { parts: { v: number; c: string }[]; total: number; dark: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const cx = r.width / 2, cy = r.height / 2, R = Math.min(cx, cy) - 4, w = R * 0.28;
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const k = Math.min(1, (now - t0) / 500), e = 1 - Math.pow(1 - k, 3);
      ctx.clearRect(0, 0, r.width, r.height);
      let a = -Math.PI / 2;
      for (const p of parts) {
        const da = Math.PI * 2 * p.v / (total || 1) * e;
        ctx.beginPath();
        ctx.arc(cx, cy, R, a + 0.008, a + da - 0.008);
        ctx.arc(cx, cy, R - w, a + da - 0.008, a + 0.008, true);
        ctx.closePath();
        ctx.fillStyle = p.c;
        ctx.fill();
        a += da;
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = dark ? '#ffffff' : '#1a1a1a';
      ctx.font = '600 22px "Segoe UI Variable Display", "Segoe UI"';
      ctx.fillText(size(total), cx, cy - 8);
      ctx.font = '12px "Segoe UI Variable Text", "Segoe UI"';
      ctx.fillStyle = dark ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.55)';
      ctx.fillText('alle Dateien', cx, cy + 14);
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [parts, total, dark]);
  return <canvas ref={ref} className="donut" />;
}
