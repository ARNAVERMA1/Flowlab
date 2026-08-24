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
  }

  idx(i, j) {
    return i + this.stride * j;
  }
}
