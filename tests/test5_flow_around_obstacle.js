// M0 Test 5 - Flow around an obstacle.
//
// A fixed circular cylinder in a channel: uniform inflow, open outflow,
// free-slip channel walls. This is the first test with an interior solid
// boundary, so it exercises machinery none of Tests 1-4 touch - the obstacle
// mask, no-slip on a surface inside the domain, exclusion of solid cells
// from the pressure solve, and an outflow condition that has to conserve
// mass globally.
//
// There is no single published table to check against the way Test 4 has
// Ghia et al., so validation here rests on three independent legs:
//
//   1. Exact structural invariants. Mass flux through every vertical cut must
//      equal the inlet flux, the velocity on the cylinder surface must be
//      exactly zero, and a symmetric problem must produce a symmetric answer.
//      These are not tolerances chosen to pass - they either hold to roundoff
//      or the obstacle treatment is wrong.
//   2. The separation regime. A circular cylinder does not separate below
//      Re ~ 5, and above it carries a standing recirculation bubble that
//      lengthens with Reynolds number.
//   3. The wake bubble length against published measurements for an
//      unbounded cylinder, which requires accounting for channel blockage -
//      see the confinement test at the bottom.
//
// Free-slip walls are used rather than no-slip so the channel does not grow
// its own boundary layers, which would add a second confinement effect on
// top of the blockage one being measured.

import test from "node:test";
import assert from "node:assert/strict";
import {
  runCylinderToSteadyState,
  wakeBubbleLength,
  peakReverseVelocity,
  peakSpeed,
  fluxThroughCuts,
  centrelineAsymmetry,
  maxVelocityOnSolidSurface,
  stagnationPressureDifference,
} from "./support/cylinder.js";

// Published recirculation lengths for a cylinder in an unbounded stream,
// measured from the rear of the cylinder and scaled by diameter. Sources
// differ by a few percent (Coutanceau & Bouard 1977 and Tritton 1959 are the
// usual references); the spread is part of why the assertions below are
// bands rather than point comparisons.
const PUBLISHED_WAKE_LENGTH = { 20: 0.93, 40: 2.3 };

const BASE = { cpd: 8, HD: 6, LD: 10 };

test("Test 5 - the obstacle is enforced exactly", () => {
  const run = runCylinderToSteadyState({ Re: 40, ...BASE });
  const flux = fluxThroughCuts(run);
  const asym = centrelineAsymmetry(run);
  const surface = maxVelocityOnSolidSurface(run);

  console.log(
    `[Test 5 structure] Re=40, ${run.nx}x${run.ny}, ${run.solidCells} solid cells, ` +
    `blockage ${(run.blockage * 100).toFixed(1)}%\n` +
    `          steady at t=${run.t.toFixed(1)} after ${run.steps} steps\n` +
    `          max|velocity| on the cylinder surface = ${surface.toExponential(2)}\n` +
    `          max|div u| = ${run.divergence.max.toExponential(2)}\n` +
    `          inlet flux = ${flux.inlet.toFixed(6)}, worst deviation across all ` +
    `${run.nx + 1} vertical cuts = ${flux.maxDeviation.toExponential(2)} ` +
    `(${flux.relative.toExponential(2)} relative)\n` +
    `          asymmetry about the centreline: u=${asym.u.toExponential(2)} v=${asym.v.toExponential(2)}`
  );

  assert.ok(run.reachedSteady, `flow did not reach steady state (rate=${run.rate})`);
  assert.ok(run.poissonConvergedEverywhere, "pressure solve failed to converge on some step");

  // No-penetration and no-slip on the body. Faces on the surface are held at
  // exactly zero, so this is an equality check, not a tolerance.
  assert.equal(surface, 0, `velocity on the cylinder surface must be exactly 0, got ${surface}`);

  assert.ok(run.divergence.max < 1e-6, `max|div u| = ${run.divergence.max}`);

  // Steady incompressible flow past a solid body: the same volume passes
  // every station. This is the check that the obstacle is not silently
  // creating or destroying fluid.
  assert.ok(
    flux.relative < 1e-7,
    `flux must be conserved through every cut, worst relative deviation ${flux.relative}`
  );

  // Symmetric geometry and boundary conditions must give a symmetric answer.
  assert.ok(
    asym.u < 1e-9 && asym.v < 1e-9,
    `solution should be symmetric about the centreline, got u=${asym.u} v=${asym.v}`
  );
});

test("Test 5 - separation appears at the right Reynolds number", () => {
  const runs = [1, 20, 40].map((Re) => runCylinderToSteadyState({ Re, ...BASE }));
  const wakes = runs.map(wakeBubbleLength);

  console.log("[Test 5 separation] standing recirculation behind the cylinder:");
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k];
    const w = wakes[k];
    console.log(
      `          Re=${String(r.Re).padStart(3)}  separated=${String(w.separated).padEnd(5)} ` +
      `L/D=${w.lengthOverD.toFixed(4)}  peak reverse velocity=${peakReverseVelocity(r).toFixed(4)} U0  ` +
      `peak speed=${peakSpeed(r).toFixed(4)} U0  dp(front-rear)=${stagnationPressureDifference(r).toFixed(5)}`
    );
  }

  // Below the separation threshold (Re ~ 5 for a circular cylinder) the flow
  // stays attached: no reversed flow anywhere on the centreline.
  assert.equal(wakes[0].separated, false, "Re=1 flow should stay attached, no recirculation");
  assert.equal(peakReverseVelocity(runs[0]), 0, "Re=1 should have no reversed flow at all");

  // Above it, a standing bubble that grows with Reynolds number.
  assert.ok(wakes[1].separated, "Re=20 should have a recirculation bubble");
  assert.ok(wakes[2].separated, "Re=40 should have a recirculation bubble");
  assert.ok(
    wakes[2].lengthOverD > wakes[1].lengthOverD,
    `wake should lengthen with Re, got ${wakes[1].lengthOverD} at Re=20 and ${wakes[2].lengthOverD} at Re=40`
  );
  assert.ok(
    Math.abs(peakReverseVelocity(runs[2])) > Math.abs(peakReverseVelocity(runs[1])),
    "reverse flow should strengthen with Re"
  );

  // The flow accelerates past the body, and the upstream face carries the
  // higher pressure - the pressure signature of form drag.
  for (const r of runs.slice(1)) {
    assert.ok(peakSpeed(r) > r.U0, `Re=${r.Re}: flow should accelerate past the cylinder`);
    assert.ok(
      stagnationPressureDifference(r) > 0,
      `Re=${r.Re}: pressure should be higher in front of the cylinder than behind`
    );
  }
});

test("Test 5 - wake length approaches published values as confinement is reduced", () => {
  // The wake bubble measured in a channel is shorter than the published
  // unbounded value, because the walls squeeze the flow past the body. That
  // is physics, not solver error, and the way to show it is to widen the
  // channel and watch the number move.
  const heights = [6, 10, 16];
  const runs = heights.map((HD) => runCylinderToSteadyState({ Re: 20, ...BASE, HD }));
  const lengths = runs.map((r) => wakeBubbleLength(r).lengthOverD);
  const published = PUBLISHED_WAKE_LENGTH[20];

  console.log("[Test 5 confinement] Re=20 wake length vs channel blockage:");
  for (let k = 0; k < runs.length; k++) {
    console.log(
      `          channel ${String(heights[k]).padStart(2)}D tall, blockage ` +
      `${(runs[k].blockage * 100).toFixed(1).padStart(4)}%  ->  L/D=${lengths[k].toFixed(4)}`
    );
  }
  console.log(
    `          published unbounded value: L/D=${published}  ` +
    `(widest channel here is ${(((lengths[2] - published) / published) * 100).toFixed(1)}% off)`
  );

  for (let k = 1; k < lengths.length; k++) {
    assert.ok(
      lengths[k] > lengths[k - 1],
      `wake should lengthen as blockage falls, got ${lengths[k - 1]} then ${lengths[k]}`
    );
  }

  // At the widest channel the remaining difference is small. Two effects
  // still work against each other here: residual blockage shortens the wake,
  // and the coarse staircase cylinder on this grid overestimates it by a few
  // percent (see the grid-refinement test below). 15% covers both with room.
  const error = Math.abs(lengths[2] - published) / published;
  assert.ok(
    error < 0.15,
    `at 6% blockage L/D=${lengths[2]} should be within 15% of the published ${published}, off by ${error}`
  );
});

test("Test 5 - wake length is insensitive to grid refinement", () => {
  // The cylinder is a staircase of whole cells, so the geometry itself is
  // only resolved to about one cell. This checks that the answer is not
  // being driven by that: refining the grid by half must not move the wake
  // length much.
  const coarse = runCylinderToSteadyState({ Re: 40, ...BASE, cpd: 8 });
  const fine = runCylinderToSteadyState({ Re: 40, ...BASE, cpd: 12 });
  const lc = wakeBubbleLength(coarse).lengthOverD;
  const lf = wakeBubbleLength(fine).lengthOverD;
  const change = Math.abs(lf - lc) / lc;

  console.log(
    `[Test 5 refinement] Re=40 wake length vs resolution:\n` +
    `          ${coarse.nx}x${coarse.ny} (8 cells per diameter, ${coarse.solidCells} solid cells)  L/D=${lc.toFixed(4)}\n` +
    `          ${fine.nx}x${fine.ny} (12 cells per diameter, ${fine.solidCells} solid cells)  L/D=${lf.toFixed(4)}\n` +
    `          change = ${(change * 100).toFixed(2)}%`
  );

  assert.ok(fine.reachedSteady, "refined run did not reach steady state");
  assert.ok(
    change < 0.06,
    `wake length should be nearly grid-independent, changed by ${(change * 100).toFixed(1)}%`
  );
  // Both resolutions must still agree on the physics.
  assert.ok(lc > 1.5 && lf > 1.5, "both resolutions should show a long Re=40 wake");
});
