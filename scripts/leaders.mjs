// Reads the current mining leader for every on-chain task and checks
// our netlist decoder + depth/cost formula against the contract's numbers.
import { createPublicClient, http, parseAbi } from 'viem';
import { bsc } from 'viem/chains';
import { readFileSync, writeFileSync } from 'node:fs';
import { decode, analyze } from '../src/netlist.mjs';

const MINING = '0x7E2E0DC66a3bD9103E69b766afA62d9f7b697b46';
const CPUS = ['0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c', '0xb1024b89886b9a34aa4ff5f31c411d708b20a14c'];
const abi = parseAbi([
  'function taskCount() view returns (uint32)',
  'function lambda() view returns (uint16)',
  'function beta() view returns (uint8)',
  'function bestSlot(uint32 taskId, address circuits) view returns (uint64 holderPlus1, uint256 cost)',
  'function cachedDepth(address circuits, uint256 circuitId) view returns (bool cached, uint32 depth, uint32 live)',
  'function netlist(uint256 id) view returns (bytes)',
  'function circuitInfo(uint256 id) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)',
]);

const client = createPublicClient({ chain: bsc, transport: http('https://bsc-rpc.publicnode.com'), batch: { multicall: true } });
const read = (address, functionName, args = []) => client.readContract({ address, abi, functionName, args });

const vectors = JSON.parse(readFileSync(new URL('../data/vectors.json', import.meta.url)));
const bank = JSON.parse(readFileSync(new URL('../data/taskbank.json', import.meta.url))).tasks;
const bankById = new Map(bank.map((t) => [t.id, t]));

const [count, lambda, beta] = await Promise.all([read(MINING, 'taskCount'), read(MINING, 'lambda'), read(MINING, 'beta')]);
console.log({ taskCount: count, lambda, beta });

const ids = Array.from({ length: Number(count) }, (_, i) => i + 1);
const slots = await Promise.all(ids.flatMap((id) => CPUS.map((cpu) => read(MINING, 'bestSlot', [id, cpu]).then(([h, c]) => ({ id, cpu, holder: h > 0n ? h - 1n : null, cost: c })))));

const rows = [];
let checked = 0, mismatch = 0;
for (const id of ids) {
  const v = vectors[String(id)];
  const ref = bankById.get(v.srcId);
  const best = slots.filter((s) => s.id === id && s.holder !== null).sort((a, b) => (a.cost < b.cost ? -1 : 1))[0];
  const row = { id, name: v.name, kind: v.kind, nIn: v.nIn, nOut: v.nOut, Cref: ref?.Cref, refGates: ref?.refGates, refDepth: ref?.refDepth, leaderCost: best ? Number(best.cost) : null, leaderCpu: best?.cpu, leaderId: best ? Number(best.holder) : null };
  // Verify our analysis on a sample of leaders.
  if (best && checked < 40) {
    const [nl, [, cDepth]] = await Promise.all([read(best.cpu, 'netlist', [best.holder]), read(MINING, 'cachedDepth', [best.cpu, best.holder])]);
    const a = analyze(decode(Buffer.from(nl.slice(2), "hex"), v.nIn), v.nIn, v.nOut);
    const myCost = (a.nand + Number(lambda) * a.latch) * Math.max(a.depth, 1) ** Number(beta);
    Object.assign(row, { leaderGates: a.nand, leaderLatch: a.latch, leaderDepth: a.depth, chainDepth: cDepth });
    checked++;
    if (myCost !== row.leaderCost || a.depth !== cDepth) { mismatch++; console.log('MISMATCH', id, v.name, { myCost, chainCost: row.leaderCost, myDepth: a.depth, chainDepth: cDepth }); }
  }
  rows.push(row);
}
console.log(`checked ${checked} leaders, ${mismatch} mismatches`);
const vacant = rows.filter((r) => r.leaderCost === null).length;
console.log(`tasks: ${rows.length}, vacant: ${vacant}`);
writeFileSync(new URL('../data/leaders.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), lambda, beta, rows }, null, 1));
