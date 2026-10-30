// Checks a sequential netlist against an executable spec on every input sequence
// (when there are at most 2^24 of them) or on a large random sample otherwise.
// Returns { ok, checked, exhaustive, counterexample? }.
import { OP } from './netlist.mjs';

const CHUNK = 1 << 16; // sequences per batch

export function verifySeq(task, els, specFn, { maxExhaustiveBits = 24, samples = 1 << 20, seed = 7 } = {}) {
  const { nIn, nOut, cycles } = task;
  const totalBits = nIn * cycles;
  const exhaustive = totalBits <= maxExhaustiveBits;
  const total = exhaustive ? 2 ** totalBits : samples;
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  const n = 2 + nIn, W = n + els.length;
  const latches = els.map((e, k) => (e.op === OP.LATCH ? k : -1)).filter((k) => k >= 0);

  for (let start = 0; start < total; start += CHUNK) {
    const S = Math.min(CHUNK, total - start), words = Math.ceil(S / 32);
    // Build input sequences for this batch.
    const seqs = new Array(S);
    for (let j = 0; j < S; j++) {
      const ins = [];
      if (exhaustive) {
        const idx = start + j;
        for (let c = 0; c < cycles; c++) { const row = []; for (let i = 0; i < nIn; i++) row.push(Math.floor(idx / 2 ** (c * nIn + i)) % 2); ins.push(row); }
      } else {
        for (let c = 0; c < cycles; c++) { const r = rnd(); const row = []; for (let i = 0; i < nIn; i++) row.push((r >>> i) & 1); ins.push(row); }
      }
      seqs[j] = ins;
    }
    const vals = Array.from({ length: W }, () => new Uint32Array(words));
    const state = latches.map(() => new Uint32Array(words));
    const expected = seqs.map((ins) => specFn(ins));
    vals[1].fill(0xffffffff);
    for (let c = 0; c < cycles; c++) {
      for (let i = 0; i < nIn; i++) { const v = vals[2 + i]; v.fill(0); for (let j = 0; j < S; j++) if (seqs[j][c][i]) v[j >>> 5] |= 1 << (j & 31); }
      let li = 0;
      for (let k = 0; k < els.length; k++) {
        const e = els[k], Y = vals[n + k];
        if (e.op === OP.NAND) { const A = vals[e.a], B = vals[e.b]; for (let w = 0; w < words; w++) Y[w] = ~(A[w] & B[w]); }
        else Y.set(state[li++]);
      }
      for (let o = 0; o < nOut; o++) {
        const Y = vals[W - nOut + o];
        for (let j = 0; j < S; j++) {
          const got = (Y[j >>> 5] >>> (j & 31)) & 1;
          if (got !== expected[j][c][o]) return { ok: false, checked: start + j, exhaustive, counterexample: seqs[j], cycle: c, output: o };
        }
      }
      li = 0;
      for (const k of latches) state[li++].set(vals[els[k].d]);
    }
  }
  return { ok: true, checked: total, exhaustive };
}
