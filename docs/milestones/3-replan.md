# Milestone 3, re-planned: a simple F-4C that is fun to fly

The plan below was approved by the owner on 28 November 2026, before any work started, after his answers and one independent review; both are in it. Its "done" lines are not changed after a result is seen, and a failed line stays on record. The results are added at the end when the milestone closes.

---

## The approved plan

## Context

Milestone 3 built the F-4C from NASA and Air Force data with the real jet's feel system. Its checkride passes. The owner flew 0.0.22 and it is not fun: pitch far too sensitive, the tail drags on rotation, a stall in the closed pull-up, no holding final, no loop. `docs/milestones/3-feel-findings.md` has the cause (mostly the controls: a real stick that light needs a hand that can feel it) and the numbers.

**What FSG is now (the owner, 28 November 2026):** simple but honest physics; simple but not nit-picky aircraft. An airplane is a file of simple numbers on JSBSim's basics. Tilt moves the surface through one speed curve. The copilot only coordinates the rudder. On the ground, tilt steers. "Close enough" is about 10% on the speeds a pilot flies by, common-sense energy checks, and the owner flying it.

**Done when:** on the test field, on his iPhone, the owner flies the simple F-4C through a takeoff, a closed pattern to a landing, a loop and a low, fast pass down the runway, and says it is fun. The valley run through real Hawaii closes milestone 4 (his choice, below).

Not in this milestone: Hawaii, a P-51D or B-26, the rudder slider (#42 stays open), anything from `docs/ideas.md`.

**Evidence labels** as in `CLAUDE.md`. Planning runs were flown in Node, in memory, on the committed build and on Wings' own code; nothing was written to either repo.

**Sources read for this plan:** this repo at `f3c6df9`; `135crewdog/wings` at `6d689b7` (0.0.62, still its `main` today; its checkride re-run, 26 of 26 pass); the findings file and `docs/milestones/3.md`; issues #29, #32, #33, #42, #44.

**An independent review** of the first draft did the sums and read the code, and found fifteen things: lines that could not pass, could not fail, or could not be measured as written, and facts I had missed. All are corrected here. The three a pilot would notice: I had told the owner Wings' full back tilt was safe to hold through the takeoff, and it is not once airborne (flown, below); there is no valley on the test field; and a tilt held across liftoff would have rolled past the line I wrote for it.

---

## The owner's answers (28 November 2026)

1. **Flaps and trim: like Wings.** Clean, phone level holds 350 knots. Gear and flaps down it holds about 200, and final is flown with a little back tilt. It comes from the flaps' lift; the copilot does no trimming.
2. **Takeoff: Wings' way, and he eases.** Full back to rotate; it lifts off with the nose about 9° up and no tail strike; then he eases the tilt to hold the climb. He chose this knowing what a held tilt does (the table below).
3. **The stick's middle: Wings' straight line** for the simple airplanes. The data-built F-4C and JSBSim's Cessna keep the softer middle they were flown with.
4. **Resources: Claude Code hands lighter work down itself,** and the levels cover research too: "Sometimes that effort is appropriate. Sometimes it is not." And: "Fable on Medium is also a viable choice."
5. **The valley run closes milestone 4.** Milestone 3 ends on the test field.
6. **Merges:** "Merge when clean." Phone checks and pilot decisions still wait for him.

**Wings' takeoff with the tilt simply held** (full flaps, full afterburner; flown on Wings' code for this plan; Supported):

| Back tilt | Nosewheel off | Airborne | Then |
|---|---|---|---|
| Full on the runway, then eased to hold 10° (Wings' own test pilot) | 150 knots | 174, nose 9° up, nothing touches | A normal climb: 226 knots and 3,000 ft/min 5 s later |
| Full, held | 150 | 174, nose 9° up, nothing touches | The nose is at 40° 2 s later, stalled; hanging at 155 knots after 10 s |
| Three quarters, held | 162 | 185 | The nose at 37° 2 s later, 64° after 5 s; not stalled; 133 knots after 10 s |
| Half, held | 179 | 199 | The nose at 30° 2 s later; near vertical after 10 s |

---

## 1. How others solved this

| Problem | What others did | Label |
|---|---|---|
| **An airplane from headline numbers** | **Wings' card** (`src/sim/cards/f4c.js`, `card.js`, `aero.js`): spec-sheet numbers plus a few feel numbers; every coefficient derived from them. The owner flew it and liked it. **YASim** (FlightGear): the author gives approach and cruise speeds and a solver fits lift and drag to them ([wiki](https://wiki.flightgear.org/YASim)). **Aeromatic** (JSBSim's own): a first guess from size and weight, meant to be tuned by hand; raw, it made energy stop mattering (findings). **Vazgriz**: lift from one curve against angle of attack, induced drag from lift squared ([part 1](https://vazgriz.com/346/flight-simulator-in-unity3d-part-1/)) | Verified (read; Wings re-run) |
| **Tilt to the tail, by speed** | **Wings:** full stick is sized to the moment that holds the g limit above corner speed (423 knots) and about 1.2 times the stall angle below it, so the tail's power is level when slow and falls as one over the air's stiffness when fast. **Vazgriz:** "an animation curve that reduces the strength of the turn at low speeds", plus a g limiter that scales the pilot's input. **F-15** pitch ratio changer; **ArduPlane** scales by speed (findings). The owner's design is Wings' rule said honestly | Verified (read) |
| **Rotation with the wheels 3.5 ft behind the centre of gravity** | **Wings** gave the tail about double bite at a low angle of attack when slow, fading by the stall, after two simpler fixes failed; its pilot still eases after liftoff (the table above). The real F-4: full aft stick from 80 knots, then ease | Verified (Wings, flown); the flight manual |
| **Steering with no pedals** | **MSFS** and **X-Plane 11**: auto-rudder ties rudder and nosewheel to the roll stick; the ailerons still move ([forum](https://forums.flightsimulator.com/t/auto-rudder/272561); milestone 3's plan). **Wings:** tilt steers the nosewheel, fading with speed. Nobody found switches the ailerons off on the ground: that is the owner's choice, for the reason milestone 3 measured (one tilt doing three jobs: steering at 60 knots also rolled the Cessna) | From forum posts; Supported |
| **One physics for every airplane** | Wings: "one physics model flies every airplane; each airplane is a card." JSBSim's own `F450` keeps its aerodynamics in a separate file (`<aerodynamics file="Aero.xml"/>`) | Verified (read) |
| **A propeller with no torque** | JSBSim's turbine with a `direct` thruster is thrust from a table times the throttle, with no torque, P-factor or slipstream. The F-4C's J79 already uses it | Verified (read) |

**Choices**
- **One shared physics file, and each airplane a file of numbers.** `aircraft/simple/` holds the lift curve, drag, moments and control run, written once. An airplane's own file holds its size, mass, wheels, engines and about 35 named numbers, each with a comment saying where it came from. **Supported:** the F-4C's file, split in memory, loads with its aerodynamics in `../simple/aero.xml` and reads a number declared in the airplane's file (WebAssembly; native JSBSim is PR 3's first check). If native will not, each file carries the block and a test holds the copies identical.
- **Wings' card is the reference for the simple F-4C's numbers and rules,** since the owner approved that feel. Its code is not copied: the rules are written in JSBSim's format. Where the data-built jet has the better number (weight, inertias, wheels, thrust lapse, drag in a pull) it is borrowed and the file says so.
- **The speed curve is the airplane's control run, in its file** (as a fly-by-wire jet's would be). The copilot never touches pitch or roll.
- **The tail is sized Wings' way:** full back tilt lifts the nosewheel at 150 knots, and in the air below corner speed it holds a little past the stall angle. Whether one plain set of numbers gives both on FSG's half-flap takeoff, or the tail needs Wings' extra bite on the runway, is PR 3's first throwaway run (the reviewer's rough sum says a plain set would need a nose about twice as stiff as Wings'; Reasoned).
- **Thrust is JSBSim's turbine and `direct` thruster for every airplane,** jet or propeller: a table shaped like that engine's thrust, times the throttle.
- **Tilt steering lives in the shared control run** (changed from the first draft, where it was in the game): with a wheel on the ground it sends the tilt to the pedals and holds the ailerons neutral, swapping over a third of a second. There the swap is one filter, the tape carries only the tilt, and the copilot's code is not touched.

---

## 2. Right-sized effort

Every pull request below carries a level. GitHub's tests and Codex's review run on all of them regardless.

| Level | For | Model | Research | Checked in the session before it goes up |
|---|---|---|---|---|
| **Full** | The shared physics, an airplane's first numbers, the control curve, steering, anything that changes how `src/sim/` flies a flight | Fable, High | "How others solved this", with sources | Throwaway flights first; the whole `npm test` with native JSBSim; the Chromium run |
| **Standard, flying** | How an airplane flies, on a pattern already proven: a feel round (one number, that airplane's checkride), a new airplane's numbers on the shared physics | Fable, Medium | Only if a new problem turns up, and then said | That airplane's checkride; native JSBSim only if its tape is re-flown |
| **Standard, app** | The picker, the app's wiring, the screen, the test harness | Opus, High | Only if a new problem turns up, and then said | The tests the change touches; the Chromium run if the screen changed |
| **Light** | Words on a screen, docs, `CLAUDE.md`, versions | Opus, Medium | None | A quick sanity check; a screenshot if it shows |

- The split in the middle is by what a mistake costs: a wrong number in an airplane is felt in every flight and is hard to see in a diff, so it keeps Fable's judgement at less effort; a wrong line in the app's wiring is caught by a test or a screenshot.
- In a milestone chat on Fable, Claude Code hands Standard and Light work to an agent at that level itself, checks the result and carries on.
- For a one-off small ask, the owner starts the chat at that level; if he didn't, Claude Code says so in one line and carries on.
- A job that turns out harder than its level is raised a level, and Claude Code says why.

---

## 3. What gets built

| Piece | Where | From |
|---|---|---|
| The airplane picker | `index.html`, `style.css`, `src/main.js`, new `src/sim/aircraft/list.js`, `src/sim/flight-run.js` (its list only), `sw.js` | #44; Wings' switch rows |
| The shared simple physics and control run | new `aircraft/simple/` | Wings' rules, in JSBSim's format |
| The simple F-4C | new `aircraft/f4c-simple/`, `src/sim/aircraft/f4c-simple.js` | Wings' card; the data-built file's mass, wheels, contact points and engine logic |
| The straight stick | `src/input/pilot.js`, aircraft settings | Wings' tilt |
| The simple Cessna | new `aircraft/c172-simple/`, `src/sim/aircraft/c172-simple.js` | The handbook's numbers; `c172p`'s wheels |
| One small checkride per simple airplane | new `tests/simple-*.test.js`, `tests/checkride/` | Reuses `flyCircuit`, `flyNative`, `moduleWith` |

**Rules the design keeps**
- **The data-built F-4C is not touched:** `aircraft/f4c/`, `src/sim/aircraft/f4c.js` and its tests stay as they are, and it flies in the picker exactly as 0.0.22 did, with its own copilot (trim, feet, the hold on the ground) and tilt on the ailerons. JSBSim's `c172p` the same.
- **JSBSim's data is not edited. No WebAssembly rebuild.**
- **A flight is still a start and a tape;** native JSBSim replays each simple airplane's circuit.
- **The model's wheels and the file's gear are in the same place,** held by `tests/model.test.js`.
- **On a simple airplane the copilot moves only the rudder.** Its pitch trim is held at zero: the trim speed is the airplane's rigging, a number in its file. Nothing pulls a simple airplane off the centreline, so nothing holds it there.
- **Wings since FSG's last pin:** none (`6d689b7`). **#32:** no new items; its note "Not copied: Wings' flight model" gains "its card and rules are the reference for the simple airplanes".

---

## 4. The pull requests

One open at a time, on `claude/loving-hawking-2vhmpd`, restarted from `main` after each merge. Merged when clean. Each line is tried in a throwaway run before its code is written; a line that cannot be met stops the work for one report in pilot terms.

**Words used in the lines.** *Stalled:* the angle of attack is beyond the file's stall angle. *Flying again:* it is back below the stall angle and stays there for 2 s. *Upright:* banked less than 90°. *Over the top:* the nose passes straight up and comes on down to wings-level inverted, never stalled, never slower than the clean stall speed.

### PR 1. The re-plan and `CLAUDE.md` (Light)
**In it:** this plan as `docs/milestones/3-replan.md`; a pointer at the top of `docs/milestones/3.md`; the `CLAUDE.md` changes of section 5; #44 marked as picked.
**Done when:** tests green; Codex reviewed.

### PR 2. The airplane picker. Version 0.0.23 (Standard, app; phone check)
**In it**
- A row on the pause screen, "Airplane", with the phone's own picker, there before a flight (Settings) and when paused. The list for now: "F-4C (NASA data)", "Cessna 172 (JSBSim's)".
- The choice is kept between visits (`fsg.aircraft`). Picking another reloads the app to the start screen with that airplane on the numbers. A saved name that no longer exists gives the first in the list.
- The row is live only once Fly is: a reload while JSBSim's fast build is still starting would leave its marker set and send the next launch to the slow build (`src/fdm.js`).
- One list (`src/sim/aircraft/list.js`) feeds the page, the Worker and the service worker's test. The Cessna's files and model come back into the download. Its credit joins JSBSim's on the pause screen's one line of small print (two lines would run into the menu).

**Done when**
- `npm test`: `sw.js` lists exactly what every airplane in the list loads; the page's list and the Worker's are one; the three versions agree; the Cessna's credit is on the page.
- Headless Chromium: the row shows in Settings and when paused; the pause menu with an update offered still fits 348 points with the small print under it (the existing line, unchanged); the row is disabled until Fly is enabled; pick the Cessna: within 5 s the start screen is back, Fly puts the Cessna on the numbers with only Flaps and Brakes; reopen the app: still the Cessna, on the fast build; pick the F-4C: its five buttons and its plumes; a made-up saved name gives the first in the list; 0 console errors; works after an offline reload. Screenshots in the chat.
- **On the owner's iPhone:** he switches between the two and flies each. Does it ask for motion access again after a switch? (Reasoned: no; the app copes either way.)

### PR 3. The simple physics and the simple F-4C, headless (Full)
**In it**
- `aircraft/simple/`: one lift curve (straight to the stall, then a drop to a flat-plate mush: Wings' shape); drag from zero-lift drag, lift squared, Mach, gear, flaps and boards; side force; three moments with plain damping numbers; flaps that lift without pitching; the control run (trim and stick summed, then to the tail through the speed curve; stick to ailerons through its own; forward stick its own smaller share). It gives JSBSim's standard names for the surfaces, which the game's state and JSBSim's own trim read.
- `aircraft/f4c-simple/`: 38,924 lb and the data-built file's inertias, wheels, contact points, engine places, throttle and afterburner logic, and gear, flap and board times. Its numbers: span, wing area, MIL and afterburner thrust, stall speeds clean and landing (145, 125), rotation 150, corner speed, 8.5 g, roll rate, trim speed 350, zero-lift drag and drag in a pull. Thrust falls off with speed and height by a plain rule, borrowing the data-built table where the top speeds need it.
- Its settings file, not yet in the picker, with the pitch trim held at zero. `tests/checkride/simple-reference.js`: every reference with its source, before the first run.

**Done when** (38,924 lb; within 10% means of the reference)
- It loads in both WebAssembly builds and native JSBSim from its listed files; standing, every tyre is within 1 in of the model's; weight and centre of gravity read back.
- **Stall, clean, idle,** slowing 1 knot a second in level flight: stalled at 145 knots within 10% (Wings' card; the data-built jet 140).
- **Stall, gear and full flaps, idle,** the same way: 125 knots within 10% (the flight manual's 122 to 126).
- **Rotation, flown as Wings' pilot flies it** (1/2 flaps, full afterburner, full back tilt from 80 knots, then the nose held 10° up once airborne): the nosewheel lifts at 150 knots within 10%; nothing but wheels touches; 5 s after liftoff it is climbing, not stalled. Liftoff speed and ground roll reported (Wings, on full flaps: 174 knots, 1,700 ft).
- **Top speed, full afterburner:** 750 knots at sea level within 10% (the flight manual's limit; the data-built jet 754); Mach 2.2 at 40,000 ft within 10%.
- **Phone level, clean:** from 350 knots, hands off for 60 s, still within 35 knots; started level at 450 the nose rises within 3 s. **Gear and flaps down:** it settles between 180 and 220 knots.
- **Full back tilt at 500 knots:** 8.5 g within 10%. **At 250 knots:** stalled before it reaches 8.5 g.
- **A hard turn loses speed:** full back tilt from 450 knots at 5,000 ft in full afterburner, level, through 180°: it comes out at least 40 knots slower and still above 250.
- **A loop needs speed:** a tilt that gives 4 g at 450 knots, held without easing from 450 knots at 5,000 ft in full afterburner, goes over the top. From 250 knots in MIL, no held back tilt (a quarter, a half or full) gets over the top.
- **A power-off stall, clean, and one with gear and full flaps:** from level flight at idle, slowing 1 knot a second to full back tilt, held 5 s: stalled. Let go: flying again within 5 s, upright.
- **A power-on stall:** from level flight at 200 knots clean in MIL, full back tilt over 2 s and held 10 s: stalled. Let go: flying again within 5 s, upright.
- **A sloppy stall:** from the clean power-off stall, full back and full right tilt held 5 s, then let go: flying again within 15 s, upright (Wings 10.4 s).
- A two-minute tape replays in native JSBSim by milestone 1's lines.
- **Reported, no pass or fail,** beside Wings', the data-built jet's and the book's:
  - the takeoff with the tilt simply held at full, three quarters and a half (the table above);
  - g for one more degree of tilt at 180, 250, 350, 450 and 550 knots (the findings' table);
  - tilt for level flight at 180, 250, 450 and 600 knots clean, and at 150 and 180 with gear and flaps;
  - on a 3° final at 150 knots with gear and full flaps: the margin above the stall, the throttle and the tilt (the data-built jet flew final at 147; the F-4E appendix 152);
  - sustained g at 450 knots at sea level (CR-2144 implies 4.8); the loop's speed over the top and height gained;
  - roll rate at 250, 400 and 600 knots (Wings 102, 180, 183);
  - MIL top speeds; 300 to 600 knots in afterburner; idle slow-down with the boards in and out;
  - the stall's nose attitude and sink (Wings: nose high, 1,360 ft/min); the full-afterburner, full-back climb.

### PR 4. Tilt steers on the ground; the simple F-4C in the picker: first flight. Version 0.0.24 (Full; the flight)
**In it**
- In the shared control run: with a wheel on the ground the tilt is the pedals (rudder, and the nosewheel fading with speed on the curve FSG has) and the ailerons are neutral. The two swap over a third of a second as the wheels leave or touch. The pedals on the ground are the pilot's alone; the copilot's rudder counts only in the air.
- The straight stick for an airplane whose settings ask for it (the simple ones).
- "F-4C" goes to the top of the picker, with the owner's model, plumes, buffet and buttons, and is what a new install gets. A saved choice stays.
- The checkride's circuit pilot learns it.

**Done when**
- `npm test`:
  - from half a second after any wheel touches, whatever the tilt: both ailerons within 0.5° of neutral; from half a second after the last wheel leaves: the ailerons follow the tilt and the tilt no longer moves the rudder;
  - across a liftoff with a 10° tilt held, the ailerons reach what the tilt asks no sooner than a quarter second and no later than half a second after the wheels leave, with no step;
  - a taxi, tilt full over, a quarter throttle: it turns in a circle 84 ft across or less (the line this gear met before);
  - at 100 knots on the roll, a 10° tilt for 3 s: the nose comes round 1° to 10°, the bank stays under 3°, every wheel stays down;
  - hands off in roll, full afterburner: within 10 ft of the centreline to liftoff;
  - the copilot's only moving command is the rudder; the pitch trim it holds reads zero all flight;
  - **the circuit,** crash override off: takeoff, a 1,500 ft pattern at 250 knots, final at 150, touchdown on the mains in the first third within 25 ft of the centreline at 600 ft/min or less, stopped on the runway. Its tape replays in native JSBSim.
  - The data-built F-4C's and both Cessnas' tests pass unchanged.
- Headless Chromium: Fly shows the simple F-4C on the numbers, wheels within 1 in, flaps "1/2"; tilted right on the runway the rudder moves on the model and the ailerons do not; in the air the ailerons do; full afterburner and full back tilt, eased after liftoff: off between 150 and 190 knots; plumes lit; 0 console errors.
- **On the owner's iPhone, 0.0.24:** a takeoff, a closed pattern to a landing, a loop and a low, fast pass. Then, in his words: the pull, the roll, the lean at speed, the rotation, the steering, final, the stall. He flies the data-built jet beside it from the picker.

### Feel rounds, as the owner flies (Standard, flying, each)
One pull request per round of his words: the change in pilot terms, the numbers before and after, that airplane's checkride flown again. A change to the shared physics or control run is Full and re-flies every simple airplane.

### PR 5. The simple Cessna. Version as it falls (Standard, flying; phone check)
**In it:** `aircraft/c172-simple/`: a file of numbers on the same physics; `c172p`'s wheels and FlightGear's model; one "engine" whose thrust falls with speed as a propeller's does, no torque. Buttons: Flaps (four settings) and Brakes. The propeller in the picture turns with the throttle. "Cessna 172" joins the picker. The engine standing in for a propeller is the one new thing here: if its throwaway run shows trouble, the pull request is raised to Full.
**References,** from the Cessna 172P handbook (the reviewer checked them; each is written into the reference file with its page before the first run): stall 51 knots clean and 46 with full flaps (calibrated); rotation 55; approach 65; top speed 123 at sea level; manoeuvring speed 99; 3.8 g; climb about 700 ft/min.
**Done when**
- The two stalls, the top speed and the rotation within 10%.
- Phone level holds 100 knots within 10 after 60 s; faster, the nose rises.
- Full back tilt at 110 knots: 3.8 g within 10%; at 80, stalled before it reaches 3.8 g.
- Power-on (full throttle from 70 knots) and power-off stalls: stalled with full back tilt held; flying again within 5 s of letting go, upright.
- Full back tilt in a 60° bank at full throttle from 100 knots, through 360°: it comes out at least 10 knots slower.
- On the takeoff roll, hands off: both main wheels leave within 2 knots of each other, within 10 ft of the centreline.
- The circuit, by milestone 2's lines; its tape replays in native JSBSim.
- Reported: climb rate; g per degree of tilt at 60, 80 and 100 knots; roll rate at 100 (UIUC's about 67°/s); on final at 65 knots with full flaps, the margin above the stall, the throttle and the tilt.
- **On the owner's iPhone:** a circuit, a power-on and a power-off stall. Is this the pattern for the P-51D and the B-26?

### Last PR. Closeout (Light)
Results into `docs/milestones/3-replan.md`, every line with its outcome, failed lines kept, the owner's words; `CLAUDE.md`'s table and known facts; `README.md`; #32 and #44. The owner says which airplanes stay in the picker. Then stop: milestone 4 starts in a new chat, in Plan Mode.

---

## 5. The changes to `CLAUDE.md` (PR 1)

**Top, under "It's a flight sim game":**
> - **Sim:** not an arcade game. Simple but honest physics: lift, drag, thrust and weight, by JSBSim. It stalls, it bleeds energy in a hard turn, and the nose cannot be pointed where the airplane has no speed to go. Nothing is scripted.
> - **Game:** not a training simulator. Simple but not nit-picky aircraft: each is a file of simple numbers, the kind on a spec sheet, set so it is fun on a tilting phone. If it doesn't feel the way a pilot imagines that airplane, the numbers are wrong, whatever data they came from.

**How we work, rule 3:** "Every plan opens with 'How others solved this'" becomes "Every plan says how others solved each real problem it meets, as deep as the work's level calls for (below)." **A new rule after 5:**
> **Right-sized effort.** Not everything needs the same resources, research included. Every pull request in a plan carries a level. **Full** (Fable on High; how others solved it, with sources; throwaway flights first; the whole test suite): the shared physics, an airplane's first numbers, the controls, anything that changes how `src/sim/` flies a flight. **Standard** (the tests the change touches; research only if a new problem turns up): Fable on Medium for how an airplane flies on a proven pattern (a feel round, a new airplane's numbers), Opus on High for the app's wiring and the screen. **Light** (Opus on Medium; no research; a quick sanity check): words, docs and versions. GitHub's tests and Codex run on all of them. In a milestone chat Claude Code hands Standard and Light work to an agent at that level itself, checks the result and carries on. For a one-off ask it says in one line which level the job is. A job that turns out harder is raised a level, with the reason.

**Where things live:** the aircraft row becomes "`aircraft/`: `simple/` holds the one physics and control run every simple airplane flies on; each airplane has a folder of its own numbers. `aircraft/f4c/` is the data-built F-4C, kept as it is." Under Wings: "Wings' own flight model is not copied as code. Its F-4C card and its rules (the lift curve, the tail sized by speed, flaps that lift without pitching) are the reference for the simple airplanes' numbers."

**Flying, replacing "JSBSim flies every airplane" and "The F-4C is the airplane":**
> - **JSBSim flies every airplane,** v1.3.3, unmodified. We use its basics: lift, drag, thrust and weight as plain forces, with size and mass.
> - **One physics, and each airplane a file of numbers.** `aircraft/simple/` is written once: a lift curve that is straight to the stall and then drops, drag from speed and lift, plain damping, and the control run. An airplane's own file has its size, mass, wheels, engines and its numbers: weight, span, wing area, thrust, stall speeds, rotation speed, top speeds, corner speed, g limit, roll rate, trim speed, and a few set by feel. Each number says where it came from. Claude Code sets the engineering ones; the owner never sees one.
> - **Thrust is a vector scaled by the throttle,** falling off with speed and height. No propeller torque, P-factor or slipstream, for any simple airplane.
> - **The F-4C is the airplane:** the simple one (`aircraft/f4c-simple/`), with the owner's model and its wheels where the model has them. Rotation at 150 knots and the centre of gravity 3.5 ft ahead of the mains still stand.
> - **The data-built F-4C** (`aircraft/f4c/`: NASA CR-2144, AFWAL-TR-80-3141 and the rest, with the real feel system and dampers) is kept, untouched, flyable from the picker for comparison, and its lift, drag and thrust are there to borrow from. It and JSBSim's `c172p` fly as they were built, with the copilot and controls they had in 0.0.22; the rules under "Controls and assists" are the simple airplanes'. Its checkride and results are `docs/milestones/3.md`.
> - **A fly-by-wire airplane may differ in its own file:** tilt asks for g, and it will not stall or over-g. That is that airplane's FCS, not the copilot.

The test-aircraft bullets stay, with two changes: `c172p` "is in the picker again from 0.0.23, for comparison, with its model and credit"; and a new one, "`c172-simple` is the Cessna on the same simple physics, the pattern for a P-51D and a B-26."

**The checkride (Building it):**
> **The checkride** is small. Within about 10%: the speeds a pilot flies by (stall, rotation, top speed; the approach is flown and reported), beside the book. Common sense on energy: a hard turn loses speed, a loop needs a sensible entry speed, it stalls when asked and recovers when let go. Everything else is reported beside the book figure and judged by the owner flying it. No line exists only because it can be measured. Lines are written before the run.

**Controls and assists, replacing the copilot's list and the tilt, rudder and "acts only through" bullets:**
> - **The copilot** helps only with what the pilot has no control for: it keeps the rudder coordinated in the air. It makes no pitch or roll inputs and does no trimming.
> - **Tilt moves the surface directly, through one curve against speed,** as cables and pushrods would: slow, a long way for a little; fast, a little for a lot. Full back tilt is the g limit above corner speed and the stall below it. No modes. The curve is the airplane's own, in its file. The tilt goes to the stick as a straight line.
> - **One trim speed.** Phone level holds it (350 knots on the F-4C); faster, the nose rises. Flaps lower it by themselves, because they lift: gear and flaps down, the F-4C holds about 200.
> - **On the ground, tilt steers:** rudder and nosewheel, blended by speed. It does not move the ailerons. (This replaces the choice of 26 November.)
> - **No rudder control in the air** (#42, a pilot's rudder slider, is open).
> - **Takeoff:** full back tilt lifts the nosewheel at rotation speed; once it flies, ease the tilt to hold the climb. Held, it pitches up steeply and stalls, as it did in Wings.

**Screen and looks** gains: "an airplane picker on the pause screen, kept between visits: a development tool until the fleet (#33)".

**Known facts:** the "stick's middle is made gentler" line gains "on the data-built F-4C and JSBSim's Cessna; the simple airplanes take the tilt straight, as Wings did (the owner, 28 November 2026)". New: "JSBSim loads an airplane's aerodynamics from a shared file in another folder (`<aerodynamics file="../simple/aero.xml"/>`) and reads numbers the airplane's own file declares." New: "Wings' F-4C, full back tilt held through the takeoff: off at 174 knots with the nose 9° up, at 40° and stalled 2 s later. Its own test pilot eases to 10°."

**Milestones table, rows 3 and 4:**
> | 3 | **The F-4C.** A simple F-4C on the shared simple physics, with the owner's model, plumes and buttons; tilt through one speed curve; tilt steering on the ground; an airplane picker; the simple Cessna as the pattern. The data-built F-4C kept for comparison | The simple F-4C's speeds are within about 10% of the book and its energy makes sense, and on the test field the owner flies a takeoff, a closed pattern to a landing, a loop and a low pass on his iPhone and says it is fun |
> | 4 | **Hawaii.** (as now) | The owner flies from Hickam to every island on his iPhone, lands on another island, rips down a valley and says it is fun, and the game is the minimum viable FSG |

And under the table: "Milestone 3 was re-planned on 28 November 2026 after the owner's first flights: `docs/milestones/3-feel-findings.md` and `docs/milestones/3-replan.md`."

---

## 6. What the owner does, and when

- **After PR 2 (0.0.23):** switch airplanes in Settings; fly each; say whether it asked for motion access again.
- **After PR 4 (0.0.24):** fly the simple F-4C: takeoff, closed pattern, landing, loop, a low pass. Say what you think, in your words.
- **After each feel round:** fly it again.
- **After PR 5:** fly the simple Cessna: a circuit and both stalls.
- **Any time a line cannot be met:** read one report in pilot terms and decide.

---

## 7. Risks

| Risk | What settles it | If it fails |
|---|---|---|
| The tail cannot both lift the nose at 150 on half flaps and stop a full pull just past the stall in the air | PR 3's throwaway runs, first thing | Tried in this order: back tilt that bites harder on the runway than in the air, as Wings had. If that is not enough, one report with what each choice flies like: a nosewheel that lifts later than 150, or a nose that is quicker and firmer at every speed. The owner picks by those numbers |
| Sized like Wings but flown by JSBSim, it still feels twitchy | PR 3's g-per-degree table beside Wings'; the first flight | A feel round: the corner speed and the stick's middle are each one number |
| Native JSBSim will not load the shared file | PR 3's first check | Each airplane carries the block; a test holds the copies identical |
| The swap from pedals to ailerons at liftoff jolts | PR 4's swap line; the first flight | The swap's time is one number; or it follows the speed instead of the wheels |
| The picker row pushes the pause menu past 348 points (it fits by about 2) | PR 2's Chromium line | The row shows only in Settings, before a flight |
| The reload asks for motion access again on the phone | PR 2's phone check | It is one tap; if it annoys, switch without a reload (a larger change, proposed then) |
| A turbine standing in for a propeller reads oddly (spool-up, idle thrust) | PR 5's throwaway run | Its spool numbers are set quick; if JSBSim won't, report and propose; the pull request goes to Full |
| A line written from a sum, not from a run, cannot pass | Each is tried before its code is written | Kept, reported as failed, a new one proposed with the numbers |
| Milestone 4 adds a fifth row (random runway) and the pause menu overflows | Milestone 4's plan | The picker is a development tool: it moves or goes then |

**Defaults I chose; say so if you want otherwise**
- Picker names: "F-4C", "F-4C (NASA data)", "Cessna 172", "Cessna 172 (JSBSim's)". All four stay until the closeout.
- The simple F-4C flies at the data-built jet's weight, 38,924 lb, so the two compare like for like (Wings: 38,000).
- Its stall is Wings': a nose-high mush with a high sink rate, not a sharp break. A sloppy stall in a turn can drop a wing; let go and it recovers.
- Tilt keeps Wings' small dead zone at neutral (2° in pitch, 1.5° in roll) and full stick at 25° and 30°.
- Folder names `f4c-simple` and `c172-simple`.
- Versions: 0.0.23 the picker, 0.0.24 the simple F-4C's first flight.

---

## Critical files

- **New:** `aircraft/simple/`, `aircraft/f4c-simple/`, `aircraft/c172-simple/`; `src/sim/aircraft/list.js`, `f4c-simple.js`, `c172-simple.js`; `tests/checkride/simple-reference.js`, `tests/simple-f4c.test.js`, `tests/simple-c172.test.js`; `docs/milestones/3-replan.md`.
- **Changed:** `src/main.js` (`const AIRCRAFT = F4C` becomes the saved choice; the picker row), `index.html` (the row; the one credit line), `style.css`, `sw.js`, `src/sim/flight-run.js` (`AIRCRAFT` from the list), `src/input/pilot.js` (`controlsFrom`: the straight stick by the airplane's settings), `tests/app.test.js` (lines 97 to 135 hard-code the F-4C and forbid the Cessna), `tests/browser/app.chromium.mjs` (sets the airplane itself before each part), `tests/model.test.js` (two more rows), `tests/checkride/circuit.js` and `pilot.js`, `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `src/version.js`, `provenance.json`.
- **Reused as they are:** `src/fdm.js` (`homeOf`, `own`), `src/sim/game.js` (`Flight`, the tape, the airborne trim), `src/sim/assists.js` (`wingsFeet`; a held trim of zero through `trim.sets`), `tests/checkride/files.js` (`moduleWith`, `rootWith`), `tape.js` (`flyNative`), `src/render/` (model, plumes, surfaces), `src/sim/buffet.js`, the flap lever.
- **Watch for:**
  - `Flight.start`'s airborne start (tests only) works out the stick from JSBSim's trim by assuming trim and stick add one for one (`src/sim/game.js:232-247`): so the control run sums them before the speed curve, and the settings hold the trim at zero.
  - The state's 34 numbers need JSBSim's standard names (`fcs/elevator-pos-rad`, `fcs/steer-pos-deg` and the rest).
  - On the ground the control run must fade out the rudder command the copilot still writes; `src/sim/assists.js` is not changed for it.
  - The simple airplanes ask for the second-order stepping the F-4C uses (`stepping`), checked once.
  - The Chromium test wants the small print under the pause card (`tests/browser/app.chromium.mjs:1114`): one credit line, not two.
- **Not changed:** `aircraft/f4c/`, `src/sim/aircraft/f4c.js`, `c172p.js`, `src/sim/assists.js`, `src/sim/game.js`, every `tests/f4c*.test.js` and milestone 1 and 2 test, `jsbsim/`.

## Verification, end to end

- Every push: `npm test` in GitHub Actions. In the session: by the pull request's level (Full builds native JSBSim with `jsbsim/scripts/build-native.sh` and runs everything).
- App pull requests: `node tests/browser/app.chromium.mjs`, its output in the pull request, screenshots in the chat.
- After each deploy: fetch the live site and confirm the version.
- Each headless pull request pastes its checkride: every number beside its reference and source.
- The phone: 0.0.23 (the picker), 0.0.24 (the four flights), each feel round, the Cessna.
- At the end: the owner has flown the takeoff, the pattern, the loop and the low pass and said it is fun, in his words, in `docs/milestones/3-replan.md`.
