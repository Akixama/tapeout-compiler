// Bundles everything the web app needs into web/public/data:
//   tasks.json         one row per on-chain task: spec, reference, current leader, our best circuit
//   vectors/<id>.json  official test vectors per task (loaded on demand)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { decode, analyze, cost } from '../src/netlist.mjs';
import { check } from '../src/sim.mjs';
import { hexToBytes } from '../src/hex.mjs';

const root = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root)));
const V = read('data/vectors.json');
const bank = new Map(read('data/taskbank.json').tasks.map((t) => [t.id, t]));
const { rows, lambda, beta } = read('data/leaders.json');
const names = read('data/names-en.json');
const outDir = new URL('web/public/data/', root);
mkdirSync(new URL('vectors/', outDir), { recursive: true });

const stats = (hex, t) => {
  const els = decode(hexToBytes(hex), t.nIn);
  return { ...analyze(els, t.nIn, t.nOut), els };
};

// Our circuits: memory-task wins were verified on every input sequence where that was possible.
const ours = (id) => {
  for (const [file, how] of [[`out/seq/${id}.hex`, 'seq'], [`out/${id}.hex`, 'comb']]) {
    const u = new URL(file, root);
    if (existsSync(u)) return { hex: readFileSync(u, 'utf8').trim(), how };
  }
  return null;
};

const tasks = [];
for (const r of rows) {
  const t = V[String(r.id)], b = bank.get(t.srcId);
  const leaderHex = readFileSync(new URL(`data/leaders/${r.id}.hex`, root), 'utf8').trim();
  const L = stats(leaderHex, t);
  const row = {
    id: r.id, name: t.name, nameEn: names[String(r.id)], kind: t.kind, nIn: t.nIn, nOut: t.nOut, cycles: t.cycles,
    group: b?.group ?? null, tier: b?.tier ?? null, K: b?.K ?? null, Cref: r.Cref, refGates: r.refGates, refDepth: r.refDepth,
    vectors: t.vectors.length, fullTable: t.kind === 'comb' && t.vectors.length >= 2 ** t.nIn,
    leader: { cost: r.leaderCost, cpu: r.leaderCpu, circuitId: r.leaderId, gates: L.nand, latches: L.latch, depth: L.depth, netlist: leaderHex },
    ours: null,
  };
  const o = ours(r.id);
  if (o) {
    const A = stats(o.hex, t);
    const c = cost(A, Number(lambda), Number(beta));
    if (!check(A.els, t).ok) throw new Error(`our circuit for task ${r.id} fails the official vectors`);
    row.ours = { cost: c, gates: A.nand, latches: A.latch, depth: A.depth, netlist: o.hex, beatsLeader: c < r.leaderCost };
  }
  tasks.push(row);
  writeFileSync(new URL(`vectors/${r.id}.json`, outDir), JSON.stringify({ id: r.id, kind: t.kind, nIn: t.nIn, nOut: t.nOut, cycles: t.cycles, root: t.root, vectors: t.vectors }));
}
writeFileSync(new URL('tasks.json', outDir), JSON.stringify({ builtAt: new Date().toISOString(), leadersAt: read('data/leaders.json').at, lambda: Number(lambda), beta: Number(beta), tasks }));
console.log(`tasks: ${tasks.length}, with our circuit: ${tasks.filter((t) => t.ours).length}, beating leader: ${tasks.filter((t) => t.ours?.beatsLeader).length}`);
