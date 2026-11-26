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

/** The buttons an airplane has: those whose control drives something in its aircraft file. (Its flaps may be drawn as a lever instead: `flapSettings`.) */
export const buttonsFor = (aircraft) => BUTTONS.filter(([control]) => aircraft.controls[control].to.length > 0);

/** What a button says: "Flaps Down", "Brakes Off". */
export const buttonText = ([, name, on, off], pressed) => `${name} ${pressed ? on : off}`;

/**
 * The flap lever (milestone 3, PR F; the owner's design, 26 November 2026). An airplane with more than one
 * flap setting has, in place of the Flaps button, two buttons, Flaps Up and Flaps Down, and between them an
 * indicator that reads the setting. It is the cockpit's way: a lever with a stop for each setting, and a
 * separate indicator (docs/milestones/3.md, PR F, "How others solved this").
 *
 * Returns the airplane's settings, from up to fully down, each { at, reads } (src/sim/aircraft/c172p.js), or
 * null for an airplane whose flaps are only up or down (it keeps the one button) or that has none.
 */
export const flapSettings = (aircraft) => (aircraft.controls.flaps.to.length > 0 && aircraft.flaps?.settings.length > 2 ? aircraft.flaps.settings : null);

/**
 * Which setting a flaps control means: the nearest one's place in `settings`. On (true) is fully down and off
 * (false) is up, as milestone 1 sends them; anything that is not a number is up.
 */
export function flapSetting(settings, flaps) {
  const want = clamp(Number(flaps), 0, 1);
  let nearest = 0;
  settings.forEach(({ at }, k) => { if (Math.abs(at - want) < Math.abs(settings[nearest].at - want)) nearest = k; });
  return nearest;
}

/**
 * The flap lever as it stands with the flaps control `flaps`:
 *   at      the control to send: always one of the airplane's settings, whatever came in
 *   reads   what the indicator says: the setting chosen, which the flaps are at or on their way to
 *   up      the control after a press of Flaps Up: one setting up, or null at the last (the button is dim and does nothing)
 *   down    the same for Flaps Down
 */
export function flapLever(settings, flaps) {
  const k = flapSetting(settings, flaps);
  return { at: settings[k].at, reads: settings[k].reads, up: k > 0 ? settings[k - 1].at : null, down: k < settings.length - 1 ? settings[k + 1].at : null };
}

/**
 * The seven controls to send: the stick from the tilt ({ pitch, roll }, back and right positive), its middle made
 * gentler (`gentle`), and the
 * throttle and the four buttons from `pilot`. Whatever comes in, what goes out is a number from -1 to 1 for
 * the stick, 0 to 1 for the throttle, and true or false for each button: a control that is not a number
 * ends a JSBSim flight. For an `aircraft` with a flap lever the flaps are not true or false but one of its
 * settings, a number from 0 to 1.
 */
export function controlsFrom(pilot, stick, aircraft = null) {
  const settings = aircraft && flapSettings(aircraft);
  return {
    pitch: gentle(clamp(stick?.pitch, -1, 1)), roll: gentle(clamp(stick?.roll, -1, 1)), throttle: clamp(pilot.throttle, 0, 1),
    gear: Boolean(pilot.gear), flaps: settings ? flapLever(settings, pilot.flaps).at : Boolean(pilot.flaps), speedbrake: Boolean(pilot.speedbrake), brake: Boolean(pilot.brake),
  };
}
