// A linear system's response in time, and the three numbers the checkride reads off a response.
// New in FSG, milestone 3 (docs/milestones/3.md, "Measuring a motion", and pull request 5).
//
// NASA CR-2144 gives each of the F-4C's motions as a transfer function: a gain, and the factors of its
// numerator and denominator in the report's own shorthand (its page A-11). The checkride gives the airplane
// a pulse of a control and lays its response beside the one CR-2144's table gives for the same pulse. This
// file turns the table's factors into that response, exactly: the transfer function as a set of first-order
// equations (its "controllable canonical form", in any control textbook: Ogata, Modern Control Engineering),
// stepped with the matrix exponential, which for an input held between steps has no error of method at all
// (the same book: the discrete-time equivalent with a zero-order hold).
//
// No JSBSim here, and nothing about the F-4C but how CR-2144 prints a table.

// ---- polynomials, highest power first ----

/** The product of two polynomials. */
export function multiply(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
}

/**
 * A polynomial from its factors. A factor is { root } for (s + root), the report's "1/T" (so a positive root
 * is a motion that dies away), or { zeta, omega } for (s2 + 2 zeta omega s + omega2).
 */
export function polynomial(factors) {
  return factors.reduce((p, f) => multiply(p, 'root' in f ? [1, f.root] : [1, 2 * f.zeta * f.omega, f.omega ** 2]), [1]);
}

/**
 * One block of one of CR-2144's transfer-function tables at one flight condition, as { gain, factors }.
 * `table` is the record's table (aircraft/f4c/data/cr2144-f4c.json, `tables`), `block` the rows' block
 * ("DENOMINATOR", "N(THE/DS)", ...), `fc` the flight condition's number, 1 to 10.
 *
 * The report's shorthand (its page A-11, quoted in the record's `how_to_read`):
 *   1/T(X)i            a root (s + 1/T)
 *   Z(X)j, W(X)j       a pair (s2 + 2 Z W s + W2)
 *   in parentheses     "the opposite order of what is specified": two rows printed as a Z and W pair are two
 *                      roots, and two 1/T rows are a Z and a W. A lone parenthesised Z is one root.
 *   A(X)               the gain: the ratio of the leading coefficients.
 */
export function factorsOf(table, block, fc) {
  const rows = table.rows.filter((row) => row.block === block), k = fc - 1;
  // A misprint the record has caught carries the value to use instead, in the table's doubt list.
  const corrected = (row) => table.doubt?.find((d) => d.row === row.label.trim() && d.fc === fc && d.use_instead !== undefined)?.use_instead;
  const value = (row) => corrected(row) ?? row.values[k], inParentheses = (row) => Boolean(row.parenthesised?.[k]);
  const blank = (row) => typeof value(row) !== 'number';
  const out = { gain: 1, factors: [] };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], label = row.label.trim(), next = rows[i + 1];
    if (blank(row)) continue;
    if (label.startsWith('A(')) out.gain = value(row);
    else if (label.startsWith('1/T(')) {
      if (inParentheses(row)) {
        // Two 1/T rows in parentheses: a damping ratio and a frequency.
        if (!next || !next.label.trim().startsWith('1/T(') || !inParentheses(next)) throw new Error(`${label}: a parenthesised 1/T with no partner`);
        out.factors.push({ zeta: value(row), omega: value(next) });
        i++;
      } else out.factors.push({ root: value(row) });
    } else if (label.startsWith('Z(')) {
      const partner = next && next.label.trim().startsWith('W(') ? next : null;
      if (inParentheses(row)) {
        // A Z and W pair in parentheses: two roots (or one, if the W is blank).
        out.factors.push({ root: value(row) });
        if (partner && !blank(partner)) out.factors.push({ root: value(partner) });
      } else {
        if (!partner || blank(partner)) throw new Error(`${label}: a damping ratio with no frequency`);
        out.factors.push({ zeta: value(row), omega: value(partner) });
      }
      if (partner) i++;
    } else throw new Error(`${label}: not a row of a transfer function`);
  }
  return out;
}

/**
 * A transfer function from a numerator and a denominator block (each { gain, factors }), as the polynomials
 * { numerator, denominator }. `times` multiplies the numerator by more factors: [{ root: 0 }] turns an
 * angle's transfer function into its rate's.
 */
export function transferFunction(numerator, denominator, times = []) {
  return { numerator: polynomial([...numerator.factors, ...times]).map((c) => c * numerator.gain), denominator: polynomial(denominator.factors) };
}

// ---- matrices, as arrays of rows ----

const identity = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
const times = (a, b) => a.map((row) => b[0].map((_, j) => row.reduce((sum, x, k) => sum + x * b[k][j], 0)));

/** e to the power of a matrix: scaled down until it is small, summed as a series, and squared back up. */
export function exponential(m) {
  const n = m.length, norm = Math.max(...m.map((row) => row.reduce((sum, x) => sum + Math.abs(x), 0)));
  const halvings = Math.max(0, Math.ceil(Math.log2(norm / 0.25)));
  const small = m.map((row) => row.map((x) => x / 2 ** halvings));
  let sum = identity(n), term = identity(n);
  for (let k = 1; k <= 20; k++) {
    term = times(term, small).map((row) => row.map((x) => x / k));
    sum = sum.map((row, i) => row.map((x, j) => x + term[i][j]));
  }
  for (let k = 0; k < halvings; k++) sum = times(sum, sum);
  return sum;
}

/**
 * The response of a transfer function to an input held constant over each step: `input(t)` is the input from
 * time t to t + dt. Returns { t, x } for every step from 0 to `seconds`: the output at each step's start.
 * The system starts at rest. The numerator must be of lower order than the denominator.
 */
export function respond({ numerator, denominator }, input, dt, seconds) {
  const n = denominator.length - 1;
  if (numerator.length > n) throw new Error('the numerator must be of lower order than the denominator');
  const lead = denominator[0], a = denominator.slice(1).map((c) => c / lead);
  const b = [...new Array(n - numerator.length).fill(0), ...numerator].map((c) => c / lead);
  // The state x' = A x + B u with A the companion matrix: the first row is minus the denominator's
  // coefficients, and each other row passes a state down. The output is the numerator's coefficients times the state.
  // One more row and column carry the input, so that one exponential steps both.
  const m = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  for (let j = 0; j < n; j++) m[0][j] = -a[j] * dt;
  m[0][n] = dt;
  for (let i = 1; i < n; i++) m[i][i - 1] = dt;
  const step = exponential(m);
  let state = new Array(n).fill(0);
  const out = [];
  for (let k = 0; k <= Math.round(seconds / dt); k++) {
    const t = k * dt, u = input(t);
    out.push({ t, x: state.reduce((sum, x, i) => sum + b[i] * x, 0) });
    state = state.map((_, i) => state.reduce((sum, x, j) => sum + step[i][j] * x, 0) + step[i][n] * u);
  }
  return out;
}

// ---- reading a response ----

/**
 * Where a record of { t, x } turns round: each highest and lowest point, once the record has come back from it
 * by more than `floor` (so that a swing smaller than the floor is not found, and ends the list).
 */
export function turningPoints(samples, floor) {
  const points = [];
  let going = 0, best = samples[0];
  for (const sample of samples) {
    if (going === 0) {
      if (Math.abs(sample.x - samples[0].x) > floor) { going = Math.sign(sample.x - samples[0].x); best = sample; }
    } else if ((sample.x - best.x) * going > 0) best = sample;
    else if ((best.x - sample.x) * going > floor) { points.push(best); going = -going; best = sample; }
  }
  return points;
}

/**
 * The three numbers the plan reads off a response to a pulse (docs/milestones/3.md, "Measuring a motion"),
 * for a record of { t, x } that starts at rest when the pulse starts and is left alone from `freeFrom` on
 * (the pulse's end):
 *   peakTime   the time to the first peak: the first place the response turns round
 *   peak       its size there, with its sign
 *   halfTime   the time to die to half: once the control is back, how long the motion's swings take to fall
 *              to half their size. A swing is from one turning point to the next, so a slow drift under the
 *              motion does not count. Its size between two swings is taken along a straight line of its
 *              logarithm, as a dying swing's is: for a motion that dies evenly this is the textbook's time to
 *              half amplitude, ln 2 / (damping ratio x frequency). NaN if the motion makes fewer than two
 *              swings after the pulse (it has no swing to time); Infinity if its swings have not fallen to
 *              half by the end of the record: the motion has not died away.
 * A turning point counts only if the response comes back from it by 2% of its largest size.
 */
export function measures(samples, freeFrom = 0) {
  const most = Math.max(...samples.map((s) => Math.abs(s.x)));
  const turns = turningPoints(samples, 0.02 * most);
  if (!turns.length) return { peakTime: NaN, peak: NaN, halfTime: NaN, turns, swings: [] };
  // The swings of the free motion: each ends at a turning point, and is as large as the response moved since the one before.
  const free = turns.filter((turn) => turn.t >= freeFrom);
  const swings = free.slice(1).map((turn, i) => ({ t: turn.t, size: Math.abs(turn.x - free[i].x) }));
  let halfTime = swings.length < 2 ? NaN : Infinity;
  for (let k = 1; k < swings.length; k++) {
    if (swings[k].size > 0.5 * swings[0].size) continue;
    const from = Math.log(swings[k - 1].size), to = Math.log(swings[k].size), wanted = Math.log(0.5 * swings[0].size);
    halfTime = swings[k - 1].t + ((wanted - from) / (to - from)) * (swings[k].t - swings[k - 1].t) - swings[0].t;
    break;
  }
  return { peakTime: turns[0].t, peak: turns[0].x, halfTime, turns, swings };
}
