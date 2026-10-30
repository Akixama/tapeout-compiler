// Runs a decoded netlist against TapeOut's official vectors.
// Same rules as tapeout.net's simulator: one pass per cycle, latches start at 0,
// each latch outputs its stored bit and stores wire d at the end of the cycle.
// Bits are packed little-endian: bit i of the cycle's value = byte[i>>3] >> (i&7).
import { OP } from './netlist.mjs';

const hexBytes = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));
const bytesPerCycle = (n) => Math.ceil(n / 8) || 0;
const bit = (bytes, off, i) => (bytes[off + (i >> 3)] >> (i & 7)) & 1;

export function check(els, task) {
  const { nIn, nOut, cycles = 1, vectors } = task;
  const nSig = 2 + nIn + els.length;
  const latches = els.filter((e) => e.op === OP.LATCH);
  const sig = new Uint8Array(nSig);
  const inB = bytesPerCycle(nIn), outB = bytesPerCycle(nOut);
  const ncyc = task.kind === 'seq' ? cycles : 1;
  for (let v = 0; v < vectors.length; v++) {
    const ins = hexBytes(vectors[v].input), outs = hexBytes(vectors[v].out);
    const state = new Uint8Array(latches.length);
    for (let c = 0; c < ncyc; c++) {
      sig[0] = 0; sig[1] = 1;
      for (let i = 0; i < nIn; i++) sig[2 + i] = bit(ins, c * inB, i);
      let w = 2 + nIn, li = 0;
      for (const e of els) {
        sig[w++] = e.op === OP.NAND ? (sig[e.a] & sig[e.b] ? 0 : 1) : state[li++];
      }
      for (let o = 0; o < nOut; o++) {
        if (sig[nSig - nOut + o] !== bit(outs, c * outB, o)) return { ok: false, vector: v, cycle: c, output: o };
      }
      li = 0;
      for (const e of latches) state[li++] = sig[e.d];
    }
  }
  return { ok: true, vectors: vectors.length };
}
