# Whose models these are

## `c172p.glb`: the stand-in Cessna 172P (milestone 2)

The exterior of FlightGear's Cessna 172P, by the c172p-team and the FlightGear contributors:
https://github.com/c172p-team/c172p, commit `10a26158b6456244d84cbac27e6882bdc807f98c`, files
`Models/c172-common.ac`, `Models/c172p.xml`, `Models/fuselage.png`, `Models/wing.png`, `Models/tail.png` and `Models/prop.png`.

**Licence: the GNU General Public License, version 2.** Its text is `models/c172p-COPYING.txt`. The converted model is a changed copy of that work and stays under the same licence. Its source is the files above, and the script that makes this file from them: `models/convert-c172p.py`, which fetches them, checks each against its fingerprint and writes `c172p.glb`. The rest of FSG is not part of that work.

What the script changed (20 November 2026):
- left out everything but the outside: the cabin, panel and seats, the tie-downs, cowl plugs and wheel fairings, FlightGear's click spots and light effects, and two blank panes that lay over the door windows;
- made the windows solid glass, since there is no cabin behind them;
- turned it to FSG's axes, put its origin at the centre of gravity JSBSim flies `c172p` about, and sat it so that all three tyres touch the ground where JSBSim stands the airplane;
- shrank the three paint textures from 2,048 to 1,024 pixels and stored them as JPEG;
- wrote FlightGear's flap, elevator, aileron and rudder movements, with their own hinge lines and travel, as the four one-second motions `docs/models.md` asks for;
- named the propeller's parts and the three tyres as `docs/models.md` asks.

It wears FlightGear's own default paint and registration. It was the stand-in for the test flights of milestone 2, and left the app when the F-4C arrived (milestone 3, pull request 8, version 0.0.19): it stays in the repo for the headless tests of `c172p`, and its credit with it.

## `f4c.glb`: the F-4C Phantom II (milestone 3)

The owner's own model, built in Blender with Claude in his Wings project, from his reference photos and drawings. Its Blender file, `f4c.blend`, is in the owner's Google Drive.

It is painted as a USAF F-4C in Southeast Asia camouflage, loosely Robin Olds's jet.

This file is Wings' `models/f4c.glb` (135crewdog/wings, commit `6d689b7`; it last changed there in `9006d56`), byte for byte: `provenance.json` holds its fingerprint, and `tests/model.test.js` checks it. Nothing was changed for FSG.

It has been the airplane on screen since version 0.0.19 (milestone 3, pull request 8).
