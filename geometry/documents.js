// Geometry documents for the validated scenarios.
//
// These replace the hand-written predicates that stampCircle and stampWhere
// were called with. Every one of them is byte-identical to the predicate it
// replaces on the grids the scenarios use - see tests/test11, which compares
// against a verbatim copy of each original.
//
// That constraint drove the shape of these builders. They are NOT written the
// way you would write them fresh: the bend is expressed as a union of three
// mutually exclusive cases because the original predicate was a chain of `if`
// statements, and reproducing its arithmetic exactly matters more than
// expressing the same region more elegantly. The cylinder uses a closed disk
// because stampCircle used `<=`, and that choice is worth three cells of the
// body.
//
// Numbers are passed in rather than recomputed here, so that expressions like
// `Lx - w` are evaluated once by the caller and the same double reaches both
// the old predicate and the new document.

// `label` is optional and carries no meaning to the sampler - sampleDocument
// reads `op` and `region` and nothing else, so labelling a scenario's shapes
// cannot move a cell. It exists so the shape list in the UI can say "cylinder"
// rather than "any of 3", which is what a scenario's analytic region honestly
// summarises to when it is described structurally.

// The cylinder body. Closed, because stampCircle compares squared distance
// with `<=` and the three cell centres that land exactly on the radius belong
// inside the body - which is what Test 5's wake length was benchmarked with.
export function cylinderDocument({ cx, cy, radius }) {
  return {
    operations: [
      {
        op: "add",
        label: "cylinder",
        region: { kind: "disk", cx, cy, radius, metric: "squared", closed: true },
      },
    ],
  };
}

// The 90-degree duct.
//
// The original predicate is a chain of cases rather than a boolean expression:
// inside the corner quadrant it tests an annulus; to the left of it, the inlet
// leg's outer wall; below it, the outlet leg's. The three cases are mutually
// exclusive and cover the plane, so their union is the same region - and since
// boolean composition introduces no arithmetic, the union is bit-identical
// rather than merely equivalent.
//
// `d > ro` becomes `not(d <= ro)`: the complement of a CLOSED disk, not an
// open one. Getting that backwards would move the outer duct wall by the cells
// sitting exactly on the outer radius.
export function bendDocument({ Lx, Ly, w, innerRadius }) {
  if (innerRadius === null) {
    // Mitre bend: the solid is the quadrant below and left of the corner.
    return {
      operations: [
        {
          op: "add",
          label: "mitre corner block",
          region: {
            all: [
              { kind: "halfPlane", axis: "x", comparison: "<", at: Lx - w },
              { kind: "halfPlane", axis: "y", comparison: "<", at: Ly - w },
            ],
          },
        },
      ],
    };
  }

  const ri = innerRadius;
  const ro = ri + w;
  const cx = Lx - ro;
  const cy = Ly - ro;

  const insideCorner = [
    { kind: "halfPlane", axis: "x", comparison: ">=", at: cx },
    { kind: "halfPlane", axis: "y", comparison: ">=", at: cy },
  ];

  return {
    operations: [
      {
        op: "add",
        label: "duct walls",
        region: {
          any: [
            // In the corner quadrant: everything outside the duct annulus.
            {
              all: [
                ...insideCorner,
                {
                  any: [
                    { kind: "disk", cx, cy, radius: ri, metric: "euclidean", closed: false },
                    { not: { kind: "disk", cx, cy, radius: ro, metric: "euclidean", closed: true } },
                  ],
                },
              ],
            },
            // Left of the corner: the inlet leg's outer wall.
            {
              all: [
                { kind: "halfPlane", axis: "x", comparison: "<", at: cx },
                { kind: "halfPlane", axis: "y", comparison: "<", at: Ly - w },
              ],
            },
            // Below the corner: the outlet leg's outer wall.
            {
              all: [
                { kind: "halfPlane", axis: "x", comparison: ">=", at: cx },
                { kind: "halfPlane", axis: "y", comparison: "<", at: cy },
                { kind: "halfPlane", axis: "x", comparison: "<", at: Lx - w },
              ],
            },
          ],
        },
      },
    ],
  };
}

// A domain with no solid at all - the cavity, the channel, the diffusion box.
// Named rather than left as `{ operations: [] }` at four call sites, so that
// "this scenario has no geometry" is a statement rather than an absence.
export function emptyDocument() {
  return { operations: [] };
}
