// Simulation configurations for the harness.
//
// This is the "simulation configuration" layer: it turns a named scenario into
// a grid, a boundary-condition descriptor and solver parameters. It sits
// between the UI and the geometry/solver layers so that neither the UI knows
// how to build a grid nor the solver knows what a "bend" is.
//
// These mirror the validated cases in /tests. They are written out here rather
// than imported from the test suite because a harness depending on test
// support code is the wrong direction - but that does mean the two can drift.
// Anything changed here is no longer the configuration that was validated.

import { StaggeredGrid, stampCircle, stampWhere } from "../geometry/grid.js";

// Timestep from the explicit stability limits of the scheme: the diffusive
// limit nu*dt/h^2 < 1/4 and the convective limit |u|*dt/h < 1, with a safety
// factor and an allowance for the flow accelerating above the inlet speed.
// Adaptive timestep control is M1; this picks a safe fixed value and reports it.
function stableTimestep(h, nu, peakSpeed, safety) {
  return safety * Math.min((0.25 * h * h) / nu, h / peakSpeed);
}

function lidDrivenCavity() {
  const n = 64;
  const U = 1;
  const Re = 1000;
  const h = 1 / n;
  const nu = U / Re;
  const grid = new StaggeredGrid(n, n, h);
  return {
    id: "cavity",
    label: "Lid-driven cavity (Re 1000)",
    note: "Test 4 - the benchmark gate. Top lid slides right; three no-slip walls.",
    grid,
    bc: {
      left: { type: "wall" },
      right: { type: "wall" },
      bottom: { type: "wall" },
      top: { type: "wall", u: U },
    },
    params: { nu, rho: 1, dt: stableTimestep(h, nu, U, 0.65), divergenceTol: 1e-7 },
    Re,
  };
}

function cylinderInChannel() {
  const D = 1;
  const cpd = 12;
  const h = D / cpd;
  const U = 1;
  const Re = 100;
  const nu = (U * D) / Re;
  let ny = Math.round(6 * cpd);
  if (ny % 2 === 0) ny += 1;
  const nx = Math.round(14 * cpd);
  const grid = new StaggeredGrid(nx, ny, h);
  const jc = (ny + 1) / 2;
  stampCircle(grid, (Math.round(3.5 / h + 0.5) - 0.5) * h, (jc - 0.5) * h, D / 2);
  for (let j = 0; j <= ny + 1; j++) {
    for (let i = 0; i <= nx + 1; i++) {
      if (!grid.solid[grid.idx(i, j)]) grid.u[grid.idx(i, j)] = U;
    }
  }
  return {
    id: "cylinder",
    label: "Flow past a cylinder (Re 100)",
    note: "Test 5 - uniform inflow, free-slip channel walls, open outflow.",
    grid,
    bc: {
      left: { type: "inflow", u: U, v: 0 },
      right: { type: "outflow" },
      top: { type: "freeSlip" },
      bottom: { type: "freeSlip" },
    },
    params: { nu, rho: 1, dt: stableTimestep(h, nu, 2 * U, 0.6), divergenceTol: 1e-7, omega: 1.97 },
    Re,
  };
}

function channelBend({ innerRadius, id, label, note, Re = 200 }) {
  const w = 1;
  const cpw = 12;
  const legLen = 6;
  const h = w / cpw;
  const U = 1;
  const nu = (U * w) / Re;
  const Lx = legLen * w + w;
  const Ly = Lx;
  const nx = Math.round(Lx / h);
  const ny = Math.round(Ly / h);
  const grid = new StaggeredGrid(nx, ny, h);

  const isSolid =
    innerRadius === null
      ? (x, y) => x < Lx - w && y < Ly - w
      : (x, y) => {
          const ri = innerRadius;
          const ro = ri + w;
          const cx = Lx - ro;
          const cy = Ly - ro;
          if (x >= cx && y >= cy) {
            const d = Math.hypot(x - cx, y - cy);
            return d < ri || d > ro;
          }
          if (x < cx) return y < Ly - w;
          return x < Lx - w;
        };
  stampWhere(grid, isSolid);

  return {
    id,
    label,
    note,
    grid,
    bc: {
      left: { type: "inflow", u: U, v: 0 },
      right: { type: "wall" },
      top: { type: "wall" },
      bottom: { type: "outflow" },
    },
    // 4*U0 rather than 2*U0: the flow accelerates to about 2.9*U0 through the
    // bend, and sizing against 2*U0 puts CFL at 0.86 and diverges.
    params: { nu, rho: 1, dt: stableTimestep(h, nu, 4 * U, 0.3), divergenceTol: 1e-7, omega: 1.97 },
    Re,
  };
}

// Labels are carried on the entry rather than read out of a built scenario, so
// listing the menu does not mean allocating four grids and stamping four masks.
export const SCENARIOS = [
  {
    id: "bend-sharp",
    label: "Sharp 90 degree bend (Re 200)",
    build: () =>
      channelBend({
        innerRadius: null,
        id: "bend-sharp",
        label: "Sharp 90 degree bend (Re 200)",
        note: "Test 6 - mitre bend. Separates off the inner corner.",
      }),
  },
  {
    id: "bend-smooth",
    label: "Smooth 90 degree bend (Re 200)",
    build: () =>
      channelBend({
        innerRadius: 1,
        id: "bend-smooth",
        label: "Smooth 90 degree bend (Re 200)",
        note: "Test 6 - same duct width, inner corner radiused. Separation suppressed.",
      }),
  },
  { id: "cylinder", label: "Flow past a cylinder (Re 100)", build: cylinderInChannel },
  { id: "cavity", label: "Lid-driven cavity (Re 1000)", build: lidDrivenCavity },
];

export const DEFAULT_SCENARIO = "bend-sharp";

export function buildScenario(id) {
  const entry = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
  return entry.build();
}
