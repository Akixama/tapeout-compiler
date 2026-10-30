// Evolutionary search for sequential (memory) circuits made of NAND gates and LATCHes.
// Fitness is lexicographic: first the number of wrong output bits over the given
// input sequences, then TapeOut's cost (gates + lambda*latches) * max(depth,1)^3.
// All sequences are simulated in parallel, one bit per sequence.
import { OP } from './netlist.mjs';

const hexBytes = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));
const getBit = (bytes, i) => (bytes[i >> 3] >> (i & 7)) & 1;

// Packs vectors into per-cycle bitsets: inBits[c][i] and outBits[c][o], one bit per sequence.
export function makeSeqSpec(task, vectors = task.vectors) {
  const { nIn, nOut, cycles } = task;
  // Sequences with no inputs are all identical; keep one.
  const vecs = nIn === 0 ? vectors.slice(0, 1) : vectors;
  const S = vecs.length, words = Math.ceil(S / 32);
  const inB = Math.ceil(nIn / 8), outB = Math.ceil(nOut / 8);
  const inBits = Array.from({ length: cycles }, () => Array.from({ length: nIn }, () => new Uint32Array(words)));
  const outBits = Array.from({ length: cycles }, () => Array.from({ length: nOut }, () => new Uint32Array(words)));
  vecs.forEach((v, s) => {
    const a = hexBytes(v.input), b = hexBytes(v.out);
    for (let c = 0; c < cycles; c++) {
      for (let i = 0; i < nIn; i++) if (getBit(a, c * inB * 8 + i)) inBits[c][i][s >>> 5] |= 1 << (s & 31);
      for (let o = 0; o < nOut; o++) if (getBit(b, c * outB * 8 + o)) outBits[c][o][s >>> 5] |= 1 << (s & 31);
    }
  });
  const lastMask = S % 32 === 0 ? 0xffffffff : (1 << (S % 32)) - 1;
  return { nIn, nOut, cycles, words, inBits, outBits, lastMask, sequences: S };
}

const popcount = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };

// Genome element: { op: 0 (NAND), a, b } or { op: 1 (LATCH), d }. Wire of element k = 2+nIn+k.
export function errors(spec, g, scratch) {
  const { nIn, nOut, cycles, words, inBits, outBits, lastMask } = spec;
  const n = 2 + nIn, W = n + g.length;
  const vals = scratch.vals.length >= W ? scratch.vals : (scratch.vals = Array.from({ length: W }, () => new Uint32Array(words)));
  const latches = [];
  for (let k = 0; k < g.length; k++) if (g[k].op === OP.LATCH) latches.push(k);
  const state = latches.map(() => new Uint32Array(words));
  let err = 0;
  vals[0].fill(0); vals[1].fill(0xffffffff);
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < nIn; i++) vals[2 + i].set(inBits[c][i]);
    let li = 0;
    for (let k = 0; k < g.length; k++) {
      const e = g[k], Y = vals[n + k];
      if (e.op === OP.NAND) { const A = vals[e.a], B = vals[e.b]; for (let w = 0; w < words; w++) Y[w] = ~(A[w] & B[w]); }
      else Y.set(state[li++]);
    }
    for (let o = 0; o < nOut; o++) {
      const Y = vals[W - nOut + o], T = outBits[c][o];
      for (let w = 0; w < words; w++) {
        let x = Y[w] ^ T[w];
        if (w === words - 1) x &= lastMask;
        if (x) err += popcount(x);
      }
    }
    li = 0;
    for (const k of latches) state[li++].set(vals[g[k].d]);
  }
  return err;
}

export function seqScore(spec, g, lambda = 6) {
  const n = 2 + spec.nIn, G = g.length;
  const live = new Uint8Array(G);
  const stack = [];
  for (let o = 0; o < spec.nOut; o++) { live[G - 1 - o] = 1; stack.push(G - 1 - o); }
  while (stack.length) {
    const e = g[stack.pop()];
    for (const x of e.op === OP.NAND ? [e.a, e.b] : [e.d]) if (x >= n && !live[x - n]) { live[x - n] = 1; stack.push(x - n); }
  }
  const depth = new Int32Array(n + G);
  let nand = 0, latch = 0;
  for (let k = 0; k < G; k++) {
    if (g[k].op === OP.NAND) { depth[n + k] = Math.max(depth[g[k].a], depth[g[k].b]) + 1; if (live[k]) nand++; }
    else if (live[k]) latch++;
  }
  let d = 0;
  for (let o = 0; o < spec.nOut; o++) d = Math.max(d, depth[n + G - 1 - o]);
  return { nand, latch, depth: d, cost: (nand + lambda * latch) * Math.max(d, 1) ** 3, live };
}

// Remove dead elements and renumber wires (latch d may point forward).
export function toSeqNetlist(spec, g) {
  const n = 2 + spec.nIn;
  const { live } = seqScore(spec, g);
  const map = new Map();
  for (let w = 0; w < n; w++) map.set(w, w);
  let next = n;
  for (let k = 0; k < g.length; k++) if (live[k]) map.set(n + k, next++);
  const els = [];
  for (let k = 0; k < g.length; k++) {
    if (!live[k]) continue;
    const e = g[k], out = map.get(n + k);
    els.push(e.op === OP.NAND ? { op: OP.NAND, a: map.get(e.a), b: map.get(e.b), out } : { op: OP.LATCH, d: map.get(e.d), out });
  }
  return els;
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function randomElement(k, n, G, rnd, latchRate) {
  if (rnd() < latchRate) return { op: OP.LATCH, d: Math.floor(rnd() * (n + G)) };
  return { op: OP.NAND, a: Math.floor(rnd() * (n + k)), b: Math.floor(rnd() * (n + k)) };
}

export function seqEvolve(spec, { size = 24, seed = 1, timeLimitMs = 10000, latchRate = 0.25, start = null, target = Infinity } = {}) {
  const rnd = rng(seed), n = 2 + spec.nIn;
  let g = start ? start.map((e) => ({ ...e })) : Array.from({ length: size }, (_, k) => randomElement(k, n, size, rnd, latchRate));
  const G = g.length, scratch = { vals: [] };
  let err = errors(spec, g, scratch), sc = seqScore(spec, g);
  let best = err === 0 ? { g: g.map((e) => ({ ...e })), ...sc } : null;
  const t0 = Date.now();
  let it = 0;
  while (Date.now() - t0 < timeLimitMs) {
    it++;
    const saved = [];
    const m = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < m; j++) {
      const k = Math.floor(rnd() * G);
      saved.push([k, g[k]]);
      const e = g[k];
      const r = rnd();
      if (r < 0.15) g[k] = randomElement(k, n, G, rnd, latchRate);
      else if (e.op === OP.NAND) g[k] = r < 0.57 ? { ...e, a: Math.floor(rnd() * (n + k)) } : { ...e, b: Math.floor(rnd() * (n + k)) };
      else g[k] = { ...e, d: Math.floor(rnd() * (n + G)) };
    }
    const s2 = seqScore(spec, g);
    // Cheap reject: once correct, never accept a costlier circuit.
    if (err === 0 && s2.cost > sc.cost) { for (let j = saved.length - 1; j >= 0; j--) g[saved[j][0]] = saved[j][1]; continue; }
    const e2 = errors(spec, g, scratch);
    if (e2 < err || (e2 === err && s2.cost <= sc.cost)) {
      err = e2; sc = s2;
      if (err === 0 && (!best || sc.cost < best.cost)) {
        best = { g: g.map((e) => ({ ...e })), ...sc };
        if (best.cost <= target) break;
      }
    } else {
      for (let j = saved.length - 1; j >= 0; j--) g[saved[j][0]] = saved[j][1];
    }
  }
  return best ? { ...best, iterations: it } : { iterations: it, errorsLeft: err };
}
