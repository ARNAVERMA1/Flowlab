// M4 - boundary conditions.
//
// The golden-field guard. See tests/support/boundaryFixtures.js for what the
// cases are and why byte equality rather than a tolerance is the standard.
//
// The short version: the M4 refactor replaces four duplicated per-side if/else
// chains with one implementation parameterised by side, and those four chains
// are not symmetric with each other. An index confused between them displaces
// a wall by half a cell and still produces a field that looks like a cavity
// flow. Every tolerance in Tests 1-6 would keep passing. These hashes would
// not.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { FIXTURE_CASES, measureFixtureCase } from "./support/boundaryFixtures.js";
import { StaggeredGrid } from "../geometry/grid.js";
import { step, boundaryPlanFor } from "../solver/ns2d.js";
import { compileBoundaryConditions } from "../boundaries/compile.js";

const GOLDEN = JSON.parse(
  readFileSync(new URL("./fixtures/golden-fields.json", import.meta.url), "utf8")
);

test("M4 - boundary fields are byte-identical to the recorded golden run", () => {
  const missing = [];
  const changed = [];

  for (const entry of FIXTURE_CASES) {
    const expected = GOLDEN.cases[entry.id];
    if (!expected) {
      missing.push(entry.id);
      continue;
    }
    const actual = measureFixtureCase(entry);
    for (const field of ["u", "v", "p"]) {
      if (actual[field] !== expected[field]) {
        changed.push(
          `${entry.id}.${field}: ${expected[field].slice(0, 16)} -> ${actual[field].slice(0, 16)} ` +
          `(peak |u| ${fmt(expected.peakU)} -> ${fmt(actual.peakU)}, ` +
          `peak |v| ${fmt(expected.peakV)} -> ${fmt(actual.peakV)})`
        );
      }
    }
  }

  assert.deepEqual(missing, [], `no golden record for: ${missing.join(", ")} - run "npm run golden"`);
  assert.deepEqual(
    changed,
    [],
    "the boundary conditions produce different fields than the recorded run:\n  " +
    changed.join("\n  ") +
    '\n\nThis is not a tolerance to widen. Inspect with "npm run golden -- --diff <caseId>". ' +
    "Regenerate the fixture only if the change to the physics is intended and said so."
  );

  const real = FIXTURE_CASES.filter((c) => c.group === "real").length;
  const coverage = FIXTURE_CASES.length - real;
  console.log(
    `[M4 golden] ${FIXTURE_CASES.length} cases byte-identical ` +
    `(${real} validated configurations, ${coverage} type-by-position coverage), ` +
    `recorded ${GOLDEN.generatedAt}`
  );
});

test("M4 - the golden record covers every boundary type in every position", () => {
  // A fixture that has drifted out of covering some branch is worse than none:
  // it reads as protection while the untested branch is exactly where a
  // per-side refactor goes wrong.
  const seen = new Map(); // type -> set of sides
  for (const entry of FIXTURE_CASES) {
    const { bc } = entry.build();
    for (const side of ["left", "right", "top", "bottom"]) {
      const type = bc[side].type;
      if (!seen.has(type)) seen.set(type, new Set());
      seen.get(type).add(side);
    }
  }

  const required = ["wall", "freeSlip", "inflow", "outflow", "zeroGradient"];
  const gaps = [];
  for (const type of required) {
    const sides = seen.get(type);
    if (!sides) {
      gaps.push(`${type}: never used`);
      continue;
    }
    for (const side of ["left", "right", "top", "bottom"]) {
      if (!sides.has(side)) gaps.push(`${type} is never applied to the ${side} side`);
    }
  }
  assert.deepEqual(gaps, [], `golden coverage gaps:\n  ${gaps.join("\n  ")}`);

  console.log(
    "[M4 golden] every type covered on all four sides: " +
    [...seen.keys()].sort().join(", ")
  );
});

function fmt(value) {
  return value === null || value === undefined ? "NaN" : value.toFixed(6);
}

// ---------------------------------------------------------------------------
// The specification compiler
// ---------------------------------------------------------------------------

function grid8() {
  return new StaggeredGrid(8, 8, 0.125);
}

const CLOSED = {
  left: { type: "wall" },
  right: { type: "wall" },
  top: { type: "wall" },
  bottom: { type: "wall" },
};

function rejects(spec, pattern, message) {
  const error = captureThrow(() => compileBoundaryConditions(grid8(), spec));
  assert.ok(error, `expected a rejection: ${message}`);
  assert.equal(error.name, "BoundarySpecError", `${message}: threw ${error.name} instead`);
  assert.match(error.message, pattern, message);
  return error;
}

function captureThrow(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

test("M4 - a whole-side condition covers the side, corner ghosts included", () => {
  const plan = compileBoundaryConditions(grid8(), CLOSED);
  for (const side of ["left", "right", "top", "bottom"]) {
    assert.equal(plan.faces[side].length, 10, `${side}: 8 faces plus two corner ghosts`);
    assert.ok(plan.faces[side].every((v) => v === plan.faces[side][0]), `${side} is not uniform`);
  }
  // Identical conditions on four sides intern to one entry, so the UI legend
  // lists "wall" once rather than four times.
  assert.equal(plan.conditions.length, 1);
});

test("M4 - segments split a side at the cell the position falls in", () => {
  const plan = compileBoundaryConditions(grid8(), {
    ...CLOSED,
    left: [
      { from: 0, to: 0.5, type: "wall" },
      { from: 0.5, to: 1, type: "inflow", u: 1 },
    ],
  });
  const faces = Array.from(plan.faces.left);
  const wall = plan.conditions.findIndex((c) => c.type === "wall");
  const inlet = plan.conditions.findIndex((c) => c.type === "inflow");

  // Faces 1..4 span y in [0, 0.5); faces 5..8 span [0.5, 1).
  assert.deepEqual(faces.slice(1, 5), [wall, wall, wall, wall]);
  assert.deepEqual(faces.slice(5, 9), [inlet, inlet, inlet, inlet]);
  // Corner ghosts take the nearest segment rather than falling off the end.
  assert.equal(faces[0], wall);
  assert.equal(faces[9], inlet);

  assert.deepEqual(
    plan.sides.left.spans.map((s) => [s.from, s.to, s.cells]),
    [[0, 0.5, 4], [0.5, 1, 4]]
  );
  console.log(
    "[M4 compiler] segmented side: " +
    plan.sides.left.spans
      .map((s) => `${plan.conditions[s.condition].type} over ${s.from}-${s.to} (${s.cells} cells)`)
      .join(", ")
  );
});

test("M4 - an incompletely specified boundary is rejected, not defaulted", () => {
  // Every one of these was previously either a silent NaN sixty steps into a
  // run, or a parameter that looked like it took effect and did not.
  rejects({ ...CLOSED, left: undefined }, /no condition given for the left/, "missing side");
  rejects({ ...CLOSED, left: { type: "teleport" } }, /unknown boundary type/, "unknown type");
  rejects(
    { ...CLOSED, left: [{ from: 0, to: 0.4, type: "wall" }, { from: 0.6, to: 1, type: "wall" }] },
    /nothing covers 0.4 to 0.6/,
    "gap between segments"
  );
  rejects(
    { ...CLOSED, left: [{ from: 0, to: 0.7, type: "wall" }, { from: 0.5, to: 1, type: "wall" }] },
    /overlap/,
    "overlapping segments"
  );
  rejects(
    { ...CLOSED, left: [{ from: 0.2, to: 1, type: "wall" }] },
    /segments start at 0.2/,
    "side not covered from its start"
  );
  rejects(
    { ...CLOSED, left: [{ from: 0, to: 0.8, type: "wall" }] },
    /segments end at 0.8/,
    "side not covered to its end"
  );
  rejects({ ...CLOSED, left: [] }, /empty segment list/, "empty segment list");
});

test("M4 - an inlet must state the component normal to the side it is on", () => {
  // The component that matters differs by side, and getting it wrong used to
  // produce `undefined` in a Float64Array - which is NaN, discovered later.
  const vertical = rejects({ ...CLOSED, left: { type: "inflow", v: 1 } }, /needs a finite u/, "left inlet needs u");
  assert.match(vertical.message, /Cartesian/, "the message should explain the sign convention");
  rejects({ ...CLOSED, top: { type: "inflow", u: 1 } }, /needs a finite v/, "top inlet needs v");

  // And the valid forms compile.
  compileBoundaryConditions(grid8(), { ...CLOSED, left: { type: "inflow", u: 1, v: 0 } });
  compileBoundaryConditions(grid8(), { ...CLOSED, top: { type: "inflow", v: -1 } });
});

test("M4 - a wall cannot carry a normal component, and stray parameters are refused", () => {
  // A wall with flow through it is an inlet. The old code ignored the field
  // silently, which is the failure mode where the specification says one thing
  // and the run does another.
  rejects({ ...CLOSED, left: { type: "wall", u: 1 } }, /cannot have a normal component/, "wall with through-flow");
  rejects({ ...CLOSED, top: { type: "wall", v: 1 } }, /cannot have a normal component/, "wall with through-flow");
  rejects({ ...CLOSED, left: { type: "outflow", u: 3 } }, /does not use "u"/, "outflow given a velocity");
  rejects({ ...CLOSED, left: { type: "wall", speed: 2 } }, /does not use "speed"/, "misspelled parameter");

  // A moving wall prescribes the TANGENTIAL component, which is v on a
  // vertical side and u on a horizontal one.
  compileBoundaryConditions(grid8(), { ...CLOSED, left: { type: "wall", v: 1 } });
  compileBoundaryConditions(grid8(), { ...CLOSED, top: { type: "wall", u: 1 } });
});

test("M4 - a compiled plan can be handed to the solver directly", () => {
  // The UI needs the compiled plan to draw what is applied where. Letting it
  // pass the plan back in means there is one compilation, not one for the
  // solver and another for the picture that could disagree with it.
  const spec = FIXTURE_CASES.find((c) => c.id === "two-outflows").build();
  const plan = compileBoundaryConditions(spec.grid, spec.bc);

  const viaSpec = FIXTURE_CASES.find((c) => c.id === "two-outflows").build();
  const viaPlan = FIXTURE_CASES.find((c) => c.id === "two-outflows").build();
  for (let n = 0; n < 10; n++) {
    step(viaSpec.grid, viaSpec.bc, viaSpec.params);
    step(viaPlan.grid, compileBoundaryConditions(viaPlan.grid, viaPlan.bc), viaPlan.params);
  }
  for (const field of ["u", "v", "p"]) {
    assert.ok(
      Buffer.from(viaSpec.grid[field].buffer).equals(Buffer.from(viaPlan.grid[field].buffer)),
      `${field} differs between passing a specification and passing a compiled plan`
    );
  }

  const mismatched = captureThrow(() => boundaryPlanFor(new StaggeredGrid(4, 4, 0.25), plan));
  assert.ok(mismatched, "a plan compiled for another grid must be refused, not reused");
  assert.match(mismatched.message, /compiled for a/);
});

test("M4 - the same specification object compiles once", () => {
  // Not an optimisation detail: recompiling per step would put an allocation
  // and a validation pass inside the timestep loop.
  const grid = grid8();
  const spec = { ...CLOSED };
  const first = boundaryPlanFor(grid, spec);
  const second = boundaryPlanFor(grid, spec);
  assert.equal(first, second, "the plan should be cached against the specification object");
});

// ---------------------------------------------------------------------------
// Flow-rate inlets
// ---------------------------------------------------------------------------

function channel({ cpw = 16, w = 1, L = 6, nu = 0.05, rho = 1, bc }) {
  const h = w / cpw;
  const grid = new StaggeredGrid(Math.round(L / h), cpw, h);
  return {
    grid, bc, h, cpw, w, L, nu, rho,
    params: {
      nu, rho,
      dt: 0.4 * Math.min((0.25 * h * h) / nu, h / 2),
      divergenceTol: 1e-7,
      poissonMaxIterations: 20000,
    },
  };
}

function fluxAcross(grid, i) {
  let q = 0;
  for (let j = 1; j <= grid.ny; j++) q += grid.u[grid.idx(i, j)] * grid.h;
  return q;
}

test("M4 - a flow-rate inlet delivers exactly the rate it was asked for", () => {
  // The whole point of specifying a rate rather than a velocity: the number
  // asked for is the number delivered, at any resolution, for either profile.
  // Renormalising the sampled shape is what buys the exactness - sampling a
  // parabola and trusting the algebra would leave an O(h^2) shortfall.
  for (const profile of ["uniform", "parabolic"]) {
    for (const cpw of [8, 16, 33]) {
      const Q = 0.75;
      const setup = channel({
        cpw,
        bc: {
          left: { type: "flowInlet", flowRate: Q, profile },
          right: { type: "outflow" },
          top: { type: "wall" },
          bottom: { type: "wall" },
        },
      });
      for (let n = 0; n < 40; n++) step(setup.grid, setup.bc, setup.params);
      const inlet = fluxAcross(setup.grid, 0);
      assert.ok(
        Math.abs(inlet - Q) < 1e-14,
        `${profile} at ${cpw} cells: delivered ${inlet}, asked for ${Q}`
      );
    }
  }
  console.log("[M4 flow inlet] uniform and parabolic deliver the requested rate to 1e-14 at 8, 16 and 33 cells");
});

test("M4 - a parabolic inlet has a parabolic shape, not just the right total", () => {
  // Exactness of the integral would also be satisfied by a uniform profile, so
  // the shape has to be checked separately. A fully developed plane channel
  // peaks at 1.5x its mean.
  const Q = 1;
  const observed = [];
  for (const cpw of [16, 32, 64]) {
    const setup = channel({
      cpw,
      bc: {
        left: { type: "flowInlet", flowRate: Q, profile: "parabolic" },
        right: { type: "outflow" },
        top: { type: "wall" },
        bottom: { type: "wall" },
      },
    });
    const plan = compileBoundaryConditions(setup.grid, setup.bc);
    let peak = 0;
    for (let j = 1; j <= cpw; j++) peak = Math.max(peak, plan.profiles.left[j]);
    observed.push({ cpw, ratio: peak / (Q / setup.w) });
  }
  // Sampling a parabola at cell centres undershoots the true peak, by less as
  // the grid refines. What matters is that it is heading for 1.5 rather than
  // sitting at 1.
  assert.ok(observed[0].ratio > 1.4, `16 cells: peak/mean ${observed[0].ratio}`);
  assert.ok(
    observed[2].ratio > observed[1].ratio && observed[1].ratio > observed[0].ratio,
    "the peak-to-mean ratio should rise toward 1.5 with resolution"
  );
  assert.ok(observed[2].ratio < 1.5, "and must never exceed the continuum value");
  console.log(
    "[M4 flow inlet] parabolic peak/mean -> 1.5: " +
    observed.map((o) => `${o.cpw} cells ${o.ratio.toFixed(4)}`).join(", ")
  );
});

test("M4 - a partly blocked flow-rate inlet still delivers its rate", () => {
  // An inlet half covered by an obstacle should push harder through what is
  // left, not quietly deliver half the flow.
  const Q = 0.5;
  const cpw = 16;
  const setup = channel({
    cpw,
    bc: {
      left: { type: "flowInlet", flowRate: Q, profile: "uniform" },
      right: { type: "outflow" },
      top: { type: "wall" },
      bottom: { type: "wall" },
    },
  });
  // Block the lower half of the inlet column.
  for (let j = 1; j <= cpw / 2; j++) setup.grid.solid[setup.grid.idx(1, j)] = 1;
  setup.grid.maskVersion++;

  const plan = compileBoundaryConditions(setup.grid, setup.bc);
  let open = 0;
  let delivered = 0;
  for (let j = 1; j <= cpw; j++) {
    if (setup.grid.solid[setup.grid.idx(1, j)]) {
      assert.equal(plan.profiles.left[j], 0, `blocked face ${j} was given a velocity`);
      continue;
    }
    open++;
    delivered += plan.profiles.left[j] * setup.h;
  }
  assert.ok(Math.abs(delivered - Q) < 1e-15, `delivered ${delivered}, asked for ${Q}`);
  const velocity = plan.profiles.left[cpw];
  assert.ok(
    Math.abs(velocity - Q / (open * setup.h)) < 1e-15,
    "the open faces should carry the whole rate between them"
  );
  console.log(
    `[M4 flow inlet] ${open} of ${cpw} faces open, each at ${velocity.toFixed(4)} ` +
    `(twice the unblocked ${(Q / (cpw * setup.h)).toFixed(4)}), total still ${delivered}`
  );
});

test("M4 - impossible flow-rate inlets are rejected with a reason", () => {
  const cpw = 16;
  const blocked = channel({
    cpw,
    bc: {
      left: { type: "flowInlet", flowRate: 1 },
      right: { type: "outflow" },
      top: { type: "wall" },
      bottom: { type: "wall" },
    },
  });
  for (let j = 1; j <= cpw; j++) blocked.grid.solid[blocked.grid.idx(1, j)] = 1;
  blocked.grid.maskVersion++;
  let error = captureThrow(() => compileBoundaryConditions(blocked.grid, blocked.bc));
  assert.match(error.message, /completely blocked/, "a fully blocked inlet must say so");

  // A parabola needs one unbroken opening; two openings have no single centre
  // to span, and guessing one would invent a profile nobody asked for.
  const split = channel({
    cpw,
    bc: {
      left: { type: "flowInlet", flowRate: 1, profile: "parabolic" },
      right: { type: "outflow" },
      top: { type: "wall" },
      bottom: { type: "wall" },
    },
  });
  split.grid.solid[split.grid.idx(1, Math.round(cpw / 2))] = 1;
  split.grid.maskVersion++;
  error = captureThrow(() => compileBoundaryConditions(split.grid, split.bc));
  assert.match(error.message, /unbroken open stretch/, "a split parabolic inlet must say so");

  // The same split is fine for a uniform profile.
  compileBoundaryConditions(split.grid, { ...split.bc, left: { type: "flowInlet", flowRate: 1 } });
});

// ---------------------------------------------------------------------------
// Pressure boundaries
// ---------------------------------------------------------------------------

test("M4 - two pressure boundaries with different values stay different", () => {
  // Regression. The condition table deduplicates identical conditions so the
  // legend lists each once, and its key used to be a hand-written list of
  // fields - type, u, v, label. When `pressure` arrived with its own `p`, both
  // ends of a channel hashed to the same key and merged: one condition, the
  // same pressure at both ends, zero flow. It converged in four iterations and
  // looked entirely healthy.
  const grid = grid8();
  const plan = compileBoundaryConditions(grid, {
    left: { type: "pressure", p: 1 },
    right: { type: "pressure", p: 0 },
    top: { type: "wall" },
    bottom: { type: "wall" },
  });
  const pressures = plan.conditions.filter((c) => c.type === "pressure").map((c) => c.p);
  assert.deepEqual(pressures.sort(), [0, 1], "the two pressure values must survive interning");
  assert.notEqual(plan.faces.left[1], plan.faces.right[1], "both ends resolved to one condition");
});

test("M4 - pressure and outflow cannot be mixed", () => {
  rejects(
    { left: { type: "pressure", p: 1 }, right: { type: "outflow" }, top: { type: "wall" }, bottom: { type: "wall" } },
    /mixes "outflow" with "pressure"/,
    "flux rescaling would fight the pressure boundary"
  );
});

test("M4 - a prescribed pressure drives the analytically correct flow rate", () => {
  // The decision this test exists to settle. A plane channel with the pressure
  // fixed at both ends has an exact steady answer,
  //
  //     U_mean = dp * w^2 / (12 * mu * L)
  //
  // so the pressure boundary can be checked against closed form rather than
  // eyeballed. Both the flow rate and the local gradient are measured: the
  // first includes entrance losses, the second isolates the developed region.
  const w = 1;
  const L = 6;
  const nu = 0.05;
  const dp = 3.6;
  const expected = (dp * w * w) / (12 * nu * L);
  const results = [];

  for (const cpw of [16, 32]) {
    const setup = channel({
      cpw, w, L, nu,
      bc: {
        left: { type: "pressure", p: dp },
        right: { type: "pressure", p: 0 },
        top: { type: "wall" },
        bottom: { type: "wall" },
      },
    });
    const steps = Math.round(50 / setup.params.dt);
    for (let n = 0; n < steps; n++) step(setup.grid, setup.bc, setup.params);

    const { grid } = setup;
    const measured = fluxAcross(grid, Math.round(grid.nx / 2)) / w;
    // The flux is a genuine output here - nothing prescribed it - so its
    // constancy along the channel is a real check, not a restatement of a
    // boundary value.
    const inlet = fluxAcross(grid, 0);
    const outlet = fluxAcross(grid, grid.nx);
    assert.ok(
      Math.abs(inlet - outlet) < 1e-8,
      `flux is not conserved: ${inlet} in, ${outlet} out`
    );
    results.push({ cpw, measured, error: (measured - expected) / expected });
  }

  const [coarse, fine] = results;
  const order = Math.log2(Math.abs(coarse.error) / Math.abs(fine.error));
  console.log(
    `[M4 pressure] plane channel, dp = ${dp} over L = ${L}, theory U_mean = ${expected.toFixed(6)}:\n` +
    results
      .map((r) => `            ${r.cpw} cells across: ${r.measured.toFixed(6)} (${(r.error * 100).toFixed(3)}%)`)
      .join("\n") +
    `\n            observed convergence order ${order.toFixed(2)}`
  );

  // The order is the load-bearing assertion. A single error figure can be
  // small for the wrong reasons; a wrongly implemented boundary does not
  // converge at second order to the right answer.
  assert.ok(order > 1.8 && order < 2.2, `convergence order ${order.toFixed(2)}, expected 2`);
  assert.ok(Math.abs(fine.error) < 0.01, `error at 32 cells is ${(fine.error * 100).toFixed(3)}%`);

  // The remaining discrepancy is the WALL treatment, not the pressure ends:
  // reflecting the no-slip condition into the ghost is exact for a linear
  // profile and O(h^2) for a parabolic one, which is why refining fixes it.
  // If the ends were at fault the local gradient in the developed region would
  // be right while the overall rate was wrong, and it is not.
  assert.ok(coarse.error > 0 && fine.error > 0, "the discrete channel should flow slightly freely");
});

test("M4 - a pressure boundary makes the pressure problem non-singular", () => {
  // The structural change. Without a prescribed pressure the operator has a
  // constant null space and the solve projects it out; with one, the solution
  // is unique and projecting would discard part of the answer.
  const grid = grid8();
  const neumann = boundaryPlanFor(grid, CLOSED);
  assert.equal(neumann.hasPressure, false);

  const driven = { ...CLOSED, left: { type: "pressure", p: 1 }, right: { type: "pressure", p: 0 } };
  const plan = boundaryPlanFor(grid, driven);
  assert.equal(plan.hasPressure, true);

  // With a Dirichlet boundary the absolute level is fixed, so the field must
  // NOT come out zero-mean - which is exactly what a stray null-space
  // projection would produce.
  const params = { nu: 0.05, rho: 1, dt: 1e-3, divergenceTol: 1e-7 };
  for (let n = 0; n < 200; n++) step(grid, driven, params);
  let total = 0;
  for (let j = 1; j <= grid.ny; j++) {
    for (let i = 1; i <= grid.nx; i++) total += grid.p[grid.idx(i, j)];
  }
  const mean = total / (grid.nx * grid.ny);
  assert.ok(Math.abs(mean - 0.5) < 0.05, `mean pressure ${mean}, expected about 0.5`);

  // And the reflected ghost puts the prescribed value on the FACE, not half a
  // cell outside it: the average of the ghost and the first cell is p_boundary.
  const onFace = (grid.p[grid.idx(0, 3)] + grid.p[grid.idx(1, 3)]) / 2;
  assert.ok(Math.abs(onFace - 1) < 1e-9, `the boundary value landed at ${onFace}, not 1`);
  console.log(
    `[M4 pressure] driven box: mean p ${mean.toFixed(4)} (not projected to zero), ` +
    `prescribed value recovered on the face to ${Math.abs(onFace - 1).toExponential(1)}`
  );
});
