// M2 - the validation registry holds itself to its own standard.
//
// These are structural checks on the declarations, not simulations: they run in
// milliseconds and belong in `npm test`. The numerical verification lives in
// `npm run validate`, which re-runs the cases and writes docs/VALIDATION.md.
//
// The point is that the registry cannot quietly become decorative. A case that
// claims to be benchmarked without naming a reference, or a reference without a
// verification level, or a caveat-free case resting on unverified numbers, are
// all ways for a validation record to look rigorous while meaning nothing - and
// this project spent most of its life with exactly one such reference sitting
// unexamined in a test file.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CASES,
  REFERENCES,
  CLASSIFICATIONS,
  VERIFICATION_LEVELS,
  SCENARIO_VALIDATION,
  caseById,
  validationForScenario,
} from "../validation/registry.js";
import { SCENARIOS } from "../scenarios/index.js";
import { hasMeasurement } from "../validation/measure.js";

test("M2 - every case declares a valid classification and a rationale", () => {
  assert.ok(CASES.length > 0);
  const seen = new Set();
  for (const entry of CASES) {
    assert.ok(entry.id, "every case needs an id");
    assert.ok(!seen.has(entry.id), `duplicate case id ${entry.id}`);
    seen.add(entry.id);
    assert.ok(
      CLASSIFICATIONS.includes(entry.classification),
      `${entry.id}: "${entry.classification}" is not a known classification`
    );
    assert.ok(entry.rationale && entry.rationale.length > 40,
      `${entry.id}: needs a rationale saying what its agreement establishes`);
    assert.ok(entry.measuredBy, `${entry.id}: must name the test that asserts it`);
    assert.ok(entry.claims?.length > 0, `${entry.id}: must declare at least one claim`);
  }
  console.log(`[M2 registry] ${CASES.length} cases: ` +
    CASES.map((c) => `${c.id}=${c.classification}`).join(", "));
});

test("M2 - a benchmarked case must name an external reference", () => {
  // This is the load-bearing rule. "benchmarked" asserts that being wrong is
  // detectable from outside the project, which is only true if something
  // outside the project is actually being compared against.
  for (const entry of CASES) {
    if (entry.classification !== "benchmarked") continue;
    assert.ok(
      entry.reference,
      `${entry.id} claims to be benchmarked but names no reference`
    );
    assert.ok(
      REFERENCES[entry.reference],
      `${entry.id} references "${entry.reference}", which does not exist`
    );
    const hasExternal = entry.claims.some(
      (c) => c.referenceType === "published" || c.referenceType === "analytical"
    );
    assert.ok(
      hasExternal,
      `${entry.id} claims to be benchmarked but no claim compares against a published or analytical value`
    );
  }
});

test("M2 - a self-validated case must not be presented as benchmarked", () => {
  // The inverse rule. A self-validated case may still cite a reference - the
  // bend cites plane Poiseuille for its inlet leg - but it must carry a caveat
  // saying plainly that its own results are not benchmarked, or the citation
  // will be read as covering more than it does.
  for (const entry of CASES) {
    if (entry.classification !== "self-validated") continue;
    if (!entry.reference) continue;
    assert.ok(
      entry.caveat,
      `${entry.id} is self-validated but cites ${entry.reference} without a caveat ` +
      `explaining what the citation does not cover`
    );
  }
});

test("M2 - every reference declares a verification level and a note", () => {
  for (const [id, reference] of Object.entries(REFERENCES)) {
    assert.equal(reference.id, id, `${id}: id mismatch`);
    assert.ok(reference.citation?.length > 30, `${id}: needs a real citation`);
    assert.ok(
      VERIFICATION_LEVELS.includes(reference.verification),
      `${id}: "${reference.verification}" is not a known verification level`
    );
    assert.ok(
      reference.verificationNote?.length > 40,
      `${id}: must say how it was verified, or say plainly that it was not`
    );
  }
  const unverified = Object.values(REFERENCES).filter((r) => r.verification === "unverified");
  console.log(
    `[M2 references] ${Object.keys(REFERENCES).length} references, ` +
    `${unverified.length} unverified` +
    (unverified.length ? `: ${unverified.map((r) => r.id).join(", ")}` : "")
  );
});

test("M2 - a case resting on an unverified reference must carry a caveat", () => {
  // Unverified references are allowed - not everything can be checked at once -
  // but a case cannot rest on one silently. The Ghia tables sat unverified for
  // most of this project's life and contained a wrong digit that was materially
  // changing a reported error.
  for (const entry of CASES) {
    if (!entry.reference) continue;
    if (REFERENCES[entry.reference].verification !== "unverified") continue;
    assert.ok(
      entry.caveat,
      `${entry.id} rests on the unverified reference "${entry.reference}" and must say so in a caveat`
    );
  }
});

test("M2 - every harness scenario resolves to a validation status", () => {
  // A scenario the panel can display but the registry does not cover must
  // resolve to "demonstration" rather than to nothing, so the panel is never
  // silent about what a viewer is looking at.
  for (const scenario of SCENARIOS) {
    const info = validationForScenario(scenario.id);
    assert.ok(
      CLASSIFICATIONS.includes(info.classification),
      `${scenario.id} resolved to "${info.classification}"`
    );
    if (info.caseId) {
      assert.ok(caseById(info.caseId), `${scenario.id} maps to unknown case ${info.caseId}`);
    }
  }
  const unknown = validationForScenario("a-scenario-that-does-not-exist");
  assert.equal(unknown.classification, "demonstration");
  assert.ok(unknown.caveat, "an uncovered scenario must explain itself, not just be blank");

  console.log("[M2 scenarios] " + SCENARIOS.map((s) =>
    `${s.id}=${validationForScenario(s.id).classification}`).join(", "));
});

test("M2 - every mapped scenario and case can actually be measured", () => {
  // Guards against the registry drifting away from the code that measures it:
  // a declared case with no measurement would silently vanish from the
  // generated record while still appearing in the summary table.
  for (const entry of CASES) {
    assert.ok(hasMeasurement(entry.id), `no measurement defined for case ${entry.id}`);
  }
  for (const [scenarioId, mapping] of Object.entries(SCENARIO_VALIDATION)) {
    assert.ok(caseById(mapping.case), `${scenarioId} maps to unknown case ${mapping.case}`);
    assert.ok(
      SCENARIOS.some((s) => s.id === scenarioId),
      `registry maps scenario "${scenarioId}", which the harness does not offer`
    );
  }
});
