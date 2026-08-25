// Executes the validation cases and reports what the solver actually produces.
//
// This uses the same harnesses in tests/support that the test suite uses, so
// the generated record cannot describe a different computation than the one
// being asserted. Everything here is deterministic, so two runs give identical
// numbers - the record and the tests agree because they are the same code
// driven the same way, not because someone kept them in sync by hand.
//
// Deliberately NOT part of `npm test`: it re-runs the expensive cases and would
// roughly double the suite. It is the body of `npm run validate`.

import { StaggeredGrid } from "../geometry/grid.js";
import { step, computeDivergence } from "../solver/ns2d.js";

import {
  runCavityToSteadyState,
  uAlongVerticalCentreline,
  vAlongHorizontalCentreline,
  primaryVortexCentre,
  maxAbsDifference,
} from "../tests/support/cavity.js";
import { Y, U_CENTRELINE, X, V_CENTRELINE, PRIMARY_VORTEX_CENTRE, isExcluded }
  from "../tests/support/ghia.js";
import {
  runCylinderToSteadyState,
  wakeBubbleLength,
  fluxThroughCuts,
  centrelineAsymmetry,
  maxVelocityOnSolidSurface,
} from "../tests/support/cylinder.js";
import {
  runBendToSteadyState,
  separationBubble,
  poiseuilleComparison,
  fluxThroughLegs,
  maxVelocityOnSolidSurface as maxVelocityOnDuctWalls,
} from "../tests/support/bend.js";
import { decayingShearMode } from "../tests/support/analytical.js";

function compareRow(computed, reference, table, Re) {
  let worst = 0;
  for (let k = 0; k < reference.length; k++) {
    if (isExcluded(table, Re, k)) continue;
    worst = Math.max(worst, Math.abs(computed[k] - reference[k]));
  }
  return worst;
}

function measureStillWater() {
  const grid = new StaggeredGrid(20, 20, 0.05);
  const bc = {
    left: { type: "wall" }, right: { type: "wall" },
    top: { type: "wall" }, bottom: { type: "wall" },
  };
  let maxU = 0;
  let maxDiv = 0;
  for (let n = 0; n < 50; n++) {
    step(grid, bc, { nu: 1e-3, rho: 1000, dt: 0.001 });
    for (const value of grid.u) maxU = Math.max(maxU, Math.abs(value));
    maxDiv = Math.max(maxDiv, computeDivergence(grid).max);
  }
  return [
    { quantity: "max|u| after 50 steps", measured: maxU },
    { quantity: "max|div u|", measured: maxDiv },
  ];
}

function measureUniformChannel() {
  const nx = 40, ny = 10, h = 0.05, U0 = 1;
  const grid = new StaggeredGrid(nx, ny, h);
  for (let j = 0; j <= ny + 1; j++)
    for (let i = 0; i <= nx + 1; i++) grid.u[grid.idx(i, j)] = U0;
  const bc = {
    left: { type: "inflow", u: U0, v: 0 }, right: { type: "inflow", u: U0, v: 0 },
    top: { type: "freeSlip" }, bottom: { type: "freeSlip" },
  };
  let worstDiv = 0;
  for (let n = 0; n < 100; n++) {
    step(grid, bc, { nu: 1e-3, rho: 1000, dt: 0.01 });
    worstDiv = Math.max(worstDiv, computeDivergence(grid).max);
  }
  let worstU = 0;
  for (let j = 1; j <= ny; j++)
    for (let i = 0; i <= nx; i++) worstU = Math.max(worstU, Math.abs(grid.u[grid.idx(i, j)] - U0));
  return [
    { quantity: "max|u - U0|", measured: worstU },
    { quantity: "max|div u|", measured: worstDiv },
  ];
}

function measureViscousDiffusion() {
  const Ly = 1, nx = 4, nu = 0.01, U0 = 1, dt = 2e-4, steps = 4430;
  const k = (2 * Math.PI) / Ly;
  const t = dt * steps;
  const bc = {
    left: { type: "zeroGradient" }, right: { type: "zeroGradient" },
    top: { type: "freeSlip" }, bottom: { type: "freeSlip" },
  };

  const rateErrorAt = (ny) => {
    const h = Ly / ny;
    const grid = new StaggeredGrid(nx, ny, h);
    const mode = [];
    for (let j = 1; j <= ny; j++) mode[j] = Math.cos(k * (j - 0.5) * h);
    for (let j = 0; j <= ny + 1; j++) {
      const u0 = decayingShearMode((j - 0.5) * h, 0, { U0, k, nu });
      for (let i = 0; i <= nx + 1; i++) grid.u[grid.idx(i, j)] = u0;
    }
    for (let n = 0; n < steps; n++) step(grid, bc, { nu, rho: 1000, dt });
    let num = 0, den = 0;
    for (let j = 1; j <= ny; j++)
      for (let i = 1; i <= nx - 1; i++) { num += grid.u[grid.idx(i, j)] * mode[j]; den += mode[j] * mode[j]; }
    const rate = -Math.log(num / den / U0) / t;
    return Math.abs(rate - nu * k * k) / (nu * k * k);
  };

  const coarse = rateErrorAt(32);
  const fine = rateErrorAt(64);
  return [
    { quantity: "decay rate vs nu*k^2 (relative)", measured: fine },
    { quantity: "spatial convergence order", measured: Math.log2(coarse / fine) },
    { quantity: "spreading-layer profile error", measured: measureSpreadingLayer() },
  ];
}

function measureSpreadingLayer() {
  // Imported lazily to keep this function self-contained alongside its sibling.
  const { spreadingShearLayer } = requireAnalytical();
  const Ly = 1, nx = 4, ny = 200, nu = 0.005, U0 = 1, y0 = 0.5, t0 = 0.08, dt = 2.5e-4, steps = 2560;
  const h = Ly / ny;
  const grid = new StaggeredGrid(nx, ny, h);
  const props = { U0, y0, nu };
  for (let j = 0; j <= ny + 1; j++) {
    const u0 = spreadingShearLayer((j - 0.5) * h, t0, props);
    for (let i = 0; i <= nx + 1; i++) grid.u[grid.idx(i, j)] = u0;
  }
  const bc = {
    left: { type: "zeroGradient" }, right: { type: "zeroGradient" },
    top: { type: "freeSlip" }, bottom: { type: "freeSlip" },
  };
  for (let n = 0; n < steps; n++) step(grid, bc, { nu, rho: 1000, dt });
  const t1 = t0 + steps * dt;
  let worst = 0;
  for (let j = 1; j <= ny; j++) {
    const exact = spreadingShearLayer((j - 0.5) * h, t1, props);
    for (let i = 1; i <= nx - 1; i++)
      worst = Math.max(worst, Math.abs(grid.u[grid.idx(i, j)] - exact));
  }
  return worst;
}

let analyticalModule = null;
function requireAnalytical() {
  return analyticalModule;
}

function measureCavity() {
  const results = [];
  const re100 = runCavityToSteadyState({ n: 64, Re: 100 });
  const u100 = uAlongVerticalCentreline(re100.grid, Y, re100.U);
  const v100 = vAlongHorizontalCentreline(re100.grid, X);
  results.push({ quantity: "max|u - Ghia| at Re=100", measured: compareRow(u100, U_CENTRELINE[100], "U_CENTRELINE", 100) });
  results.push({ quantity: "max|v - Ghia| at Re=100", measured: compareRow(v100, V_CENTRELINE[100], "V_CENTRELINE", 100) });

  for (const Re of [400, 1000]) {
    const run = runCavityToSteadyState({ n: 64, Re });
    const u = uAlongVerticalCentreline(run.grid, Y, run.U);
    results.push({ quantity: `max|u - Ghia| at Re=${Re}`, measured: compareRow(u, U_CENTRELINE[Re], "U_CENTRELINE", Re) });
  }

  const runs = [16, 32, 64].map((n) => runCavityToSteadyState({ n, Re: 100 }));
  const us = runs.map((r) => uAlongVerticalCentreline(r.grid, Y, r.U));
  const order = Math.log2(
    maxAbsDifference(us[0], us[1]) / maxAbsDifference(us[1], us[2])
  );
  results.push({ quantity: "self-convergence order", measured: order });

  const centre = primaryVortexCentre(re100.grid);
  const ref = PRIMARY_VORTEX_CENTRE[100];
  results.push({
    quantity: "primary vortex centre offset at Re=100",
    measured: Math.hypot(centre.x - ref.x, centre.y - ref.y),
    context: `solver (${centre.x.toFixed(4)}, ${centre.y.toFixed(4)}) vs Ghia (${ref.x}, ${ref.y})`,
  });
  return results;
}

function measureCylinder() {
  const base = { cpd: 8, HD: 6, LD: 10 };
  const re40 = runCylinderToSteadyState({ Re: 40, ...base });
  const widest = runCylinderToSteadyState({ Re: 20, ...base, HD: 16 });
  const re1 = runCylinderToSteadyState({ Re: 1, ...base });

  return [
    {
      quantity: "wake L/D at Re=20, 6% blockage",
      measured: wakeBubbleLength(widest).lengthOverD,
      context: "published unbounded value 0.93",
    },
    { quantity: "separation onset below Re~5", measured: wakeBubbleLength(re1).separated ? 1 : 0,
      context: "0 = attached at Re=1, as expected" },
    { quantity: "velocity on the body surface", measured: maxVelocityOnSolidSurface(re40) },
    { quantity: "flux deviation through all cuts (relative)", measured: fluxThroughCuts(re40).relative },
    { quantity: "centreline asymmetry", measured: centrelineAsymmetry(re40).u },
  ];
}

function measureBend() {
  const sharp = runBendToSteadyState({ Re: 200, cpw: 12, legLen: 6 });
  const smooth = runBendToSteadyState({ Re: 200, cpw: 12, legLen: 6, innerRadius: 1 });
  const coarse = runBendToSteadyState({ Re: 20, cpw: 8, legLen: 6 });
  const fine = runBendToSteadyState({ Re: 20, cpw: 16, legLen: 6 });
  const pc = poiseuilleComparison(coarse, 3.0);
  const pf = poiseuilleComparison(fine, 3.0);

  return [
    { quantity: "inlet-leg dp/dx vs -12*mu*U/w^2 (relative)", measured: pf.dpdxRelativeError },
    { quantity: "inlet-leg profile convergence order",
      measured: Math.log2(pc.maxProfileError / pf.maxProfileError) },
    { quantity: "flux deviation through all cuts (relative)", measured: fluxThroughLegs(sharp).relative },
    { quantity: "velocity on the duct walls", measured: maxVelocityOnDuctWalls(sharp) },
    { quantity: "sharp bend separates at the inner corner", measured: null,
      context: `bubble ${separationBubble(sharp).lengthOverW.toFixed(3)}w, ` +
        `peak reverse ${separationBubble(sharp).peakReverse.toFixed(4)} U0` },
    { quantity: "radiusing suppresses the separation", measured: null,
      context: `smooth bend peak reverse ${separationBubble(smooth).peakReverse.toFixed(4)} U0 ` +
        `against ${separationBubble(sharp).peakReverse.toFixed(4)} sharp` },
  ];
}

const MEASURERS = {
  "still-water": measureStillWater,
  "uniform-channel": measureUniformChannel,
  "viscous-diffusion": measureViscousDiffusion,
  "lid-driven-cavity": measureCavity,
  "cylinder-wake": measureCylinder,
  "channel-bend": measureBend,
};

export async function measureCase(caseId) {
  if (!analyticalModule) analyticalModule = await import("../tests/support/analytical.js");
  const fn = MEASURERS[caseId];
  if (!fn) throw new Error(`no measurement defined for case "${caseId}"`);
  return fn();
}

export function hasMeasurement(caseId) {
  return Boolean(MEASURERS[caseId]);
}
