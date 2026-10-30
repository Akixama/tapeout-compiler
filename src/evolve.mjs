// Evolutionary optimizer for combinational NAND circuits with a full truth table.
// Keeps the circuit 100% correct at every step and only accepts changes that do not
// raise TapeOut's cost (gates x depth^3). Neutral changes are accepted so the search can drift.
import { OP } from './netlist.mjs';

const hexBytes = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));
const bit = (bytes, i) => (bytes[i >> 3] >> (i & 7)) & 1;

// Bit-parallel truth tables: one Uint32Array per wire, one bit per input combination.
export function makeSpec(task) {
  const { nIn, nOut, vectors } = task;
  const rows = 2 ** nIn, words = Math.max(1, rows >>> 5);
  const inputs = Array.from({ length: nIn }, () => new Uint32Array(words));
  const target = Array.from({ length: nOut }, () => new Uint32Array(words));
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < nIn; i++) if ((r >> i) & 1) inputs[i][r >>> 5] |= 1 << (r & 31);
  }
  for (const v of vectors) {
    const a = hexBytes(v.input), b = hexBytes(v.out);
    let r = 0;
    for (let i = 0; i < nIn; i++) r |= bit(a, i) << i;
    for (let o = 0; o < nOut; o++) if (bit(b, o)) target[o][r >>> 5] |= 1 << (r & 31);
  }
  const mask = rows >= 32 ? 0xffffffff : (2 ** rows - 1);
  return { nIn, nOut, words, inputs, target, mask };
}

// Genome: gates[k] = [a, b] over wires 0..(2+nIn+k-1). The last nOut gates are the outputs.
function simulate(spec, gates, vals) {
  const { nIn, words, inputs, mask } = spec;
  vals[0].fill(0); vals[1].fill(mask);
  for (let i = 0; i < nIn; i++) vals[2 + i].set(inputs[i]);
  for (let k = 0; k < gates.length; k++) {
    const A = vals[gates[k][0]], B = vals[gates[k][1]], Y = vals[2 + nIn + k];
    for (let w = 0; w < words; w++) Y[w] = ~(A[w] & B[w]) & mask;
  }
}

function correct(spec, gates, vals) {
  simulate(spec, gates, vals);
  const base = 2 + spec.nIn + gates.length - spec.nOut;
  for (let o = 0; o < spec.nOut; o++) {
    const Y = vals[base + o], T = spec.target[o];
    for (let w = 0; w < spec.words; w++) if (Y[w] !== T[w]) return false;
  }
  return true;
}

// Cost counts only gates that feed an output (dead gates are stripped on export).
function score(spec, gates) {
  const n = 2 + spec.nIn, G = gates.length;
  const live = new Uint8Array(G), depth = new Int32Array(n + G);
  for (let o = 0; o < spec.nOut; o++) live[G - 1 - o] = 1;
  for (let k = G - 1; k >= 0; k--) if (live[k]) for (const x of gates[k]) if (x >= n) live[x - n] = 1;
  let count = 0;
  for (let k = 0; k < G; k++) {
    if (!live[k]) continue;
    count++;
    depth[n + k] = Math.max(depth[gates[k][0]], depth[gates[k][1]]) + 1;
  }
  let d = 0;
  for (let o = 0; o < spec.nOut; o++) d = Math.max(d, depth[n + G - 1 - o]);
  return { gates: count, depth: d, cost: count * Math.max(d, 1) ** 3 };
}

export function fromNetlist(els, nIn) {
  if (els.some((e) => e.op !== OP.NAND)) throw new Error('only NAND circuits');
  return els.map((e) => [e.a, e.b]);
}

// Drop dead gates and renumber.
export function toNetlist(gates, spec) {
  const n = 2 + spec.nIn, G = gates.length;
  const live = new Uint8Array(G);
  for (let o = 0; o < spec.nOut; o++) live[G - 1 - o] = 1;
  for (let k = G - 1; k >= 0; k--) if (live[k]) for (const x of gates[k]) if (x >= n) live[x - n] = 1;
  const map = new Map();
  for (let w = 0; w < n; w++) map.set(w, w);
  const els = [];
  for (let k = 0; k < G; k++) {
    if (!live[k]) continue;
    const out = n + els.length;
    els.push({ op: OP.NAND, a: map.get(gates[k][0]), b: map.get(gates[k][1]), out });
    map.set(n + k, out);
  }
  return els;
}

// Insert unused spare gates before the output block to give the search room.
function addSpares(gates, spec, spares, rnd) {
  const n = 2 + spec.nIn;
  const body = gates.slice(0, gates.length - spec.nOut), outs = gates.slice(gates.length - spec.nOut);
  const remap = (g, shiftFrom, by) => g.map((x) => (x >= shiftFrom ? x + by : x));
  let cur = body.map((g) => g.slice());
  let tail = outs.map((g) => g.slice());
  for (let s = 0; s < spares; s++) {
    const pos = Math.floor(rnd() * (cur.length + 1));
    const w = n + pos;
    cur = cur.map((g) => remap(g, w, 1));
    tail = tail.map((g) => remap(g, w, 1));
    const lim = w; // spare may read any earlier wire
    cur.splice(pos, 0, [Math.floor(rnd() * lim), Math.floor(rnd() * lim)]);
  }
  return cur.concat(tail);
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function evolve(spec, start, { iterations = 200000, spares = null, seed = 1, timeLimitMs = 60000, onImprove } = {}) {
  const rnd = rng(seed);
  let gates = addSpares(start, spec, spares ?? Math.max(8, Math.ceil(start.length * 0.5)), rnd);
  const n = 2 + spec.nIn;
  const vals = Array.from({ length: n + gates.length }, () => new Uint32Array(spec.words));
  if (!correct(spec, gates, vals)) throw new Error('start circuit is not correct');
  let cur = score(spec, gates), best = { ...cur, gates: gates.map((g) => g.slice()) , s: cur };
  const t0 = Date.now();
  for (let it = 0; it < iterations && Date.now() - t0 < timeLimitMs; it++) {
    // Mutate 1-3 gate inputs.
    const changes = [];
    const m = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < m; j++) {
      const k = Math.floor(rnd() * gates.length), side = rnd() < 0.5 ? 0 : 1;
      changes.push([k, side, gates[k][side]]);
      gates[k][side] = Math.floor(rnd() * (n + k));
    }
    const s = score(spec, gates);
    if (s.cost <= cur.cost && correct(spec, gates, vals)) {
      cur = s;
      if (s.cost < best.s.cost) { best = { gates: gates.map((g) => g.slice()), s }; onImprove?.(s, it); }
    } else {
      for (let j = changes.length - 1; j >= 0; j--) gates[changes[j][0]][changes[j][1]] = changes[j][2];
    }
  }
  return { ...best.s, genome: best.gates };
}
