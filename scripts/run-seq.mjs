// Evolves memory circuits for sequential tasks and compares with the current leader.
// Usage: node scripts/run-seq.mjs <seconds-per-task> [taskId ...]   (no ids = all no-input tasks)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { makeSeqSpec, seqEvolve, toSeqNetlist } from '../src/seqevolve.mjs';
import { check } from '../src/sim.mjs';
import { analyze, cost, encode } from '../src/netlist.mjs';

const V = JSON.parse(readFileSync(new URL('../data/vectors.json', import.meta.url)));
const { rows } = JSON.parse(readFileSync(new URL('../data/leaders.json', import.meta.url)));
const byId = new Map(rows.map((r) => [String(r.id), r]));
const [secs, ...args] = process.argv.slice(2);
const ids = args.length ? args : Object.keys(V).filter((id) => V[id].kind === 'seq' && V[id].nIn === 0);
mkdirSync(new URL('../out/seq/', import.meta.url), { recursive: true });

let wins = 0;
for (const id of ids) {
  const t = V[id], lead = byId.get(id);
  const spec = makeSeqSpec(t);
  let best = null;
  const runs = 6, slice = (Number(secs) * 1000) / runs;
  for (let seed = 1; seed <= runs; seed++) {
    const size = 8 + seed * 4;
    const r = seqEvolve(spec, { size, seed, timeLimitMs: slice });
    if (r.g && (!best || r.cost < best.cost)) best = r;
  }
  if (!best) { console.log(`${id.padStart(3)} NONE  ${t.name}`); continue; }
  const els = toSeqNetlist(spec, best.g);
  const a = analyze(els, t.nIn, t.nOut);
  const c = cost(a);
  const ok = check(els, t).ok;
  const win = ok && c < lead.leaderCost;
  if (win) { wins++; writeFileSync(new URL(`../out/seq/${id}.hex`, import.meta.url), '0x' + Buffer.from(encode(els)).toString('hex')); }
  console.log(`${id.padStart(3)} ${ok ? (win ? 'BEATS' : 'loses') : 'WRONG'} ${t.name}  ours ${a.nand}g ${a.latch}L d${a.depth} C=${c}  leader C=${lead.leaderCost}`);
}
console.log(`\n${wins} / ${ids.length} beat the leader`);
