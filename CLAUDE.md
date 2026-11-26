# FSG: Flight Sim Game

A flight sim game for the iPhone: a home-screen web app at `https://135crewdog.github.io/fsg/`. The F-4C Phantom II over the real Hawaiian Islands, in the spirit of Eric Parker's PocketWings. The flight model is **JSBSim**, the open-source flight dynamics model behind FlightGear, compiled to WebAssembly and run unmodified.

It's a **flight sim game**:
- **Sim:** not an arcade game. The airplane flies by real physics and real data, so stalls, spins, energy bleed and the nose falling through the horizon all come from JSBSim. Nothing is scripted.
- **Game:** not a training simulator. It has to be easy to pick up and fun on a phone. Accessibility comes from assists that fly the airplane the way a helpful copilot would. They never change the physics.

Solo only. No missions, combat, scores or weather.

The owner is a USAF KC-135 instructor pilot, not an engineer. He builds these apps to learn and to have fun. He knows how airplanes fly and feel. He does not know, and should never be asked about, coefficients, damping ratios or the equations behind them.

This is the third try at the idea:
- **Wings** (`135crewdog/wings`) built the game around a home-made flight model.
- **FDM** (`135crewdog/FDM`) built and tested JSBSim for the iPhone.

FSG joins the two: Wings' game on FDM's JSBSim. Only JSBSim is used. FlightGear's other flight model, YASim, is not part of this project.

## Principles

From the owner's design philosophy (https://135crewdog.github.io/hig/), which applies to everything a person sees or touches, and to the code:

- **Simple.** Use what's already there, leave out what isn't needed, and make it obvious to use. Example: JSBSim's own landing gear, atmosphere and flight-control system are used as they are, not rewritten. The pause screen holds only what a pilot needs.
- **Efficient.** Do the work once; one good general rule beats many special cases. Example: the same terrain tiles feed the picture and JSBSim's ground, so what is seen is what is hit. A flaw in an aircraft is fixed once in its file, not covered up by special code in the game.
- **Future-proof.** Build on what will still work in ten years, depend on as little as possible, and leave the data with the owner. Example: JSBSim is pinned at v1.3.3. Aircraft are plain JSBSim XML files. Three.js is vendored at a pinned version. The app works offline with no server.
- **Best practice.** Every problem we meet has almost certainly been solved before, better than we would solve it alone. Before building anything non-trivial, find out how others solved it:
  - independent developers (WebFlight, Sky Hopper, gefly, opengeo-sim, Vazgriz, Why485 and the like)
  - industry (FlightGear, X-Plane, DCS, MSFS, JSBSim's maintainers)
  - coding standards and platform guidance (WebKit, MDN, Emscripten)
  - textbooks and academic sources (Stevens, Lewis & Johnson; Allerton; Zipfel; NASA reports)

  Copy the proven approach. Write down where it came from. A departure from it needs a written reason.

## How we work

1. **Big decisions happen in chats** in the owner's "FDM" Claude project. Their results arrive here as changes to this file or as a prompt.
2. **Every milestone starts in Plan Mode,** in a new Claude Code chat. Claude Code reads this file and `docs/`, researches, and proposes the plan. The owner and Claude Code iterate until the owner approves. The owner wrote the first prompt (milestone 0) and writes no others: when a milestone is done, Claude Code proposes the next.
3. **Every plan opens with "How others solved this":** for each real problem in the milestone, what independent developers, industry and textbooks did, with links. Then the choice, and why.
4. **Every task has a written "done" before it starts:** what will be true, how it will be checked, and the numbers it must meet. Write it in the plan, never change it after seeing a result, and keep a failed result on record. If the line was wrong, say so and add a new one.
5. **After approval the owner switches to Auto Mode.** Claude Code builds in pull requests, each small enough for the owner to check on his phone in about a minute.
6. **Codex reviews every pull request automatically.** Claude Code fixes what it finds, or explains in the pull request why a finding is wrong.
7. **The owner authorizes each merge; Claude Code merges.** Never merge unasked.
8. **The owner checks the app on his phone** and gives feedback. Claude Code carries on with the next pull request.
9. **When the milestone is done:** mark it in the table below, write its results into `docs/milestones/`, and stop. The next milestone starts in a new chat, in Plan Mode.

Rules for Claude Code:
- **Ask the owner pilot questions, never engineering ones.** Not "what pitch damping?" but "after a stall, should the nose drop harder?" Engineering choices are Claude Code's to make, test and write down.
- **Build only the current milestone.** Nothing appears in the app that the owner didn't ask for. Propose, don't add.
- **When a test can't pass, stop and report what you found, in pilot terms, with numbers.** Never loosen a test to make it pass.
- **Label the evidence** behind every claim in plans and reports:
  - **Verified:** checked against something we didn't make (native JSBSim, NASA data, a flight manual, upstream source, the owner's phone).
  - **Supported:** our own test shows it.
  - **Reasoned:** not tested yet; name the test that would settle it.
- **Ideas go to `docs/ideas.md`.** When the owner says "idea: …", add it there. Never build from it until the owner picks an idea.

## Where things live

One home for each kind of thing. Nothing lives in two places.

| What | Home |
|---|---|
| Code, docs, this file, aircraft files, finished 3D models (`.glb`), terrain tiles: anything the app needs | This repo |
| Each milestone's approved plan, its "done" lines and its results | `docs/milestones/` |
| Ideas | `docs/ideas.md` |
| Reference photos, drawings, Blender files | The owner's Google Drive, synced to his laptop |
| Brainstorming, big decisions, building 3D models in Blender | Chats in the owner's Claude projects |

**Older projects are references, never inherited wholesale.** Copy a piece in on purpose. Its commit message and a comment at the top of the file say where it came from (repo, path, commit).

- **`135crewdog/FDM`, branch `baseline/jsbsim`, commit `e478825`.** The JSBSim WebAssembly build and everything proven with it:
  - the build scripts, pins and flags
  - the C++ host layer: C API, height-grid ground callback, logger
  - the JavaScript-facing wrapper, the fixed-step loop and the Worker
  - JSBSim's data files
  - the native answer key and its tests

  Its `REPORT.md`, `RESEARCH.md` and `CLAUDE.md` hold the evidence. Branch `archive/attempt-1` and its integrator and ground patches are not used.
- **`135crewdog/wings`.** Everything around the flight model:
  - the PWA shell, service worker, update offer and iPhone platform rules
  - tilt input, throttle, toggles, pause screen, map, HUD, debug overlay
  - chase camera, renderer, terrain tiles and their culling, detail rings and haze
  - water, sky, afterburner plumes
  - `docs/models.md`, `docs/hawaii.md`, `terrain/make-hawaii.py` and the Hawaii tiles
  - `models/f4c.glb`, the owner's own F-4C
  - the headless checkride idea

  Wings' own flight model (`src/sim/`: the airplane "cards", aero, engine and contact code) is replaced by JSBSim and is not copied.
- Wings in turn came from `135crewdog/wings-v1` and `135crewdog/rage`. Go to them only when Wings points there.

Wings stays live at its own address, and the owner keeps improving it. FSG never changes it. **Before copying anything from Wings:**
- Fetch Wings `main`. Read its `CHANGELOG.md` and its commits since the commit FSG last copied that file from.
- Copy from current `main`, never from an old pin.
- Adapt FSG's own version of the file rather than overwrite it: FSG's copies have been changed for JSBSim.
- Record the new commit in the file's header and in `provenance.json`.
- Every plan that copies from Wings lists the Wings commits since the last pin, and the items of issue #32 (the running list of what to bring over) that it covers.

## Flying

- **JSBSim flies every airplane.** JSBSim v1.3.3, unmodified, compiled to WebAssembly. Each airplane is a JSBSim aircraft file: mass and inertia, aerodynamics, engines, landing gear and flight-control system.
- **The F-4C is the airplane.** JSBSim's bundled `F4N` is a 2007 Aeromatic draft (a generator's first guess) with an empty flight-control system, so it's a starting point at most. The F-4C file is built from real data and checked against it:
  - NASA CR-2144 (handling-qualities data, F-4C)
  - NASA TN D-6425 (F-4 model forces, −10° to 110° angle of attack)
  - NASA TN D-5361 (the F-4's directional divergence at high angle of attack)
  - NASA TN D-7721 (high-angle-of-attack yaw derivatives)
  - AFFDL-TR-73-125 and related reports on the F-4E's stall, departure and spin
  - the F-4C flight manual
  - the UIUC F-4 model (Scott and Selig)

  The precedent to study is Richard Harrison's FlightGear F-14, a JSBSim fighter built from NASA wind-tunnel reports (zaretto.com). Its stability augmentation system goes in JSBSim's flight-control format, as on the real jet. The owner's figures from Wings still stand: rotation at 150 knots, and the centre of gravity 3.5 feet ahead of the main wheels, where his model puts it.
- **Test aircraft:** JSBSim's bundled Cessnas and F-16, well-known files used to prove the wiring before the F-4C. They are not in the finished game.
  - `c172x` and `f16` are flown headless against native JSBSim (milestone 1).
  - `c172p` is the Cessna on screen since milestone 2, flown as JSBSim ships it: no slack in its elevator, and a nosewheel the stick can steer. Its picture is FlightGear's own c172p model (GPL 2), which fits it within an inch (the owner's choice, 20 November 2026).
  - The owner's own C172 model stays in his Drive.
- **The physics clock:**
  - JSBSim runs in a Web Worker at a fixed 120 steps a second, decoupled from the screen. It uses an accumulator with a catch-up cap ("Fix Your Timestep").
  - The renderer reads the latest state and interpolates. iOS drops the screen to 30 fps in Low Power Mode, and the physics must not slow with it.
  - State goes by `postMessage`. GitHub Pages can't enable shared memory.
- **Ground:**
  - JSBSim gets the ground the player sees, through its ground callback. The game uploads a height patch around the airplane from the same tiles the picture draws (Sky Hopper's method).
  - Never feed the physics a tile that hasn't loaded.
  - JSBSim's own gear model is used as it is, at 120 Hz. Change it only if a real landing feels wrong.
  - Contact points on the nose, belly, tail and wingtips make scrapes and crashes register.
  - The model's wheels and the aircraft file's gear must be in the same place. A test checks it.
- **Limits are reported, not enforced.** JSBSim reports over-g, overspeed, Mach and touchdowns. The game decides what they mean.

Game rules (kept from Wings):
- **Standard day:** no wind, weather or turbulence.
- **Constant weight:** fuel never burns (JSBSim's fuel freeze).
- **Forgiving crashes:** only a hard impact ends the flight, judged by how fast the airplane closes with the ground. Scrapes and wingtip touches survive. Any touch of the sea or a lake ends the flight. A **crash override** switch, on by default, turns crashes off altogether.
- **No consequence** for over-g or overspeed.

## Controls and assists

- **Tilt for pitch and roll,** the phone held in landscape like a steering wheel, PocketWings style.
  - With the phone at neutral, the airplane holds a trimmed speed. Faster than that the nose rises, as with fixed trim in a real airplane.
  - How that's done on top of a real JSBSim airplane is Claude Code's to research and propose. The owner judges it by flying.
- **Throttle:** a slider on the left edge.
- **Four toggles:** gear, flaps, speedbrakes and wheel brakes. A button shows only if the airplane has the thing: the Cessna shows Flaps and Brakes.
- **No rudder control.** Automatic coordination holds the ball centred. On the ground, tilt steers the nosewheel.
- **Assists act only through the controls,** as a pilot, autopilot or the real jet's own systems would. They never add forces or change the aircraft file.
  - The F-4C's real stability augmentation lives in its aircraft file.
  - Anything beyond the real jet (neutral-tilt trim, automatic coordination) is a game assist outside JSBSim, and is named as such.

## Screen and looks

**The screen and the world** follow Wings, copied in on purpose as milestones need them:
- start screen and pause screen with its switches (crash override, HUD, debug overlay) and the islands map
- chase camera with drag-to-look
- Rage's green HUD and the debug overlay
- afterburner plumes, with Rage's water and sky
- US units only, with no units setting

**The world** is `docs/hawaii.md`: the real Hawaiian Islands with the channels shortened, USGS heights and Sentinel-2 photographs. Every paved runway of 3,000 feet or more is level and landable. Every flight starts on the numbers of runway 8R at Honolulu and Hickam, with gear and flaps down and the brakes on. The tiles download once into their own store on the phone, which app updates never touch.

**Airplanes must look right to a pilot.** 3D models are built in Blender in separate Claude chats on the owner's laptop, never by Claude Code. `docs/models.md` is the handoff: what the app needs from a model. A test checks every model against it. One exception, the owner's: milestone 2's stand-in Cessna is FlightGear's model, converted to the handoff by a script kept in the repo.

## Building it

- **Plain HTML, CSS and JavaScript (ES modules).** No framework, bundler or TypeScript in the app, and no build step to run it.
- **The one build is JSBSim's:** C++ to WebAssembly, with the pinned Emscripten, by a script in the repo. Its output is committed. It's re-run only when JSBSim or the C++ host layer changes, and a rebuild must reproduce the committed files byte for byte.
- **Three.js is the one runtime library,** vendored at a pinned version. Ask before adding any other dependency.
- **Tests use Node's built-in runner** (`node --test`). They run in GitHub Actions on every push and pull request. Pages deploys `main` only if they pass.
- **GitHub's workflow tools** (checkout, setup-node, the cache and the Pages steps in `.github/workflows/`) stay on their current versions. Dependabot (`.github/dependabot.yml`, after Wings) opens at most one pull request a month for all of them together. It goes through tests and Codex like any other, and the owner authorizes the merge.
- **The simulation code** (the Worker, the JSBSim wrapper, assists, game rules) has no DOM or Three.js code, so it runs headless in Node.
- **Target:** 60 fps on an iPhone 16, with the physics at 120 Hz.
- **The checkride:** maneuvers flown headless, with results in knots, feet, degrees and g next to the reference numbers (flight manual, NASA data, native JSBSim). Each milestone plan writes the tolerances before the run.

### Known facts about JSBSim in WebAssembly (Verified or Supported in FDM and in milestones 0 and 1; details in FDM's `REPORT.md` and `docs/milestones/`)
- Build all of JSBSim with exception support, or 22 aircraft fail to load. Ship two builds:
  - `-fwasm-exceptions`: about 8 µs per step on the owner's iPhone
  - `-fexceptions`: about 18 µs per step, the fallback for Safari 26.0's WebKit bug 299629
- Fixed 16 MiB memory is enough: the measured peak over every aircraft is about 3.3 MiB.
- Setting a property by name costs about 1 µs. Use handles or one bulk array per step.
- On iPhone, `performance.now()` ticks in 1 ms steps. Time batches of steps, not single steps.
- Native JSBSim silently ignores writes to read-only properties. Read back every value a test relies on.
- A JSBSim initial-condition latitude is geocentric, not geodetic. A grid laid out in geodetic latitude once landed 10 nm away.
- Read back that a scenario is what its name says: on the ground, on the slope, engine running.
- WebAssembly and native JSBSim differ in the last digit from the first step. Compare against native's own spread after a one-last-digit nudge, not against a fixed tiny number.
- The cloud sessions' git proxy has refused tag pushes (HTTP 403). If a tag is needed, record its name and commit and ask the owner to create it on GitHub.
- Each Emscripten file fetches its own `.wasm` from beside itself and ignores bytes handed to it. Each `.wasm` must sit beside its `.mjs` and be in `sw.js`.
- JSBSim's own build stamps its version text on GitHub's machines. A build that must match the committed one runs without `GITHUB_RUN_NUMBER`.
- The installed home-screen app runs JSBSim as fast as a Safari tab: 7.7 µs per step on the owner's iPhone.
- On the owner's iPhone the Worker's own 4 ms timer keeps 120.0 steps a second with a state every 10 ms, in Low Power Mode too. Page ticks deliver a state only every 33 ms there.
- Low Power Mode runs the phone's processor at a little under half speed: 18 µs a step against 8. Step-time lines are for normal mode.
- On the owner's iPhone one whole game step costs 10.3 µs on the fast build (JSBSim alone 8.3) and 21.7 µs on the fallback build.
- The fallback marker covers only the start of the fast build. Held longer, a launch after an update or a mid-flight close lands on the slow build.
- A tape (the start and every step's inputs) replays in native JSBSim to within 0.00001 ft over a seven-minute flight with a landing.
- FDM's C++ scenario runner holds about two minutes of flight in the fixed 16 MiB. Longer flights replay step by step through the wrapper.
- JSBSim starts a "running" piston engine at full power: settle a new flight for 10 seconds of its own time.
- In JSBSim's initial conditions the speed goes in last. `propulsion/fuel_freeze` works but reads back 0. A trim that fails kills that JSBSim.
- Upstream's `c172x` cannot be steered on the ground by a pilot, has 3° of free play in its elevator, and pulls 7.5 g at 120 knots. Upstream's `c172p` has neither flaw.
- JSBSim's position is the centre of gravity as loaded, not the one written in the aircraft file: 4.5 in further back on `c172x`. Measure wheels from the loaded one, read back from a run.
- FDM's host layer refuses an input that is not a number. JSBSim's own state can still break with the step returning "ok", so the flight checks every number it gives out.

### iPhone platform rules (proven in Rage and Wings)
- Motion permission is requested synchronously inside the Fly tap, over HTTPS.
- iOS ignores orientation lock, so show a rotate screen in portrait.
- Hold a screen wake lock only in flight.
- Draw only while something is moving.
- Full screen: `display: standalone`, `viewport-fit=cover`. Controls and text stay inside the safe area.
- No scrolling, zooming or selecting.
- Pause automatically when the app is hidden or loses focus; resume only from the pause screen.
- iOS tells a home-screen web app nothing when Control Center or its screen-recording menu covers it: no blur, no visibility change (tested on the owner's phone in Wings, 22 November 2026). There the pilot pauses by hand: Pause, then Control Center. For a recording: start it, close Control Center, tap Resume.
- The origin `135crewdog.github.io` is shared with the owner's other apps:
  - Prefix every cache with `fsg-` and every storage key with `fsg.`.
  - Only ever delete caches that start with `fsg-`.
  - Every path is relative (`./`).
- The service worker never calls `skipWaiting()` on its own. New versions are offered on the start or pause screen, never mid-flight.
- **Versions:** `APP_VERSION`, the service worker's cache name and a `CHANGELOG.md` line change together on every deploy a player would notice. A test fails if they disagree.

## Milestones

Claude Code plans each milestone in Plan Mode when the one before is done. The list below is the intended path; a plan may propose changing it, and the owner decides.

| # | Milestone | Done when |
|---|---|---|
| 0, done | **Setup.** Repo, Actions, Pages, Codex review; the Wings app shell; the JSBSim build copied in from FDM with its tests | A test pull request goes through Codex review, merges and deploys. The shell installs on the owner's iPhone and takes an update. Inside the app, on the phone, the Worker loads `c172x` and reports its step time on the debug overlay |
| 1, done | **JSBSim as the game's core, headless.** Worker clock, controls in, state out, height-patch ground callback, contact points, game rules, assists; the checkride harness | `c172x` and `f16` take off, fly a circuit and land headless, with checkride results matching native JSBSim within the written tolerances |
| 2, done | **First flight.** Tilt, throttle, toggles, chase camera, HUD over a flat test field with a runway, on the phone, flying `c172p` | The owner takes off, flies a circuit and lands on his iPhone, and says the controls and the ground feel right |
| 3 | **The F-4C.** Its JSBSim file built from real data, with its stability augmentation; `models/f4c.glb` with moving surfaces, gear and flaps; plumes | The F-4C passes its checkride against the flight manual and NASA data, and the owner flies it on the test field and approves the feel |
| 4 | **Hawaii.** The real islands under the F-4C, ground callback fed from the tiles, the islands map, crash rules on real terrain | The owner flies from Hickam to every island on his iPhone, lands on another island, and the game is the minimum viable FSG |

Milestones 0, 1 and 2 are done: their plans and results are in `docs/milestones/0.md`, `docs/milestones/1.md` and `docs/milestones/2.md`. Milestone 3 is next: it starts in a new chat, in Plan Mode.
