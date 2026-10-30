// Synthesize with Yosys/ABC, then evolve the result. Compares against the current leader.
// Usage: node --experimental-wasm-exnref scripts/run-evolve.mjs <seconds-per-task> <taskId ...>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { synthesize } from '../src/synth.mjs';
import { makeSpec, fromNetlist, toNetlist, evolve } from '../src/evolve.mjs';
import { check } from '../src/sim.mjs';
import { analyze, cost, encode } from '../src/netlist.mjs';

const V = JSON.parse(readFileSync(new URL('../data/vectors.json', import.meta.url)));
const { rows } = JSON.parse(readFileSync(new URL('../data/leaders.json', import.meta.url)));
const byId = new Map(rows.map((r) => [String(r.id), r]));
const [secs, ...ids] = process.argv.slice(2);
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });

for (const id of ids) {
  const t = V[id], lead = byId.get(id);
  const { best, results } = await synthesize(t);
  const spec = makeSpec(t);
  let bestEls = best.els, bestCost = best.cost;
  // Evolve from every distinct recipe result (a shallower start can end up cheaper),
  // then spend the rest of the time refining the overall best.
  const starts = [...new Map(results.filter((r) => !r.error).map((r) => [`${r.nand}/${r.depth}`, r])).values()];
  const slice = (Number(secs) * 1000) / (starts.length + 2);
  const tryRun = (els, seed) => {
    const r = evolve(spec, fromNetlist(els, t.nIn), { seed, timeLimitMs: slice });
    const out = toNetlist(r.genome, spec);
    const c = cost(analyze(out, t.nIn, t.nOut));
    if (c < bestCost && check(out, t).ok) { bestEls = out; bestCost = c; }
  };
  starts.forEach((s, i) => tryRun(s.els, i + 1));
  tryRun(bestEls, 101);
  tryRun(bestEls, 102);
  const a = analyze(bestEls, t.nIn, t.nOut);
  const ok = check(bestEls, t).ok;
  const ratio = lead.leaderCost / bestCost;
  console.log(`${id.padStart(3)} ${ok ? (ratio > 1 ? 'BEATS' : ratio === 1 ? 'TIES ' : 'loses') : 'WRONG'} ${t.name}  abc C=${best.cost} -> evolved ${a.nand}g d${a.depth} C=${bestCost}  leader C=${lead.leaderCost}  x${ratio.toFixed(2)}`);
  if (ok && ratio > 1) writeFileSync(new URL(`../out/${id}.hex`, import.meta.url), '0x' + Buffer.from(encode(bestEls)).toString('hex'));
}
