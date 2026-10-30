import { useEffect, useRef, useState } from 'react';
import { decode } from '@core/netlist.mjs';
import { hexToBytes } from '@core/hex.mjs';
import { check } from '@core/sim.mjs';
import { bonusOf, fmt, loadVectors, short, verifiability, type Bundle, type Task } from '../data';
import { liveLeader } from '../chain';
import CircuitView from '../components/CircuitView';
import CostChart from '../components/CostChart';
import type { Done, Progress, StartMsg } from '../optimizer.worker';

export default function TaskPage({ bundle, id }: { bundle: Bundle; id: number }) {
  const t = bundle.tasks.find((x) => x.id === id);
  if (!t) return <p>Task #{id} not found. <a href="#/">Back to tasks</a></p>;
  return <TaskView key={id} t={t} />;
}

function TaskView({ t }: { t: Task }) {
  const v = verifiability(t);
  const [live, setLive] = useState<{ cost: number; circuitId: number | null } | 'loading' | 'error' | null>(null);
  const [found, setFound] = useState<{ hex: string; cost: number; gates: number; latches: number; depth: number; verify?: { ok: boolean; how: string } } | null>(null);
  const leaderCost = live && typeof live === 'object' ? live.cost : t.leader.cost;
  const best = [found && found.verify?.ok ? found : null, t.ours].filter(Boolean).sort((a, b) => a!.cost - b!.cost)[0] as { cost: number; gates: number; latches: number; depth: number } | undefined;

  const refresh = () => {
    setLive('loading');
    liveLeader(t.id).then((l) => setLive(l ? { cost: l.cost, circuitId: l.circuitId } : 'error'), () => setLive('error'));
  };

  return (
    <>
      <a className="back" href="#/">← All tasks</a>
      <div className="taskhead">
        <div>
          <div className="mono" style={{ color: 'var(--muted)' }}>Task #{t.id}</div>
          <h1>{t.nameEn}</h1>
          <div className="zh">{t.name}</div>
        </div>
        <div className="row-actions">
          <span className="badge">{t.kind === 'seq' ? `Memory · ${t.cycles} cycles` : 'Logic'}</span>
          <span className="badge">{t.nIn} in → {t.nOut} out</span>
          <span className={`badge ${v.level === 'official' ? 'warn' : 'good'}`} title={v.note}>{v.level === 'official' ? 'Sample-checked only' : 'Fully checkable'}</span>
        </div>
      </div>

      <div className="cards">
        <div className="card">
          <h3>Reference design</h3>
          <div className="big">{fmt(t.Cref)}</div>
          <div className="sub">{t.refGates} gates · depth {t.refDepth}</div>
        </div>
        <div className="card">
          <h3>Current leader</h3>
          <div className="big">{fmt(leaderCost)}</div>
          <div className="sub">
            {t.leader.gates} gates{t.leader.latches ? ` · ${t.leader.latches} latches` : ''} · depth {t.leader.depth} · circuit #{t.leader.circuitId} on {short(t.leader.cpu)}
          </div>
          <div className="sub" style={{ marginTop: 6 }}>
            {live === 'loading' ? 'Checking BNB Chain…'
              : live === 'error' ? 'Could not reach BNB Chain.'
              : live ? (live.cost === t.leader.cost ? '✓ Still the leader right now.' : `Changed: now ${fmt(live.cost)} (circuit #${live.circuitId}).`)
              : <button className="btn" style={{ padding: '4px 10px' }} onClick={refresh}>Check live</button>}
          </div>
        </div>
        <div className="card ours">
          <h3>Best we found</h3>
          {best ? <>
            <div className="big">{fmt(best.cost)}</div>
            <div className="sub">{best.gates} gates{best.latches ? ` · ${best.latches} latches` : ''} · depth {best.depth}</div>
            <div className="sub" style={{ marginTop: 6 }}>
              {best.cost < leaderCost
                ? <span className="badge win">{Math.round((1 - best.cost / leaderCost) * 100)}% cheaper than the leader</span>
                : best.cost === leaderCost ? <span className="badge">Ties the leader</span> : <span className="badge">Behind the leader</span>}
              {' '}Bonus ≈ {Math.round(bonusOf(t, best.cost))} (max {4 * (t.K ?? 0)})
            </div>
          </> : <><div className="big" style={{ color: 'var(--muted)' }}>—</div><div className="sub">Nothing yet. Run the optimizer below.</div></>}
        </div>
      </div>

      <Circuits t={t} found={found} />
      <Optimizer t={t} leaderCost={leaderCost} onFound={setFound} />

      <div className="panel">
        <h2>How cost and rewards work</h2>
        <p className="hint">The top mining spot for a task goes to the cheapest correct circuit on each processor. Depth counts only the NAND gates on paths to an output; latches start a path fresh, which is why memory designs keep outputs at depth 0 or 1.</p>
        <div className="formula">
          C = (gates + {6} × latches) × max(depth, 1)³<br />
          bonus = K × clamp(C_ref / C, ¼, 4) = {t.K} × clamp({fmt(t.Cref)} / C, ¼, 4)
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          To mine with a circuit, it has to be taped out on an eligible processor (Behemoth or TapeOut) by calling <code>tapeout(netlist, {t.nIn}, {t.nOut})</code> with the downloaded netlist.
          That burns transistors and costs gas. Don't rebuild it in TapeOut's canvas: the canvas adds two gates to every output, which erases the savings.
        </p>
      </div>
    </>
  );
}

function Circuits({ t, found }: { t: Task; found: { hex: string; verify?: { ok: boolean } } | null }) {
  const options: [string, string][] = [];
  if (found?.verify?.ok) options.push(['found', 'Just found']);
  if (t.ours) options.push(['ours', 'Our best']);
  options.push(['leader', 'Current leader']);
  const [which, setWhich] = useState(options[0][0]);
  useEffect(() => { setWhich(options[0][0]); }, [found]); // eslint-disable-line react-hooks/exhaustive-deps
  const hex = which === 'found' ? found!.hex : which === 'ours' ? t.ours!.netlist : t.leader.netlist;
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setStatus(null), [hex]);

  const verify = async () => {
    setStatus({ ok: true, text: 'Checking…' });
    const vec = await loadVectors(t.id);
    const r = check(decode(hexToBytes(hex), t.nIn), { ...vec, cycles: vec.kind === 'seq' ? vec.cycles : 1 });
    setStatus(r.ok ? { ok: true, text: `Passes all ${vec.vectors.length} official vectors.` } : { ok: false, text: `Fails official vector #${r.vector} (cycle ${r.cycle}, output ${r.output}).` });
  };
  const download = () => {
    const blob = new Blob([hex + '\n'], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tapeout-task-${t.id}-${which}.hex`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="panel">
      <div className="row-actions" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div><h2>Circuit</h2><p className="hint" style={{ margin: 0 }}>Exactly what would be taped out, gate by gate.</p></div>
        <div className="seg">{options.map(([k, l]) => <button key={k} className={which === k ? 'on' : ''} onClick={() => setWhich(k)}>{l}</button>)}</div>
      </div>
      <CircuitView hex={hex} nIn={t.nIn} nOut={t.nOut} />
      <div className="row-actions" style={{ marginTop: 14 }}>
        <button className="btn" onClick={verify}>Check against official vectors</button>
        <button className="btn" onClick={download}>Download netlist</button>
        <button className="btn" onClick={() => navigator.clipboard?.writeText(hex)}>Copy hex</button>
      </div>
      {status && <div className={`result ${status.ok ? 'ok' : 'err'}`}>{status.text}</div>}
    </div>
  );
}

function Optimizer({ t, leaderCost, onFound }: { t: Task; leaderCost: number; onFound: (f: { hex: string; cost: number; gates: number; latches: number; depth: number; verify?: { ok: boolean; how: string } }) => void }) {
  const v = verifiability(t);
  const tooBig = t.kind === 'comb' && t.nIn > 12;
  const [start, setStart] = useState(t.ours ? 'ours' : 'scratch');
  const [secs, setSecs] = useState(30);
  const [running, setRunning] = useState(false);
  const [prog, setProg] = useState<Progress | null>(null);
  const [points, setPoints] = useState<{ t: number; c: number }[]>([]);
  const [done, setDone] = useState<Done | null>(null);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);

  const run = async () => {
    worker.current?.terminate();
    const w = new Worker(new URL('../optimizer.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setRunning(true); setProg(null); setPoints([]); setDone(null);
    const task = await loadVectors(t.id);
    const startHex = start === 'ours' ? t.ours?.netlist ?? null : start === 'leader' ? t.leader.netlist : null;
    w.onmessage = (e: MessageEvent<Progress | Done>) => {
      if (e.data.type === 'progress') {
        const p = e.data;
        setProg(p);
        if (p.best) setPoints((pts) => (pts.length && pts[pts.length - 1].c === p.best!.cost ? pts : [...pts, { t: p.elapsed, c: p.best!.cost }]));
      } else {
        setDone(e.data); setRunning(false); w.terminate();
        if (e.data.netlist && e.data.best) onFound({ hex: e.data.netlist, ...e.data.best, verify: e.data.verify });
      }
    };
    w.postMessage({ type: 'start', task, startHex, seconds: secs, seed: (Date.now() % 100000) + 1 } satisfies StartMsg);
  };
  const stop = () => worker.current?.postMessage({ type: 'stop' });

  return (
    <div className="panel">
      <h2>Run the optimizer in your browser</h2>
      <p className="hint">
        An evolutionary search rewires gates at random and keeps every change that stays correct and doesn't raise the cost.
        {v.level === 'official' && ' This task only has a sample of test cases here, so treat results as unverified.'}
      </p>
      {tooBig ? <p className="hint">This task has too many inputs for an in-browser search. Its circuits come from the offline pipeline (Yosys + ABC + evolution).</p> : <>
        <div className="row-actions">
          <select className="btn" value={start} onChange={(e) => setStart(e.target.value)} disabled={running}>
            <option value="scratch">Start from random wiring</option>
            {t.ours && <option value="ours">Start from our best</option>}
            <option value="leader">Start from the current leader</option>
          </select>
          <select className="btn" value={secs} onChange={(e) => setSecs(Number(e.target.value))} disabled={running}>
            <option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>1 minute</option><option value={180}>3 minutes</option>
          </select>
          {running ? <button className="btn" onClick={stop}>Stop</button> : <button className="btn primary" onClick={run}>Start search</button>}
        </div>
        {(prog || done) && <>
          <div className="live">
            <div><b>{prog?.best ? fmt(prog.best.cost) : '—'}</b><span>best cost</span></div>
            <div><b>{prog?.best ? `${prog.best.gates}g ${prog.best.latches}L d${prog.best.depth}` : prog?.errors != null ? `${prog.errors} wrong bits` : '—'}</b><span>{prog?.best ? 'gates · latches · depth' : 'still searching for a correct circuit'}</span></div>
            <div><b>{prog ? fmt(prog.iterations) : 0}</b><span>circuits tried</span></div>
            <div><b>{prog ? Math.round(prog.elapsed / 1000) : 0}s</b><span>elapsed</span></div>
          </div>
          <CostChart points={points} leader={leaderCost} />
        </>}
        {done && (done.netlist
          ? <div className={`result ${done.verify?.ok ? 'ok' : 'err'}`}>
              {done.verify?.ok ? '✓' : '✗'} Found a circuit with cost {fmt(done.best!.cost)} ({done.best!.cost < leaderCost ? `${Math.round((1 - done.best!.cost / leaderCost) * 100)}% cheaper than the leader` : done.best!.cost === leaderCost ? 'ties the leader' : 'more than the leader'}). It {done.verify?.how}.
              {done.verify?.ok && ' It is now shown above under "Just found".'}
            </div>
          : <div className="result err">{done.verify ? `Search failed: ${done.verify.how}` : 'No correct circuit found in time. Try longer, or start from our best.'}</div>)}
      </>}
    </div>
  );
}
