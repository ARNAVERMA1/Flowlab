// M0 Test 1 - Still water.
//
// Initialize u = v = 0 in a closed box (no-slip walls on all four sides,
// no forcing). u = 0 is an exact fixed point of the momentum equation, so
// nothing should ever perturb it: this is the fastest way to catch a solver
// that manufactures numerical garbage out of nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { StaggeredGrid } from "../geometry/grid.js";
import { step, computeDivergence } from "../solver/ns2d.js";

test("Test 1 - still water stays still", () => {
  const nx = 20;
  const ny = 20;
  const h = 0.05;
  const grid = new StaggeredGrid(nx, ny, h);
  // u, v, p start at zero by construction (Float64Array default fill).

  const bc = {
    left: { type: "wall" },
    right: { type: "wall" },
    top: { type: "wall" },
    bottom: { type: "wall" },
  };
  const params = { nu: 1e-3, rho: 1000, dt: 0.001 };

  const steps = 50;
  let maxU = 0;
  let maxV = 0;
  let maxDiv = 0;

  for (let n = 0; n < steps; n++) {
    step(grid, bc, params);
    for (const val of grid.u) maxU = Math.max(maxU, Math.abs(val));
    for (const val of grid.v) maxV = Math.max(maxV, Math.abs(val));
    maxDiv = Math.max(maxDiv, computeDivergence(grid).max);
  }

  console.log(
    `[Test 1] after ${steps} steps: max|u|=${maxU.toExponential(3)} ` +
    `max|v|=${maxV.toExponential(3)} max|div|=${maxDiv.toExponential(3)}`
  );

  assert.ok(maxU < 1e-10, `still water should stay at u=0, got max|u|=${maxU}`);
  assert.ok(maxV < 1e-10, `still water should stay at v=0, got max|v|=${maxV}`);
  assert.ok(maxDiv < 1e-10, `divergence should stay ~0, got max|div|=${maxDiv}`);
});
