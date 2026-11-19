# NASA check-case reference data

Results published with NASA/TM-2015-218675 ("Check-Cases for Verification of 6-Degree-of-Freedom Flight Vehicle
Simulations"), downloaded 2026-11-18 from:

- `https://nescacademy.nasa.gov/src/flightsim/Datasets/Atmos_01_DroppedSphere.zip`
- `https://nescacademy.nasa.gov/src/flightsim/Datasets/Atmos_02_TumblingBrickNoDamping.zip`
- `https://nescacademy.nasa.gov/src/flightsim/Datasets/Atmos_03_TumblingBrickDamping.zip`

Each file is one simulation tool's result for that case (`sim_01` .. `sim_06`). `sim_05` is left out (about 2 MB
per case, irregular time steps). Files are unchanged.

Used for information only: to show that this project's fixtures for cases 01 and 03 (`tests/fixtures/nasa/`)
describe the same scenario as NASA's. They are not a pass/fail line (see `REPORT.md`, part 2).
