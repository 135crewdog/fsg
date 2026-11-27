// The model's moving parts, from JSBSim's state: where each of docs/models.md's motions should be, so that the
// picture shows what the flight model's surfaces are doing. New in FSG, milestone 2 (pull request 5).
//
// An aircraft's settings say, for each motion its model has, which number of the state drives it and the
// three values of that number at which the motion is at 0, at 0.5 and at 1 (docs/models.md's table: flaps up
// to down; the controls from full forward or left, through neutral, to full back or right). Between them it
// is a straight line, so a surface at half its travel in JSBSim is drawn at half its travel on the model,
// whatever each one's degrees are.
//
// Milestone 3, pull request 8: a motion may be driven by the difference of two numbers (`minus`). The F-4C's
// ailerons only go down, one each way, so what rolls it is the left aileron less the right: one number for
// the model's `aileron` motion, which moves both ailerons and both spoilers (docs/models.md).
//
// No DOM and no Three.js.
const clamp = (x) => Math.max(0, Math.min(1, x));

/** Where a motion is (0 to 1) for a value, given the values at 0, 0.5 and 1. */
export function motionAt(value, [at0, atHalf, at1]) {
  const low = (value - at0) / (atHalf - at0);   // 0 at `at0`, 1 at `atHalf`
  return low <= 1 ? clamp(0.5 * low) : clamp(0.5 + (0.5 * (value - atHalf)) / (at1 - atHalf));
}

/**
 * Returns a function that reads the motions from a state: { flaps, elevator, aileron, rudder, ... }, those the
 * aircraft's settings name. `surfaces` is the settings' (src/sim/aircraft/): for each motion `from`, the
 * number that drives it, or with `minus` that number less another; `stateNames` is the flight's.
 */
export function surfaceReader(surfaces, stateNames) {
  const where = (name) => {
    const index = stateNames.indexOf(name);
    if (index < 0) throw new Error(`${name} is not in the state`);
    return index;
  };
  const read = Object.entries(surfaces).map(([motion, { from, minus, at }]) => [motion, where(from), minus === undefined ? -1 : where(minus), at]);
  return (state) => Object.fromEntries(read.map(([motion, index, less, at]) => [motion, motionAt(less < 0 ? state[index] : state[index] - state[less], at)]));
}
