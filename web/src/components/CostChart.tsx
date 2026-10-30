// Step chart of best cost over time, with the leader's cost as a reference line.
export default function CostChart({ points, leader }: { points: { t: number; c: number }[]; leader: number }) {
  const W = 600, H = 160, P = 28;
  if (!points.length) return <svg className="chart" viewBox={`0 0 ${W} ${H}`} />;
  const maxT = Math.max(points[points.length - 1].t, 1000);
  const vals = [...points.map((p) => p.c), leader];
  const lo = Math.min(...vals) * 0.9, hi = Math.max(...vals) * 1.05;
  const x = (t: number) => P + ((W - 2 * P) * t) / maxT;
  const y = (c: number) => H - P - ((H - 2 * P) * (c - lo)) / (hi - lo || 1);
  let d = `M${x(points[0].t)} ${y(points[0].c)}`;
  for (let i = 1; i < points.length; i++) d += ` H${x(points[i].t)} V${y(points[i].c)}`;
  d += ` H${x(maxT)}`;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Best cost over time">
      <line x1={P} x2={W - P} y1={y(leader)} y2={y(leader)} stroke="var(--muted)" strokeDasharray="5 4" />
      <text x={W - P} y={y(leader) - 6} textAnchor="end" fontSize={11} fill="var(--muted)">leader {leader.toLocaleString()}</text>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
    </svg>
  );
}
