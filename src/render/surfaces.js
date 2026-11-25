// The model's moving parts, from JSBSim's state: where each of docs/models.md's motions should be, so that the
// picture shows what the flight model's surfaces are doing. New in FSG, milestone 2 (pull request 5).
//
// An aircraft's settings say, for each motion its model has, which number of the state drives it and the
// three values of that number at which the motion is at 0, at 0.5 and at 1 (docs/models.md's table: flaps up
// to down; the controls from full forward or left, through neutral, to full back or right). Between them it
// is a straight line, so a surface at half its travel in JSBSim is drawn at half its travel on the model,
// whatever each one's degrees are.
//
// No DOM and no Three.js.
const clamp = (x) => Math.max(0, Math.min(1, x));

/** Where a motion is (0 to 1) for a value, given the values at 0, 0.5 and 1. */
export function motionAt(value, [at0, atHalf, at1]) {
  const low = (value - at0) / (atHalf - at0);   // 0 at `at0`, 1 at `atHalf`
  return low <= 1 ? clamp(0.5 * low) : clamp(0.5 + (0.5 * (value - atHalf)) / (at1 - atHalf));
}

/**
 * Returns a function that reads the motions from a state: { flaps, elevator, aileron, rudder }, those the
 * aircraft's settings name. `surfaces` is the settings' (src/sim/aircraft/); `stateNames` is the flight's.
 */
export function surfaceReader(surfaces, stateNames) {
  const read = Object.entries(surfaces).map(([motion, { from, at }]) => {
    const index = stateNames.indexOf(from);
    if (index < 0) throw new Error(`${from} is not in the state`);
    return [motion, index, at];
  });
  return (state) => Object.fromEntries(read.map(([motion, index, at]) => [motion, motionAt(state[index], at)]));
}
