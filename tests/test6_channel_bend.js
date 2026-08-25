// M0 Test 6 - 90-degree channel bend.
//
// An L-shaped duct: flow enters along the top leg, turns through the bend, and
// leaves through the bottom of the right leg. Both a sharp mitre bend and a
// smooth elbow of the same channel width are run, which is the comparison the
// roadmap asks for.
//
// Like Test 5 there is no single published table to check against, so the
// validation rests on:
//
//   1. Exact structural invariants - the same volume passes every station of
//      both legs, the duct walls carry exactly zero velocity, and the flow is
//      divergence-free.
//   2. An exact analytical anchor inside the same geometry. Far enough
//      upstream of the bend the inlet leg carries fully developed plane
//      Poiseuille flow, for which both the profile and the streamwise
//      pressure gradient are known in closed form. This is what makes the
//      bend numbers - which have no closed form - worth believing.
//   3. Known qualitative behaviour of bends: a sharp inner corner separates
//      the flow and throws it toward the outer wall, the pressure is higher on
//      the outer wall than the inner one, and rounding the corner suppresses
//      the separation. The last of these is the reason bends are rounded in
//      real pipework.

import test from "node:test";
import assert from "node:assert/strict";
import {
  runBendToSteadyState,
  separationBubble,
  bendWallPressures,
  outletProfilePeakPosition,
  poiseuilleComparison,
  fluxThroughLegs,
  maxVelocityOnSolidSurface,
} from "./support/bend.js";

// Far enough into the inlet leg to be fully developed, and far enough from
// the bend not to feel it. Measured: the profile error is flat from 2w to 4w
// and climbs from 4.5w onward as the bend's upstream influence reaches back.
const POISEUILLE_STATION = 3.0;

test("Test 6 - the L-shaped duct is enforced exactly", () => {
  const run = runBendToSteadyState({ Re: 100, cpw: 12, legLen: 6 });
  const flux = fluxThroughLegs(run);
  const surface = maxVelocityOnSolidSurface(run);

  console.log(
    `[Test 6 structure] sharp bend, Re=100, ${run.nx}x${run.ny}, ` +
    `${run.solidCells} solid cells, cell Re=${run.cellReynolds.toFixed(1)}\n` +
    `          steady at t=${run.t.toFixed(1)} after ${run.steps} steps, dt=${run.dt.toExponential(3)}\n` +
    `          max|velocity| on the duct walls = ${surface.toExponential(2)}\n` +
    `          max|div u| = ${run.divergence.max.toExponential(2)}\n` +
    `          volume flux: expected ${flux.expected.toFixed(6)} through every station, ` +
    `worst deviation over ${flux.cuts} cuts of both legs = ${flux.maxDeviation.toExponential(2)} ` +
    `(${flux.relative.toExponential(2)} relative)`
  );

  assert.ok(run.reachedSteady, `flow did not reach steady state (rate=${run.rate})`);
  assert.ok(run.poissonConvergedEverywhere, "pressure solve failed to converge on some step");
  assert.equal(surface, 0, `duct walls must carry exactly zero velocity, got ${surface}`);
  assert.ok(run.divergence.max < 1e-6, `max|div u| = ${run.divergence.max}`);
  assert.ok(
    flux.relative < 1e-6,
    `the same volume must pass every station, worst relative deviation ${flux.relative}`
  );
});

test("Test 6 - the inlet leg reproduces exact Poiseuille flow", () => {
  // With a uniform inlet of speed U0 across width w, the developed profile is
  // 1.5*U0*(1 - (2(y-yc)/w)^2) and dp/dx is exactly -12*mu*U0/w^2.
  const runs = [8, 16].map((cpw) => runBendToSteadyState({ Re: 20, cpw, legLen: 6 }));
  const cmp = runs.map((r) => poiseuilleComparison(r, POISEUILLE_STATION));
  const order = Math.log2(cmp[0].maxProfileError / cmp[1].maxProfileError);

  console.log(`[Test 6 Poiseuille] inlet leg at x=${POISEUILLE_STATION}w, Re=20:`);
  for (let k = 0; k < runs.length; k++) {
    console.log(
      `          ${runs[k].nx}x${runs[k].ny} (${runs[k].w / runs[k].h} cells across the duct)  ` +
      `max|u - parabola|=${cmp[k].maxProfileError.toExponential(3)}  ` +
      `peak u=${cmp[k].peak.toFixed(5)} (exact ${cmp[k].peakExact})  ` +
      `dp/dx=${cmp[k].dpdx.toFixed(5)} (exact ${cmp[k].dpdxExact.toFixed(5)}, ` +
      `${(cmp[k].dpdxRelativeError * 100).toFixed(2)}% off)`
    );
  }
  console.log(`          profile error converges at order ${order.toFixed(2)}`);

  assert.ok(
    cmp[1].maxProfileError < 0.01,
    `developed profile should match the parabola, got ${cmp[1].maxProfileError}`
  );
  assert.ok(
    cmp[1].dpdxRelativeError < 0.02,
    `dp/dx should match -12*mu*U/w^2, off by ${cmp[1].dpdxRelativeError}`
  );
  assert.ok(order > 1.7 && order < 2.3, `expected ~2nd order convergence, got ${order}`);
});

test("Test 6 - a sharp bend separates at the inner corner", () => {
  const runs = [100, 200].map((Re) => runBendToSteadyState({ Re, cpw: 12, legLen: 6 }));

  console.log("[Test 6 sharp bend] inner-corner separation and flow redistribution:");
  const bubbles = [];
  for (const run of runs) {
    const bubble = separationBubble(run);
    const walls = bendWallPressures(run);
    const peakPos = outletProfilePeakPosition(run);
    bubbles.push(bubble);
    console.log(
      `          Re=${String(run.Re).padStart(3)}  separation bubble ${bubble.lengthOverW.toFixed(3)}w ` +
      `starting ${bubble.startOverW.toFixed(3)}w below the corner, ` +
      `peak reverse flow ${bubble.peakReverse.toFixed(4)} U0\n` +
      `                  outlet peak speed sits ${(peakPos * 100).toFixed(1)}% of the way from the ` +
      `inner wall to the outer (0.5 = centred)\n` +
      `                  wall pressure: inner=${walls.inner.toFixed(4)} outer=${walls.outer.toFixed(4)} ` +
      `difference=${walls.difference.toFixed(4)}`
    );

    assert.ok(run.reachedSteady, `Re=${run.Re} did not reach steady state`);
    assert.ok(bubble.separated, `Re=${run.Re}: a sharp bend must separate at the inner corner`);
    assert.ok(
      bubble.peakReverse > 0.05,
      `Re=${run.Re}: reverse flow should be substantial, got ${bubble.peakReverse} U0`
    );

    // Turning the flow needs a radial pressure gradient: the outer wall must
    // carry the higher pressure. This is what actually drives the turn.
    assert.ok(
      walls.difference > 0,
      `Re=${run.Re}: outer wall pressure should exceed inner, got ${walls.difference}`
    );
    // Separation off the inner wall pushes the flow outward.
    assert.ok(
      peakPos > 0.55,
      `Re=${run.Re}: flow should be thrown toward the outer wall, peak at ${peakPos}`
    );
  }

  // A larger Reynolds number means less momentum diffusion to reattach the
  // flow, so the bubble grows.
  assert.ok(
    bubbles[1].lengthOverW > bubbles[0].lengthOverW,
    `bubble should lengthen with Re, got ${bubbles[0].lengthOverW} then ${bubbles[1].lengthOverW}`
  );
  assert.ok(
    bubbles[1].peakReverse > bubbles[0].peakReverse,
    "reverse flow should strengthen with Re"
  );
});

test("Test 6 - rounding the bend suppresses the separation", () => {
  // Same channel width, same Reynolds numbers, same everything except the
  // inner corner is replaced by an arc of one channel width radius (and the
  // outer wall by the concentric arc). This is the sharp-vs-smooth comparison
  // that motivates rounding bends in real pipework.
  console.log("[Test 6 sharp vs smooth] identical duct width, inner radius 0 vs 1w:");
  for (const Re of [100, 200]) {
    const sharp = runBendToSteadyState({ Re, cpw: 12, legLen: 6 });
    const smooth = runBendToSteadyState({ Re, cpw: 12, legLen: 6, innerRadius: 1 });
    const bs = separationBubble(sharp);
    const bm = separationBubble(smooth);
    const ps = bendWallPressures(sharp);
    const pm = bendWallPressures(smooth);
    const qs = outletProfilePeakPosition(sharp);
    const qm = outletProfilePeakPosition(smooth);

    console.log(
      `          Re=${String(Re).padStart(3)}  sharp:  bubble ${bs.lengthOverW.toFixed(3)}w  ` +
      `peak reverse ${bs.peakReverse.toFixed(4)} U0  peak at ${(qs * 100).toFixed(1)}%  ` +
      `dp(outer-inner)=${ps.difference.toFixed(4)}\n` +
      `                  smooth: bubble ${bm.lengthOverW.toFixed(3)}w  ` +
      `peak reverse ${bm.peakReverse.toFixed(4)} U0  peak at ${(qm * 100).toFixed(1)}%  ` +
      `dp(outer-inner)=${pm.difference.toFixed(4)}`
    );

    assert.ok(smooth.reachedSteady, `Re=${Re}: smooth bend did not reach steady state`);
    assert.equal(maxVelocityOnSolidSurface(smooth), 0, "smooth duct walls must carry zero velocity");
    assert.ok(fluxThroughLegs(smooth).relative < 1e-6, "smooth bend must conserve volume flux");

    // The discriminator is the strength of the reverse flow, not the boolean
    // "did any cell reverse": at Re=200 the smooth bend shows a trace of
    // reversal at 0.1% of the inlet speed, which is not a separation bubble in
    // any meaningful sense. The sharp bend runs 100x stronger than that.
    assert.ok(
      bm.peakReverse < 0.01,
      `Re=${Re}: rounding should suppress reverse flow, got ${bm.peakReverse} U0`
    );
    assert.ok(
      bs.peakReverse > 10 * Math.max(bm.peakReverse, 1e-4),
      `Re=${Re}: sharp bend should separate far more strongly than the smooth one`
    );

    // Without the corner separation displacing it, the flow leaves the smooth
    // bend much closer to centred.
    assert.ok(qm < qs, `Re=${Re}: smooth bend should redistribute the flow less`);

    // A gentler turn needs a weaker radial pressure gradient.
    assert.ok(
      pm.difference > 0 && pm.difference < ps.difference,
      `Re=${Re}: smooth bend should need a smaller pressure difference across it, ` +
      `got ${pm.difference} vs ${ps.difference}`
    );
  }
});
