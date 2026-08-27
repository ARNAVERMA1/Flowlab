// Geometry as a document: an ordered list of shapes sampled onto the grid.
//
// This is the M5 transition. Before it, each scenario stamped its solid mask
// with a hand-written predicate; after it, geometry is data that can be drawn,
// edited, saved and resampled at another resolution. The solver is untouched -
// it reads grid.solid and grid.maskVersion and always has.
//
// ---------------------------------------------------------------------------
// WHY EVERY PRIMITIVE CARRIES ITS OWN INCLUSION CONVENTION
// ---------------------------------------------------------------------------
//
// The obvious design is one tidy `circle` primitive. Two different circle
// conventions were already in this codebase before M5:
//
//   stampCircle          (x-cx)**2 + (y-cy)**2 <= r*r     squared, closed
//   the smooth bend      Math.hypot(x-cx, y-cy) <  r      euclidean, open
//
// and unifying them changes the cylinder mask by 3 of 113 solid cells - 2.7%
// of the body, enough to move the wake length that Test 5 benchmarks against
// published measurements.
//
// Measuring which half of the difference does that gave a result worth writing
// down, because the intuitive answer is wrong:
//
//   squared/closed vs euclidean/closed     0 cells differ
//   squared/open   vs euclidean/open       0 cells differ
//   squared/closed vs squared/open         3 cells differ
//   euclidean/closed vs euclidean/open     3 cells differ
//
// The METRIC contributes nothing. All three cells come from `<=` against `<`,
// and they are exactly the three cell centres whose distance from the axis
// lands precisely on the radius in floating point. A wider search found no
// case where the metrics disagree at all: 0 disagreements in 12 million
// samples over 300 random circles on a 200x200 grid, and none at coordinates
// near 1e8 where squared distance loses precision that hypot keeps.
//
// So `closed` is a required parameter because it demonstrably decides cells.
// `metric` is a required parameter for two weaker but real reasons: it
// reproduces each source predicate's actual expression rather than an
// equivalent one, and Math.hypot is not required to be correctly rounded, so
// the observed equivalence is a property of this engine rather than a
// guarantee. Being honest about the difference in strength matters - no
// behavioural test can catch the removal of the squared branch, because
// nothing distinguishes the two. This comment is that guard, plus the
// cross-version canary in tests/test11.
//
// The same reasoning applies to half-planes, where it is not marginal at all:
// `<` and `<=` are separate comparisons, spelled out, never normalised.
//
// ---------------------------------------------------------------------------
// STRUCTURE
// ---------------------------------------------------------------------------
//
//   document   { operations: [ { op: "add" | "subtract", region } ] }
//   region     a primitive, or { all: [...] } | { any: [...] } | { not: region }
//   primitive  { kind: "disk" | "halfPlane" | "rect" | "polygon", ... }
//
// Operations apply in order: `add` marks solid where the region holds,
// `subtract` clears it. That is the painter's model a drawing tool produces,
// and it is also expressive enough for the analytic regions the existing
// scenarios use, which are unions of intersections.
//
// Boolean composition is exact - there is no arithmetic in `all`/`any`/`not` -
// so the only float-sensitive part of sampling is the individual comparison
// inside each primitive. That is what makes byte-identity achievable at all.

export class GeometryDocumentError extends Error {
  constructor(message) {
    super(message);
    this.name = "GeometryDocumentError";
  }
}

export const METRICS = ["squared", "euclidean"];
export const COMPARISONS = ["<", "<=", ">", ">="];

function compare(value, comparison, threshold) {
  switch (comparison) {
    case "<": return value < threshold;
    case "<=": return value <= threshold;
    case ">": return value > threshold;
    case ">=": return value >= threshold;
    default: return false;
  }
}

export const PRIMITIVES = {
  // A disk, with the distance metric and the boundary convention both stated.
  //
  // metric "squared"   compares (x-cx)**2 + (y-cy)**2 against radius*radius
  // metric "euclidean" compares Math.hypot(x-cx, y-cy) against radius
  //
  // Written as the exact expressions the original predicates used rather than
  // one expression with a flag. `closed` is what actually decides cells; see
  // the note at the top of this file for the measurement, and for why `metric`
  // is kept anyway despite no measured effect.
  disk: {
    label: "Circle",
    validate(shape) {
      requireFinite(shape, ["cx", "cy", "radius"]);
      if (!(shape.radius > 0)) fail(`disk radius must be positive, got ${shape.radius}`);
      if (!METRICS.includes(shape.metric)) {
        fail(
          `disk needs an explicit metric (${METRICS.join(" or ")}), got "${shape.metric}". ` +
          `No default, so that a document records which expression it was built against.`
        );
      }
      if (typeof shape.closed !== "boolean") {
        fail(
          `disk needs an explicit "closed" (true for <=, false for <), got ${shape.closed}. ` +
          `This one decides cells: on the cylinder body it is worth 3 of 113 solid cells, ` +
          `which is enough to move a benchmarked wake length.`
        );
      }
    },
    test(shape, x, y) {
      if (shape.metric === "squared") {
        const d2 = (x - shape.cx) ** 2 + (y - shape.cy) ** 2;
        const r2 = shape.radius * shape.radius;
        return shape.closed ? d2 <= r2 : d2 < r2;
      }
      const d = Math.hypot(x - shape.cx, y - shape.cy);
      return shape.closed ? d <= shape.radius : d < shape.radius;
    },
  },

  // An axis-aligned half-plane: one comparison against one coordinate. The
  // building block the analytic scenario predicates are actually made of.
  halfPlane: {
    label: "Half-plane",
    validate(shape) {
      requireFinite(shape, ["at"]);
      if (shape.axis !== "x" && shape.axis !== "y") {
        fail(`halfPlane axis must be "x" or "y", got "${shape.axis}"`);
      }
      if (!COMPARISONS.includes(shape.comparison)) {
        fail(
          `halfPlane needs an explicit comparison (${COMPARISONS.join(" ")}), ` +
          `got "${shape.comparison}"`
        );
      }
    },
    test(shape, x, y) {
      return compare(shape.axis === "x" ? x : y, shape.comparison, shape.at);
    },
  },

  // A rectangle. Half-open by default - closed on its low edges, open on its
  // high edges - so that abutting rectangles tile without overlapping or
  // leaving a seam. Each edge's comparison can still be named explicitly.
  rect: {
    label: "Rectangle",
    validate(shape) {
      requireFinite(shape, ["x0", "y0", "x1", "y1"]);
      if (shape.x1 <= shape.x0 || shape.y1 <= shape.y0) {
        fail(`rect needs x1 > x0 and y1 > y0, got (${shape.x0},${shape.y0})-(${shape.x1},${shape.y1})`);
      }
      for (const field of ["lowComparison", "highComparison"]) {
        if (shape[field] !== undefined && !COMPARISONS.includes(shape[field])) {
          fail(`rect ${field} must be one of ${COMPARISONS.join(" ")}, got "${shape[field]}"`);
        }
      }
    },
    test(shape, x, y) {
      const low = shape.lowComparison ?? ">=";
      const high = shape.highComparison ?? "<";
      return (
        compare(x, low, shape.x0) && compare(x, high, shape.x1) &&
        compare(y, low, shape.y0) && compare(y, high, shape.y1)
      );
    },
  },

  // A polygon, by even-odd ray casting along +x.
  //
  // The convention, stated because every polygon test has one and leaving it
  // implicit is the same mistake as the circle: a point exactly on an edge is
  // NOT reliably classified, because the test compares a floating-point
  // intersection abscissa. No existing scenario depends on a polygon, so
  // nothing is pinned to this behaviour - but a drawing tool will produce
  // vertices on cell centres often, so it is worth knowing.
  polygon: {
    label: "Polygon",
    validate(shape) {
      if (!Array.isArray(shape.vertices) || shape.vertices.length < 3) {
        fail(`polygon needs at least 3 vertices, got ${shape.vertices?.length ?? 0}`);
      }
      shape.vertices.forEach((vertex, n) => {
        if (!Number.isFinite(vertex?.x) || !Number.isFinite(vertex?.y)) {
          fail(`polygon vertex ${n} must have finite x and y, got ${JSON.stringify(vertex)}`);
        }
      });
    },
    test(shape, x, y) {
      const { vertices } = shape;
      let inside = false;
      for (let a = 0, b = vertices.length - 1; a < vertices.length; b = a++) {
        const va = vertices[a];
        const vb = vertices[b];
        if (va.y > y !== vb.y > y) {
          const crossing = ((vb.x - va.x) * (y - va.y)) / (vb.y - va.y) + va.x;
          if (x < crossing) inside = !inside;
        }
      }
      return inside;
    },
  },
};

function fail(message) {
  throw new GeometryDocumentError(message);
}

function requireFinite(shape, fields) {
  for (const field of fields) {
    if (!Number.isFinite(shape[field])) {
      fail(`${shape.kind}: "${field}" must be a finite number, got ${shape[field]}`);
    }
  }
}

export function validateRegion(region, where = "region") {
  if (!region || typeof region !== "object") {
    fail(`${where}: expected a region object, got ${region}`);
  }
  if (region.all || region.any) {
    const list = region.all ?? region.any;
    const name = region.all ? "all" : "any";
    if (!Array.isArray(list) || list.length === 0) {
      fail(`${where}: "${name}" needs a non-empty array of regions`);
    }
    list.forEach((child, n) => validateRegion(child, `${where}.${name}[${n}]`));
    return;
  }
  if (region.not) {
    validateRegion(region.not, `${where}.not`);
    return;
  }
  const primitive = PRIMITIVES[region.kind];
  if (!primitive) {
    fail(
      `${where}: unknown shape "${region.kind}". ` +
      `Known shapes: ${Object.keys(PRIMITIVES).join(", ")}`
    );
  }
  primitive.validate(region);
}

// Boolean composition. No arithmetic here, which is what keeps sampling
// bit-reproducible: every float comparison happens inside one primitive.
export function testRegion(region, x, y) {
  if (region.all) {
    for (const child of region.all) if (!testRegion(child, x, y)) return false;
    return true;
  }
  if (region.any) {
    for (const child of region.any) if (testRegion(child, x, y)) return true;
    return false;
  }
  if (region.not) return !testRegion(region.not, x, y);
  return PRIMITIVES[region.kind].test(region, x, y);
}

export function validateDocument(document) {
  if (!document || typeof document !== "object") {
    fail(`expected a geometry document, got ${document}`);
  }
  if (!Array.isArray(document.operations)) {
    fail(`a geometry document needs an "operations" array`);
  }
  document.operations.forEach((operation, n) => {
    if (operation?.op !== "add" && operation?.op !== "subtract") {
      fail(`operation ${n}: "op" must be "add" or "subtract", got "${operation?.op}"`);
    }
    validateRegion(operation.region, `operation ${n}`);
  });
  return document;
}

// Samples a document at cell centres, returning a fresh mask.
//
// Reads the grid only for its dimensions and its cellCentre - the same
// function the hand-written stamps used, so the sample points are identical.
// Nothing is written to the grid here; see applyDocument.
export function sampleDocument(document, grid) {
  validateDocument(document);
  const mask = new Uint8Array((grid.nx + 2) * (grid.ny + 2));
  for (let j = 1; j <= grid.ny; j++) {
    for (let i = 1; i <= grid.nx; i++) {
      const { x, y } = grid.cellCentre(i, j);
      let solid = false;
      for (const operation of document.operations) {
        if (!testRegion(operation.region, x, y)) continue;
        solid = operation.op === "add";
      }
      if (solid) mask[grid.idx(i, j)] = 1;
    }
  }
  return mask;
}

// Writes a sampled document onto a grid, bumping maskVersion so the solver's
// cached topology and the compiled boundary plan both rebuild.
export function applyDocument(grid, document) {
  const mask = sampleDocument(document, grid);
  grid.solid.set(mask);
  grid.maskVersion++;
  let solidCells = 0;
  for (let k = 0; k < mask.length; k++) solidCells += mask[k];
  return solidCells;
}
