// Horizontal cost bars on a log scale (reference designs are often 100x the leaders).
import { fmt } from '../data';

export type BarRow = { label: string; value: number; kind?: 'ref' | 'leader' | 'ours' };

export default function Bars({ rows }: { rows: BarRow[] }) {
  const max = Math.max(...rows.map((r) => r.value));
  const min = Math.min(...rows.map((r) => r.value));
  // Log scale with a floor so the smallest bar is still visible.
  const lo = Math.log(Math.max(1, min * 0.5)), hi = Math.log(max);
  const w = (v: number) => (hi === lo ? 100 : 12 + (88 * (Math.log(v) - lo)) / (hi - lo));
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.label} className={`bar ${r.kind ?? ''}`}>
          <span className="lbl">{r.label}</span>
          <span className="track"><span className="fill" style={{ width: `${w(r.value)}%`, display: 'block' }} /></span>
          <span className="val">{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
