// 2D incompressible Navier-Stokes solver.
//
// Method: Chorin projection (fractional step) on a MAC staggered grid.
//   1. Compute intermediate velocities F, G from advection (central
//      differencing, finite-volume flux form) + diffusion (mu * grad^2 u).
//   2. Solve the pressure Poisson equation grad^2 p = (rho/dt) * div(F,G).
//   3. Correct: u = F - (dt/rho) dp/dx,  v = G - (dt/rho) dp/dy.
//
// This module only depends on plain arrays shaped like geometry/grid.js's
// StaggeredGrid (nx, ny, h, stride, u, v, p, solid, maskVersion) - no import
// of that class is needed, and nothing here imports UI or rendering code.
//
// Boundary conditions are not a general pluggable framework (that is M4's
// job) - just a small descriptor consumed directly:
//
//   bc = { left, right, top, bottom }
//
// where each side is one of:
//   { type: "wall", u?, v? }  no-slip. Optionally a moving wall with a
//                             prescribed tangential velocity: u for the
//                             top/bottom walls, v for left/right. Default 0.
//   { type: "freeSlip" }      normal = 0, tangential gradient = 0
//   { type: "inflow", u, v }  prescribed velocity (Dirichlet)
//   { type: "zeroGradient" }  open end: normal and tangential gradients = 0
//   { type: "outflow" }       zeroGradient plus a global flux correction
//
// left/right control the u (normal) component and reflect/prescribe v
// (tangential) at that edge; top/bottom control v (normal) and
// reflect/prescribe u (tangential).
//
// On zeroGradient vs outflow: the pressure Poisson equation here always uses
// Neumann pressure boundaries, which is solvable only if the net mass flux
// through the boundary is zero. zeroGradient does not enforce that, so it is
// only appropriate where the flow leaves as cleanly as it enters (a
// unidirectional shear flow). outflow rescales the outgoing faces so total
// outflow matches total inflow, which is what makes a uniform inlet usable
// with a developed outlet.
//
// Obstacles are given by the cell-centred grid.solid mask. A face between
// two solid cells lies inside the body; a face between a solid and a fluid
// cell lies exactly on the body surface. See applySolidBoundaryConditions.

function idxFor(grid) {
  const { stride } = grid;
  return (i, j) => i + stride * j;
}

export function applyVelocityBoundaryConditions(grid, bc, u, v) {
  const { nx, ny } = grid;
  const idx = idxFor(grid);

  for (let j = 0; j <= ny + 1; j++) {
    const L = bc.left;
    if (L.type === "wall") {
      // Tangential velocity lives half a cell off the wall, so a wall value
      // of vWall is imposed by reflecting about it: (v_ghost + v_1)/2 = vWall.
      u[idx(0, j)] = 0;
      v[idx(0, j)] = 2 * (L.v ?? 0) - v[idx(1, j)];
    } else if (L.type === "freeSlip") {
      u[idx(0, j)] = 0;
      v[idx(0, j)] = v[idx(1, j)];
    } else if (L.type === "inflow") {
      u[idx(0, j)] = L.u;
      v[idx(0, j)] = v[idx(1, j)];
    } else if (L.type === "zeroGradient" || L.type === "outflow") {
      u[idx(0, j)] = u[idx(1, j)];
      v[idx(0, j)] = v[idx(1, j)];
    } else {
      throw new Error(`Unknown left BC type: ${L.type}`);
    }

    const R = bc.right;
    if (R.type === "wall") {
      u[idx(nx, j)] = 0;
      v[idx(nx + 1, j)] = 2 * (R.v ?? 0) - v[idx(nx, j)];
    } else if (R.type === "freeSlip") {
      u[idx(nx, j)] = 0;
      v[idx(nx + 1, j)] = v[idx(nx, j)];
    } else if (R.type === "inflow") {
      u[idx(nx, j)] = R.u;
      v[idx(nx + 1, j)] = v[idx(nx, j)];
    } else if (R.type === "zeroGradient" || R.type === "outflow") {
      u[idx(nx, j)] = u[idx(nx - 1, j)];
      v[idx(nx + 1, j)] = v[idx(nx, j)];
    } else {
      throw new Error(`Unknown right BC type: ${R.type}`);
    }
  }

  for (let i = 0; i <= nx + 1; i++) {
    const B = bc.bottom;
    if (B.type === "wall") {
      v[idx(i, 0)] = 0;
      u[idx(i, 0)] = 2 * (B.u ?? 0) - u[idx(i, 1)];
    } else if (B.type === "freeSlip") {
      v[idx(i, 0)] = 0;
      u[idx(i, 0)] = u[idx(i, 1)];
    } else if (B.type === "inflow") {
      v[idx(i, 0)] = B.v;
      u[idx(i, 0)] = u[idx(i, 1)];
    } else if (B.type === "zeroGradient" || B.type === "outflow") {
      v[idx(i, 0)] = v[idx(i, 1)];
      u[idx(i, 0)] = u[idx(i, 1)];
    } else {
      throw new Error(`Unknown bottom BC type: ${B.type}`);
    }

    const T = bc.top;
    if (T.type === "wall") {
      v[idx(i, ny)] = 0;
      u[idx(i, ny + 1)] = 2 * (T.u ?? 0) - u[idx(i, ny)];
    } else if (T.type === "freeSlip") {
      v[idx(i, ny)] = 0;
      u[idx(i, ny + 1)] = u[idx(i, ny)];
    } else if (T.type === "inflow") {
      v[idx(i, ny)] = T.v;
      u[idx(i, ny + 1)] = u[idx(i, ny)];
    } else if (T.type === "zeroGradient" || T.type === "outflow") {
      v[idx(i, ny)] = v[idx(i, ny - 1)];
      u[idx(i, ny + 1)] = u[idx(i, ny)];
    } else {
      throw new Error(`Unknown top BC type: ${T.type}`);
    }
  }

  applySolidBoundaryConditions(grid, u, v);
  enforceGlobalFluxBalance(grid, bc, u, v);
}

// No-slip on the surface of an obstacle.
//
// A face with exactly one solid neighbour cell lies on the body surface, and
// its velocity component is normal to that surface: it is set to zero, which
// is both no-penetration and half of no-slip.
//
// A face with two solid neighbours lies inside the body. Those faces are not
// degrees of freedom, but they are read by the stencils of the fluid faces
// one layer out, where they act as ghosts for the *tangential* no-slip
// condition. Setting them to zero would place the wall half a cell inside
// the body; reflecting the adjacent fluid value instead puts the zero
// exactly on the cell boundary where the surface actually is.
//
// Worth knowing: the reflection is the textbook-correct treatment, but at 8
// cells per diameter it moves the Re=40 wake length by only 0.8% against
// simply zeroing those faces. The test suite does not resolve that
// difference, so this choice rests on the argument above rather than on
// measurement.
export function applySolidBoundaryConditions(grid, u, v) {
  const { nx, ny, solid } = grid;
  const idx = idxFor(grid);

  for (let j = 1; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const a = solid[idx(i, j)];
      const b = solid[idx(i + 1, j)];
      if (!a && !b) continue;
      const k = idx(i, j);
      if (a !== b) {
        u[k] = 0; // on the surface, normal component
        continue;
      }
      const fluidAbove = !solid[idx(i, j + 1)] && !solid[idx(i + 1, j + 1)];
      const fluidBelow = !solid[idx(i, j - 1)] && !solid[idx(i + 1, j - 1)];
      if (fluidAbove && !fluidBelow) u[k] = -u[idx(i, j + 1)];
      else if (fluidBelow && !fluidAbove) u[k] = -u[idx(i, j - 1)];
      else u[k] = 0;
    }
  }

  for (let i = 1; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const a = solid[idx(i, j)];
      const b = solid[idx(i, j + 1)];
      if (!a && !b) continue;
      const k = idx(i, j);
      if (a !== b) {
        v[k] = 0;
        continue;
      }
      const fluidRight = !solid[idx(i + 1, j)] && !solid[idx(i + 1, j + 1)];
      const fluidLeft = !solid[idx(i - 1, j)] && !solid[idx(i - 1, j + 1)];
      if (fluidRight && !fluidLeft) v[k] = -v[idx(i + 1, j)];
      else if (fluidLeft && !fluidRight) v[k] = -v[idx(i - 1, j)];
      else v[k] = 0;
    }
  }
}

// Rescales faces on "outflow" sides so total outflow matches total inflow.
// Without this the pure-Neumann pressure problem is not solvable: a uniform
// inlet paired with a zero-gradient outlet does not conserve mass on its own,
// and the projection has no way to fix a global imbalance.
function enforceGlobalFluxBalance(grid, bc, u, v) {
  const { nx, ny, h, solid } = grid;
  const idx = idxFor(grid);

  // Net flux counted positive *into* the domain.
  let net = 0;
  const faces = [];

  for (let j = 1; j <= ny; j++) {
    const kL = idx(0, j);
    const kR = idx(nx, j);
    net += u[kL] * h;
    net -= u[kR] * h;
    if (bc.left.type === "outflow" && !solid[idx(1, j)]) faces.push({ arr: u, k: kL, sign: 1 });
    if (bc.right.type === "outflow" && !solid[idx(nx, j)]) faces.push({ arr: u, k: kR, sign: -1 });
  }
  for (let i = 1; i <= nx; i++) {
    const kB = idx(i, 0);
    const kT = idx(i, ny);
    net += v[kB] * h;
    net -= v[kT] * h;
    if (bc.bottom.type === "outflow" && !solid[idx(i, 1)]) faces.push({ arr: v, k: kB, sign: 1 });
    if (bc.top.type === "outflow" && !solid[idx(i, ny)]) faces.push({ arr: v, k: kT, sign: -1 });
  }

  if (faces.length === 0) return;
  let signSum = 0;
  for (const f of faces) signSum += f.sign;
  if (signSum === 0) return;

  // Adding delta to every open outflow face changes the net influx by
  // signSum*delta*h; choose delta so the net becomes zero.
  const delta = -net / (signSum * h);
  for (const f of faces) f.arr[f.k] += delta;
}

// Pressure: zero-gradient (Neumann) at every boundary, domain and obstacle
// alike. M0 never prescribes pressure, so this is the complete set. The
// Poisson solve does not read these ghost values (see the reduced-diagonal
// treatment below); they are maintained so the stored field is consistent
// for anything that reads it.
export function applyPressureBoundaryConditions(grid) {
  const { nx, ny, p } = grid;
  const idx = idxFor(grid);
  for (let j = 1; j <= ny; j++) {
    p[idx(0, j)] = p[idx(1, j)];
    p[idx(nx + 1, j)] = p[idx(nx, j)];
  }
  for (let i = 1; i <= nx; i++) {
    p[idx(i, 0)] = p[idx(i, 1)];
    p[idx(i, ny + 1)] = p[idx(i, ny)];
  }
}

export function applyBoundaryConditions(grid, bc) {
  applyVelocityBoundaryConditions(grid, bc, grid.u, grid.v);
  applyPressureBoundaryConditions(grid);
}

function computeIntermediateVelocities(grid, nu, dt, fx, fy, F, G) {
  const { nx, ny, h, u, v, solid } = grid;
  const idx = idxFor(grid);
  const h2 = h * h;

  // F at u-locations. Interior: i = 1..nx-1, j = 1..ny. Faces touching a
  // solid cell are not degrees of freedom and are set by the BC pass.
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx - 1; i++) {
      const k = idx(i, j);
      if (solid[k] || solid[idx(i + 1, j)]) continue;
      const uij = u[k];
      const d2udx2 = (u[idx(i + 1, j)] - 2 * uij + u[idx(i - 1, j)]) / h2;
      const d2udy2 = (u[idx(i, j + 1)] - 2 * uij + u[idx(i, j - 1)]) / h2;

      const ue = (uij + u[idx(i + 1, j)]) / 2;
      const uw = (u[idx(i - 1, j)] + uij) / 2;
      const du2dx = (ue * ue - uw * uw) / h;

      const un = (uij + u[idx(i, j + 1)]) / 2;
      const us = (u[idx(i, j - 1)] + uij) / 2;
      const vn = (v[idx(i, j)] + v[idx(i + 1, j)]) / 2;
      const vs = (v[idx(i, j - 1)] + v[idx(i + 1, j - 1)]) / 2;
      const duvdy = (un * vn - us * vs) / h;

      F[k] = uij + dt * (nu * (d2udx2 + d2udy2) - du2dx - duvdy + fx);
    }
  }

  // G at v-locations. Interior: i = 1..nx, j = 1..ny-1.
  for (let i = 1; i <= nx; i++) {
    for (let j = 1; j <= ny - 1; j++) {
      const k = idx(i, j);
      if (solid[k] || solid[idx(i, j + 1)]) continue;
      const vij = v[k];
      const d2vdx2 = (v[idx(i + 1, j)] - 2 * vij + v[idx(i - 1, j)]) / h2;
      const d2vdy2 = (v[idx(i, j + 1)] - 2 * vij + v[idx(i, j - 1)]) / h2;

      const vn = (vij + v[idx(i, j + 1)]) / 2;
      const vs = (v[idx(i, j - 1)] + vij) / 2;
      const dv2dy = (vn * vn - vs * vs) / h;

      const ve = (vij + v[idx(i + 1, j)]) / 2;
      const vw = (v[idx(i - 1, j)] + vij) / 2;
      const ue = (u[idx(i, j)] + u[idx(i, j + 1)]) / 2;
      const uw = (u[idx(i - 1, j)] + u[idx(i - 1, j + 1)]) / 2;
      const duvdx = (ue * ve - uw * vw) / h;

      G[k] = vij + dt * (nu * (d2vdx2 + d2vdy2) - duvdx - dv2dy + fy);
    }
  }
}

function computeRHS(grid, F, G, dt, rho, rhs) {
  const { nx, ny, h, solid } = grid;
  const idx = idxFor(grid);
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx; i++) {
      const k = idx(i, j);
      if (solid[k]) { rhs[k] = 0; continue; }
      const div = (F[k] - F[idx(i - 1, j)]) / h + (G[k] - G[idx(i, j - 1)]) / h;
      rhs[k] = (rho / dt) * div;
    }
  }
}

// Pressure Poisson solve: red-black Gauss-Seidel with over-relaxation (SOR).
//
// Chosen over plain Jacobi because Jacobi needs O(N^2) iterations to
// converge on an N x N grid, which is affordable for the trivial cases but
// not for a driven cavity: measured 19,600 Jacobi iterations per timestep at
// 64x64, about 3 hours for a single steady-state run. SOR with the optimal
// relaxation factor needs O(N) instead. Red-black ordering is used because
// the two colours decouple (every neighbour of a red cell is black), which
// is what makes the classical optimal-omega theory apply.
//
// Neumann boundaries - domain walls and obstacle surfaces alike - are imposed
// by dropping the out-of-domain or solid neighbour and reducing the diagonal
// accordingly. That is algebraically identical to mirroring a ghost cell but
// needs no ghost update inside the sweep, which matters here because with
// red-black ordering a boundary cell's mirrored ghost has the same colour as
// the cell itself. It also makes obstacles fall out for free: a solid
// neighbour is dropped exactly like a wall.
//
// The pure-Neumann system is singular (defined up to an additive constant);
// we pin it by zero-meaning the result over the fluid cells.
function solvePressurePoisson(grid, rhs, cells, { residualTol, maxIterations, omega }) {
  const { nx, ny, h, p } = grid;
  const h2 = h * h;
  const w = omega ?? 2 / (1 + Math.sin(Math.PI / Math.max(nx, ny)));
  const { red, black, offsets, counts } = cells;

  let iterations = 0;
  let residual = Infinity;
  let converged = false;

  const sweep = (list) => {
    for (let m = 0; m < list.length; m++) {
      const k = list[m];
      const n = counts[k];
      if (n === 0) continue;
      let sum = 0;
      const base = k * 4;
      for (let d = 0; d < 4; d++) {
        const o = offsets[base + d];
        if (o !== 0) sum += p[k + o];
      }
      p[k] += w * ((sum - h2 * rhs[k]) / n - p[k]);
    }
  };

  while (iterations < maxIterations) {
    sweep(red);
    sweep(black);
    iterations++;

    residual = 0;
    // Negated comparisons so a NaN residual propagates rather than being
    // skipped - otherwise a diverged field reports residual 0 and
    // "converged", which is the opposite of the truth.
    for (let m = 0; m < red.length; m++) {
      const r = residualAt(red[m]);
      if (!(r <= residual)) residual = r;
    }
    for (let m = 0; m < black.length; m++) {
      const r = residualAt(black[m]);
      if (!(r <= residual)) residual = r;
    }
    // Bail out rather than grinding to maxIterations on a field that has
    // already blown up. Turning this into a clear, actionable failure for
    // the caller is M1's job; reporting it honestly is not optional.
    if (!Number.isFinite(residual)) break;
    if (residual < residualTol) { converged = true; break; }
  }

  function residualAt(k) {
    const n = counts[k];
    if (n === 0) return 0;
    let sum = 0;
    const base = k * 4;
    for (let d = 0; d < 4; d++) {
      const o = offsets[base + d];
      if (o !== 0) sum += p[k + o];
    }
    return Math.abs((sum - n * p[k]) / h2 - rhs[k]);
  }

  let sum = 0;
  const total = red.length + black.length;
  for (let m = 0; m < red.length; m++) sum += p[red[m]];
  for (let m = 0; m < black.length; m++) sum += p[black[m]];
  const mean = total > 0 ? sum / total : 0;
  for (let m = 0; m < red.length; m++) p[red[m]] -= mean;
  for (let m = 0; m < black.length; m++) p[black[m]] -= mean;

  return { iterations, residual, converged };
}

// The projected velocity is the intermediate field everywhere, minus the
// pressure gradient on exactly those faces the Poisson operator treated as
// degrees of freedom.
//
// The whole of F,G is copied across first, rather than only the corrected
// faces. F,G already satisfy the boundary and obstacle conditions, so this
// leaves u,v equal to the field whose divergence the pressure solve actually
// controlled. Re-deriving the boundary faces from u,v *after* this point
// would break that: an extrapolating outflow condition would recompute
// u[nx] from the just-corrected u[nx-1] and reintroduce divergence in the
// outlet column.
function correctVelocities(grid, F, G, dt, rho) {
  const { nx, ny, h, u, v, p, solid } = grid;
  const idx = idxFor(grid);

  u.set(F);
  v.set(G);

  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx - 1; i++) {
      const k = idx(i, j);
      if (solid[k] || solid[idx(i + 1, j)]) continue;
      u[k] = F[k] - (dt / rho) * (p[idx(i + 1, j)] - p[k]) / h;
    }
  }
  for (let i = 1; i <= nx; i++) {
    for (let j = 1; j <= ny - 1; j++) {
      const k = idx(i, j);
      if (solid[k] || solid[idx(i, j + 1)]) continue;
      v[k] = G[k] - (dt / rho) * (p[idx(i, j + 1)] - p[k]) / h;
    }
  }
}

// Per-grid scratch buffers and the precomputed fluid-cell topology, reused
// across timesteps. Kept out of StaggeredGrid so the geometry layer stays
// free of solver internals. Rebuilt when the obstacle mask changes.
const scratchByGrid = new WeakMap();

function scratchFor(grid) {
  let s = scratchByGrid.get(grid);
  if (s && s.F.length === grid.u.length && s.maskVersion === grid.maskVersion) return s;

  const size = grid.u.length;
  const { nx, ny, stride, solid } = grid;
  const idx = (i, j) => i + stride * j;

  // For each fluid cell, the offsets of its fluid neighbours (0 = dropped,
  // i.e. a domain boundary or an obstacle face, which are the same Neumann
  // condition) and how many there are.
  const offsets = new Int32Array(size * 4);
  const counts = new Uint8Array(size);
  const red = [];
  const black = [];
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx; i++) {
      const k = idx(i, j);
      if (solid[k]) continue;
      let n = 0;
      const base = k * 4;
      if (i > 1 && !solid[k - 1]) { offsets[base] = -1; n++; }
      if (i < nx && !solid[k + 1]) { offsets[base + 1] = 1; n++; }
      if (j > 1 && !solid[k - stride]) { offsets[base + 2] = -stride; n++; }
      if (j < ny && !solid[k + stride]) { offsets[base + 3] = stride; n++; }
      counts[k] = n;
      ((i + j) & 1 ? black : red).push(k);
    }
  }

  s = {
    F: new Float64Array(size),
    G: new Float64Array(size),
    rhs: new Float64Array(size),
    maskVersion: grid.maskVersion,
    cells: { red: Int32Array.from(red), black: Int32Array.from(black), offsets, counts },
  };
  scratchByGrid.set(grid, s);
  return s;
}

// Advance the grid state by one timestep. Mutates grid.u, grid.v, grid.p.
//
// divergenceTol is the knob for how hard the pressure solve works, expressed
// in the units that actually matter. After the correction step the remaining
// velocity divergence is exactly -(dt/rho) * (Poisson residual), so a
// residual tolerance of divergenceTol*rho/dt bounds the divergence of the
// field this step produces.
export function step(grid, bc, params) {
  const {
    nu,
    rho,
    dt,
    fx = 0,
    fy = 0,
    divergenceTol = 1e-8,
    poissonMaxIterations = 5000,
    omega,
  } = params;

  const { F, G, rhs, cells } = scratchFor(grid);

  applyBoundaryConditions(grid, bc);

  // Seed the whole intermediate field from the current velocity so that every
  // face the momentum update skips (boundary faces, and faces on or inside an
  // obstacle) still carries a meaningful value for the BC pass to work from.
  F.set(grid.u);
  G.set(grid.v);
  computeIntermediateVelocities(grid, nu, dt, fx, fy, F, G);
  applyVelocityBoundaryConditions(grid, bc, F, G);

  computeRHS(grid, F, G, dt, rho, rhs);
  const poisson = solvePressurePoisson(grid, rhs, cells, {
    residualTol: (divergenceTol * rho) / dt,
    maxIterations: poissonMaxIterations,
    omega,
  });
  correctVelocities(grid, F, G, dt, rho);

  // Only the pressure ghosts are refreshed here. The velocity boundary values
  // already came through F,G and must not be re-derived - see correctVelocities.
  applyPressureBoundaryConditions(grid);

  return {
    poissonIterations: poisson.iterations,
    poissonResidual: poisson.residual,
    poissonConverged: poisson.converged,
  };
}

// Divergence of the velocity field at fluid cell centers - the direct
// measure of how well incompressibility (continuity) is being satisfied.
export function computeDivergence(grid) {
  const { nx, ny, h, u, v, solid } = grid;
  const idx = idxFor(grid);

  let max = 0;
  let sumSq = 0;
  let count = 0;
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx; i++) {
      const k = idx(i, j);
      if (solid[k]) continue;
      const div = (u[k] - u[idx(i - 1, j)]) / h + (v[k] - v[idx(i, j - 1)]) / h;
      const a = Math.abs(div);
      // Negated comparison so NaN propagates instead of being skipped: a
      // blown-up field must not report divergence of zero. `a > max` is false
      // for NaN, which silently made an all-NaN field look perfectly
      // incompressible.
      if (!(a <= max)) max = a;
      sumSq += div * div;
      count++;
    }
  }
  return { max, rms: count > 0 ? Math.sqrt(sumSq / count) : 0 };
}
