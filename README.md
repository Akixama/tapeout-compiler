# TapeOut Compiler

**Cheaper circuits for [TapeOut](https://tapeout.net) mining, found automatically and checked before they go on-chain.**

Live app: **https://tapeout-compiler.vercel.app**

TapeOut pays the most $BEM to the cheapest correct circuit for each of its 267 mining tasks. Designing those circuits by hand takes chip-design skill. TapeOut Compiler generates NAND circuits, evolves them under TapeOut's exact cost rule, and proves them correct against the official test vectors, so anyone can compete.

Built for the OKX Xccelerate hackathon (X Layer × TapeOut).

## Results

Our circuits are cheaper than the current on-chain leader on **14 tasks**, by 10% on average. Every one passes all official vectors; the memory tasks with inputs were also checked against every possible input sequence, so they can't be revoked by a counterexample.

| Task | Leader cost | Our cost | Cut |
|---|---:|---:|---:|
| #86 4-bit Johnson counter | 36 | 31 | −14% |
| #95 mod-3 counter 0–1–2 cycle | 30 | 26 | −13% |
| #82 Divide-by-2 square wave | 8 | 7 | −13% |
| #221 Divide-by-4 | 24 | 21 | −13% |
| #235 PWM duty cycle 1/4 | 24 | 21 | −13% |
| #234 Traffic-light FSM (red 4, amber 1, green 3) | 57 | 50 | −12% |
| #75 Rising-edge detector | 270 | 243 | −10% |
| #232 Falling-edge detector | 270 | 243 | −10% |
| #233 Dual-edge detector | 297 | 270 | −9% |
| #84 2-bit free-running counter | 33 | 31 | −6% |
| #211 mod-4 counter | 33 | 31 | −6% |
| #236 PWM duty cycle 3/8 | 34 | 32 | −6% |
| #227 sequence detector 110 | 486 | 459 | −6% |
| #212 mod-8 counter | 52 | 50 | −4% |

Leader costs are a snapshot from BNB Chain on 2026-10-30; the app can re-check any task live. The winning netlists are in [`out/seq/`](out/seq).

## How TapeOut scores a circuit

Worked out from tapeout.net's app and the mining contract, and confirmed against all 267 current leaders (0 mismatches):

```
cost  = (NAND gates + 6 × latches) × max(depth, 1)³
bonus = K × clamp(C_ref / cost, ¼, 4)
```

- **Depth counts only paths that end at an output.** Latch outputs start at depth 0, so memory designs can keep outputs at depth 0–1 and pay no depth penalty.
- **The latch weight dropped from 7 to 6.** All 58 memory-task leaders were scored at 7, so an equally good design submitted today is strictly cheaper.
- **TapeOut's canvas adds two gates to every output** when it compiles a drawing. Our netlists are submitted raw through `tapeout(netlist, nIn, nOut)`, which avoids that.

## How it works

1. **Read the tasks.** All task specs, official vectors and current leader circuits come from TapeOut's public data and the mining contract on BNB Chain.
2. **Generate.** Logic tasks go through Yosys + ABC (WebAssembly) with several optimization recipes and are mapped to 2-input NAND. Memory tasks start from a textbook state machine whose logic Yosys builds.
3. **Evolve.** An evolutionary search rewires gates and latches, keeping only changes that stay 100% correct and don't raise TapeOut's cost.
4. **Verify.** Every circuit is simulated against the official vectors. Memory tasks with inputs get an executable spec (chosen automatically as the reading of the task name that matches all official vectors) and are checked on every input sequence, up to 16.7 million.
5. **Export.** The app shows the circuit gate by gate and downloads the exact netlist bytes for `tapeout()`.

The same engine runs in the browser: open any task and press **Start search** to watch it hunt for a cheaper circuit live.

## Run it

```bash
npm ci
node --test test/                                    # checker vs all 267 leaders
node --experimental-wasm-exnref scripts/run-seq.mjs 60   # evolve memory tasks (60 s each)
node scripts/run-seq-in.mjs 60                       # memory tasks with inputs, fully verified
node scripts/build-web-data.mjs                      # bundle data for the web app
cd web && npm ci && npm run dev
```

## Layout

| Path | What it is |
|---|---|
| `src/netlist.mjs` | TapeOut netlist format, depth and cost |
| `src/sim.mjs` | Simulator, same rules as tapeout.net |
| `src/synth.mjs` | Yosys + ABC synthesis to NAND |
| `src/evolve.mjs`, `src/seqevolve.mjs` | Evolutionary optimizers (logic / memory) |
| `src/seqspecs.mjs`, `src/seqverify.mjs` | Executable specs and exhaustive verification |
| `scripts/` | Data refresh, batch runs, web bundle |
| `web/` | The web app (Vite + React) |
| `out/seq/` | Winning netlists |

## Status and next steps

- Not yet taped out on-chain (that burns transistors and costs gas).
- X Layer: hosting on X Layer DeWEB and recording verified wins on X Layer are next.
- Logic-task leaders are expert-level; our pipeline ties about 40 of them but hasn't beaten one yet.

Independent project; not affiliated with TapeOut or OKX.
