# jsbsim/: the one build

Everything about JSBSim lives here: its pins, its data files, and (as milestone 0's pull requests land) the C++ host layer, the build scripts, the WebAssembly binaries and the tests that came with them.

## Where it came from

All of it is copied from **`135crewdog/FDM`, branch `baseline/jsbsim`, commit `e47882503ab765d575a38b5bcd59fd41da76b1ae`** (`e478825`). That commit's `REPORT.md` holds the evidence: what was tested, the numbers, and what the owner's iPhone showed. The folders inside `jsbsim/` keep FDM's own layout, so FDM's scripts run here as they are.

`tools/from-fdm.mjs` did the copying and is the record of it. `provenance.json` at the repo's root lists every copied file with the hash of its original.

| Here | In FDM | How |
|---|---|---|
| `pins.env` | `pins.env` | byte for byte |
| `jsbsim-data/` (485 files) | `jsbsim-data/` | byte for byte |
| `scripts/fetch-jsbsim-data.sh` | `scripts/fetch-jsbsim-data.sh` | byte for byte |
| `scripts/check-data.sh` | `scripts/check-data.sh` | changed (below) |
| `tests/data.test.js` | none | new in FSG: runs `check-data.sh` under `npm test` |

Files copied byte for byte carry no "came from" comment: adding one would break the checks that prove they are FDM's. This file, `provenance.json` and the commit messages say it for them.

## Local changes

- **`scripts/check-data.sh`.** In FDM the data sat at the repo's root; here it sits one folder down. The script now asks git where the repo's `.git` is and what the path from the root is: two lines added, four changed, and a header. Nothing else differs.

## JSBSim itself

- **Version:** JSBSim v1.3.3, commit `66f7fafc07fe13e7ede9db20873030fed2881713`, unmodified. Source: <https://github.com/JSBSim-Team/jsbsim>.
- **Licence:** GNU Lesser General Public License, version 2.1. Its text is `jsbsim-data/COPYING`.
- **`jsbsim-data/`** is JSBSim's own `aircraft/`, `engine/`, `systems/`, `scripts/` and `check_cases/NASA_EOM_2015/` folders and its `COPYING` file, as they are at that commit, plus a two-line `REF` file naming it. Nothing in it is edited, ever: an aircraft made for FSG gets its own folder elsewhere.

## Checks

- `scripts/check-data.sh` rebuilds git's id for each data folder from the files on disk and compares it with upstream's id in `pins.env`. `npm test` runs it (`tests/data.test.js`).
- `tests/provenance.test.js` (at the repo's root) fails if any copied file or folder stops matching `provenance.json`.
- `node tools/from-fdm.mjs --fdm <FDM clone> --wings <wings clone> --check` derives every copy again from the originals and compares.
