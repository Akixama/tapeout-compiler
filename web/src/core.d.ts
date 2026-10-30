// Type declarations for the shared JavaScript circuit engine in ../src.
declare module '@core/netlist.mjs' {
  export const OP: { NAND: 0; LATCH: 1; REF: 2 };
  export type El = { op: number; a?: number; b?: number; d?: number; out: number };
  export function decode(bytes: Uint8Array, nIn: number): El[];
  export function encode(els: El[]): Uint8Array;
  export function analyze(els: El[], nIn: number, nOut: number): { nand: number; latch: number; depth: number };
  export function cost(a: { nand: number; latch: number; depth: number }, lambda?: number, beta?: number): number;
}
declare module '@core/hex.mjs' {
  export function hexToBytes(h: string): Uint8Array;
  export function bytesToHex(b: Uint8Array): string;
}
declare module '@core/sim.mjs' {
  import type { El } from '@core/netlist.mjs';
  export function check(els: El[], task: { nIn: number; nOut: number; cycles?: number; kind: string; vectors: { input: string; out: string }[] }): { ok: boolean; vector?: number; cycle?: number; output?: number; vectors?: number };
}
declare module '@core/seqspecs.mjs' {
  export const CANDIDATES: Record<string, Record<string, (ins: number[][]) => number[][]>>;
  export function pickSpec(id: number | string, task: unknown): { name: string; fn: (ins: number[][]) => number[][]; matches: string[] } | null;
  export function encodeVector(task: unknown, ins: number[][], outs: number[][]): { input: string; out: string };
}
declare module '@core/seqevolve.mjs' {
  export type G = { op: number; a?: number; b?: number; d?: number }[];
  export function makeSeqSpec(task: unknown, vectors?: unknown[]): unknown;
  export function seqEvolve(spec: unknown, opts: Record<string, unknown>): { g?: G; cost: number; nand: number; latch: number; depth: number; iterations: number; errorsLeft?: number; current: G };
  export function toSeqNetlist(spec: unknown, g: G): import('@core/netlist.mjs').El[];
  export function withSpares(start: G, nIn: number, nOut: number, spares: number, seed?: number): G;
  export function errors(spec: unknown, g: G, scratch: { vals: unknown[] }): number;
  export function seqScore(spec: unknown, g: G, lambda?: number): { nand: number; latch: number; depth: number; cost: number };
}
declare module '@core/seqverify.mjs' {
  import type { El } from '@core/netlist.mjs';
  export function verifySeq(task: unknown, els: El[], spec: (ins: number[][]) => number[][], opts?: Record<string, unknown>): { ok: boolean; checked: number; exhaustive: boolean; counterexample?: number[][] };
}
