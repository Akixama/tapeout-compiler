// Evolves memory circuits for sequential tasks WITH inputs, using executable specs.
// Trains on official vectors + random spec-generated sequences; any failure found by the
// exhaustive verifier is added to the training set and the search continues.
// Usage: node scripts/run-seq-in.mjs <seconds-per-task> [taskId ...]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { makeSeqSpec, seqEvolve, toSeqNetlist } from '../src/seqevolve.mjs';
import { CANDIDATES, pickSpec, encodeVector } from '../src/seqspecs.mjs';
import { verifySeq } from '../src/seqverify.mjs';
import { check } from '../src/sim.mjs';
import { analyze, cost, encode } from '../src/netlist.mjs';

const V = JSON.parse(readFileSync(new URL('../data/vectors.json', import.meta.url)));
const { rows } = JSON.parse(readFileSync(new URL('../data/leaders.json', import.meta.url)));
const byId = new Map(rows.map((r) => [String(r.id), r]));
const [secs, ...args] = process.argv.slice(2);
const ids = args.length ? args : Object.keys(CANDIDATES);
mkdirSync(new URL('../out/seq/', import.meta.url), { recursive: true });

let s = 99;
const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
let wins = 0;
for (const id of ids) {
  const t = V[id], lead = byId.get(id);
  const spec = pickSpec(id, t);
  if (!spec) { console.log(`${id} no spec`); continue; }
  const train = [...t.vectors];
  for (let j = 0; j < 768; j++) {
    const ins = Array.from({ length: t.cycles }, () => { const r = rnd(); return Array.from({ length: t.nIn }, (_, i) => (r >>> i) & 1); });
    train.push(encodeVector(t, ins, spec.fn(ins)));
  }
  let best = null, verified = null;
  const deadline = Date.now() + Number(secs) * 1000;
  for (let round = 0; round < 6 && Date.now() < deadline; round++) {
    const sspec = makeSeqSpec(t, train);
    const runs = 4, slice = Math.max(1000, (deadline - Date.now()) / runs);
    let roundBest = null;
    for (let seed = 1; seed <= runs; seed++) {
      const r = seqEvolve(sspec, { size: 10 + seed * 6, seed: seed + round * 10, timeLimitMs: slice, latchRate: 0.2 });
      if (r.g && (!roundBest || r.cost < roundBest.cost)) roundBest = r;
    }
    if (!roundBest) break;
    const els = toSeqNetlist(sspec, roundBest.g);
    const v = verifySeq(t, els, spec.fn);
    if (v.ok) { best = els; verified = v; break; }
    // Learn from the counterexample and search again.
    for (let j = 0; j < 32; j++) train.push(encodeVector(t, v.counterexample, spec.fn(v.counterexample)));
  }
  if (!best) { console.log(`${id.padStart(3)} NONE  ${t.name}`); continue; }
  const a = analyze(best, t.nIn, t.nOut), c = cost(a);
  const ok = check(best, t).ok && verified.ok;
  const win = ok && c < lead.leaderCost;
  if (win) { wins++; writeFileSync(new URL(`../out/seq/${id}.hex`, import.meta.url), '0x' + Buffer.from(encode(best)).toString('hex')); }
  console.log(`${id.padStart(3)} ${ok ? (win ? 'BEATS' : 'loses') : 'WRONG'} ${t.name}  ours ${a.nand}g ${a.latch}L d${a.depth} C=${c}  leader C=${lead.leaderCost}  [${verified.exhaustive ? 'all' : 'sampled'} ${verified.checked} sequences, spec ${spec.name}]`);
}
console.log(`\n${wins} / ${ids.length} beat the leader`);
