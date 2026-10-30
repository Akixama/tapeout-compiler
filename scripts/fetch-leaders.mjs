// Downloads every task leader's netlist into data/leaders/<taskId>.hex
// so the checker and optimizer can be tested offline.
import { createPublicClient, http, parseAbi } from 'viem';
import { bsc } from 'viem/chains';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const abi = parseAbi(['function netlist(uint256 id) view returns (bytes)']);
const client = createPublicClient({ chain: bsc, transport: http('https://bsc-rpc.publicnode.com'), batch: { multicall: true } });
const { rows } = JSON.parse(readFileSync(new URL('../data/leaders.json', import.meta.url)));
const dir = new URL('../data/leaders/', import.meta.url);
mkdirSync(dir, { recursive: true });

const todo = rows.filter((r) => r.leaderId !== null);
for (let i = 0; i < todo.length; i += 25) {
  await Promise.all(todo.slice(i, i + 25).map(async (r) => {
    const nl = await client.readContract({ address: r.leaderCpu, abi, functionName: 'netlist', args: [BigInt(r.leaderId)] });
    writeFileSync(new URL(`${r.id}.hex`, dir), nl);
  }));
}
console.log(`saved ${todo.length} leader netlists`);
