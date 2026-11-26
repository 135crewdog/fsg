// What the pilot's hands make of the screen's controls: the seven controls the game takes
// (src/sim/game.js), and which buttons an airplane has. New in FSG, milestone 2 (pull request 7). Plain
// sums, no browser code.

const clamp = (x, lo, hi) => (Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : 0);

/**
 * How much of the stick's middle is made gentler: the "expo" of radio-control transmitters and flight-sim
 * joystick settings. 0 is a straight line; at 2/3, half stick sends a quarter. Full stick always sends all
 * of it. The owner's choice after his first flight (26 November 2026): the roll was too quick and the pull
 * too lively, and full tilt already was the real airplane's most (docs/milestones/2.md, PR 8).
 */
export const GENTLE = 2 / 3;

/** The stick as it is sent, from the stick as it is held (-1 to 1): (1 - e) x + e x^3. A game assist: it acts only through the controls. */
export const gentle = (x, e = GENTLE) => (1 - e) * x + e * x * x * x;

/** The four buttons, as Wings has them: [control, its name, what it says on, what it says off], in title case. */
export const BUTTONS = [['gear', 'Gear', 'Down', 'Up'], ['flaps', 'Flaps', 'Down', 'Up'], ['speedbrake', 'Boards', 'Out', 'In'], ['brake', 'Brakes', 'On', 'Off']];

/** The buttons an airplane has: those whose control drives something in its aircraft file. */
export const buttonsFor = (aircraft) => BUTTONS.filter(([control]) => aircraft.controls[control].to.length > 0);

/** What a button says: "Flaps Down", "Brakes Off". */
export const buttonText = ([, name, on, off], pressed) => `${name} ${pressed ? on : off}`;

/**
 * The seven controls to send: the stick from the tilt ({ pitch, roll }, back and right positive), its middle made
 * gentler (`gentle`), and the
 * throttle and the four buttons from `pilot`. Whatever comes in, what goes out is a number from -1 to 1 for
 * the stick, 0 to 1 for the throttle, and true or false for each button: a control that is not a number
 * ends a JSBSim flight.
 */
export function controlsFrom(pilot, stick) {
  return {
    pitch: gentle(clamp(stick?.pitch, -1, 1)), roll: gentle(clamp(stick?.roll, -1, 1)), throttle: clamp(pilot.throttle, 0, 1),
    gear: Boolean(pilot.gear), flaps: Boolean(pilot.flaps), speedbrake: Boolean(pilot.speedbrake), brake: Boolean(pilot.brake),
  };
}
