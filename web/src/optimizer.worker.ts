// Runs the circuit search off the main thread and streams progress back.
// Works for logic tasks (as 1-cycle circuits) and memory tasks alike.
import { decode, encode, analyze, cost, OP, type El } from '@core/netlist.mjs';
import { hexToBytes, bytesToHex } from '@core/hex.mjs';
import { makeSeqSpec, seqEvolve, toSeqNetlist, withSpares, type G } from '@core/seqevolve.mjs';
import { pickSpec, encodeVector } from '@core/seqspecs.mjs';
import { verifySeq } from '@core/seqverify.mjs';
import { check } from '@core/sim.mjs';
import type { TaskVectors } from './data';

export type StartMsg = { type: 'start'; task: TaskVectors; startHex: string | null; seconds: number; seed: number };
export type Progress = { type: 'progress'; elapsed: number; iterations: number; correct: boolean; errors?: number; best?: { cost: number; gates: number; latches: number; depth: number } };
export type Done = { type: 'done'; netlist: string | null; best?: { cost: number; gates: number; latches: number; depth: number }; verify?: { ok: boolean; how: string } };

let stopped = false;
self.onmessage = (e: MessageEvent<StartMsg | { type: 'stop' }>) => {
  if (e.data.type === 'stop') { stopped = true; return; }
  stopped = false;
  run(e.data).catch((err) => postMessage({ type: 'done', netlist: null, verify: { ok: false, how: String(err) } } satisfies Done));
};

const toGenome = (els: El[]): G => els.map((x) => (x.op === OP.NAND ? { op: 0, a: x.a, b: x.b } : { op: 1, d: x.d }));

async function run({ task, startHex, seconds, seed }: StartMsg) {
  const t = { ...task, cycles: task.kind === 'seq' ? task.cycles : 1 };
  // Memory tasks with inputs: add random spec-generated sequences so the search can't overfit the sample.
  const spec = t.kind === 'seq' && t.nIn > 0 ? pickSpec(t.id, t) : null;
  const train = [...t.vectors];
  if (spec) {
    let s = seed * 7919 + 1;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
    for (let j = 0; j < 512; j++) {
      const ins = Array.from({ length: t.cycles }, () => { const r = rnd(); return Array.from({ length: t.nIn }, (_, i) => (r >>> i) & 1); });
      train.push(encodeVector(t, ins, spec.fn(ins)));
    }
  }
  const sspec = makeSeqSpec(t, train);
  let genome: G | null = startHex ? withSpares(toGenome(decode(hexToBytes(startHex), t.nIn)), t.nIn, t.nOut, 12, seed) : null;
  let best: { g: G; cost: number; nand: number; latch: number; depth: number } | null = null;
  const t0 = Date.now();
  let iterations = 0, round = 0;
  const size = Math.min(80, 10 + 4 * (t.nIn + t.nOut));
  while (!stopped && Date.now() - t0 < seconds * 1000) {
    const r = seqEvolve(sspec, genome ? { start: genome, seed: seed + round, timeLimitMs: 400, latchRate: t.kind === 'seq' ? 0.2 : 0 } : { size, seed: seed + round, timeLimitMs: 400, latchRate: t.kind === 'seq' ? 0.2 : 0 });
    round++;
    iterations += r.iterations;
    genome = r.g ?? r.current;
    if (r.g && (!best || r.cost < best.cost)) best = { g: r.g, cost: r.cost, nand: r.nand, latch: r.latch, depth: r.depth };
    postMessage({
      type: 'progress', elapsed: Date.now() - t0, iterations, correct: !!best, errors: r.errorsLeft,
      best: best ? { cost: best.cost, gates: best.nand, latches: best.latch, depth: best.depth } : undefined,
    } satisfies Progress);
    await new Promise((res) => setTimeout(res, 0)); // let a stop message through
  }
  if (!best) { postMessage({ type: 'done', netlist: null } satisfies Done); return; }
  const els = toSeqNetlist(sspec, best.g);
  const a = analyze(els, t.nIn, t.nOut);
  const official = check(els, t);
  let verify = { ok: official.ok, how: official.ok ? `passes all ${t.vectors.length} official vectors` : 'fails an official vector' };
  if (official.ok && spec) {
    const v = verifySeq(t, els, spec.fn, { maxExhaustiveBits: 20, samples: 200000 });
    verify = v.ok
      ? { ok: true, how: `passes the official vectors and ${v.exhaustive ? 'every one of' : 'a random sample of'} ${v.checked.toLocaleString()} input sequences` }
      : { ok: false, how: 'passes the official vectors but fails another input sequence (not safe to mine)' };
  }
  postMessage({ type: 'done', netlist: bytesToHex(encode(els)), best: { cost: cost(a), gates: a.nand, latches: a.latch, depth: a.depth }, verify } satisfies Done);
}
