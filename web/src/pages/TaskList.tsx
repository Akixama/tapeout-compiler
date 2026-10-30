import { useMemo, useState } from 'react';
import { fmt, verifiability, type Bundle, type Task } from '../data';

type Filter = 'all' | 'wins' | 'comb' | 'seq' | 'full';
const FILTERS: [Filter, string][] = [['wins', 'Our wins'], ['all', 'All tasks'], ['seq', 'Memory'], ['comb', 'Logic'], ['full', 'Fully checkable']];

export default function TaskList({ bundle }: { bundle: Bundle }) {
  const [filter, setFilter] = useState<Filter>('wins');
  const [q, setQ] = useState('');
  const { tasks } = bundle;
  const wins = tasks.filter((t) => t.ours?.beatsLeader);
  const maxed = tasks.filter((t) => t.Cref / t.leader.cost >= 4).length;
  const avgSaving = wins.length ? wins.reduce((s, t) => s + (1 - t.ours!.cost / t.leader.cost), 0) / wins.length : 0;

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tasks
      .filter((t) => filter === 'all' || (filter === 'wins' ? t.ours?.beatsLeader : filter === 'full' ? verifiability(t).level !== 'official' : t.kind === filter))
      .filter((t) => !s || t.nameEn.toLowerCase().includes(s) || t.name.includes(s) || String(t.id) === s);
  }, [tasks, filter, q]);

  return (
    <>
      <section className="hero">
        <h1>Cheaper circuits for TapeOut mining, found automatically.</h1>
        <p>
          TapeOut pays the most $BEM to the cheapest correct circuit for each task, where cost = (gates + 6 × latches) × depth³.
          This tool generates NAND circuits, evolves them to lower cost, and checks them against the official vectors before you tape out.
        </p>
      </section>
      <div className="kpis">
        <div className="kpi hl"><div className="v">{wins.length}</div><div className="l">tasks where we beat the leader</div></div>
        <div className="kpi"><div className="v">{Math.round(avgSaving * 100)}%</div><div className="l">average cost cut on those</div></div>
        <div className="kpi"><div className="v">{tasks.length}</div><div className="l">live mining tasks</div></div>
        <div className="kpi"><div className="v">{maxed}</div><div className="l">leaders already at max bonus</div></div>
      </div>
      <div className="toolbar">
        <input placeholder="Search tasks (e.g. counter, adder, 234)" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">{FILTERS.map(([k, label]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{label}</button>)}</div>
      </div>
      <div className="tablewrap">
        <table className="table">
          <thead><tr>
            <th>#</th><th>Task</th><th className="hide-sm">Pins</th><th className="r">Leader cost</th><th className="r">Our cost</th><th className="r hide-sm">Reference</th><th>Status</th>
          </tr></thead>
          <tbody>
            {shown.map((t) => <Row key={t.id} t={t} />)}
            {!shown.length && <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>No tasks match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Row({ t }: { t: Task }) {
  const go = () => { location.hash = `#/task/${t.id}`; };
  const cut = t.ours ? Math.round((1 - t.ours.cost / t.leader.cost) * 100) : 0;
  return (
    <tr className="row" onClick={go}>
      <td className="num">{t.id}</td>
      <td className="name"><a href={`#/task/${t.id}`} onClick={(e) => e.stopPropagation()}>{t.nameEn}</a><small>{t.kind === 'seq' ? `Memory · ${t.cycles} cycles` : 'Logic'} · {t.name}</small></td>
      <td className="num hide-sm">{t.nIn} → {t.nOut}</td>
      <td className="num r">{fmt(t.leader.cost)}</td>
      <td className="num r">{t.ours ? fmt(t.ours.cost) : '—'}</td>
      <td className="num r hide-sm">{fmt(t.Cref)}</td>
      <td>{t.ours?.beatsLeader ? <span className="badge win">−{cut}% vs leader</span> : <span className="badge">open</span>}</td>
    </tr>
  );
}
