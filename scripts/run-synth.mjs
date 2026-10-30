// Synthesizes full-truth-table combinational tasks and compares with the current leader.
// Usage: node scripts/run-synth.mjs [taskId ...]   (no ids = all eligible tasks)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { synthesize } from '../src/synth.mjs';
import { check } from '../src/sim.mjs';
import { encode } from '../src/netlist.mjs';

const V = JSON.parse(readFileSync(new URL('../data/vectors.json', import.meta.url)));
const { rows } = JSON.parse(readFileSync(new URL('../data/leaders.json', import.meta.url)));
const byId = new Map(rows.map((r) => [String(r.id), r]));
const args = process.argv.slice(2);
const ids = args.length ? args : Object.keys(V).filter((id) => V[id].kind === 'comb' && V[id].vectors.length >= 2 ** V[id].nIn);

mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
const summary = [];
for (const id of ids) {
  const t = V[id], lead = byId.get(id);
  const { best, results } = await synthesize(t);
  if (!best) { console.log(id, t.name, 'FAILED', results.map((r) => r.error).join(' | ').slice(0, 200)); continue; }
  const ok = check(best.els, t).ok;
  const ratio = lead.leaderCost / best.cost;
  const tag = !ok ? 'WRONG' : ratio > 1 ? 'BEATS' : ratio === 1 ? 'TIES' : 'loses';
  console.log(`${id.padStart(3)} ${tag.padEnd(5)} ${t.name}  ours ${best.nand}g d${best.depth} C=${best.cost} (${best.recipe})  leader C=${lead.leaderCost}  x${ratio.toFixed(2)}`);
  summary.push({ id: Number(id), name: t.name, ok, ours: best.cost, gates: best.nand, depth: best.depth, recipe: best.recipe, leader: lead.leaderCost, ratio });
  if (ok && ratio > 1) writeFileSync(new URL(`../out/${id}.hex`, import.meta.url), '0x' + Buffer.from(encode(best.els)).toString('hex'));
}
writeFileSync(new URL('../out/summary.json', import.meta.url), JSON.stringify(summary, null, 1));
const n = (f) => summary.filter(f).length;
console.log(`\n${summary.length} tasks: ${n((s) => s.ok && s.ratio > 1)} beat the leader, ${n((s) => s.ok && s.ratio === 1)} tie, ${n((s) => !s.ok)} wrong`);
