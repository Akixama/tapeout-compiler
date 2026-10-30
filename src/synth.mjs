// Turns a logic spec into a TapeOut NAND netlist using Yosys + ABC (WebAssembly),
// trying several optimization recipes and keeping the cheapest by TapeOut's cost.
import { runYosys } from '@yowasp/yosys';
import { OP, analyze, cost } from './netlist.mjs';

const bit = (bytes, i) => (bytes[i >> 3] >> (i & 7)) & 1;
import { hexToBytes as hexBytes, bytesToHex } from './hex.mjs';

// Combinational task whose vectors cover every input -> BLIF truth table.
export function truthTableBlif(task) {
  const { nIn, nOut, vectors } = task;
  if (task.kind !== 'comb' || vectors.length < 2 ** nIn) throw new Error('vectors are not a full truth table');
  const ins = Array.from({ length: nIn }, (_, i) => `i${i}`);
  const outs = Array.from({ length: nOut }, (_, i) => `o${i}`);
  const rows = outs.map(() => []);
  for (const v of vectors) {
    const a = hexBytes(v.input), b = hexBytes(v.out);
    // BLIF lists the first input as the leftmost character.
    const pat = ins.map((_, i) => bit(a, i)).join('');
    for (let o = 0; o < nOut; o++) if (bit(b, o)) rows[o].push(pat);
  }
  let s = `.model top\n.inputs ${ins.join(' ')}\n.outputs ${outs.join(' ')}\n`;
  outs.forEach((o, k) => {
    s += `.names ${ins.join(' ')} ${o}\n`;
    for (const p of rows[k]) s += `${p} 1\n`;
  });
  return s + '.end\n';
}

// ABC's standard shortcuts (normally loaded from abc.rc, which the WebAssembly build lacks).
const resyn2 = 'balance; rewrite; refactor; balance; rewrite; rewrite -z; balance; refactor -z; rewrite -z; balance';
const resyn2rs = 'balance; resub -K 6; rewrite; resub -K 6 -N 2; refactor; resub -K 8; balance; resub -K 8 -N 2; rewrite; resub -K 10; rewrite -z; resub -K 10 -N 2; balance; resub -K 12; refactor -z; resub -K 12 -N 2; rewrite -z; balance';
const compress2rs = 'balance -l; resub -K 6 -l; rewrite -l; resub -K 6 -N 2 -l; refactor -l; resub -K 8 -l; balance -l; resub -K 8 -N 2 -l; rewrite -l; resub -K 10 -l; rewrite -z -l; resub -K 10 -N 2 -l; balance -l; resub -K 12 -l; refactor -z -l; resub -K 12 -N 2 -l; rewrite -z -l; balance -l';
const expand = (s) => s.replace(/\bresyn2rs\b/g, resyn2rs).replace(/\bresyn2\b/g, resyn2).replace(/\bcompress2rs\b/g, compress2rs);

// ABC recipes: area-oriented, delay-oriented and mixed. ABC maps to 2-input NAND + NOT.
const RECIPES = {
  area: 'strash; dch; resyn2; dch -f; map -a',
  delay: 'strash; dch; resyn2; dch -f; map',
  'balance-delay': 'strash; balance; dch; resyn2; balance; map',
  'resyn3-delay': 'strash; resyn2; resyn2rs; dch -f; map',
  'compress-area': 'strash; compress2rs; compress2rs; dch -f; map -a',
  'mfs-delay': 'strash; dch; resyn2; dch -f; if -K 6; mfs2; strash; dch; map',
};

// source: { blif } or { verilog }. Verilog must define: module top(input [nIn-1:0] i, output [nOut-1:0] o).
async function runRecipe(source, script) {
  const isV = source.verilog != null;
  const ys = [
    isV ? 'read_verilog -sv in.v' : 'read_blif in.blif',
    isV ? 'synth -flatten -top top -noabc' : 'hierarchy -top top; flatten; techmap; opt -purge',
    'abc -g NAND -script abc.script',
    'opt_clean -purge',
    'write_json out.json',
  ].join('; ');
  let log = '';
  try {
    const abcScript = expand(script).split(';').map((c) => c.trim()).join('\n') + '\n';
    const files = await runYosys(['-q', '-p', ys], { ...(isV ? { 'in.v': source.verilog } : { 'in.blif': source.blif }), 'abc.script': abcScript, tmp: {} }, { stdout: null, stderr: (b) => { if (b) log += new TextDecoder().decode(b); } });
    const out = files['out.json'];
    return JSON.parse(typeof out === 'string' ? out : new TextDecoder().decode(out));
  } catch (e) {
    throw new Error(`yosys failed: ${log.slice(-400) || e.message}`);
  }
}

// Yosys JSON (only $_NAND_ / $_NOT_ cells) -> TapeOut elements.
export function jsonToNetlist(json, nIn, nOut) {
  const mod = json.modules.top;
  const wire = new Map(); // yosys bit id -> TapeOut wire
  wire.set('0', 0); wire.set('1', 1); wire.set('x', 0); // undriven/don't-care bits -> 0
  const pin = (p, k) => (mod.ports[p] ? mod.ports[p].bits[k] : mod.ports[`${p}${k}`].bits[0]);
  for (let i = 0; i < nIn; i++) wire.set(pin('i', i), 2 + i);
  const outBits = Array.from({ length: nOut }, (_, k) => pin('o', k));

  const drivers = new Map(); // bit -> {a, b}
  for (const c of Object.values(mod.cells)) {
    const { A, B, Y } = c.connections;
    if (c.type === '$_NAND_') drivers.set(Y[0], { a: A[0], b: B[0] });
    else if (c.type === '$_NOT_') drivers.set(Y[0], { a: A[0], b: A[0] });
    else throw new Error(`unexpected cell ${c.type}`);
  }

  const els = [];
  let next = 2 + nIn;
  const emit = (a, b) => { els.push({ op: OP.NAND, a, b, out: next }); return next++; };
  // Emit a bit (and everything it needs) in topological order.
  const need = (b) => {
    if (wire.has(b)) return wire.get(b);
    const stack = [[b, false]];
    while (stack.length) {
      const [x, ready] = stack.pop();
      if (wire.has(x)) continue;
      const d = drivers.get(x);
      if (!d) throw new Error(`undriven bit ${x}`);
      if (ready) { wire.set(x, emit(wire.get(d.a), wire.get(d.b))); continue; }
      stack.push([x, true]);
      for (const y of [d.a, d.b]) if (!wire.has(y)) stack.push([y, false]);
    }
    return wire.get(b);
  };

  // Outputs must be the last nOut wires, in order. Emit what the output gates read first,
  // then one final gate per output that recomputes it (no extra depth).
  const finals = outBits.map((b) => {
    if (b === '0' || b === 'x') return { a: 1, b: 1 }; // NAND(1,1) = 0
    if (b === '1') return { a: 0, b: 0 };          // NAND(0,0) = 1
    const d = drivers.get(b);
    if (d) return { a: need(d.a), b: need(d.b) };
    const x = need(b);                              // an input passed straight through
    const n = emit(x, x);
    return { a: n, b: n };
  });
  for (const f of finals) emit(f.a, f.b);
  return els;
}

export async function synthesize(task, { recipes = Object.keys(RECIPES), verilog = null } = {}) {
  const source = verilog != null ? { verilog } : { blif: truthTableBlif(task) };
  const results = [];
  for (const name of recipes) {
    try {
      const json = await runRecipe(source, RECIPES[name]);
      const els = jsonToNetlist(json, task.nIn, task.nOut);
      const a = analyze(els, task.nIn, task.nOut);
      results.push({ recipe: name, els, ...a, cost: cost(a) });
    } catch (e) {
      results.push({ recipe: name, error: e.message });
    }
  }
  const ok = results.filter((r) => !r.error).sort((x, y) => x.cost - y.cost);
  return { best: ok[0] ?? null, results };
}
