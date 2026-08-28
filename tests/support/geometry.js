// The scenarios' original geometry expressions, and the machinery for checking
// a document reproduces them.
//
// These predicates are COPIES of the arithmetic in scenarios/index.js and
// geometry/grid.js, written out again rather than imported. That is the whole
// point of the comparison: importing the scenario's own geometry would only
// prove the document agrees with itself. What has to be shown is that the
// document reproduces the expression the validated results were measured with,
// cell for cell, on the exact grids those results used.
//
// Shared between tests/test11_m5_geometry.js, which asserts it, and
// validation/measure.js, which records it - one definition, so the test and the
// validation record cannot describe different computations.

import { StaggeredGrid } from "../../geometry/grid.js";
import { applyDocument, sampleDocument } from "../../geometry/document.js";

// The cylinder scenario's grid and circle placement.
export function cylinderGeometry() {
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

// The bend scenarios' grid and duct dimensions. `innerRadius` null is the
// mitre; 1 is the radiused corner.
export function bendGeometry() {
  const w = 1;
  const cpw = 12;
  const legLen = 6;
  const h = w / cpw;
  const Lx = legLen * w + w;
  return { w, h, Lx, Ly: Lx, n: Math.round(Lx / h) };
}

// The duct predicate as originally written: a chain of cases, not a boolean
// expression. Inside the corner quadrant it tests an annulus; to the left, the
// inlet leg's outer wall; below, the outlet leg's.
export function originalBendPredicate({ Lx, Ly, w, innerRadius }) {
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

export function countMask(mask) {
  let n = 0;
  for (let k = 0; k < mask.length; k++) n += mask[k];
  return n;
}

export function compareAgainstPredicate(grid, document, predicate) {
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

// ---------------------------------------------------------------------------
// The surface-condition harness: a channel with a drawn rectangular block
// ---------------------------------------------------------------------------

export function channelWithBlock({ cpw = 20, length = 3 } = {}) {
  const h = 1 / cpw;
  const grid = new StaggeredGrid(Math.round(length / h), cpw, h);
  const document = {
    operations: [{ op: "add", region: { kind: "rect", x0: 1.0, y0: 0.3, x1: 1.4, y1: 0.7 } }],
  };
  applyDocument(grid, document);
  return {
    grid, h, document,
    params: {
      nu: 0.02, rho: 1, dt: 0.4 * Math.min((0.25 * h * h) / 0.02, h / 4),
      divergenceTol: 1e-7, poissonMaxIterations: 20000,
    },
  };
}

// u-face midpoints sit at cell BOUNDARIES (x = i*h) while v-face midpoints sit
// at cell CENTRES (x = (i-0.5)*h), so a narrow band around a boundary selects
// only faces of one orientation. Getting this wrong is the easiest mistake to
// make when writing a selector, and it shows up as a staircase rejection.
export const BLOCK_UPSTREAM_FACE = { kind: "rect", x0: 0.99, y0: 0.29, x1: 1.01, y1: 0.71 };
export const BLOCK_DOWNSTREAM_FACE = { kind: "rect", x0: 1.39, y0: 0.29, x1: 1.41, y1: 0.71 };
export const WHOLE_DOMAIN = { kind: "rect", x0: -1, y0: -1, x1: 9, y1: 9 };

export const CHANNEL_BC = {
  left: { type: "inflow", u: 1, v: 0 },
  right: { type: "outflow" },
  top: { type: "wall" },
  bottom: { type: "wall" },
};

// The flux actually carried through the faces one surface attachment claims,
// signed so that flow INTO the fluid is positive whichever way the surface
// faces. Reading it off the velocity field rather than off the specification is
// the point: on a surface that prescribes a rate, this is the check; on one
// that prescribes a pressure, it is the answer.
export function fluxThroughAttachment(grid, plan) {
  let delivered = 0;
  for (let j = 1; j <= grid.ny; j++) {
    for (let i = 0; i <= grid.nx; i++) {
      const k = grid.idx(i, j);
      const a = grid.solid[k];
      if (a === grid.solid[grid.idx(i + 1, j)]) continue;
      if (plan.surfaces.u[k] < 0) continue;
      delivered += (a ? 1 : -1) * grid.u[k] * grid.h;
    }
  }
  return delivered;
}

// Peak velocity on solid faces that no surface attachment claims - the parts
// still carrying plain no-slip, where the normal component must be exactly
// zero. Faces an attachment does claim are excluded because a blowing or
// moving surface is supposed to be nonzero there.
export function maxVelocityOnUnclaimedSurface(grid, plan) {
  let m = 0;
  for (let j = 1; j <= grid.ny; j++) {
    for (let i = 0; i <= grid.nx; i++) {
      const k = grid.idx(i, j);
      if (grid.solid[k] === grid.solid[grid.idx(i + 1, j)]) continue;
      if (plan.surfaces.u[k] >= 0) continue;
      m = Math.max(m, Math.abs(grid.u[k]));
    }
  }
  for (let i = 1; i <= grid.nx; i++) {
    for (let j = 0; j <= grid.ny; j++) {
      const k = grid.idx(i, j);
      if (grid.solid[k] === grid.solid[grid.idx(i, j + 1)]) continue;
      if (plan.surfaces.v[k] >= 0) continue;
      m = Math.max(m, Math.abs(grid.v[k]));
    }
  }
  return m;
}
