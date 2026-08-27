// M5 step 1 - the geometry document model.
//
// The model is built around one finding: TWO DIFFERENT CIRCLE CONVENTIONS were
// already in this codebase before M5, and unifying them moves a benchmarked
// result.
//
//   stampCircle      (x-cx)**2 + (y-cy)**2 <= r*r    squared, closed
//   the smooth bend  Math.hypot(x-cx, y-cy) <  r     euclidean, open
//
// Decomposing the difference corrected the first explanation of it. The metric
// contributes nothing at all; every differing cell comes from `<=` against
// `<`. The tests below record that decomposition rather than the initial
// reading of it, and check each primitive reproduces the predicate it replaces
// cell for cell on the exact grids the scenarios use - not on a toy grid where
// the difference cannot show up.

import test from "node:test";
import assert from "node:assert/strict";

import { StaggeredGrid, stampCircle } from "../geometry/grid.js";
import {
  applyDocument,
  sampleDocument,
  testRegion,
  validateDocument,
  GeometryDocumentError,
} from "../geometry/document.js";
import { bendDocument, cylinderDocument, emptyDocument } from "../geometry/documents.js";

// The cylinder scenario's exact grid and circle placement, copied from
// scenarios/index.js. Copied rather than imported because the point is to
// check the document reproduces THAT arithmetic; importing the scenario would
// only prove the document agrees with itself.
function cylinderGeometry() {
  const D = 1;
  const cpd = 12;
  const h = D / cpd;
  let ny = Math.round(6 * cpd);
  if (ny % 2 === 0) ny += 1;
  const nx = Math.round(14 * cpd);
  const jc = (ny + 1) / 2;
  return {
    D, h, nx, ny,
    cx: (Math.round(3.5 / h + 0.5) - 0.5) * h,
    cy: (jc - 0.5) * h,
    radius: D / 2,
  };
}

function countMask(mask) {
  let n = 0;
  for (let k = 0; k < mask.length; k++) n += mask[k];
  return n;
}

function firstDifference(a, b, grid) {
  for (let j = 1; j <= grid.ny; j++) {
    for (let i = 1; i <= grid.nx; i++) {
      const k = grid.idx(i, j);
      if (a[k] !== b[k]) return { i, j, ...grid.cellCentre(i, j) };
    }
  }
  return null;
}

function captureThrow(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

test("M5 - a squared/closed disk reproduces stampCircle cell for cell", () => {
  const g = cylinderGeometry();
  const stamped = new StaggeredGrid(g.nx, g.ny, g.h);
  const stampedCount = stampCircle(stamped, g.cx, g.cy, g.radius);

  const sampled = new StaggeredGrid(g.nx, g.ny, g.h);
  const document = {
    operations: [
      {
        op: "add",
        region: { kind: "disk", cx: g.cx, cy: g.cy, radius: g.radius, metric: "squared", closed: true },
      },
    ],
  };
  const sampledCount = applyDocument(sampled, document);

  const difference = firstDifference(stamped.solid, sampled.solid, stamped);
  assert.equal(difference, null, `masks differ first at ${JSON.stringify(difference)}`);
  assert.equal(sampledCount, stampedCount);
  console.log(
    `[M5 conventions] squared/closed disk reproduces stampCircle exactly: ` +
    `${sampledCount} solid cells on the ${g.nx}x${g.ny} cylinder grid`
  );
});

test("M5 - the boundary convention decides cells; the metric decides none", () => {
  // The decomposition, pinned. The first reading of this finding blamed the
  // metric, and a mutation that removed the squared branch entirely survived
  // the test suite - which is how the attribution got corrected. All four
  // variants are compared here so the numbers say which half matters.
  const g = cylinderGeometry();
  const grid = new StaggeredGrid(g.nx, g.ny, g.h);
  const mask = (metric, closed) =>
    sampleDocument(
      { operations: [{ op: "add", region: { kind: "disk", cx: g.cx, cy: g.cy, radius: g.radius, metric, closed } }] },
      grid
    );
  const differing = (a, b) => {
    let n = 0;
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) n++;
    return n;
  };

  const sc = mask("squared", true);
  const so = mask("squared", false);
  const ec = mask("euclidean", true);
  const eo = mask("euclidean", false);

  assert.equal(differing(sc, ec), 0, "changing only the metric must change nothing");
  assert.equal(differing(so, eo), 0, "changing only the metric must change nothing");
  assert.equal(differing(sc, so), 3, "changing only the boundary convention costs 3 cells");
  assert.equal(differing(ec, eo), 3, "changing only the boundary convention costs 3 cells");

  console.log(
    `[M5 conventions] cylinder body, ${countMask(sc)} cells: metric alone changes ` +
    `${differing(sc, ec)} cells, boundary convention alone changes ${differing(sc, so)}`
  );
});

test("M5 - the three deciding cells sit exactly on the radius", () => {
  // Why the boundary convention is worth three cells and not zero: three cell
  // centres are at a distance that lands precisely on the radius in floating
  // point, so `<=` takes them and `<` does not.
  //
  // This doubles as a CROSS-VERSION CANARY. Math.hypot is not required to be
  // correctly rounded, so this exact equality is a property of the engine, not
  // of arithmetic. If a Node upgrade changes it, this fails and warns that the
  // golden masks and golden fields may have moved for reasons that are not a
  // code change.
  const g = cylinderGeometry();
  const grid = new StaggeredGrid(g.nx, g.ny, g.h);
  const exact = [];
  for (let j = 1; j <= grid.ny; j++) {
    for (let i = 1; i <= grid.nx; i++) {
      const { x, y } = grid.cellCentre(i, j);
      if (Math.hypot(x - g.cx, y - g.cy) === g.radius) exact.push({ i, j });
      }
  }
  assert.equal(exact.length, 3, "three cell centres should land exactly on the radius");
  for (const { i, j } of exact) {
    const { x, y } = grid.cellCentre(i, j);
    assert.equal((x - g.cx) ** 2 + (y - g.cy) ** 2 === g.radius * g.radius, true,
      `cell (${i}, ${j}) is on the radius by hypot but not by squared distance`);
  }
  console.log(
    `[M5 conventions] cross-version canary: cells ` +
    exact.map((c) => `(${c.i},${c.j})`).join(" ") +
    ` sit exactly on the radius under both metrics`
  );
});

test("M5 - the metrics agree everywhere this project can find", () => {
  // The honest strength of the metric parameter. It is kept because it records
  // which expression a document was built against and because Math.hypot's
  // rounding is an engine property rather than a guarantee - NOT because any
  // measured case distinguishes the two. Nothing here would fail if the
  // squared branch were deleted; that is stated rather than papered over.
  const grid = new StaggeredGrid(120, 120, 1 / 120);
  let seed = 20260827;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let disagreements = 0;
  let samples = 0;
  for (let t = 0; t < 40; t++) {
    const cx = 0.2 + 0.6 * rnd();
    const cy = 0.2 + 0.6 * rnd();
    const radius = 0.02 + 0.15 * rnd();
    for (const closed of [true, false]) {
      for (let j = 1; j <= grid.ny; j++) {
        for (let i = 1; i <= grid.nx; i++) {
          const { x, y } = grid.cellCentre(i, j);
          const a = testRegion({ kind: "disk", cx, cy, radius, metric: "squared", closed }, x, y);
          const b = testRegion({ kind: "disk", cx, cy, radius, metric: "euclidean", closed }, x, y);
          if (a !== b) disagreements++;
          samples++;
        }
      }
    }
  }
  assert.equal(disagreements, 0);
  console.log(
    `[M5 conventions] squared and euclidean agreed on all ${samples.toLocaleString()} samples ` +
    `across 40 circles - the metric parameter is about reproducing an expression, not a measured difference`
  );
});

test("M5 - a euclidean/open disk reproduces the smooth bend's annulus", () => {
  // The other convention, on the grid that uses it. The bend's corner is an
  // annulus complement: solid where d < ri OR d > ro, tested only inside the
  // corner quadrant.
  const w = 1;
  const cpw = 12;
  const h = w / cpw;
  const legLen = 6;
  const Lx = legLen * w + w;
  const ri = 1;
  const ro = ri + w;
  const cx = Lx - ro;
  const cy = Lx - ro;
  const nx = Math.round(Lx / h);
  const grid = new StaggeredGrid(nx, nx, h);

  const annulusRegion = {
    all: [
      { kind: "halfPlane", axis: "x", comparison: ">=", at: cx },
      { kind: "halfPlane", axis: "y", comparison: ">=", at: cy },
      {
        any: [
          { kind: "disk", cx, cy, radius: ri, metric: "euclidean", closed: false },
          { not: { kind: "disk", cx, cy, radius: ro, metric: "euclidean", closed: true } },
        ],
      },
    ],
  };

  let checked = 0;
  for (let j = 1; j <= grid.ny; j++) {
    for (let i = 1; i <= grid.nx; i++) {
      const { x, y } = grid.cellCentre(i, j);
      // The original predicate, verbatim.
      const original = x >= cx && y >= cy ? Math.hypot(x - cx, y - cy) < ri || Math.hypot(x - cx, y - cy) > ro : false;
      assert.equal(
        testRegion(annulusRegion, x, y),
        original,
        `annulus disagrees at cell (${i}, ${j}), x=${x}, y=${y}`
      );
      checked++;
    }
  }
  console.log(`[M5 conventions] euclidean/open annulus matches the bend predicate over ${checked} cells`);
});

test("M5 - half-planes keep < and <= apart", () => {
  // The bend's legs are strict inequalities. A half-plane that normalised < to
  // <= would move the duct wall by one cell wherever an edge lands exactly on
  // a cell centre - which is common, because scenario dimensions are chosen to
  // be round numbers.
  const at = 0.5;
  const open = { kind: "halfPlane", axis: "x", comparison: "<", at };
  const closed = { kind: "halfPlane", axis: "x", comparison: "<=", at };
  assert.equal(testRegion(open, at, 0), false, "< must exclude the boundary");
  assert.equal(testRegion(closed, at, 0), true, "<= must include it");
  assert.equal(testRegion(open, at - 1e-15, 0), true);

  // And the axis actually selects a coordinate.
  assert.equal(testRegion({ kind: "halfPlane", axis: "y", comparison: "<", at }, 9, 0.4), true);
  assert.equal(testRegion({ kind: "halfPlane", axis: "y", comparison: "<", at }, 0.4, 9), false);
});

test("M5 - rectangles are half-open so they tile without seams or overlaps", () => {
  // Two rectangles meeting at x = 0.5 must cover every point exactly once. A
  // closed-closed convention double-covers the seam; open-open leaves a gap
  // that shows up as a one-cell crack in a drawn wall.
  const left = { kind: "rect", x0: 0, y0: 0, x1: 0.5, y1: 1 };
  const right = { kind: "rect", x0: 0.5, y0: 0, x1: 1, y1: 1 };
  let covered = 0;
  for (const x of [0, 0.25, 0.4999999, 0.5, 0.75, 0.9999999]) {
    const inLeft = testRegion(left, x, 0.5);
    const inRight = testRegion(right, x, 0.5);
    assert.ok(!(inLeft && inRight), `x=${x} is covered twice`);
    if (inLeft || inRight) covered++;
  }
  assert.equal(covered, 6, "every sample point should be covered exactly once");

  // Explicit comparisons override the default when a scenario needs them.
  const closedHigh = { kind: "rect", x0: 0, y0: 0, x1: 0.5, y1: 1, highComparison: "<=" };
  assert.equal(testRegion(closedHigh, 0.5, 0.5), true);
});

test("M5 - add and subtract apply in order", () => {
  const grid = new StaggeredGrid(20, 20, 0.05);
  const ring = {
    operations: [
      { op: "add", region: { kind: "disk", cx: 0.5, cy: 0.5, radius: 0.4, metric: "squared", closed: true } },
      { op: "subtract", region: { kind: "disk", cx: 0.5, cy: 0.5, radius: 0.2, metric: "squared", closed: true } },
    ],
  };
  const mask = sampleDocument(ring, grid);
  assert.equal(mask[grid.idx(10, 10)], 0, "the centre should have been carved out");
  assert.equal(mask[grid.idx(10, 4)], 1, "the ring itself should be solid");

  // Reversing the operations gives a filled disk: subtract-then-add is not the
  // same document, and the model must not quietly reorder.
  const reversed = sampleDocument({ operations: [...ring.operations].reverse() }, grid);
  assert.equal(reversed[grid.idx(10, 10)], 1);
  assert.notEqual(countMask(mask), countMask(reversed));
});

test("M5 - sampling is pure and repeatable", () => {
  // Everything downstream - the golden mask fixture in step 2, resampling at
  // another resolution in step 5 - depends on this.
  const grid = new StaggeredGrid(30, 30, 1 / 30);
  const document = {
    operations: [
      { op: "add", region: { kind: "rect", x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.4 } },
      { op: "add", region: { kind: "polygon", vertices: [{ x: 0.2, y: 0.6 }, { x: 0.8, y: 0.6 }, { x: 0.5, y: 0.95 }] } },
      { op: "subtract", region: { kind: "disk", cx: 0.5, cy: 0.25, radius: 0.08, metric: "euclidean", closed: false } },
    ],
  };
  const before = JSON.stringify(document);
  const first = sampleDocument(document, grid);
  const second = sampleDocument(document, grid);
  assert.ok(Buffer.from(first).equals(Buffer.from(second)), "two samples of one document must agree");
  assert.equal(JSON.stringify(document), before, "sampling must not mutate the document");
  assert.ok(countMask(first) > 0);
  console.log(`[M5 document] three-operation document samples to ${countMask(first)} solid cells, repeatably`);
});

test("M5 - a malformed document is rejected with a reason", () => {
  const cases = [
    [{ operations: [] }, null, "an empty document is legal - no geometry is a valid state"],
    [{ operations: [{ op: "paint", region: { kind: "rect", x0: 0, y0: 0, x1: 1, y1: 1 } }] }, /"op" must be/, "unknown operation"],
    [{ operations: [{ op: "add", region: { kind: "blob" } }] }, /unknown shape "blob"/, "unknown shape"],
    [{ operations: [{ op: "add", region: { kind: "disk", cx: 0, cy: 0, radius: 1, closed: true } }] }, /explicit metric/, "disk without a metric"],
    [{ operations: [{ op: "add", region: { kind: "disk", cx: 0, cy: 0, radius: 1, metric: "squared" } }] }, /explicit "closed"/, "disk without a boundary convention"],
    [{ operations: [{ op: "add", region: { kind: "disk", cx: 0, cy: 0, radius: -1, metric: "squared", closed: true } }] }, /radius must be positive/, "negative radius"],
    [{ operations: [{ op: "add", region: { kind: "halfPlane", axis: "z", comparison: "<", at: 0 } }] }, /axis must be/, "bad axis"],
    [{ operations: [{ op: "add", region: { kind: "halfPlane", axis: "x", comparison: "=", at: 0 } }] }, /explicit comparison/, "bad comparison"],
    [{ operations: [{ op: "add", region: { kind: "rect", x0: 1, y0: 0, x1: 0, y1: 1 } }] }, /x1 > x0/, "inverted rectangle"],
    [{ operations: [{ op: "add", region: { kind: "polygon", vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } }] }, /at least 3 vertices/, "degenerate polygon"],
    [{ operations: [{ op: "add", region: { all: [] } }] }, /non-empty array/, "empty composition"],
    [{ operations: [{ op: "add", region: { kind: "rect", x0: 0, y0: 0, x1: NaN, y1: 1 } }] }, /finite number/, "NaN coordinate"],
  ];

  for (const [document, pattern, description] of cases) {
    const error = captureThrow(() => validateDocument(document));
    if (pattern === null) {
      assert.equal(error, null, description);
      continue;
    }
    assert.ok(error, `expected a rejection: ${description}`);
    assert.equal(error.name, "GeometryDocumentError", `${description}: threw ${error.name}`);
    assert.match(error.message, pattern, description);
  }
  console.log(`[M5 document] ${cases.length - 1} malformed documents rejected with reasons`);
});

test("M5 - applyDocument bumps maskVersion so cached topology rebuilds", () => {
  // The solver caches its fluid-cell topology and M4 caches the compiled
  // boundary plan, both keyed on maskVersion. Geometry that changes without
  // bumping it would leave the solver operating on a stale mask.
  const grid = new StaggeredGrid(10, 10, 0.1);
  const before = grid.maskVersion;
  applyDocument(grid, { operations: [{ op: "add", region: { kind: "rect", x0: 0.2, y0: 0.2, x1: 0.5, y1: 0.5 } }] });
  assert.ok(grid.maskVersion > before, "maskVersion must advance when geometry changes");

  // Applying a different document replaces the mask rather than accumulating.
  const solidAfterFirst = countMask(grid.solid);
  applyDocument(grid, { operations: [{ op: "add", region: { kind: "rect", x0: 0.7, y0: 0.7, x1: 0.9, y1: 0.9 } }] });
  assert.ok(countMask(grid.solid) > 0);
  assert.equal(grid.solid[grid.idx(3, 3)], 0, "the previous document's solid must be gone");
  assert.ok(solidAfterFirst > 0);
});

// ---------------------------------------------------------------------------
// Step 2 - the validated scenarios as documents
// ---------------------------------------------------------------------------
//
// GATE 1. Each document must reproduce, cell for cell, the predicate it
// replaces - on the grid that scenario actually uses, not a convenient one.
// The originals are copied verbatim into this file rather than imported,
// because importing the production code would only prove the document agrees
// with itself. These copies are the record of what the mask was.

// Verbatim from tests/support/bend.js buildBend, which scenarios/index.js
// duplicates exactly.
function originalBendPredicate({ Lx, Ly, w, innerRadius }) {
  if (innerRadius === null) {
    return (x, y) => x < Lx - w && y < Ly - w;
  }
  const ri = innerRadius;
  const ro = ri + w;
  const cx = Lx - ro;
  const cy = Ly - ro;
  return (x, y) => {
    if (x >= cx && y >= cy) {
      const d = Math.hypot(x - cx, y - cy);
      return d < ri || d > ro;
    }
    if (x < cx) return y < Ly - w; // inlet leg
    return x < Lx - w; // outlet leg
  };
}

function compareAgainstPredicate(grid, document, predicate) {
  const mask = sampleDocument(document, grid);
  const differing = [];
  for (let j = 1; j <= grid.ny; j++) {
    for (let i = 1; i <= grid.nx; i++) {
      const { x, y } = grid.cellCentre(i, j);
      const expected = predicate(x, y) ? 1 : 0;
      if (mask[grid.idx(i, j)] !== expected) differing.push({ i, j, x, y, expected });
    }
  }
  return { mask, differing, solidCells: countMask(mask) };
}

test("M5 gate 1 - the cylinder document reproduces its stamp exactly", () => {
  const g = cylinderGeometry();
  const grid = new StaggeredGrid(g.nx, g.ny, g.h);
  const stamped = new StaggeredGrid(g.nx, g.ny, g.h);
  stampCircle(stamped, g.cx, g.cy, g.radius);

  const { mask, solidCells } = compareAgainstPredicate(
    grid,
    cylinderDocument({ cx: g.cx, cy: g.cy, radius: g.radius }),
    // The stamp itself is the reference here, read back cell by cell.
    (x, y) => false
  );
  void mask;

  const differing = [];
  for (let j = 1; j <= grid.ny; j++) {
    for (let i = 1; i <= grid.nx; i++) {
      const k = grid.idx(i, j);
      const fromDocument = sampleDocument(
        cylinderDocument({ cx: g.cx, cy: g.cy, radius: g.radius }),
        grid
      )[k];
      if (fromDocument !== stamped.solid[k]) differing.push({ i, j });
      if (differing.length > 3) break;
    }
    if (differing.length > 3) break;
  }
  assert.deepEqual(differing, [], `cells differing from stampCircle: ${JSON.stringify(differing)}`);
  console.log(`[M5 gate 1] cylinder: ${solidCells} solid cells, 0 differing from stampCircle`);
});

test("M5 gate 1 - both bend documents reproduce their predicates exactly", () => {
  const w = 1;
  const cpw = 12;
  const legLen = 6;
  const h = w / cpw;
  const Lx = legLen * w + w;
  const Ly = Lx;
  const n = Math.round(Lx / h);

  const report = [];
  for (const innerRadius of [null, 1]) {
    const grid = new StaggeredGrid(n, n, h);
    const { differing, solidCells } = compareAgainstPredicate(
      grid,
      bendDocument({ Lx, Ly, w, innerRadius }),
      originalBendPredicate({ Lx, Ly, w, innerRadius })
    );
    assert.deepEqual(
      differing.slice(0, 5),
      [],
      `${innerRadius === null ? "sharp" : "smooth"} bend: ${differing.length} cells differ, ` +
      `first at ${JSON.stringify(differing[0])}`
    );
    report.push(`${innerRadius === null ? "sharp" : "smooth"} ${solidCells} cells`);
  }
  console.log(`[M5 gate 1] bend documents match their predicates over ${n * n} cells each: ${report.join(", ")}`);
});

test("M5 gate 1 - the documents survive a change of resolution", () => {
  // Not a byte-identity claim - a different grid gives a different mask by
  // definition. What must hold is that the document is still the same region:
  // refining the grid should converge the solid fraction, not wander. This is
  // what makes a document better than a baked mask, and step 5 depends on it.
  const w = 1;
  const legLen = 6;
  const Lx = legLen * w + w;
  const fractions = [];
  for (const cpw of [6, 12, 24, 48]) {
    const h = w / cpw;
    const n = Math.round(Lx / h);
    const grid = new StaggeredGrid(n, n, h);
    const mask = sampleDocument(bendDocument({ Lx, Ly: Lx, w, innerRadius: 1 }), grid);
    fractions.push({ cpw, fraction: countMask(mask) / (n * n) });
  }
  // The exact solid fraction, from the continuum areas. Each straight leg runs
  // from the wall to the arc's centre - a length of Lx - ro, not Lx - w, which
  // is where the first version of this test went wrong.
  const ri = 1;
  const ro = ri + w;
  const ductArea = 2 * (Lx - ro) * w + (Math.PI / 4) * (ro * ro - ri * ri);
  const exact = 1 - ductArea / (Lx * Lx);
  const errors = fractions.map((f) => Math.abs(f.fraction - exact));
  assert.ok(
    errors[3] < errors[0],
    `refinement should approach the exact solid fraction: ${errors.map((e) => e.toExponential(2))}`
  );
  assert.ok(errors[3] < 5e-3, `finest grid is ${errors[3].toExponential(2)} from the exact fraction`);
  console.log(
    `[M5 gate 1] solid fraction converging to ${exact.toFixed(6)}: ` +
    fractions.map((f) => `${f.cpw}cpw ${f.fraction.toFixed(6)}`).join(", ")
  );
});

test("M5 - the complement of a closed disk is strictly outside", () => {
  // `d > r` is `not(d <= r)` - the complement of a CLOSED disk.
  // `d >= r` is `not(d <  r)` - the complement of an OPEN disk.
  //
  // bendDocument relies on the first of these to express the duct's outer
  // wall. Swapping them moves the wall by exactly the cells sitting on the
  // radius, and the test below shows the bend has none - so this semantic
  // test is what justifies the choice, since no sampling of that geometry can.
  //
  // (3, 4) is at distance exactly 5 from the origin under both metrics.
  const closed = { kind: "disk", cx: 0, cy: 0, radius: 5, metric: "euclidean", closed: true };
  const open = { ...closed, closed: false };
  assert.equal(Math.hypot(3, 4), 5, "the fixture point must be exactly on the radius");

  assert.equal(testRegion({ not: closed }, 3, 4), false, "d > r must exclude a point on the radius");
  assert.equal(testRegion({ not: open }, 3, 4), true, "d >= r must include it");
  assert.equal(testRegion({ not: closed }, 3, 4.0001), true, "and both must include a point outside");
  assert.equal(testRegion({ not: open }, 3, 4.0001), true);

  // Same under the squared metric, so the derivation does not depend on which.
  const squaredClosed = { ...closed, metric: "squared" };
  assert.equal(testRegion({ not: squaredClosed }, 3, 4), false);
});

test("M5 - no cell centre lands on a bend radius, so gate 1 cannot check that convention", () => {
  // Stated rather than left as a false impression of coverage. A mutation
  // swapping `closed: true` for `false` on the bend's outer radius SURVIVES
  // both gate 1 and the M4 golden fields - not because the gates are weak, but
  // because the geometry never puts a sample point where the two disagree.
  //
  // The cylinder is the opposite case: three of its cell centres land exactly
  // on the radius, so the same mutation there is caught immediately and moves
  // peak |u| by 9%.
  //
  // If this ever becomes non-zero - a new leg length, a new radius, a new
  // resolution - the convention becomes checkable and gate 1 starts covering
  // it. Until then the derivation above is the guarantee.
  const w = 1;
  const legLen = 6;
  const Lx = legLen * w + w;
  const ri = 1;
  const ro = ri + w;
  const cx = Lx - ro;
  const cy = Lx - ro;

  let onRadius = 0;
  for (let cpw = 4; cpw <= 32; cpw++) {
    const h = w / cpw;
    const n = Math.round(Lx / h);
    const grid = new StaggeredGrid(n, n, h);
    for (let j = 1; j <= n; j++) {
      for (let i = 1; i <= n; i++) {
        const { x, y } = grid.cellCentre(i, j);
        const d = Math.hypot(x - cx, y - cy);
        if (d === ri || d === ro) onRadius++;
      }
    }
  }
  assert.equal(onRadius, 0, "if this is non-zero the bend's radius convention became checkable");
  console.log(
    "[M5 gate 1] no cell centre lands on a bend radius across cpw 4..32, so `<` and `<=` " +
    "there are indistinguishable by sampling - the complement test above is what pins it"
  );
});
