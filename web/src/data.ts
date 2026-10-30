// Types and loaders for the bundled TapeOut data (built by scripts/build-web-data.mjs).
import { CANDIDATES } from '@core/seqspecs.mjs';

export type CircuitStats = { cost: number; gates: number; latches: number; depth: number; netlist: string };
export type Task = {
  id: number;
  name: string;
  nameEn: string;
  kind: 'comb' | 'seq';
  nIn: number;
  nOut: number;
  cycles: number;
  group: string | null;
  tier: string | null;
  K: number | null;
  Cref: number;
  refGates: number;
  refDepth: number;
  vectors: number;
  fullTable: boolean;
  leader: CircuitStats & { cpu: string; circuitId: number };
  ours: (CircuitStats & { beatsLeader: boolean }) | null;
};
export type Bundle = { builtAt: string; leadersAt: string; lambda: number; beta: number; tasks: Task[] };
export type Vector = { input: string; out: string };
export type TaskVectors = { id: number; kind: 'comb' | 'seq'; nIn: number; nOut: number; cycles: number; root: string; vectors: Vector[] };

let bundle: Promise<Bundle> | null = null;
export const loadBundle = () => (bundle ??= fetch('/data/tasks.json').then((r) => r.json()));

const vecCache = new Map<number, Promise<TaskVectors>>();
export const loadVectors = (id: number) => {
  if (!vecCache.has(id)) vecCache.set(id, fetch(`/data/vectors/${id}.json`).then((r) => r.json()));
  return vecCache.get(id)!;
};

// TapeOut's cost: (gates + lambda * latches) * max(depth, 1)^beta
export const costOf = (gates: number, latches: number, depth: number, lambda = 6, beta = 3) => (gates + lambda * latches) * Math.max(depth, 1) ** beta;
// Mining bonus: K * clamp(Cref / C, 1/4, 4)
export const bonusOf = (t: Task, c: number) => (t.K ?? 0) * Math.min(4, Math.max(0.25, t.Cref / c));

// Can we fully check a circuit for this task (so it can't be revoked by a counterexample)?
export function verifiability(t: Task): { level: 'full' | 'spec' | 'official'; note: string } {
  if (t.kind === 'comb' && t.fullTable) return { level: 'full', note: 'The official vectors cover every input, so passing them proves the circuit correct.' };
  if (t.kind === 'seq' && t.nIn === 0) return { level: 'full', note: 'No inputs: the official run is the only possible behaviour.' };
  if (t.kind === 'seq' && (CANDIDATES as Record<string, unknown>)[t.id]) return { level: 'spec', note: 'Checked against a written spec on every input sequence (or a 1M-sequence sample when there are too many).' };
  return { level: 'official', note: 'Only the official sample is available here. Passing it does not rule out a counterexample on other inputs.' };
}

export const fmt = (n: number) => n.toLocaleString('en-US');
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
