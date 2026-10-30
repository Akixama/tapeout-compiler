// Builds a correct starting circuit for a no-input sequential task:
// a binary state counter (all-zero = first cycle) whose next-state and next-output logic
// come from Yosys/ABC. Outputs are stored in latches so their depth is 0 or 1:
//   - output that starts at 0: an output latch holding the next value (depth 0)
//   - output that starts at 1: a latch holding the inverted next value, read through NAND(t,t) (depth 1)
import { OP } from './netlist.mjs';
import { synthesize } from './synth.mjs';

import { hexToBytes as hexBytes, bytesToHex } from './hex.mjs';
const getBit = (bytes, i) => (bytes[i >> 3] >> (i & 7)) & 1;

function outputSequence(task) {
  const b = hexBytes(task.vectors[0].out), outB = Math.ceil(task.nOut / 8) * 8;
  return Array.from({ length: task.cycles }, (_, c) => Array.from({ length: task.nOut }, (_, o) => getBit(b, c * outB + o)));
}

// Smallest p so the sequence repeats every p cycles (within the checked cycles).
function period(seq) {
  for (let p = 1; p <= seq.length; p++) if (seq.every((row, c) => row.join() === seq[c % p].join())) return p;
  return seq.length;
}

export async function counterSeed(task) {
  if (task.nIn !== 0) throw new Error('only for tasks without inputs');
  const seq = outputSequence(task), p = period(seq), nOut = task.nOut;
  const b = Math.max(1, Math.ceil(Math.log2(p)));
  const inv = seq[0].map((v) => v === 1); // outputs that start at 1
  // Combinational task: inputs = state bits, outputs = next-state bits then next-output bits.
  const nO = b + nOut, rows = 2 ** b;
  const vectors = [];
  for (let s = 0; s < rows; s++) {
    const nxt = s < p ? (s + 1) % p : 0;
    const outsNext = s < p ? seq[nxt] : new Array(nOut).fill(0);
    const bits = [];
    for (let i = 0; i < b; i++) bits.push((nxt >> i) & 1);
    outsNext.forEach((v, o) => bits.push(inv[o] ? 1 - v : v));
    const outBytes = new Uint8Array(Math.ceil(nO / 8));
    bits.forEach((v, i) => { if (v) outBytes[i >> 3] |= 1 << (i & 7); });
    vectors.push({ input: '0x' + s.toString(16).padStart(2 * Math.ceil(b / 8), '0').match(/../g).reverse().join(''), out: bytesToHex(outBytes) });
  }
  const comb = { kind: 'comb', nIn: b, nOut: nO, vectors };
  const { best } = await synthesize(comb);
  // Assemble: state latches occupy wires 2..2+b-1 (exactly where the comb circuit expects its inputs).
  const C = best.els; // wires 2+b .. 2+b+C.length-1
  const combOutWire = (k) => 2 + b + C.length - nO + k;
  const els = [];
  for (let i = 0; i < b; i++) els.push({ op: OP.LATCH, d: combOutWire(i) });
  for (const e of C) els.push({ ...e });
  // Latches for inverted outputs first, then the output elements in order.
  const tWire = {};
  for (let o = 0; o < nOut; o++) if (inv[o]) { tWire[o] = 2 + els.length; els.push({ op: OP.LATCH, d: combOutWire(b + o) }); }
  for (let o = 0; o < nOut; o++) {
    els.push(inv[o] ? { op: OP.NAND, a: tWire[o], b: tWire[o] } : { op: OP.LATCH, d: combOutWire(b + o) });
  }
  return els.map((e, k) => ({ ...e, out: 2 + k }));
}
