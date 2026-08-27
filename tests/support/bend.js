// 90-degree channel bend: harness plus the measurements Test 6 validates.
//
// Geometry is an L-shaped duct. Flow enters on the left along the TOP leg,
// turns through the bend, and leaves through the BOTTOM of the RIGHT leg.
// The outer walls of the bend are the domain's top and right edges; the inner
// corner sits at (Lx-w, Ly-w).
//
//        inlet
//      +---------------------+
//   -> |                     |   <- top wall = outer wall of the inlet leg
//      +--------------+      |
//                     |      |   <- right wall = outer wall of the outlet leg
//         solid       |      |
//                     +------+
//                        |
//                        v  outlet
//
// Test-support code only - nothing here is imported by /solver or /geometry.

import { StaggeredGrid, stampWhere } from "../../geometry/grid.js";
import { step, computeDivergence } from "../../solver/ns2d.js";

const cache = new Map();

// innerRadius === null gives a sharp mitre bend (square inner and outer
// corners). A number gives a smooth elbow of that inner radius, with the
// outer wall on the concentric arc one channel width further out, so both
// geometries have the same channel width everywhere.
export function buildBend({ w = 1, cpw = 12, legLen = 6, innerRadius = null }) {
  const h = w / cpw;
  const Lx = legLen * w + w;
  const Ly = Lx;
  const nx = Math.round(Lx / h);
  const ny = Math.round(Ly / h);
  const grid = new StaggeredGrid(nx, ny, h);

  let isSolid;
  if (innerRadius === null) {
    isSolid = (x, y) => x < Lx - w && y < Ly - w;
  } else {
    const ri = innerRadius;
    const ro = ri + w;
    const cx = Lx - ro;
    const cy = Ly - ro;
    isSolid = (x, y) => {
      if (x >= cx && y >= cy) {
        const d = Math.hypot(x - cx, y - cy);
        return d < ri || d > ro;
      }
      if (x < cx) return y < Ly - w; // inlet leg
      return x < Lx - w; // outlet leg
    };
  }

  const solidCells = stampWhere(grid, isSolid);
  return { grid, h, w, Lx, Ly, nx, ny, solidCells, innerRadius, legLen };
}

// See the note on cavityBoundary: shared with the golden-field fixture so the
// two cannot drift apart.
export function bendBoundary(U0) {
  return {
    left: { type: "inflow", u: U0, v: 0 },
    right: { type: "wall" },
    top: { type: "wall" },
    bottom: { type: "outflow" },
  };
}

export function runBendToSteadyState({
  Re,
  w = 1,
  cpw = 12,
  legLen = 6,
  innerRadius = null,
  U0 = 1,
  rho = 1,
  dtSafety = 0.3,
  steadyTol = 1e-5,
  divergenceTol = 1e-7,
  omega = 1.97,
  maxTime = 400,
}) {
  const key = `${Re}:${w}:${cpw}:${legLen}:${innerRadius}:${U0}:${dtSafety}:${steadyTol}`;
  if (cache.has(key)) return cache.get(key);

  const b = buildBend({ w, cpw, legLen, innerRadius });
  const { grid, h, nx, ny } = b;
  const nu = (U0 * w) / Re;

  const bc = bendBoundary(U0);

  // The timestep has to allow for the flow accelerating through the bend, not
  // just the inlet speed. Estimating the peak at 2*U0 puts the CFL number at
  // 0.86 by the time the corner jet develops, and the run diverges; the peak
  // actually reaches about 2.9*U0. Sizing against 4*U0 keeps CFL near 0.14.
  // Adaptive timestep control is M1 - this just picks a safe fixed value.
  const dt = dtSafety * Math.min((0.25 * h * h) / nu, h / (4 * U0));
  const params = { nu, rho, dt, divergenceTol, omega, poissonMaxIterations: 20000 };

  const WINDOW = 200;
  const snapshot = new Float64Array(grid.u.length);
  snapshot.set(grid.u);
  const maxSteps = Math.ceil(maxTime / dt);

  let t = 0;
  let steps = 0;
  let rate = Infinity;
  let poissonConvergedEverywhere = true;

  while (steps < maxSteps) {
    const r = step(grid, bc, params);
    if (!r.poissonConverged) poissonConvergedEverywhere = false;
    t += dt;
    steps++;
    if (steps % WINDOW === 0) {
      let m = 0;
      for (let k = 0; k < grid.u.length; k++) {
        const d = Math.abs(grid.u[k] - snapshot[k]);
        if (!(d <= m)) m = d;
      }
      rate = m / (WINDOW * dt);
      snapshot.set(grid.u);
      if (rate < steadyTol) break;
    }
  }

  const result = {
    ...b, Re, nu, rho, U0, dt, t, steps, rate,
    reachedSteady: rate < steadyTol,
    poissonConvergedEverywhere,
    divergence: computeDivergence(grid),
    cellReynolds: h / nu,
  };
  cache.set(key, result);
  return result;
}

// Separation bubble on the inner wall of the outlet leg, located by the two
// sign changes of the wall-adjacent vertical velocity: the flow leaves the
// wall where v turns positive (reversed, since the bulk flow runs downward)
// and reattaches where it turns negative again. Both crossings are
// interpolated. The bubble does not start exactly at the corner, so anchoring
// the measurement there would miss it entirely.
export function separationBubble(run) {
  const { grid, h, w, Lx, Ly, ny, U0 } = run;
  const iInner = Math.round((Lx - w) / h) + 1;

  const s = [];
  const v = [];
  for (let j = ny; j >= 1; j--) {
    const y = (j - 0.5) * h;
    if (y > Ly - w) continue;
    const k = grid.idx(iInner, j);
    if (grid.solid[k] || grid.solid[grid.idx(iInner, j + 1)]) continue;
    s.push(Ly - w - y);
    v.push(grid.v[k]);
  }

  let peakReverse = 0;
  for (const value of v) if (value > peakReverse) peakReverse = value;

  let sep = -1;
  for (let k = 1; k < v.length; k++) {
    if (v[k] > 0 && v[k - 1] <= 0) { sep = k; break; }
  }
  if (sep < 0) {
    return { separated: false, lengthOverW: 0, peakReverse: peakReverse / U0 };
  }
  let att = -1;
  for (let k = sep + 1; k < v.length; k++) {
    if (v[k] < 0 && v[k - 1] >= 0) { att = k; break; }
  }

  const cross = (k) => s[k - 1] + (s[k] - s[k - 1]) * (-v[k - 1] / (v[k] - v[k - 1]));
  const start = cross(sep);
  const end = att > 0 ? cross(att) : s[s.length - 1];
  return {
    separated: true,
    lengthOverW: (end - start) / w,
    startOverW: start / w,
    reattached: att > 0,
    peakReverse: peakReverse / U0,
  };
}

// Pressure on the outer and inner walls of the bend, sampled by walking the
// 45-degree diagonal inward from the domain corner: the first fluid cell met
// lies against the outer wall, the last one before solid lies against the
// inner wall. Walking the diagonal rather than probing fixed points keeps
// this valid for both the square outer corner and the rounded one.
export function bendWallPressures(run) {
  const { grid, h, Lx, Ly, nx, ny } = run;
  let outer = NaN;
  let inner = NaN;
  const steps = Math.round(Math.hypot(Lx, Ly) / h);
  for (let n = 0; n < steps; n++) {
    const d = n * h * Math.SQRT1_2;
    const x = Lx - d;
    const y = Ly - d;
    if (x <= 0 || y <= 0) break;
    const i = Math.round(x / h + 0.5);
    const j = Math.round(y / h + 0.5);
    if (i < 1 || i > nx || j < 1 || j > ny) continue;
    const k = grid.idx(i, j);
    if (grid.solid[k]) {
      if (Number.isFinite(outer)) break; // passed through the channel
      continue; // still in the filled outer corner of a rounded bend
    }
    if (!Number.isFinite(outer)) outer = grid.p[k];
    inner = grid.p[k];
  }
  return { inner, outer, difference: outer - inner };
}

// Where the peak speed sits across the outlet leg, as a fraction of the way
// from the inner wall to the outer wall. 0.5 is a centred profile; larger
// means the flow has been thrown toward the outside of the bend.
export function outletProfilePeakPosition(run, belowBend = 1.0) {
  const { grid, h, w, Lx, Ly, nx } = run;
  const j = Math.round((Ly - w - belowBend * w) / h);
  let best = 0;
  let bestX = NaN;
  for (let i = 1; i <= nx; i++) {
    const k = grid.idx(i, j);
    if (grid.solid[k] || grid.solid[grid.idx(i, j + 1)]) continue;
    const speed = Math.abs(grid.v[k]);
    if (speed > best) { best = speed; bestX = (i - 0.5) * h; }
  }
  return (bestX - (Lx - w)) / w;
}

// Comparison of the inlet leg against exact plane Poiseuille flow. With a
// uniform inlet of speed U0 across width w the mean velocity is U0, so the
// developed profile is 1.5*U0*(1 - (2(y-yc)/w)^2) and the streamwise pressure
// gradient is -12*mu*U0/w^2.
export function poiseuilleComparison(run, xStation) {
  const { grid, h, w, Ly, ny, nu, rho, U0 } = run;
  const i = Math.round(xStation / h);
  const yc = Ly - w / 2;

  let maxProfileError = 0;
  let peak = 0;
  for (let j = 1; j <= ny; j++) {
    const k = grid.idx(i, j);
    if (grid.solid[k] || grid.solid[grid.idx(i + 1, j)]) continue;
    const y = (j - 0.5) * h;
    const exact = 1.5 * U0 * (1 - ((y - yc) / (w / 2)) ** 2);
    maxProfileError = Math.max(maxProfileError, Math.abs(grid.u[k] - exact));
    peak = Math.max(peak, grid.u[k]);
  }

  const jc = Math.round(yc / h + 0.5);
  const i1 = Math.round((xStation - 0.5 * w) / h);
  const i2 = Math.round((xStation + 0.5 * w) / h);
  const dpdx = (grid.p[grid.idx(i2, jc)] - grid.p[grid.idx(i1, jc)]) / ((i2 - i1) * h);
  const dpdxExact = (-12 * rho * nu * U0) / (w * w);

  return {
    maxProfileError, peak, peakExact: 1.5 * U0,
    dpdx, dpdxExact,
    dpdxRelativeError: Math.abs(dpdx - dpdxExact) / Math.abs(dpdxExact),
  };
}

// Volume flux through cuts across the inlet leg (vertical cuts) and the outlet
// leg (horizontal cuts). Steady incompressible flow through a duct passes the
// same volume through every station of both legs.
export function fluxThroughLegs(run) {
  const { grid, h, w, Lx, Ly, nx, ny, U0 } = run;
  const expected = U0 * w;
  let worst = 0;
  let cuts = 0;

  for (let i = 1; i < nx; i++) {
    if ((i - 0.5) * h > Lx - w) break; // past the bend
    let q = 0;
    let any = false;
    for (let j = 1; j <= ny; j++) {
      const k = grid.idx(i, j);
      if (grid.solid[k] || grid.solid[grid.idx(i + 1, j)]) continue;
      q += grid.u[k] * h;
      any = true;
    }
    if (any) { worst = Math.max(worst, Math.abs(q - expected)); cuts++; }
  }

  for (let j = 1; j < ny; j++) {
    if ((j - 0.5) * h > Ly - w) break;
    let q = 0;
    let any = false;
    for (let i = 1; i <= nx; i++) {
      const k = grid.idx(i, j);
      if (grid.solid[k] || grid.solid[grid.idx(i, j + 1)]) continue;
      q += -grid.v[k] * h;
      any = true;
    }
    if (any) { worst = Math.max(worst, Math.abs(q - expected)); cuts++; }
  }

  return { expected, maxDeviation: worst, relative: worst / expected, cuts };
}

export function maxVelocityOnSolidSurface(run) {
  const { grid, nx, ny } = run;
  let m = 0;
  for (let j = 1; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      if (grid.solid[grid.idx(i, j)] !== grid.solid[grid.idx(i + 1, j)]) {
        m = Math.max(m, Math.abs(grid.u[grid.idx(i, j)]));
      }
    }
  }
  for (let i = 1; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      if (grid.solid[grid.idx(i, j)] !== grid.solid[grid.idx(i, j + 1)]) {
        m = Math.max(m, Math.abs(grid.v[grid.idx(i, j)]));
      }
    }
  }
  return m;
}
