# Milestone 3: the owner's first flights, what was found, and what he decided

27 and 28 November 2026. Written for the chat that re-plans the milestone. The plan and the record of every line are in `docs/milestones/3.md`.

Evidence labels as in `CLAUDE.md`. Everything measured here was flown headless in Node on the committed build by throwaway scripts that are not in the repo; nothing was changed in the app or the aircraft to get it. **Supported** unless marked.

## What the owner saw (version 0.0.22, on his iPhone)

1. **Takeoff:** "a little back tilt on rotation drags the tail on the runway and the nose shoots up to about 45° pitch."
2. **Pitch:** "far too sensitive. With small tilt changes, the best I could do in level flight was the nose bouncing between 0° and 5°."
3. **The pattern:** "I stalled in the closed pullup's turn and crashed."
4. **Final:** "I couldn't hold an aim point or an airspeed."
5. **A loop** from about 590 knots in full afterburner: "I couldn't get over the top; it stalled on the back side. A frontline Vietnam fighter can loop."

And: "I think we are losing sight of the 'game' in Flight Sim Game."

## The cause

**Mostly not the NASA data: the controls.** Milestone 3 made back tilt a pull in pounds through the real jet's feel system. Per pound the jet is the real one: 6.6 lb per g at 180 knots against NASA CR-2144's 7.1 on approach, and 10 to 13 lb per g from 250 to 550 knots against 12.5 (Verified against CR-2144). The real stick is that light when slow. A pilot checks it by feeling the stick's position and the airframe; a tilting phone gives neither.

How a tilt became stabilator in 0.0.22: a 2° dead zone, then a straight line to full stick at 25°, then the gentle middle; full back 103 lb and full forward 48 lb, the same at every speed; pounds, less the bobweight, over feel springs that stiffen with speed (about 0.5 lb an inch at 100 knots, 2.1 at 180, 12 at 350); 3.36° of stabilator an inch.

| | Measured on 0.0.22 |
|---|---|
| **Takeoff** | On the runway the whole stick fits in 6° of tilt: full nose-up stabilator takes 4° at 100 knots and 6.4° at 150 (3 to 7 lb of 103). Any tilt from 7° to 25° flies the same: nosewheel off at 153 knots, nose up at 15 to 26° a second. Held, the stabilator tips strike at about 13° of pitch and the nose peaks at 45° to 56°. A 10° to 12° fly-off means coming back to 4° of tilt, within half a degree, within 0.6 s |
| **Pitch** | One degree of tilt is 0.24 g at 180 knots and 0.07 g at 450. Slow, the nose rate first peaks at three times what it settles to. A pilot model (0.3 s reaction) holds level but goes into a growing bounce trying to capture a 3° climb: 6° to 8° of swing every 2 to 2.5 s at 180 to 250 knots |
| **Closed pull-up** | About 2 g and 9° of tilt. Below MIL the speed bleeds 6 to 16 knots a second. The margin to the stall shrinks from 6° to 8° of tilt at 300 knots to 1° at 231 |
| **Final** | One degree of tilt, in 5 s: 9° of angle of attack, 14 knots, about 950 ft of aim point. The jet is on the back side of the power curve (9,800 lb needed at 147 knots, 10,900 at 130) |
| **Loop** | Full back tilt stalls early. A 4 g pull eased to hold about 16° angle of attack gets over the top from 450, 500 and 590 knots (from 590: 321 knots over the top, 13,200 ft gained). A tilt held constant tightens as the jet slows and ends in a stall |

**Faults of the mapping, not the jet:** the dead zone sits on the tilt for level flight at 330 to 400 knots; a push gets under half the pounds of a pull.

**One fault in the aerodynamics:** too much drag in a pull. At 450 knots in full afterburner the jet sustains about 4.2 g; CR-2144's lift and drag imply about 4.8 (about 40% too much drag at 4 g; Supported, with a caveat about reading its curves across heights).

## What was tried, as measurements only

**On the data-built jet** (g for one more degree of tilt):

| Speed | 0.0.22 | Tilt asks for g | Nose rate slow, g fast (Boeing's C*) | Tilt straight to the tail, one speed curve |
|---|---|---|---|---|
| 180 knots | 0.24 | 0.08 | 0.03 | 0.13 |
| 250 | 0.16 | 0.07 | 0.03 | 0.13 |
| 350 | 0.14 | 0.06 | 0.04 | 0.16 |
| 450 | 0.07 | 0.06 | 0.04 | 0.09 |
| 550 | 0.075 | 0.06 | 0.045 | 0.10 |

- **C\*** (the copilot working the stick) fixed the takeoff, the bounce, the approach and the loop together. **The owner rejected it:** the copilot should not make pitch inputs, the stick's job should not change with the flight regime, and he must be able to stall the airplane at will.
- **Tilt straight to the tail through one speed curve (the owner's design).** The feel system out. Full tail travel at and below a corner speed, falling as one over the air's stiffness above it; a corner of 303 knots makes full back tilt 8.5 g at 480 knots. The pitch damper in (without it the g overshoots 30% and the bounce returns).
  - Better: on final one degree of tilt is 2.7° of angle of attack in 5 s (9° before), and a calm hand holds the path within 9 ft; a held 4 g tilt loops cleanly from 450, 500 and 590 knots; 3° to 4° of tilt to spare in the pull-up; as lively as before at speed; "phone level holds 350 knots, faster the nose rises" holds by itself; it stalls at will, power on or off, wings level, and recovers upright clean.
  - Worse: with the trim fixed for 350 knots, level flight takes 12° of back tilt at 180 knots, 17° on final and 12.5° forward at 550; takeoff is all or nothing (only full back rotates at 153 knots; full back then easing to 6° to 10° a second after the nose moves gives 15° to 17°); stalled with gear and full flaps and let go, it ends inverted.

**A blank-slate Aeromatic F-4C** (JSBSim's Aeromatic++ 3.3.21, "Fighter Jet", from headline numbers; stick straight to the tail):
- Calm when slow (0.05 g a degree at 180 knots), twitchier than 0.0.22 when fast (0.19 at 550). With the tail's gearing eased against speed, full back no longer stalls the wing in a pull.
- **Energy barely matters in it as generated:** a 6 g turn through 180° from 450 knots in afterburner gains 19 knots; it sustains 6.1 g at 450; it loops from 250 knots.
- It misses its own headline numbers: 658 knots on the deck (750), Mach 1.52 at 36,000 ft (2.2), a flapped stall of 141 knots (125), roll 374° a second at 600 knots (180 to 200).
- Its stall is a cliff; full back held, a spin at 560° to 700° a second that does not recover while held (Aeromatic's "stall starter").
- So a simple file needs its drag, stall, flap lift, roll and tail numbers set on purpose, not left as generated.

## How others solved this (research, 27 November 2026)

- **Boeing's C\*** (Tobie, Elliott and Malcolm, 1966): the stick asks for nose rate when slow and g when fast, crossing over at about 240 knots. Boeing's C\*U (the 777) adds a slow pull back to a trim speed. [Patent US5722620](https://patents.google.com/patent/US5722620A/en); [Niedermeier and Lambregts, ICAS 2012](http://icas.org/icas_archive/ICAS2012/PAPERS/605.PDF). Verified (read).
- **The F-16:** the stick commands g, with an angle-of-attack limit. [NASA TN D-8176](https://ntrs.nasa.gov/api/citations/19760017178/downloads/19760017178.pdf). Verified (read). Its pilots kept pulling at the stop with no cue.
- **Games with no stick feel** mostly use a fixed curve that softens the middle and a cap on full pull: [Heatblur's DCS F-4E options](https://f4.manuals.heatblur.se/dcs/special_options.html). No phone tilt game was found that changes sensitivity with speed.
- **Speed-scheduled gains:** the F-15's pitch ratio changer; [ArduPlane](https://ardupilot.org/plane/docs/airspeed-parameters-setup.html) scales its gains by speed.
- Not found: the 1966 paper itself; the textbook chapter; Airbus's own manual (forum sources only).

## What the owner decided (28 November 2026), in his words where he gave them

"Simple but honest physics. Simple but not nit-picky aircraft."

- **An airplane is a file of simple numbers.** JSBSim's basics only: lift, drag, thrust and weight as simple vectors; geometry and mass. It still stalls, more simply.
- **Thrust is a vector scaled by the throttle.** No propeller torque, P-factor or slipstream, for any airplane. (This removes the Cessna's right wheel lifting on the takeoff roll, which was its engine's torque, 427 lb-ft.)
- **Headline numbers, not wind-tunnel data.** "The basic stuff you'd find on Wikipedia."
- **Tilt moves the control surface directly, through one curve against speed,** as cables and pushrods would: slow, it moves a long way and does little; fast, it moves a little and does a lot. No modes.
- **The copilot helps only with what the pilot has no control for:** it coordinates the rudder. It does not make pitch or roll inputs.
- **On the ground, tilt steers** (rudder and nosewheel blended) and does not move the ailerons. "This is the way." (This replaces the choice of 26 November, that tilt is always the ailerons.)
- **Trim:** "we start with one trim speed and tilt the screen, like Wings. I'm open to discussing a new trim setting per flap (or gear?) configuration."
- **An airplane with a flight control system** (a fly-by-wire jet) may differ in its own file: tilt asks for g and the jet will not stall or over-g. That is that airplane's, not the copilot's.
- **What "close enough" means:** about 10% on the handful of speeds a pilot flies by (stall, approach, rotation, top speed); common-sense checks on energy (a hard turn loses speed; a loop needs a sensible entry speed; it stalls when asked and recovers when let go); everything else reported beside the book figure and judged by flying. "Does it feel like I imagine an F-4 would feel?"
- **Keep the data-built F-4C.** "Without trashing all the work." Not deleted or moved; flyable for comparison.
- **An airplane picker,** so he can test fly the Cessna and both F-4s.

## Open, for the plan

- The takeoff under a direct stick is all or nothing with one trim; trim by configuration is the owner's to discuss.
- The simple F-4C's numbers have to be set so energy matters; the data-built jet's lift, drag and thrust are there to borrow from.
- A pitch damper may be needed; in a simple file it is a number, not a device.
- Milestone 3's own line in `CLAUDE.md` ("passes its checkride against the flight manual and NASA data") no longer says what done means.
- Issue #42 (a pilot's rudder slider) is open; ground steering changes as above.
