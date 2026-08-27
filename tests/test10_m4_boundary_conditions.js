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
