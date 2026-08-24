// M0 Test 2 - Constant channel flow.
//
// Uniform plug flow (u = U0, v = 0) through a straight channel: prescribed
// inflow/outflow velocity at the left/right ends, free-slip top/bottom walls
// (no wall friction). A uniform field with no-penetration, zero-gradient
// walls is an exact fixed point of the momentum equation - it should stay
// uniform, and mass conservation (div u = 0) should hold throughout.
//
// Free-slip (rather than no-slip) walls are deliberate: no-slip would
// immediately grow a boundary layer, which is what Test 3 (viscous
// diffusion) and Test 4 (lid-driven cavity) are for. Test 2 isolates
// whether the projection step conserves a uniform flow correctly.

import test from "node:test";
import assert from "node:assert/strict";
import { StaggeredGrid } from "../geometry/grid.js";
import { step, computeDivergence } from "../solver/ns2d.js";

test("Test 2 - constant channel flow stays uniform", () => {
  const nx = 40;
  const ny = 10;
  const h = 0.05;
  const U0 = 1.0;
  const grid = new StaggeredGrid(nx, ny, h);

  for (let j = 0; j <= ny + 1; j++) {
    for (let i = 0; i <= nx + 1; i++) {
      grid.u[grid.idx(i, j)] = U0;
      grid.v[grid.idx(i, j)] = 0;
    }
  }

  const bc = {
    left: { type: "inflow", u: U0, v: 0 },
    right: { type: "inflow", u: U0, v: 0 },
    top: { type: "freeSlip" },
    bottom: { type: "freeSlip" },
  };
  // CFL: U0*dt/h = 0.2, diffusion number nu*dt/h^2 = 0.004 - both well
  // inside the explicit stability limits.
  const params = { nu: 1e-3, rho: 1000, dt: 0.01 };

  const steps = 100;
  let worstDiv = 0;
  let lastResult;

  for (let n = 0; n < steps; n++) {
    lastResult = step(grid, bc, params);
    worstDiv = Math.max(worstDiv, computeDivergence(grid).max);
  }

  let maxUDeviation = 0;
  for (let j = 1; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      maxUDeviation = Math.max(maxUDeviation, Math.abs(grid.u[grid.idx(i, j)] - U0));
    }
  }
  let maxV = 0;
  for (const val of grid.v) maxV = Math.max(maxV, Math.abs(val));

  const finalDiv = computeDivergence(grid);

  console.log(
    `[Test 2] after ${steps} steps: max|u-U0|=${maxUDeviation.toExponential(3)} ` +
    `max|v|=${maxV.toExponential(3)} final max|div|=${finalDiv.max.toExponential(3)} ` +
    `worst max|div| over run=${worstDiv.toExponential(3)} ` +
    `poisson iterations (last step)=${lastResult.poissonIterations}`
  );

  assert.ok(maxUDeviation < 1e-6, `uniform channel flow should stay at u=U0, got max deviation=${maxUDeviation}`);
  assert.ok(maxV < 1e-6, `uniform channel flow should keep v=0, got max|v|=${maxV}`);
  assert.ok(worstDiv < 1e-6, `divergence should stay near 0, got max|div|=${worstDiv}`);
});
