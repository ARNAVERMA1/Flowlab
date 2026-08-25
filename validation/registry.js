// The validation registry: what this project claims, against what, and how
// well the reference behind each claim is actually known.
//
// This is the single declaration consumed by three things - the test suite,
// the generated validation record in docs/VALIDATION.md, and the harness panel.
// Before it existed, a reference value could sit in a test file with its
// provenance in a comment written to whatever standard that day allowed, and
// nothing forced two different claims to be held to the same standard.
//
// ---------------------------------------------------------------------------
// CLASSIFICATION - what kind of thing a case's agreement actually establishes
// ---------------------------------------------------------------------------
//
//   benchmarked      Checked against a reference external to this project: a
//                    closed-form solution, or published measurements. Being
//                    wrong here is detectable from outside.
//
//   self-validated   Checked against exact invariants the problem must satisfy
//                    (mass conservation, symmetry, a fixed point) and against
//                    its own grid convergence. Strong evidence that the solver
//                    solves what it claims to solve, but it cannot detect a
//                    consistent error in the model itself. Nothing external
//                    says the answer is right.
//
//   demonstration    Neither. Runs and looks plausible. No case here is this,
//                    and the harness must be able to say so when one is.
//
// The distinction is the point. A lid-driven cavity agreeing with Ghia to 0.4%
// and a 90-degree bend separating where physical reasoning says it should are
// not the same kind of statement, and a viewer who cannot tell them apart is
// being misled by omission.
//
// ---------------------------------------------------------------------------
// REFERENCE VERIFICATION - how much the reference itself can be trusted
// ---------------------------------------------------------------------------
//
//   derived          A closed-form result reproducible from the governing
//                    equations. Nothing to transcribe, so nothing to get wrong.
//   verified         Transcribed from a publication AND cross-referenced
//                    against an independent source.
//   unverified       Recalled or single-sourced. Believed correct, not checked.
//
// The level describes the NUMBERS, not the citation. Confirming that a cited
// paper is real, correctly attributed and genuinely the standard source does
// not verify the values attached to it, and a reference in that state is
// arguably more dangerous than an obviously unsourced one: the citation reads
// as authority the numbers have not earned. An unverified reference must
// therefore also declare `blocker` - what closing it would actually take - so
// that "unverified" is a piece of work someone can pick up rather than a
// permanent shrug.
//
// The third label is not decoration. The Ghia tables sat at "unverified" for
// most of this project's life and turned out to contain one wrong digit that
// was materially changing a reported error. Anything still carrying that label
// should be assumed to have the same problem until someone checks it.

export const CLASSIFICATIONS = ["benchmarked", "self-validated", "demonstration"];
export const VERIFICATION_LEVELS = ["derived", "verified", "unverified"];

export const REFERENCES = {
  ghia1982: {
    id: "ghia1982",
    citation:
      "Ghia, U., Ghia, K. N., & Shin, C. T. (1982). High-Re solutions for " +
      "incompressible flow using the Navier-Stokes equations and a multigrid " +
      "method. Journal of Computational Physics, 48(3), 387-411.",
    verification: "verified",
    verificationNote:
      "Cross-referenced against an independent public transcription, one source " +
      "per table. The check found one wrong digit in the previous recalled " +
      "transcription (Re=1000, x=0.9063: -0.51550 against a true -0.51500) which " +
      "was setting the reported Re=1000 error. One published point is excluded " +
      "as unreliable - see tests/support/ghia.js EXCLUDED_POINTS.",
  },

  analyticalDiffusion: {
    id: "analyticalDiffusion",
    citation:
      "Closed-form solutions of the 1D heat equation: the decaying mode " +
      "u = U0*cos(k*y)*exp(-nu*k^2*t) and the spreading error-function layer " +
      "u = (U0/2)(1 + erf((y-y0)/(2*sqrt(nu*t)))).",
    verification: "derived",
    verificationNote:
      "Reproducible from the governing equations. For a unidirectional flow the " +
      "nonlinear and pressure terms vanish identically, so the momentum equation " +
      "collapses onto the heat equation exactly - the tests assert that collapse " +
      "rather than assuming it.",
  },

  planePoiseuille: {
    id: "planePoiseuille",
    citation:
      "Plane Poiseuille flow: for a channel of width w with mean velocity U, " +
      "u(y) = 1.5*U*(1 - (2(y-yc)/w)^2) and dp/dx = -12*mu*U/w^2.",
    verification: "derived",
    verificationNote: "Standard closed-form result, reproducible from the equations.",
  },

  cylinderWakeLength: {
    id: "cylinderWakeLength",
    citation:
      "Steady recirculation length behind a circular cylinder in unbounded " +
      "flow, L/D ~ 0.93 at Re=20 and ~2.3 at Re=40. Usually attributed to " +
      "Coutanceau & Bouard (1977), J. Fluid Mech. 79(2), 231-256, and to " +
      "Tritton (1959), J. Fluid Mech. 6, 547-567.",
    verification: "unverified",
    verificationNote:
      "THE NUMBERS ARE STILL RECALLED, NOT CHECKED. A partial check has since " +
      "confirmed the citation but not the values. Coutanceau & Bouard (1977), " +
      "J. Fluid Mech. 79, is a real paper, correctly attributed here, and is " +
      "the standard experimental benchmark that numerical work compares against " +
      "for cylinder wake length at Re < 40 - so the attribution is sound. What " +
      "could not be obtained is the part this project actually depends on: the " +
      "figures L/D ~ 0.93 at Re=20 and ~2.3 at Re=40 still come from recall, " +
      "not from any source that could be checked. That is why this stays " +
      "`unverified` rather than being upgraded on the strength of the citation. " +
      "Published values also differ by a few percent between sources (2.24 to " +
      "2.35 at Re=40 is commonly quoted), which is part of why the test asserts " +
      "a band rather than a point. This remains the weakest reference in the " +
      "project.",
    blocker:
      "The 1977 paper is paywalled and its table could not be reached from any " +
      "openly available source. Closing this needs either institutional or " +
      "library access to the original, or a secondary paper that digitises and " +
      "reproduces those exact figures. Recorded as a known limitation and left " +
      "open deliberately, not pursued further.",
  },
};

// Each case records what it establishes and how. `claims` are the specific
// comparisons; `measuredBy` names the test that asserts them.
export const CASES = [
  {
    id: "still-water",
    label: "Still water",
    classification: "self-validated",
    measuredBy: "tests/test1_still_water.js",
    rationale:
      "u = 0 is an exact fixed point of the discretised equations, so this is " +
      "an invariant rather than a comparison. It cannot be close - it is either " +
      "exact or the solver is manufacturing motion from nothing.",
    claims: [
      { quantity: "max|u| after 50 steps", reference: 0, tolerance: 1e-10, referenceType: "invariant" },
      { quantity: "max|div u|", reference: 0, tolerance: 1e-10, referenceType: "invariant" },
    ],
  },
  {
    id: "uniform-channel",
    label: "Uniform channel flow",
    classification: "self-validated",
    measuredBy: "tests/test2_channel_flow.js",
    rationale:
      "A uniform plug flow with no-penetration, zero-gradient walls is another " +
      "exact fixed point. Isolates whether the projection preserves a trivial " +
      "solution.",
    claims: [
      { quantity: "max|u - U0|", reference: 0, tolerance: 1e-6, referenceType: "invariant" },
      { quantity: "max|div u|", reference: 0, tolerance: 1e-6, referenceType: "invariant" },
    ],
  },
  {
    id: "viscous-diffusion",
    label: "Viscous diffusion",
    classification: "benchmarked",
    measuredBy: "tests/test3_viscous_diffusion.js",
    reference: "analyticalDiffusion",
    rationale:
      "Compared against exact closed-form solutions. The construction makes the " +
      "nonlinear and pressure terms vanish identically, which the test verifies " +
      "by requiring v and divergence to stay at exactly zero, so this isolates " +
      "the diffusion term alone.",
    claims: [
      { quantity: "decay rate vs nu*k^2 (relative)", reference: 0, tolerance: 1e-3, referenceType: "analytical" },
      { quantity: "spatial convergence order", reference: 2, tolerance: 0.3, referenceType: "analytical" },
      { quantity: "spreading-layer profile error", reference: 0, tolerance: 2e-4, referenceType: "analytical" },
    ],
  },
  {
    id: "lid-driven-cavity",
    label: "Lid-driven cavity",
    classification: "benchmarked",
    measuredBy: "tests/test4_lid_driven_cavity.js",
    reference: "ghia1982",
    rationale:
      "The standard 2D incompressible benchmark and the go/no-go gate for this " +
      "solver. The first case where advection and pressure are both live.",
    claims: [
      { quantity: "max|u - Ghia| at Re=100", reference: 0, tolerance: 0.015, referenceType: "published" },
      { quantity: "max|v - Ghia| at Re=100", reference: 0, tolerance: 0.015, referenceType: "published" },
      { quantity: "max|u - Ghia| at Re=400", reference: 0, tolerance: 0.015, referenceType: "published" },
      { quantity: "max|u - Ghia| at Re=1000", reference: 0, tolerance: 0.035, referenceType: "published" },
      { quantity: "self-convergence order", reference: 2, tolerance: 0.3, referenceType: "self-convergence" },
    ],
  },
  {
    id: "cylinder-wake",
    label: "Flow past a circular cylinder",
    classification: "benchmarked",
    measuredBy: "tests/test5_flow_around_obstacle.js",
    reference: "cylinderWakeLength",
    rationale:
      "Wake length compared against published values for an unbounded cylinder, " +
      "which requires accounting for channel blockage: the measured length rises " +
      "monotonically toward the published figure as the channel widens. The " +
      "structural invariants (exact zero velocity on the body, flux conserved " +
      "through every cut, a symmetric answer to a symmetric problem) hold to " +
      "roundoff and are what the case mostly rests on.",
    caveat:
      "The reference VALUES behind this case are UNVERIFIED. The citation has " +
      "been confirmed as real, correctly attributed and the standard source for " +
      "this measurement, but the specific numbers attributed to it have not " +
      "been checked against it. The agreement is also indirect - it is a trend " +
      "toward the published number under reducing blockage, not a direct match " +
      "at a stated condition.",
    claims: [
      { quantity: "wake L/D at Re=20, 6% blockage", reference: 0.93, tolerance: 0.15, relative: true, referenceType: "published" },
      { quantity: "separation onset below Re~5", reference: 0, tolerance: 0, referenceType: "published" },
      { quantity: "velocity on the body surface", reference: 0, tolerance: 0, referenceType: "invariant" },
      { quantity: "flux deviation through all cuts (relative)", reference: 0, tolerance: 1e-7, referenceType: "invariant" },
      { quantity: "centreline asymmetry", reference: 0, tolerance: 1e-9, referenceType: "invariant" },
    ],
  },
  {
    id: "channel-bend",
    label: "90-degree channel bend",
    classification: "self-validated",
    measuredBy: "tests/test6_channel_bend.js",
    reference: "planePoiseuille",
    rationale:
      "There is no published reference for this geometry, so the bend's own " +
      "behaviour - separation off the sharp inner corner, suppression when the " +
      "corner is radiused, flow thrown toward the outer wall, higher pressure on " +
      "the outer wall - is checked against physical reasoning and exact " +
      "invariants, not against measurements. What IS benchmarked is the inlet " +
      "leg, which carries fully developed plane Poiseuille flow with a " +
      "closed-form profile and pressure gradient. That analytical anchor inside " +
      "the same geometry is what makes the bend numbers worth believing.",
    caveat:
      "The bend results themselves are NOT benchmarked. No external source says " +
      "the separation bubble should be 1.555w at Re=200; it is reported because " +
      "the solver is trusted, not the other way round.",
    claims: [
      { quantity: "inlet-leg dp/dx vs -12*mu*U/w^2 (relative)", reference: 0, tolerance: 0.02, referenceType: "analytical" },
      { quantity: "inlet-leg profile convergence order", reference: 2, tolerance: 0.3, referenceType: "analytical" },
      { quantity: "flux deviation through all cuts (relative)", reference: 0, tolerance: 1e-6, referenceType: "invariant" },
      { quantity: "velocity on the duct walls", reference: 0, tolerance: 0, referenceType: "invariant" },
      { quantity: "sharp bend separates at the inner corner", reference: null, tolerance: null, referenceType: "physical-reasoning" },
      { quantity: "radiusing suppresses the separation", reference: null, tolerance: null, referenceType: "physical-reasoning" },
    ],
  },
];

// Harness scenarios map onto cases. A scenario the panel can show but that no
// case validates would be a "demonstration", and the panel must say so rather
// than presenting it like the rest.
export const SCENARIO_VALIDATION = {
  "bend-sharp": { case: "channel-bend" },
  "bend-smooth": { case: "channel-bend" },
  cylinder: { case: "cylinder-wake" },
  cavity: { case: "lid-driven-cavity" },
};

export function caseById(id) {
  return CASES.find((c) => c.id === id) ?? null;
}

export function referenceFor(caseId) {
  const entry = caseById(caseId);
  return entry?.reference ? REFERENCES[entry.reference] : null;
}

// What the panel should say about a scenario: its classification, the strength
// of the reference behind it, and any caveat attached.
export function validationForScenario(scenarioId) {
  const mapping = SCENARIO_VALIDATION[scenarioId];
  if (!mapping) {
    return {
      classification: "demonstration",
      caseId: null,
      label: "no validation case",
      reference: null,
      caveat: "Nothing in the validation registry covers this scenario.",
    };
  }
  const entry = caseById(mapping.case);
  const reference = entry.reference ? REFERENCES[entry.reference] : null;
  return {
    classification: entry.classification,
    caseId: entry.id,
    label: entry.label,
    reference,
    caveat: entry.caveat ?? null,
    measuredBy: entry.measuredBy,
  };
}
