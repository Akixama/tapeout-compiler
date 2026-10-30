// TapeOut netlist format (read from tapeout.net's app code).
// Wires: 0 = constant 0, 1 = constant 1, 2..2+nIn-1 = inputs, then one wire per gate in order.
// NAND  = [0x00, a:u24, b:u24]   (inputs must be earlier wires)
// LATCH = [0x01, d:u24]          (outputs its stored bit; stores wire d after each cycle)
// REF   = [0x02, ...]            (sub-circuit call; not allowed for mining)
// The last nOut wires are the outputs.

export const OP = { NAND: 0, LATCH: 1, REF: 2 };

export function decode(bytes, nIn) {
  const els = [];
  let p = 0, next = 2 + nIn;
  const u24 = () => { if (p + 3 > bytes.length) throw new Error('netlist truncated'); const v = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2]; p += 3; return v; };
  while (p < bytes.length) {
    const op = bytes[p++];
    if (op === OP.NAND) {
      const a = u24(), b = u24(), out = next++;
      if (a >= out || b >= out) throw new Error(`NAND ${out} uses a later wire`);
      els.push({ op, a, b, out });
    } else if (op === OP.LATCH) {
      els.push({ op, d: u24(), out: next++ });
    } else if (op === OP.REF) {
      throw new Error('REF elements are not supported (they cannot mine)');
    } else throw new Error(`unknown opcode ${op} at byte ${p - 1}`);
  }
  return els;
}

export function encode(els) {
  const out = [];
  const u24 = (v) => { if (!Number.isInteger(v) || v < 0 || v > 0xffffff) throw new Error(`bad wire ${v}`); out.push((v >>> 16) & 255, (v >>> 8) & 255, v & 255); };
  for (const e of els) {
    if (e.op === OP.NAND) { out.push(0); u24(e.a); u24(e.b); }
    else if (e.op === OP.LATCH) { out.push(1); u24(e.d); }
    else throw new Error('unsupported element');
  }
  return Uint8Array.from(out);
}

// Depth = longest chain of NAND gates ending at an OUTPUT wire (the last nOut wires).
// Constants, inputs and latch outputs start at 0. Logic that only feeds latches
// does not count toward depth (confirmed against all 267 on-chain leaders).
export function analyze(els, nIn, nOut) {
  const depth = new Int32Array(2 + nIn + els.length);
  let nand = 0, latch = 0, w = 2 + nIn;
  for (const e of els) {
    if (e.op === OP.NAND) { nand++; depth[w] = Math.max(depth[e.a], depth[e.b]) + 1; }
    else latch++;
    w++;
  }
  let max = 0;
  for (let o = 0; o < nOut; o++) max = Math.max(max, depth[w - nOut + o]);
  return { nand, latch, depth: max };
}

export function cost({ nand, latch, depth }, lambda = 6, beta = 3) {
  return (nand + lambda * latch) * Math.max(depth, 1) ** beta;
}
