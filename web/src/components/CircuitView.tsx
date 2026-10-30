// Draws a NAND/LATCH netlist in columns by depth: inputs and latches on the left,
// outputs on the right. Latch feedback is dashed.
import { useMemo } from 'react';
import { decode, OP } from '@core/netlist.mjs';
import { hexToBytes } from '@core/hex.mjs';

const COL = 92, ROW = 34, PAD = 40;

export default function CircuitView({ hex, nIn, nOut }: { hex: string; nIn: number; nOut: number }) {
  const layout = useMemo(() => {
    const els = decode(hexToBytes(hex), nIn);
    if (els.length > 400) return null;
    const n = 2 + nIn, W = n + els.length;
    const col = new Int32Array(W);
    const kind: string[] = ['c0', 'c1', ...Array(nIn).fill('in')];
    els.forEach((e, k) => {
      const w = n + k;
      if (e.op === OP.NAND) { col[w] = Math.max(col[e.a!], col[e.b!]) + 1; kind[w] = 'nand'; }
      else { col[w] = 0; kind[w] = 'latch'; }
    });
    const used = new Set<number>();
    els.forEach((e) => { if (e.op === OP.NAND) { used.add(e.a!); used.add(e.b!); } else used.add(e.d!); });
    for (let o = 0; o < nOut; o++) used.add(W - nOut + o);
    const outputs = new Set(Array.from({ length: nOut }, (_, o) => W - nOut + o));
    // Assign rows within each column.
    const rows = new Map<number, number>(), count = new Map<number, number>();
    const pos: { x: number; y: number }[] = [];
    for (let w = 0; w < W; w++) {
      if (w < 2 && !used.has(w)) continue;
      const c = col[w], r = count.get(c) ?? 0;
      count.set(c, r + 1); rows.set(w, r);
      pos[w] = { x: PAD + c * COL, y: PAD + r * ROW };
    }
    const maxCol = Math.max(...col), maxRow = Math.max(...count.values());
    const edges: { from: number; to: number; latch: boolean }[] = [];
    els.forEach((e, k) => {
      const w = n + k;
      if (e.op === OP.NAND) { edges.push({ from: e.a!, to: w, latch: false }); if (e.b !== e.a) edges.push({ from: e.b!, to: w, latch: false }); }
      else edges.push({ from: e.d!, to: w, latch: true });
    });
    return { pos, kind, edges, outputs, width: PAD * 2 + maxCol * COL + 60, height: PAD * 2 + (maxRow - 1) * ROW + 10, W };
  }, [hex, nIn, nOut]);

  if (!layout) return <p className="hint">This circuit is too large to draw here.</p>;
  const { pos, kind, edges, outputs, width, height, W } = layout;
  const label = (w: number) => (kind[w] === 'in' ? `in${w - 2}` : kind[w] === 'c0' ? '0' : kind[w] === 'c1' ? '1' : kind[w] === 'latch' ? 'L' : '');
  return (
    <>
      <div className="circuit">
        <svg width={width} height={height} role="img" aria-label="Circuit diagram">
          {edges.map((e, i) => {
            const a = pos[e.from], b = pos[e.to];
            if (!a || !b) return null;
            if (e.latch) {
              const midY = Math.max(a.y, b.y) + ROW * 0.6;
              return <path key={i} d={`M${a.x + 12} ${a.y} C ${a.x + 60} ${midY}, ${b.x - 60} ${midY}, ${b.x - 12} ${b.y}`} fill="none" stroke="var(--accent)" strokeWidth={1.2} strokeDasharray="4 3" opacity={0.8} />;
            }
            const mx = (a.x + b.x) / 2;
            return <path key={i} d={`M${a.x + 12} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x - 12} ${b.y}`} fill="none" stroke="var(--wire)" strokeWidth={1.2} opacity={0.55} />;
          })}
          {pos.map((p, w) => {
            if (!p || w >= W) return null;
            const k = kind[w], out = outputs.has(w);
            const fill = k === 'nand' ? 'var(--panel)' : k === 'latch' ? 'color-mix(in srgb, var(--accent) 25%, var(--panel))' : 'var(--panel-2)';
            const stroke = out ? 'var(--good)' : k === 'latch' ? 'var(--accent)' : k === 'nand' ? 'var(--wire)' : 'var(--muted)';
            return (
              <g key={w}>
                {k === 'nand'
                  ? <path d={`M${p.x - 12} ${p.y - 10} h10 a10 10 0 0 1 0 20 h-10 z`} fill={fill} stroke={stroke} strokeWidth={out ? 2 : 1.2} />
                  : <rect x={p.x - 12} y={p.y - 10} width={24} height={20} rx={4} fill={fill} stroke={stroke} strokeWidth={out ? 2 : 1.2} />}
                {k === 'nand' && <circle cx={p.x + 10} cy={p.y} r={2.5} fill={fill} stroke={stroke} />}
                <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={10} fill="var(--text)" fontFamily="JetBrains Mono, monospace">{label(w)}</text>
                {out && <text x={p.x + 18} y={p.y + 4} fontSize={10} fill="var(--good)" fontFamily="JetBrains Mono, monospace">out{w - (W - outputs.size)}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="legend">
        <span><i style={{ border: '1.5px solid var(--wire)' }} />NAND gate (column = depth)</span>
        <span><i style={{ background: 'color-mix(in srgb, var(--accent) 25%, transparent)', border: '1.5px solid var(--accent)' }} />Latch (memory, dashed = what it stores next)</span>
        <span><i style={{ border: '2px solid var(--good)' }} />Output</span>
      </div>
    </>
  );
}
