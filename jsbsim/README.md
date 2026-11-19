# jsbsim/: the one build

Everything about JSBSim lives here: its pins, its data files, the C++ host layer, the build scripts and the WebAssembly binaries they made, and the tests that came with them. The one piece that lives elsewhere is the JavaScript wrapper, loop and Worker, in `src/sim/`, because the app loads them.

## Where it came from

All of it is copied from **`135crewdog/FDM`, branch `baseline/jsbsim`, commit `e47882503ab765d575a38b5bcd59fd41da76b1ae`** (`e478825`). That commit's `REPORT.md` holds the evidence: what was tested, the numbers, and what the owner's iPhone showed. The folders inside `jsbsim/` keep FDM's own layout, so FDM's scripts run here as they are.

`tools/from-fdm.mjs` did the copying and is the record of it. `provenance.json` at the repo's root lists every copied file with the hash of its original.

| Here | In FDM | How |
|---|---|---|
| `pins.env` | `pins.env` | byte for byte |
| `jsbsim-data/` (485 files) | `jsbsim-data/` | byte for byte |
| `scripts/fetch-jsbsim-data.sh` | `scripts/fetch-jsbsim-data.sh` | byte for byte |
| `scripts/check-data.sh` | `scripts/check-data.sh` | changed (below) |
| `CMakeLists.txt` | `CMakeLists.txt` | byte for byte |
| `host/` (11 files) | `host/` | byte for byte |
| `tests/native/` (2 files) | `tests/native/` | byte for byte |
| `scripts/build.sh`, `setup-toolchain.sh`, `check-flags.mjs`, `write-build-info.mjs`, `check-binaries.mjs`, `selftest-build.sh` | the same names in `scripts/` | byte for byte |
| `dist-wasm/` (5 files) | `dist-wasm/` | byte for byte |
| `../src/sim/` (7 files) | `ts/core.ts`, `codes.ts`, `files.ts`, `loop.ts`, `bench.ts`, `worker-handler.ts`, `worker.ts` | types removed (below) |
| `tests/*.test.js` (7), `tests/lib/*.js` (6) | `tests/*.test.ts`, `tests/lib/*.ts`, `ts/node.ts` | types removed (below) |
| `tests/fixtures/`, `tests/reference/nasa/`, `tests/rng-elements.md` | the same | byte for byte |
| `scripts/build-native.sh` | none | new in FSG: the native answer keys alone, with the commands `setup-toolchain.sh` and `build.sh` use |
| `tests/native-selftest.test.js` | none | new in FSG: runs the native self-test under `npm test` |
| `scripts/compare-rebuild.mjs` | none | new in FSG: after a rebuild, are the files the committed ones? |
| `tests/data.test.js` | none | new in FSG: runs `check-data.sh` under `npm test` |
| `tests/build.test.js` | none | new in FSG: the binaries and the host sources are the ones `build-info.json` describes |

Files copied byte for byte carry no "came from" comment: adding one would break the checks that prove they are FDM's. This file, `provenance.json` and the commit messages say it for them.

## From TypeScript to JavaScript

FDM wrote its wrapper and tests in TypeScript. FSG has no TypeScript, so `tools/from-fdm.mjs` made them plain JavaScript, mechanically:

1. Node's own type stripper blanks out the types and leaves every other character where it was.
2. A line that was nothing but types is kept as a `//` comment, so the descriptions of the Worker's messages and the options are still there to read. `import type` lines are dropped.
3. `.ts` becomes `.js` in file names, and import paths follow the new folders.
4. A header says where the file came from.

Each file's comments are FDM's, untouched: where one says `host/`, `dist-wasm/` or `build/` it means the folder here in `jsbsim/`; `REPORT.md` and `RESEARCH.md` are FDM's; "TypeScript" means the file you are reading.

The proof that nothing else changed: every one of FDM's tests passes on the converted files, and `build/results/parity.txt` from a run here is, line for line, the `results/parity.txt` FDM committed.

## Local changes

- **`scripts/check-data.sh`.** In FDM the data sat at the repo's root; here it sits one folder down. The script now asks git where the repo's `.git` is and what the path from the root is: two lines added, four changed, and a header. Nothing else differs.
- **`tests/lib/node.js`** (FDM's `ts/node.ts`). It moved two folders down, so the root of the build is two folders up: one line.
- **`tests/lib/harness.js`.** FDM committed its result files in `results/`. Here they are written to `build/results/`, which is not committed: FDM's evidence stays in FDM, and GitHub Actions keeps each run's files. Two lines.

## The build

`dist-wasm/` holds two builds of the same JSBSim, each an Emscripten `.mjs` file and the `.wasm` it loads from beside itself:

- `fdm-weh`: built with `-fwasm-exceptions`. The fast one, about 8 µs per step on the owner's iPhone.
- `fdm-jseh`: built with `-fexceptions`. About 18 µs per step; the fallback for Safari 26.0 and 26.1 (WebKit bug 299629).

`dist-wasm/build-info.json` records what they were built from: the JSBSim commit, the Emscripten version, every compiler and linker flag, the fixed 16 MiB of memory, and the hashes of the four files and of the C++ host sources.

To rebuild (Linux, with `cmake`, `ninja`, `g++` and `git`; about ten minutes on four cores, after a one-time download of the toolchain):

```
jsbsim/scripts/setup-toolchain.sh      # JSBSim v1.3.3 and Emscripten 6.0.13, into jsbsim/build/ (not committed)
jsbsim/scripts/build.sh                # native answer keys, then both WebAssembly builds, into jsbsim/dist-wasm/
node jsbsim/scripts/compare-rebuild.mjs
```

One thing in the environment changes the result: JSBSim's own build file stamps the build number into its version text when it finds `GITHUB_RUN_NUMBER` (or `TRAVIS`, or `APPVEYOR`) set, as on a GitHub Actions machine. The committed files were built without the stamp, so build without those variables: `env -u GITHUB_RUN_NUMBER jsbsim/scripts/build.sh`.

A rebuild must give the committed files byte for byte. `.github/workflows/rebuild.yml` does exactly these steps in GitHub Actions whenever anything that feeds the build changes, and fails on any difference. The committed binaries are never replaced by a rebuild that differs: FDM's test evidence belongs to those exact files.

## JSBSim itself

- **Version:** JSBSim v1.3.3, commit `66f7fafc07fe13e7ede9db20873030fed2881713`, unmodified. Source: <https://github.com/JSBSim-Team/jsbsim>.
- **Licence:** GNU Lesser General Public License, version 2.1. Its text is `jsbsim-data/COPYING`.
- **`jsbsim-data/`** is JSBSim's own `aircraft/`, `engine/`, `systems/`, `scripts/` and `check_cases/NASA_EOM_2015/` folders and its `COPYING` file, as they are at that commit, plus a two-line `REF` file naming it. Nothing in it is edited, ever: an aircraft made for FSG gets its own folder elsewhere.

## The tests

`npm test`, from the repo's root, runs them all, one file at a time (they share a fixtures folder). They need the native answer keys, which are built, not committed:

```
jsbsim/scripts/build-native.sh         # once; needs cmake, ninja, g++ and git; a few minutes
npm test                               # about two minutes
```

| Test | What it shows (the numbers are FDM's, from its `REPORT.md`) |
|---|---|
| `native-selftest` | the wrapper's 41 checks, natively |
| `wrapper` | the same checks on both WebAssembly builds: 22 tests |
| `compare-selftest` | the trace comparator itself, on made-up traces: 17 tests |
| `loop` | the fixed-step loop, and the Worker's handler in Node and in a worker thread: 10 tests |
| `load` | all 61 aircraft folders: 59 load in native and in both builds, the same 2 fail everywhere |
| `ground` | the height-grid ground: a flat grid equals upstream's own, bit for bit; the slope run |
| `forces` | external forces written every step, against native |
| `parity` | step by step against native: NASA cases 01 to 03, `c1723`, `f16_test`, and JSBSim's other 59 scripts |

`parity` keeps three failed lines on record, as FDM does (`c3104`, `c3105`, `mk82_script`): in each, native JSBSim differs from itself by the same amount after a one-last-digit nudge. The test fails on any other failed line.

## Checks

- `scripts/check-data.sh` rebuilds git's id for each data folder from the files on disk and compares it with upstream's id in `pins.env`. `npm test` runs it (`tests/data.test.js`).
- `tests/build.test.js` checks the four binaries against `build-info.json`, and recomputes the hash of the C++ host sources that the build wrote there: the C++ in this folder is what the binaries were built from.
- `tests/provenance.test.js` (at the repo's root) fails if any copied file or folder stops matching `provenance.json`.
- `node tools/from-fdm.mjs --fdm <FDM clone> --wings <wings clone> --check` derives every copy again from the originals and compares.
