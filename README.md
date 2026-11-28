# FSG: Flight Sim Game

A flight sim game for the iPhone: a home-screen web app at <https://135crewdog.github.io/fsg/>. The flight model is JSBSim, compiled to WebAssembly and run unmodified. `CLAUDE.md` says what the game is and the rules it's built under.

## Where things are

- `CLAUDE.md`: the project's rules. Read it first.
- `docs/models.md`: what the app needs from a 3D model. `models/`: the models, whose they are (`CREDITS.md`), the script that made the stand-in Cessna from FlightGear's (`convert-c172p.py`; it needs Python with Pillow, and is run by hand), and the script that measures where a model has its wheels, engine exits and speedbrakes, for its aircraft file (`node models/measure.mjs models/f4c.glb`).
- `docs/milestones/`: each milestone's approved plan, its "done" lines and its results. Milestone 0 (setup) is done: `docs/milestones/0.md`. Milestone 1 (JSBSim as the game's core, headless) is done: `docs/milestones/1.md`. Milestone 2 (first flight) is done: `docs/milestones/2.md`.
- `docs/ideas.md`: ideas, not built until the owner picks one.
- `index.html`, `style.css`, `sw.js`, `manifest.webmanifest`, `icons/`, `src/`: the app. Plain HTML, CSS and JavaScript; nothing is built.
- `jsbsim/`: everything about JSBSim, copied from `135crewdog/FDM`. Its `README.md` says where each piece came from.
- `tools/from-fdm.mjs` and `provenance.json`: the script that copied pieces in from FDM and Wings, and the record of what it copied.
- `src/sim/`: the simulation code: the JSBSim wrapper, the fixed-step loop and the Worker. No DOM code, so it runs in Node too.
- `src/sim/aircraft/`: the game's settings for each JSBSim aircraft. `list.js` is the list the pause screen's Airplane picker offers, kept between visits (milestone 3 re-planned): `f4c-simple.js`, the simple F-4C on the shared simple physics and control run of `aircraft/simple/`, first in the list and what a new install flies; `f4c.js`, the F-4C built from NASA data (milestone 3); and `c172p.js`, JSBSim's Cessna that the game flew in milestone 2, back for comparison. `c172x.js` and `f16.js` are flown by the tests against native JSBSim.
- `src/flight.js` and `src/render/`: the picture. `world.js` is the test field and the sky, `aircraft.js` the airplane's model with its moving parts, `camera.js` the chase camera. Two files there are plain sums with no DOM and no Three.js, tested in Node: `between.js`, the picture's clock, which will draw between the Worker's physics steps, and `frames.js`, which puts JSBSim's position and attitude into the picture's axes.
- `vendor/three/`: Three.js 0.187.0, the one runtime library, byte for byte as Wings vendored it from npm (`vendor/three/VERSION`).
- `tests/`, `jsbsim/tests/`: the tests.

## Running the tests

You need Node 22 or later; there are no dependencies to install. The tests of the JSBSim build compare it with native JSBSim, which is built once on your machine (it needs `cmake`, `ninja`, `g++` and `git`, and takes a few minutes):

```
jsbsim/scripts/build-native.sh
npm test
```

The same command runs in GitHub Actions on every push and pull request (`.github/workflows/test.yml`).

One check is not part of `npm test` because it needs a browser: `node tests/browser/app.chromium.mjs` runs the app in headless Chromium (start screen, service worker, offline reload, rotate screen, the update offer). Claude Code runs it before each pull request that changes the app and puts its output in the pull request.

## Running it locally

Any static file server works. From the repo's folder:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

## How JSBSim runs in the app

- `src/fdm.js`, on the page, starts a module Worker, `src/sim/worker.js`, when the app opens, and posts it the JSBSim files the chosen airplane needs (its settings in `src/sim/aircraft/`), fetched as they are from FSG's own `aircraft/` (the F-4C) or JSBSim's own data (the Cessna).
- The Worker imports the Emscripten file `jsbsim/dist-wasm/fdm-weh.mjs`, which fetches `fdm-weh.wasm` from beside itself. If that build doesn't start, a fresh Worker tries the fallback build, `fdm-jseh`, and the debug overlay says why.
- Every one of those files is in `sw.js`, so it all works offline.
- The Worker holds one flight at a time (`src/sim/flight-run.js`): the chosen airplane parked on the runway of the test field, held until Fly is tapped, then stepped 120 times a second by the Worker's own clock (`src/sim/clock.js`), with the state posted to the page after every batch of steps. Paused, the Worker's timer is stopped. Restart is a new flight.
- The page draws it (`src/flight.js`): the picture's clock (`src/render/between.js`) trails the newest state by two steps, and the airplane is drawn between the two states either side of it.
- With the debug overlay on (Settings), the overlay shows how the flight is running: frames a second, steps a second, time dropped, how far the picture is behind, and where the airplane is.
- The Worker's own clock was chosen over ticks from the page on the owner's phone (`docs/milestones/1.md`): it kept 120.0 steps a second, in Low Power Mode too.

## The one build

The app itself is not built. JSBSim is: C++ to WebAssembly, by `jsbsim/scripts/build.sh`, with its output committed in `jsbsim/dist-wasm/`. It is rebuilt only when JSBSim or the C++ host layer changes, and a rebuild must reproduce the committed files byte for byte (`.github/workflows/rebuild.yml`). `jsbsim/README.md` has the steps.

## Versions

`APP_VERSION` in `src/version.js`, `VERSION` in `sw.js` and the newest entry in `CHANGELOG.md` change together on every deploy a player would notice. The tests fail if they disagree. Every file the app needs is listed in `sw.js`, so it works offline.

## How the tools are connected

- **GitHub Actions** runs the tests on every push and pull request. On `main`, it publishes the site to GitHub Pages only if they pass (`.github/workflows/pages.yml`).
- **Codex** reviews every pull request when it opens. Claude Code fixes what it finds, or says in the pull request why a finding is wrong. The owner authorizes each merge.
