<!-- After 135crewdog/wings, docs/models.md, commit 6d689b7. Changed for FSG in milestone 2 (docs/milestones/2.md):
     fixed gear, the propeller, a hinge's parent, the wheels checked against the aircraft file, a borrowed
     stand-in's budget, and the stand-in Cessna. In milestone 3 (docs/milestones/3.md, pull request 4) Wings'
     speedbrake and engine-exit rules came back, written for a JSBSim aircraft file where Wings has its card,
     with the owner's F-4C. -->
# What the app needs from a 3D model

This is the handoff between a model chat and the app: what an airplane's model must be.

A model chat builds an airplane in Blender to these rules and exports one `.glb`. The app can then show it and move its parts without any code written for that airplane, and it stands on its wheels where JSBSim stands it. `tests/model.test.js` checks a model against this page.

Claude Code writes this page and keeps it current. If a rule here is impractical in Blender, say so in the model chat and the owner brings it back; don't work around it.

## Size and which way is which

- **Real size, in metres.** An F-4C is 17.7 m long with a span of 11.7 m. The test allows 2% either way.
- **Axes in the exported file:** nose along −Z, right wing along +X, up along +Y. In Blender, which has Z up, that means the nose points along +Y and the right wing along +X; the glTF exporter's "+Y Up" option (on by default) does the rest.
- **The origin is the centre of gravity:** the one JSBSim flies the airplane about, as loaded, read back from a run (it is not the empty airplane's, which is the one written in an aircraft file). JSBSim turns and pitches the airplane around this point, so a wrong origin makes it look as if it pivots about its nose or tail.
- Apply rotation and scale to every object before animating anything (Ctrl-A, "Rotation & Scale"), so the file carries no hidden scaling. Not "All Transforms" and not "Location": those move each object's origin to the middle of the scene, which throws away the hinges below.

## The parts that move

Every moving part is its own object, with its origin on its hinge line, so it rotates where the real one does. It may have a parent that only places it.

The app does not know any airplane's hinges or angles. It only knows **five named motions**, which every model must have. One exception: an airplane with fixed gear has no `gear` motion. Each is an animation (a Blender action, exported as a glTF animation) of **exactly one second**, and the app sets the time to say where the part is. The time is the position:

| Name | 0 s | 0.5 s | 1 s |
|---|---|---|---|
| `gear` | up, doors closed | part way | down and locked |
| `flaps` | up | part way | fully down |
| `elevator` | full forward stick: trailing edge down | neutral | full back stick: trailing edge up |
| `aileron` | full left stick: the airplane rolls left | neutral | full right stick: it rolls right |
| `rudder` | full left: trailing edge left | neutral | full right |

Rules for the motions:

- **Names are exact,** lower case, as in the table.
- **`aileron` moves whatever rolls the airplane, the way the real one does.** On most airplanes that is two ailerons, one up and one down. The F-4 is different: its ailerons only go down, and a spoiler on top of the other wing comes up. For a left roll the right aileron goes down and the left spoiler rises, while the left aileron stays put; a right roll is the mirror image; at neutral everything is flush.
- **One motion may move many parts.** `gear` moves all three legs and every door. `flaps` moves every flap panel, leading and trailing edge. `aileron` moves both ailerons, and the spoilers too if the airplane rolls with them, as the F-4 does.
- **A part belongs to one motion only.** The app runs all five at once, so two motions moving the same part would fight.
- **Frame rate:** set the scene to 24 frames per second and key frames 0, 12 and 24. Use linear interpolation between keys, so half way in time is half way in travel. The exporter may write a key for every frame; that is fine.
- **The file's own resting pose doesn't matter.** The app sets all five motions before it draws anything, and the tools and tests pose the model the same way: gear down, flaps up, controls at 0.5 s.
- **Deflections are the real airplane's.** Check them against the references; for the F-4C they are about: stabilator 21° trailing edge up to 9° down; ailerons 30° down, with the spoiler on the other wing up 45°; rudder 30° each way; trailing-edge flaps 60° and leading-edge flaps 30°; speedbrakes 60°.
- The gear should take its whole second: doors opening first, legs swinging down after.
- **A model may carry other motions.** The app leaves any it doesn't know at 0 s, so 0 s must be the closed, flush position. No spinning wheels, no pilots' heads.
- **`speedbrake`,** if the airplane has them: 0 s closed and flush, 1 s fully open, every panel it moves opening into the airflow, one each side. The app opens them with the speedbrake button. Their drag is JSBSim's, from the airplane's aircraft file, and acts where the model has the panels: the middle of the open panels, on the centreline, is measured from the model (`models/measure.mjs`) and the aircraft file's speedbrake point is written there. `tests/model.test.js` holds the two together, within an inch.

## The engines' exits

A jet's exits need nothing named: Claude Code measures the middle and the opening of each one from the model (`models/measure.mjs` finds them by their shape). Fore and aft and sideways, the aircraft file's thrust points are written there, and `tests/model.test.js` holds the two together, within an inch; the afterburner plumes will start there too. In height the thrust line is the real airplane's, from its data, and the test reports how far that is from the model's exits.

An exit must be a round rim, open at the back, with nothing of the airframe inside the opening for the first metre behind it, or the flame would come out through the skin.

## The propeller

An airplane with a propeller has a part named exactly `propeller`, its origin on the hub. The app turns it about its own Z axis, which must lie along the thrust line, at the engine's speed.

It holds two parts. `propeller_blades` is the solid blades and spinner, drawn while the propeller turns slowly. `propeller_disc` is a flat, see-through disc painted as the blur of the blades, drawn in their place as it speeds up. The app fades one into the other; the model only has to carry both.

## The wheels

Three objects named exactly `wheel_nose`, `wheel_left` and `wheel_right`: the tyres. If a leg has two tyres, as the F-4's nose leg does, join them into one object. They may be children of their gear legs: they are measured where they end up with the gear down. Each tyre must touch the ground where the airplane's JSBSim file has that wheel, with the gear down, so that the airplane sits and rolls on the wheels you can see. `tests/model.test.js` stands the airplane in JSBSim and checks all three, within an inch.

Model the gear at its length with the airplane's weight on it, not hanging fully extended: JSBSim's springs are squeezed that far when it stands.

## Looks

- **Shape and proportions come first:** the planform, the tail, the intakes, the canopy line. Fine detail nobody sees from a chase camera 30 m away isn't worth its triangles.
- **Markings:** a real paint scheme and national insignia. Tail codes, serials and unit badges are invented unless the owner says otherwise. Nose art and kill markings are his call: his F-4C carries Robin Olds's "SCAT XXVII" and MiG-kill stars. The owner settles the scheme and what hangs under the wings in the model chat.
- **Gear bays and flap gaps** should look right when open: no see-through holes into an empty fuselage.
- Smooth shading with sharp edges marked where the real airplane has them, or flat shading throughout: whichever suits the model.

## Budget

- The `.glb` is under **2 MB**.
- Under **50,000 triangles.**
- **One material, single-sided, and up to two textures**, each up to 1024 × 1024 pixels, packed into the file: base colour, and optionally roughness with metalness in the standard glTF layout. No normal or emission maps.
- No cameras, lights, empties left over from modelling, or hidden objects.
- **A borrowed stand-in** (a model made for another simulator, converted by a script) may keep its own materials, and up to four textures of 1,024 pixels. The 2 MB and the 50,000 triangles hold for it too.

## Exporting

File → Export → glTF 2.0, format **glTF Binary (.glb)**, with: +Y Up on; Apply Modifiers on; Animations on, with one glTF animation per action (animation mode "Actions"); and everything else left at its default.

Save the Blender file and the export side by side in the owner's Drive. The owner then attaches the `.glb` to the Claude Code chat.

## What happens to it in the app

Claude Code puts the file in `models/` and runs `tests/model.test.js`. If the test finds a rule broken, Claude Code reports exactly what is off for the model chat to fix. The owner gets two rounds of revision on the look, unless he asks for more.

`node models/measure.mjs models/f4c.glb` prints where a model has its wheels, engine exits, speedbrake panels and lowest points, in feet forward, right and down from its origin, for the author of its aircraft file.

## The models today

### The stand-in Cessna, in the app

`models/c172p.glb` is milestone 2's stand-in: FlightGear's Cessna 172P, licence GPL version 2, converted by `models/convert-c172p.py`. It is the one exception to "models are built in a model chat": `models/CREDITS.md` says whose it is and what the script changed. It flies as JSBSim's `c172p`, which came from the same FlightGear airplane, so its wheels are where the flight model's are.

Two things about it are not as this page asks, and are on record, not fixed:
- Its gear is drawn hanging free, as FlightGear models it. So that the tyres still stand on the ground, the airplane is sat about 2° more nose-up than FlightGear draws it.
- Its wing is 13 inches wider than a real 172's (2.9%).

### The owner's F-4C, not in the app yet

`models/f4c.glb` is the owner's own F-4C, built in Blender with Claude in a Wings project chat: the same file as Wings', bit for bit, locked in `provenance.json`. `models/CREDITS.md` has its history. It is 17.70 m long and 11.70 m in span, 3,669 triangles, with one material and two textures of 1,024 pixels. It comes into the app in milestone 3, pull request 8.

It has six motions, each one second, measured by `tests/model.test.js` and each exactly the travel this page asks:

| Motion | What it moves | Travel |
|---|---|---|
| `gear` | three legs, their wheels and three doors | up and closed to down and locked |
| `flaps` | two trailing-edge flaps, and four leading-edge flaps | 60° down; 30° down |
| `elevator` | the stabilator, one piece | 9° trailing edge down (forward stick) to 21° up (back stick) |
| `aileron` | two ailerons and two spoilers | the aileron 30° down on the wing that rises, with the other wing's spoiler 45° up; the other aileron and spoiler stay flush |
| `rudder` | the rudder | 30° each way |
| `speedbrake` | two panels under the wings | 60° open |

Against its aircraft file, `aircraft/f4c/f4c.xml`, stood in JSBSim:
- **Its wheels.** The gear is drawn at its loaded length, so the airplane stands on its tyres at the height JSBSim stands it: the tyres meet the runway 6.40 ft below the origin, the nose wheel 19.75 ft ahead of it and the main wheels 3.52 ft behind and 8.96 ft out. Every tyre is within a quarter of an inch of the file's wheel, fore and aft, sideways and in height.
- **Its engine exits.** Their middles are 16.16 ft behind the origin, 2.14 ft out and 0.60 ft below it, each opening 2.4 ft across. The file's thrust points are within half an inch of them fore and aft and sideways. In height the thrust line is NASA CR-2144's, which passes 6 in below the model's exits.
- **Its speedbrake panels.** Open, their middle is 5.99 ft behind the origin and 2.49 ft below it (`tests/checkride/f4c-reference.js`). The aircraft file's speedbrake point is written there (milestone 3, pull request 7), and `tests/model.test.js` holds the two together within an inch.
