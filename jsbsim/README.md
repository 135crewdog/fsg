# jsbsim/: the one build

Everything about JSBSim lives here: its pins, its data files, the C++ host layer, the build scripts and the WebAssembly binaries they made, and (as milestone 0's pull requests land) the tests that came with them.

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
| `scripts/compare-rebuild.mjs` | none | new in FSG: after a rebuild, are the files the committed ones? |
| `tests/data.test.js` | none | new in FSG: runs `check-data.sh` under `npm test` |
| `tests/build.test.js` | none | new in FSG: the binaries and the host sources are the ones `build-info.json` describes |

Files copied byte for byte carry no "came from" comment: adding one would break the checks that prove they are FDM's. This file, `provenance.json` and the commit messages say it for them.

## Local changes

- **`scripts/check-data.sh`.** In FDM the data sat at the repo's root; here it sits one folder down. The script now asks git where the repo's `.git` is and what the path from the root is: two lines added, four changed, and a header. Nothing else differs.

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

## Checks

- `scripts/check-data.sh` rebuilds git's id for each data folder from the files on disk and compares it with upstream's id in `pins.env`. `npm test` runs it (`tests/data.test.js`).
- `tests/build.test.js` checks the four binaries against `build-info.json`, and recomputes the hash of the C++ host sources that the build wrote there: the C++ in this folder is what the binaries were built from.
- `tests/provenance.test.js` (at the repo's root) fails if any copied file or folder stops matching `provenance.json`.
- `node tools/from-fdm.mjs --fdm <FDM clone> --wings <wings clone> --check` derives every copy again from the originals and compares.
