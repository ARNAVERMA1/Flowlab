// MAC (marker-and-cell) staggered grid for 2D incompressible Navier-Stokes.
//
// Layout, following Griebel/Dornseifer/Neunhoeffer-style staggering:
//
//   - Pressure p sits at cell centers.
//   - u (x-velocity) sits on the vertical faces between cells (east/west faces).
//   - v (y-velocity) sits on the horizontal faces between cells (north/south faces).
//
// All three fields are stored on a common (nx+2) x (ny+2) array shape with a
// one-cell ghost border, even though u and v only have nx+1 / ny+1 physically
// meaningful positions along their staggered axis. The unused border entries
// cost negligible memory and keep indexing uniform across fields.
//
// Interior pressure cells: i = 1..nx, j = 1..ny (cell (i,j) center at
// x = (i-0.5)*h, y = (j-0.5)*h).
// Interior u faces (solved by the momentum equation): i = 1..nx-1, j = 1..ny.
// Boundary u faces (prescribed by BC, not updated by the momentum equation):
// i = 0 and i = nx.
// Interior v faces (solved by the momentum equation): i = 1..nx, j = 1..ny-1.
// Boundary v faces (prescribed by BC): j = 0 and j = ny.

export class StaggeredGrid {
  constructor(nx, ny, h) {
    if (!Number.isInteger(nx) || nx < 1) throw new Error("nx must be a positive integer");
    if (!Number.isInteger(ny) || ny < 1) throw new Error("ny must be a positive integer");
    if (!(h > 0)) throw new Error("h must be positive");

    this.nx = nx;
    this.ny = ny;
    this.h = h;
    this.stride = nx + 2;

    const size = (nx + 2) * (ny + 2);
    this.u = new Float64Array(size);
    this.v = new Float64Array(size);
    this.p = new Float64Array(size);

    // Cell-centred obstacle mask: 1 = solid, 0 = fluid. All fluid by
    // default, so a grid with no obstacles behaves exactly as before.
    // Bumping maskVersion tells the solver to rebuild anything it cached
    // from the mask.
    this.solid = new Uint8Array(size);
    this.maskVersion = 0;
  }

  idx(i, j) {
    return i + this.stride * j;
  }

  isSolid(i, j) {
    return this.solid[i + this.stride * j] === 1;
  }

  cellCentre(i, j) {
    return { x: (i - 0.5) * this.h, y: (j - 0.5) * this.h };
  }
}

// Marks every cell whose centre lies inside the circle as solid. This is a
// staircase representation of the body: the resolved shape is only accurate
// to about one cell, which is the dominant geometric error for a curved
// obstacle on a uniform grid. Cut-cell or immersed-boundary treatments that
// would fix that are well beyond M0.
// Marks every cell whose centre satisfies the predicate as solid. The same
// staircase caveat as stampCircle applies to any curved region defined this
// way. This is a primitive for building fixed domains in code - the
// interactive geometry pipeline is M5 and nothing here anticipates it.
export function stampWhere(grid, isSolidAt) {
  const { nx, ny } = grid;
  let count = 0;
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx; i++) {
      const { x, y } = grid.cellCentre(i, j);
      if (isSolidAt(x, y)) {
        grid.solid[grid.idx(i, j)] = 1;
        count++;
      }
    }
  }
  grid.maskVersion++;
  return count;
}

export function stampCircle(grid, cx, cy, radius) {
  const { nx, ny } = grid;
  let count = 0;
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx; i++) {
      const { x, y } = grid.cellCentre(i, j);
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) {
        grid.solid[grid.idx(i, j)] = 1;
        count++;
      }
    }
  }
  grid.maskVersion++;
  return count;
}
