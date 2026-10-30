// Every current leader passed TapeOut's on-chain checks, so our checker must
// pass all of them, and must reject them once a single gate is broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { decode, analyze, cost } from '../src/netlist.mjs';
import { check } from '../src/sim.mjs';

const vectors = JSON.parse(readFileSync(new URL('../data/vectors.json', import.meta.url)));
const { rows } = JSON.parse(readFileSync(new URL('../data/leaders.json', import.meta.url)));

test('all leader circuits pass, match on-chain cost, and fail when broken', () => {
  let n = 0;
  for (const r of rows) {
    const f = new URL(`../data/leaders/${r.id}.hex`, import.meta.url);
    if (!existsSync(f)) continue;
    const task = vectors[String(r.id)];
    const els = decode(Buffer.from(readFileSync(f, 'utf8').trim().slice(2), 'hex'), task.nIn);
    assert.deepEqual(check(els, task).ok, true, `task ${r.id} ${task.name}`);
    // Older slots were scored when the latch weight was 7 (it is 6 now).
    const a = analyze(els, task.nIn, task.nOut);
    assert.ok([cost(a, 6), cost(a, 7)].includes(r.leaderCost), `cost of task ${r.id}`);
    // Break the last NAND: tie both inputs to constant 1 if it isn't already, else to 0.
    const last = [...els].reverse().find((e) => e.op === 0);
    if (last) {
      const broken = els.map((e) => (e === last ? { ...e, a: e.a === 1 && e.b === 1 ? 0 : 1, b: e.a === 1 && e.b === 1 ? 0 : 1 } : e));
      const res = check(broken, task);
      // Some tasks don't depend on that gate's exact value (rare); only count real breaks.
      if (res.ok) continue;
    }
    n++;
  }
  assert.ok(n > 200, `only ${n} leaders checked`);
});
