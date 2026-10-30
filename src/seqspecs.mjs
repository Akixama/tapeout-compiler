// Executable specs for sequential tasks that have inputs.
// Each spec maps the per-cycle input bits (array of arrays) to per-cycle output bits.
// Task names don't say everything (output this cycle or next? overlapping matches?),
// so each task lists candidate readings and pickSpec() keeps the one that matches
// every official vector.

const bitsOf = (x, n) => Array.from({ length: n }, (_, i) => (x >> i) & 1);
const val = (bits) => bits.reduce((a, b, i) => a | (b << i), 0);

// Run a Moore/Mealy machine: step(state, inBits) -> { state, out } ; "now" variants output
// after seeing this cycle's input, "late" variants output the value from before the update.
const machine = (init, step) => ({
  now: (ins) => { let s = init; return ins.map((x) => { const r = step(s, x); s = r.state; return r.out(r.state, s); }); },
  late: (ins) => { let s = init; return ins.map((x) => { const prev = s; const r = step(s, x); s = r.state; return r.out(prev, s); }); },
});

const detector = (pattern) => {
  const p = pattern.split('').map(Number), k = p.length;
  const hit = (h) => h.length >= k && h.slice(-k).every((b, i) => b === p[i]);
  return {
    'overlap-now': (ins) => { const h = []; return ins.map((x) => { h.push(x[0]); return [hit(h) ? 1 : 0]; }); },
    'overlap-late': (ins) => { const h = []; return ins.map((x) => { const o = hit(h) ? 1 : 0; h.push(x[0]); return [o]; }); },
    'nonoverlap-now': (ins) => { let h = []; return ins.map((x) => { h.push(x[0]); if (hit(h)) { h = []; return [1]; } return [0]; }); },
    // History starts as k zeros (a shift register cleared at reset).
    'zero-history-now': (ins) => { const h = new Array(k).fill(0); return ins.map((x) => { h.push(x[0]); return [hit(h) ? 1 : 0]; }); },
  };
};

const counterEn = (bits) => {
  const m = 2 ** bits;
  return {
    now: (ins) => { let c = 0; return ins.map((x) => { if (x[0]) c = (c + 1) % m; return bitsOf(c, bits); }); },
    late: (ins) => { let c = 0; return ins.map((x) => { const o = bitsOf(c, bits); if (x[0]) c = (c + 1) % m; return o; }); },
  };
};

const edge = (kind) => {
  const f = (prev, cur) => (kind === 'rise' ? !prev && cur : kind === 'fall' ? prev && !cur : prev !== cur) ? 1 : 0;
  return {
    now: (ins) => { let p = 0; return ins.map((x) => { const o = f(p, x[0]); p = x[0]; return [o]; }); },
    late: (ins) => { let p = 0, q = 0; return ins.map((x) => { const o = q; q = f(p, x[0]); p = x[0]; return [o]; }); },
  };
};

// Shift register: inputs (data, enable) or (enable, data); shift direction left/right.
const shiftReg = (bits) => {
  const out = {};
  for (const order of ['de', 'ed']) for (const dir of ['left', 'right']) for (const when of ['now', 'late']) {
    out[`${order}-${dir}-${when}`] = (ins) => {
      let r = new Array(bits).fill(0);
      return ins.map((x) => {
        const [d, e] = order === 'de' ? [x[0], x[1]] : [x[1], x[0]];
        const before = r.slice();
        if (e) r = dir === 'left' ? [d, ...r.slice(0, bits - 1)] : [...r.slice(1), d];
        return when === 'now' ? r.slice() : before;
      });
    };
    // Some shift registers shift every cycle and use the second input as the data bit only.
  }
  for (const di of [0, 1]) for (const dir of ['left', 'right']) for (const when of ['now', 'late']) {
    out[`always-d${di}-${dir}-${when}`] = (ins) => {
      let r = new Array(bits).fill(0);
      return ins.map((x) => { const before = r.slice(); const d = x[di]; r = dir === 'left' ? [d, ...r.slice(0, bits - 1)] : [...r.slice(1), d]; return when === 'now' ? r.slice() : before; });
    };
  }
  return out;
};

const serial = (op) => {
  const out = {};
  for (const when of ['now', 'late']) out[when] = (ins) => {
    let c = 0, q = 0;
    return ins.map((x) => {
      const [a, b] = x;
      const s = op === 'add' ? a ^ b ^ c : a ^ b ^ c;
      c = op === 'add' ? (a & b) | (c & (a ^ b)) : ((1 - a) & b) | (c & (1 - (a ^ b)));
      const o = when === 'now' ? s : q; q = s; return [o];
    });
  };
  return out;
};

const accumulator = () => {
  const out = {};
  for (const enBit of [0, 4]) for (const when of ['now', 'late']) {
    out[`en${enBit}-${when}`] = (ins) => {
      let acc = 0;
      return ins.map((x) => {
        const en = x[enBit], v = val(enBit === 0 ? x.slice(1, 5) : x.slice(0, 4));
        const before = acc;
        if (en) acc = (acc + v) & 15;
        return bitsOf(when === 'now' ? acc : before, 4);
      });
    };
  }
  return out;
};

const tff = () => ({
  now: (ins) => { let q = 0; return ins.map((x) => { q ^= x[0]; return [q]; }); },
  late: (ins) => { let q = 0; return ins.map((x) => { const o = q; q ^= x[0]; return [o]; }); },
});
const div2en = () => ({
  ...tff(),
  'every-now': (ins) => { let q = 0; return ins.map(() => { q ^= 1; return [q]; }); },
  'every-late': (ins) => { let q = 0; return ins.map(() => { const o = q; q ^= 1; return [o]; }); },
});

// On-chain task id -> candidate specs.
export const CANDIDATES = {
  73: tff(), 74: div2en(), 75: edge('rise'), 232: edge('fall'), 233: edge('both'),
  76: counterEn(2), 77: counterEn(4),
  79: detector('1011'), 226: detector('1010'), 227: detector('110'), 228: detector('0110'),
  229: detector('11011'), 230: detector('1001'), 263: detector('101'), 264: detector('0101'), 265: detector('111'),
  78: shiftReg(4), 219: shiftReg(4), 218: shiftReg(8),
  81: serial('add'), 231: serial('sub'),
  80: accumulator(),
};

const hexBytes = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));
const getBit = (bytes, i) => (bytes[i >> 3] >> (i & 7)) & 1;

export function decodeVector(task, v) {
  const inB = Math.ceil(task.nIn / 8) * 8, outB = Math.ceil(task.nOut / 8) * 8;
  const a = hexBytes(v.input), b = hexBytes(v.out);
  const ins = Array.from({ length: task.cycles }, (_, c) => Array.from({ length: task.nIn }, (_, i) => getBit(a, c * inB + i)));
  const outs = Array.from({ length: task.cycles }, (_, c) => Array.from({ length: task.nOut }, (_, o) => getBit(b, c * outB + o)));
  return { ins, outs };
}

export function encodeVector(task, ins, outs) {
  const inB = Math.ceil(task.nIn / 8), outB = Math.ceil(task.nOut / 8);
  const a = new Uint8Array(inB * task.cycles), b = new Uint8Array(outB * task.cycles);
  ins.forEach((x, c) => x.forEach((v, i) => { if (v) a[c * inB + (i >> 3)] |= 1 << (i & 7); }));
  outs.forEach((x, c) => x.forEach((v, o) => { if (v) b[c * outB + (o >> 3)] |= 1 << (o & 7); }));
  return { input: '0x' + Buffer.from(a).toString('hex'), out: '0x' + Buffer.from(b).toString('hex') };
}

// Returns { name, fn } for the single candidate that matches all official vectors, or null.
export function pickSpec(id, task) {
  const cands = CANDIDATES[id];
  if (!cands) return null;
  const decoded = task.vectors.map((v) => decodeVector(task, v));
  const ok = Object.entries(cands).filter(([, fn]) => decoded.every(({ ins, outs }) => JSON.stringify(fn(ins)) === JSON.stringify(outs)));
  return ok.length ? { name: ok[0][0], fn: ok[0][1], matches: ok.map(([n]) => n) } : null;
}
