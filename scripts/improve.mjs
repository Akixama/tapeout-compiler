// Re-evolves saved winning circuits from where they are, keeping any verified improvement.
// Usage: node scripts/improve.mjs <seconds-per-task> <taskId ...>
import { readFileSync, writeFileSync } from 'node:fs';
import { decode, encode, analyze, cost } from '../src/netlist.mjs';
import { hexToBytes, bytesToHex } from '../src/hex.mjs';
import { makeSeqSpec, seqEvolve, toSeqNetlist, withSpares } from '../src/seqevolve.mjs';
import { pickSpec, encodeVector } from '../src/seqspecs.mjs';
import { verifySeq } from '../src/seqverify.mjs';
import { check } from '../src/sim.mjs';

const V = JSON.parse(readFileSync(new URL('../data/vectors.json', import.meta.url)));
const [secs, ...ids] = process.argv.slice(2);
for (const id of ids) {
  const t = V[id], file = new URL(`../out/seq/${id}.hex`, import.meta.url);
  const start = decode(hexToBytes(readFileSync(file, 'utf8').trim()), t.nIn);
  const before = cost(analyze(start, t.nIn, t.nOut));
  const spec = t.nIn > 0 ? pickSpec(id, t) : null;
  const train = [...t.vectors];
  if (spec) for (let j = 0; j < 768; j++) {
    const ins = Array.from({ length: t.cycles }, () => Array.from({ length: t.nIn }, () => (Math.random() < 0.5 ? 1 : 0)));
    train.push(encodeVector(t, ins, spec.fn(ins)));
  }
  const sspec = makeSeqSpec(t, train);
  let best = start, bestCost = before;
  const genome = start.map((e) => (e.op === 0 ? { op: 0, a: e.a, b: e.b } : { op: 1, d: e.d }));
  for (let seed = 1; seed <= 4; seed++) {
    const r = seqEvolve(sspec, { start: withSpares(genome, t.nIn, t.nOut, 10 + seed * 4, seed), seed, timeLimitMs: (Number(secs) * 1000) / 4 });
    if (!r.g || r.cost >= bestCost) continue;
    const els = toSeqNetlist(sspec, r.g);
    const ok = check(els, t).ok && (!spec || verifySeq(t, els, spec.fn).ok);
    if (ok) { best = els; bestCost = cost(analyze(els, t.nIn, t.nOut)); }
  }
  if (bestCost < before) writeFileSync(file, bytesToHex(encode(best)));
  console.log(`${id} ${t.name}: ${before} -> ${bestCost}${bestCost < before ? ' (saved)' : ''}`);
}
