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
