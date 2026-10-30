// Live reads from TapeOut's mining contract on BNB Chain (read-only, no wallet).
import { createPublicClient, http, fallback, parseAbi } from 'viem';
import { bsc } from 'viem/chains';

export const MINING = '0x7E2E0DC66a3bD9103E69b766afA62d9f7b697b46' as const;
export const MINING_CPUS = ['0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c', '0xb1024b89886b9a34aa4ff5f31c411d708b20a14c'] as const;
const abi = parseAbi(['function bestSlot(uint32 taskId, address circuits) view returns (uint64 holderPlus1, uint256 cost)']);

const client = createPublicClient({
  chain: bsc,
  transport: fallback([http('https://bsc-rpc.publicnode.com'), http('https://bsc-dataseed.bnbchain.org'), http('https://1rpc.io/bnb')]),
  batch: { multicall: true },
});

// Cheapest current slot holder for a task across the mining processors.
export async function liveLeader(taskId: number) {
  const slots = await Promise.all(MINING_CPUS.map(async (cpu) => {
    const [h, c] = await client.readContract({ address: MINING, abi, functionName: 'bestSlot', args: [taskId, cpu] });
    return { cpu, circuitId: h > 0n ? Number(h - 1n) : null, cost: Number(c) };
  }));
  const held = slots.filter((s) => s.circuitId !== null).sort((a, b) => a.cost - b.cost);
  return held[0] ?? null;
}
