// NASA CR-2144's own linear model of the F-4C in pitch, worked out here from its tables and figures: the
// airframe of table IV-3, the feel system of figures IV-3 to IV-5, the bobweight, the stabilator's actuator and
// the pitch damper of figure IV-7. New in FSG, milestone 3 (docs/milestones/3.md, pull request 6).
//
// Why: the plan's lines lay JSBSim's response to a pull beside CR-2144's printed transfer functions (tables IV-6
// and IV-10), which include the stick's own mass and damping. The aircraft file leaves those out (the plan's
// own fallback; aircraft/f4c/f4c.xml, "The stick itself"). So the same model is built here twice: with the
// stick's mass and damping in, to be laid beside the printed tables (does it read the report right?), and with
// them out, as the aircraft file has them, to be laid beside JSBSim.
//
// The equations are the report's (its appendix C, the small-perturbation equations in the airplane's own axes,
// with the dimensional derivatives of table IV-3; Etkin, Dynamics of Flight, chapter 4, has the same form):
//   u' = Xu u + Xw w - W0 q - g cos(theta0) theta + Xds ds
//   w' (1 - Zwd) = Zu u + Zw w + (U0 + Zq) q - g sin(theta0) theta + Zds ds
//   q' = Mu u + Mw w + Mwd w' + Mq q + Mds ds
//   theta' = q
// with U0 = V cos(alpha0), W0 = V sin(alpha0), theta0 = alpha0 + gamma0 (all CR-2144's conditions are level).
// The control system (figure IV-3): the stick, m x'' + c x' + K1 x + K2 (x - y) = F - Fb, with y the far end of
// the bellows-pressure spring: held at 0 while the viscous damper is on its stop, and b y' = K2 (x - y) off it;
// the bobweight Fb = 5.35/32.2 times the normal acceleration 39.3 ft ahead, taken from its trim value; the
// stabilator asked for -3.36/57.3 x + the pitch damper's 0.15 s/(s + 1) on the pitch rate; the actuator
// 1/(0.05 s + 1). Stepped by the fourth-order Runge-Kutta rule at 1/1200 s, the input held over each 1/120 s.
import { readFileSync } from 'node:fs';

const CR = JSON.parse(readFileSync(new URL('../../aircraft/f4c/data/cr2144-f4c.json', import.meta.url)));
const G = 32.174;

/** A row of one of CR-2144's tables at a condition, a misprint the record caught put right. */
function cell(table, label, fc) {
  const t = CR.tables[table], row = t.rows.find((r) => r.label.trim() === label);
  const fix = t.doubt?.find((d) => d.row === label && d.fc === fc && d.use_instead !== undefined);
  return fix ? fix.use_instead : row.values[fc - 1];
}

/** A plotted line's value at x: straight lines between its points, held at its ends. */
export function along(points, x) {
  if (x <= points[0][0]) return points[0][1];
  if (x >= points.at(-1)[0]) return points.at(-1)[1];
  const k = points.findIndex(([a], i) => a <= x && x <= points[i + 1][0]);
  const [[a, b], [e, g]] = [points[k], points[k + 1]];
  return b + ((x - a) / (e - a)) * (g - b);
}

const feel = CR.figures.feel_system_parameters;
/** Figure IV-5: qB PBF, pounds (PBF's three lines by height, straight lines between them). */
export function qbPbf(mach, qbar, heightFt) {
  const lines = feel.PBF_ft2.curves, heights = [0, 15000, 35000, 45000];
  const at = [along(lines.upper_SL, mach), along(lines.upper_SL, mach), along(lines.middle_35000, mach), along(lines.lower_45000_55000, mach)];
  const h = Math.min(Math.max(heightFt, 0), 45000), k = Math.min(heights.findIndex((x, i) => h >= x && h <= heights[i + 1]), 2);
  return along(feel.qB_over_q.points, mach) * qbar * (at[k] + ((h - heights[k]) / (heights[k + 1] - heights[k])) * (at[k + 1] - at[k]));
}
/** Figure IV-5: whether the viscous damper is off its stop. */
export function damperFree(mach, heightFt) {
  const boundary = feel.viscous_damper_boundary.points_M_h_ft;
  return mach >= boundary[0][0] && heightFt > along(boundary, mach);
}

/** The stick and feel numbers (figures IV-3 and IV-4). */
export const STICK = { mass: 0.0369, damping: 0.208, spring: 0.0157, pressure: 0.0569, damper: 3.03, bobweight: 5.35 / 32.2, station: 39.3, gearing: -3.36 / 57.3, actuator: 0.05, pitchDamper: [0.15, 1] };

/**
 * The model at one of CR-2144's conditions. `stick: true` keeps the stick's mass and damping (CR-2144's own);
 * false leaves them out (the stick stands where its springs balance the push), as the aircraft file does.
 * `damper: true` has the pitch damper in (table IV-10), false out (IV-6).
 */
export function pitchModel(fc, { stick = true, damper = false } = {}) {
  const at = (label) => cell('IV-3', label, fc);
  const [Xu, Zu, Mu, Xw, Zw, Mw, Zwd, Zq, Mwd, Mq, Xd, Zd, Md] = ['XU *', 'ZU *', 'MU *', 'XW', 'ZW', 'MW', 'ZWD', 'ZQ', 'MWD', 'MQ', 'XDS', 'ZDS', 'MDS'].map(at);
  const V = cell('IV-2', 'VTO(FPS)', fc), alpha = cell('IV-2', 'ALPHA(DEG)', fc) * Math.PI / 180, gamma = cell('IV-2', 'GAMMA(DEG)', fc) * Math.PI / 180;
  const mach = cell('IV-2', 'M(-)', fc), qbar = cell('IV-2', 'Q(PSF)', fc), h = cell('IV-2', 'H(FT)', fc), heightFt = h === 'SL' ? 0 : Number(String(h).replace('K', '')) * 1000;
  const U0 = V * Math.cos(alpha), W0 = V * Math.sin(alpha), theta0 = alpha + gamma;
  const pb = qbPbf(mach, qbar, heightFt), K1 = STICK.spring * pb, K2 = STICK.pressure * pb, free = damperFree(mach, heightFt);
  // The state: u, w, q, theta, the stick x and its rate, the damper's end y, the stabilator, the pitch damper's lag.
  const derivative = (s, F) => {
    const [u, w, q, theta, x, xd, y, ds, z] = s;
    const wd = (Zu * u + Zw * w + (U0 + Zq) * q - G * Math.sin(theta0) * theta + Zd * ds) / (1 - Zwd);
    const qd = Mu * u + Mw * w + Mwd * wd + Mq * q + Md * ds;
    // The normal acceleration felt 39.3 ft ahead, ft/s2 along z (down): the centre of gravity's, less the pitching acceleration's share.
    const fz = wd - U0 * q + G * Math.sin(theta0) * theta - STICK.station * qd;
    const push = F - STICK.bobweight * -fz - K2 * (x - (free ? y : 0));
    let xdd = 0, xs = x;
    if (stick) xdd = (push - STICK.damping * xd - K1 * x) / STICK.mass;
    const yd = free ? (K2 * (x - y)) / STICK.damper : -y;
    const asked = STICK.gearing * xs + (damper ? STICK.pitchDamper[0] * (q - z) : 0);
    return [Xu * u + Xw * w - W0 * q - G * Math.cos(theta0) * theta + Xd * ds, wd, qd, q, stick ? xd : 0, xdd, yd, (asked - ds) / STICK.actuator, STICK.pitchDamper[1] * (q - z)];
  };
  // With the stick's mass out, x is not a state: it is where the springs balance the push. Found at each
  // evaluation: x = (F - bobweight + K2 y) / (K1 + K2), the bobweight's acceleration depending on x through
  // nothing but the state (the stabilator lags it through the actuator), so no loop needs solving.
  const balanced = (s, F) => {
    const [u, w, q, theta, , , y, ds] = s;
    const wd = (Zu * u + Zw * w + (U0 + Zq) * q - G * Math.sin(theta0) * theta + Zd * ds) / (1 - Zwd);
    const qd = Mu * u + Mw * w + Mwd * wd + Mq * q + Md * ds;
    const fz = wd - U0 * q + G * Math.sin(theta0) * theta - STICK.station * qd;
    return (F - STICK.bobweight * -fz + K2 * (free ? y : 0)) / (K1 + K2);
  };
  return {
    fc, mach, heightFt, K1, K2, free, staticStiffness: K1 + (free ? 0 : K2),
    /** The pitch rate, deg/s, each `dt` from 0 to `seconds`, for a stick force `force(t)` (lb, aft positive) held over each `dt`. */
    respond(force, dt, seconds, substeps = 10) {
      let s = new Array(9).fill(0);
      const h = dt / substeps, out = [];
      const f = (state, F) => {
        if (stick) return derivative(state, F);
        const next = [...state];
        next[4] = balanced(state, F);
        return derivative(next, F);
      };
      for (let k = 0; k <= Math.round(seconds / dt); k++) {
        const t = k * dt, F = force(t);
        out.push({ t, x: s[2] * 180 / Math.PI });
        for (let i = 0; i < substeps; i++) {
          const k1 = f(s, F), k2 = f(s.map((v, j) => v + (h / 2) * k1[j]), F), k3 = f(s.map((v, j) => v + (h / 2) * k2[j]), F), k4 = f(s.map((v, j) => v + h * k3[j]), F);
          s = s.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
          if (!stick) s[4] = balanced(s, F);
        }
      }
      return out;
    },
    /** The airframe alone: the pitch rate, deg/s, for a stabilator `deflection(t)` (degrees) held over each `dt`. For checking it against table IV-4. */
    airframe(deflection, dt, seconds, substeps = 10) {
      let s = [0, 0, 0, 0];
      const d = (st, ds) => {
        const [u, w, q, theta] = st;
        const wd = (Zu * u + Zw * w + (U0 + Zq) * q - G * Math.sin(theta0) * theta + Zd * ds) / (1 - Zwd);
        return [Xu * u + Xw * w - W0 * q - G * Math.cos(theta0) * theta + Xd * ds, wd, Mu * u + Mw * w + Mwd * wd + Mq * q + Md * ds, q];
      };
      const h = dt / substeps, out = [];
      for (let k = 0; k <= Math.round(seconds / dt); k++) {
        const t = k * dt, ds = deflection(t) * Math.PI / 180;
        out.push({ t, x: s[2] * 180 / Math.PI });
        for (let i = 0; i < substeps; i++) {
          const k1 = d(s, ds), k2 = d(s.map((v, j) => v + (h / 2) * k1[j]), ds), k3 = d(s.map((v, j) => v + (h / 2) * k2[j]), ds), k4 = d(s.map((v, j) => v + h * k3[j]), ds);
          s = s.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
        }
      }
      return out;
    },
  };
}
