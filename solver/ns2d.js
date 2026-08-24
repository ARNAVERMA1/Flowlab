// 2D incompressible Navier-Stokes solver.
//
// Method: Chorin projection (fractional step) on a MAC staggered grid.
//   1. Compute intermediate velocities F, G from advection (central
//      differencing, finite-volume flux form) + diffusion (mu * grad^2 u).
//   2. Solve the pressure Poisson equation grad^2 p = (rho/dt) * div(F,G)
//      with Jacobi iteration.
//   3. Correct: u = F - (dt/rho) dp/dx,  v = G - (dt/rho) dp/dy.
//
// This module only depends on plain arrays shaped like geometry/grid.js's
// StaggeredGrid (nx, ny, h, stride, u, v, p) - no import of that class is
// needed, and nothing here imports UI or rendering code.
//
// Boundary conditions are not a general pluggable framework (that is M4's
// job) - just a small descriptor consumed directly:
//
//   bc = { left, right, top, bottom }
//
// where each side is one of:
//   { type: "wall" }          no-slip: normal = 0, tangential = 0
//   { type: "freeSlip" }      normal = 0, tangential gradient = 0
//   { type: "inflow", u, v }  prescribed velocity (Dirichlet)
//   { type: "zeroGradient" }  open end: normal and tangential gradients = 0
//
// left/right control the u (normal) component and reflect/prescribe v
// (tangential) at that edge; top/bottom control v (normal) and
// reflect/prescribe u (tangential).
//
// Note on zeroGradient: the pressure Poisson equation here always uses
// Neumann pressure boundaries, which is solvable only if the net mass flux
// through the boundary is zero. zeroGradient does not enforce that by
// itself - it is only appropriate where the flow leaves the domain as
// cleanly as it enters (as in a unidirectional shear flow). A general
// outflow condition with flux correction is M4 work.

function idxFor(grid) {
  const { stride } = grid;
  return (i, j) => i + stride * j;
}

// Applies the velocity boundary conditions to an arbitrary (u, v) pair.
// Called both on the real velocity field and on the intermediate velocity
// field (F, G): the tentative velocity has to satisfy the same boundary
// conditions as the real one, or the divergence fed into the pressure
// solve picks up a spurious contribution at the boundary.
export function applyVelocityBoundaryConditions(grid, bc, u, v) {
  const { nx, ny } = grid;
  const idx = idxFor(grid);

  for (let j = 0; j <= ny + 1; j++) {
    const L = bc.left;
    if (L.type === "wall") {
      u[idx(0, j)] = 0;
      v[idx(0, j)] = -v[idx(1, j)];
    } else if (L.type === "freeSlip") {
      u[idx(0, j)] = 0;
      v[idx(0, j)] = v[idx(1, j)];
    } else if (L.type === "inflow") {
      u[idx(0, j)] = L.u;
      v[idx(0, j)] = v[idx(1, j)];
    } else if (L.type === "zeroGradient") {
      u[idx(0, j)] = u[idx(1, j)];
      v[idx(0, j)] = v[idx(1, j)];
    } else {
      throw new Error(`Unknown left BC type: ${L.type}`);
    }

    const R = bc.right;
    if (R.type === "wall") {
      u[idx(nx, j)] = 0;
      v[idx(nx + 1, j)] = -v[idx(nx, j)];
    } else if (R.type === "freeSlip") {
      u[idx(nx, j)] = 0;
      v[idx(nx + 1, j)] = v[idx(nx, j)];
    } else if (R.type === "inflow") {
      u[idx(nx, j)] = R.u;
      v[idx(nx + 1, j)] = v[idx(nx, j)];
    } else if (R.type === "zeroGradient") {
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
      u[idx(i, 0)] = -u[idx(i, 1)];
    } else if (B.type === "freeSlip") {
      v[idx(i, 0)] = 0;
      u[idx(i, 0)] = u[idx(i, 1)];
    } else if (B.type === "inflow") {
      v[idx(i, 0)] = B.v;
      u[idx(i, 0)] = u[idx(i, 1)];
    } else if (B.type === "zeroGradient") {
      v[idx(i, 0)] = v[idx(i, 1)];
      u[idx(i, 0)] = u[idx(i, 1)];
    } else {
      throw new Error(`Unknown bottom BC type: ${B.type}`);
    }

    const T = bc.top;
    if (T.type === "wall") {
      v[idx(i, ny)] = 0;
      u[idx(i, ny + 1)] = -u[idx(i, ny)];
    } else if (T.type === "freeSlip") {
      v[idx(i, ny)] = 0;
      u[idx(i, ny + 1)] = u[idx(i, ny)];
    } else if (T.type === "inflow") {
      v[idx(i, ny)] = T.v;
      u[idx(i, ny + 1)] = u[idx(i, ny)];
    } else if (T.type === "zeroGradient") {
      v[idx(i, ny)] = v[idx(i, ny - 1)];
      u[idx(i, ny + 1)] = u[idx(i, ny)];
    } else {
      throw new Error(`Unknown top BC type: ${T.type}`);
    }
  }
}

// Pressure: zero-gradient (Neumann) at every boundary. M0 only has
// prescribed-velocity boundaries (walls / free-slip / inflow / open ends),
// never a prescribed-pressure boundary, so this is the complete set.
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
  const { nx, ny, h, u, v } = grid;
  const idx = idxFor(grid);
  const h2 = h * h;

  // F at u-locations. Interior: i = 1..nx-1, j = 1..ny.
  // Boundary faces (i = 0, nx) are set afterwards by the BC pass.
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx - 1; i++) {
      const k = idx(i, j);
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
  // Boundary faces (j = 0, ny) are set afterwards by the BC pass.
  for (let i = 1; i <= nx; i++) {
    for (let j = 1; j <= ny - 1; j++) {
      const k = idx(i, j);
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
  const { nx, ny, h } = grid;
  const idx = idxFor(grid);
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx; i++) {
      const div = (F[idx(i, j)] - F[idx(i - 1, j)]) / h + (G[idx(i, j)] - G[idx(i, j - 1)]) / h;
      rhs[idx(i, j)] = (rho / dt) * div;
    }
  }
}

// Jacobi iteration for grad^2 p = rhs with Neumann boundaries. The pure
// Neumann problem is defined up to an additive constant; we pin it by
// zero-meaning the result, since M0's boundaries never prescribe pressure.
function solvePressurePoisson(grid, rhs, pNew, { tol = 1e-6, maxIterations = 2000 } = {}) {
  const { nx, ny, h, p } = grid;
  const idx = idxFor(grid);
  const h2 = h * h;

  let iterations = 0;
  let residual = Infinity;

  while (iterations < maxIterations) {
    applyPressureBoundaryConditions(grid);

    residual = 0;
    for (let j = 1; j <= ny; j++) {
      for (let i = 1; i <= nx; i++) {
        const k = idx(i, j);
        const neighborSum = p[idx(i + 1, j)] + p[idx(i - 1, j)] + p[idx(i, j + 1)] + p[idx(i, j - 1)];
        pNew[k] = (neighborSum - h2 * rhs[k]) / 4;

        const laplacian = (p[idx(i + 1, j)] - 2 * p[k] + p[idx(i - 1, j)]) / h2 +
                           (p[idx(i, j + 1)] - 2 * p[k] + p[idx(i, j - 1)]) / h2;
        const localResidual = Math.abs(laplacian - rhs[k]);
        if (localResidual > residual) residual = localResidual;
      }
    }

    for (let j = 1; j <= ny; j++) {
      for (let i = 1; i <= nx; i++) {
        p[idx(i, j)] = pNew[idx(i, j)];
      }
    }

    iterations++;
    if (residual < tol) break;
  }

  let sum = 0;
  let count = 0;
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx; i++) {
      sum += p[idx(i, j)];
      count++;
    }
  }
  const mean = sum / count;
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx; i++) {
      p[idx(i, j)] -= mean;
    }
  }

  return { iterations, residual };
}

function correctVelocities(grid, F, G, dt, rho) {
  const { nx, ny, h, u, v, p } = grid;
  const idx = idxFor(grid);

  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx - 1; i++) {
      u[idx(i, j)] = F[idx(i, j)] - (dt / rho) * (p[idx(i + 1, j)] - p[idx(i, j)]) / h;
    }
  }
  for (let i = 1; i <= nx; i++) {
    for (let j = 1; j <= ny - 1; j++) {
      v[idx(i, j)] = G[idx(i, j)] - (dt / rho) * (p[idx(i, j + 1)] - p[idx(i, j)]) / h;
    }
  }
}

// Per-grid scratch buffers, reused across timesteps. Kept out of
// StaggeredGrid so the geometry layer stays free of solver internals.
const scratchByGrid = new WeakMap();

function scratchFor(grid) {
  let s = scratchByGrid.get(grid);
  if (!s || s.F.length !== grid.u.length) {
    const size = grid.u.length;
    s = {
      F: new Float64Array(size),
      G: new Float64Array(size),
      rhs: new Float64Array(size),
      pNew: new Float64Array(size),
    };
    scratchByGrid.set(grid, s);
  }
  return s;
}

// Advance the grid state by one timestep. Mutates grid.u, grid.v, grid.p.
export function step(grid, bc, params) {
  const {
    nu,
    rho,
    dt,
    fx = 0,
    fy = 0,
    poissonTol = 1e-6,
    poissonMaxIterations = 2000,
  } = params;

  const { F, G, rhs, pNew } = scratchFor(grid);

  applyBoundaryConditions(grid, bc);

  computeIntermediateVelocities(grid, nu, dt, fx, fy, F, G);
  applyVelocityBoundaryConditions(grid, bc, F, G);

  computeRHS(grid, F, G, dt, rho, rhs);
  const poisson = solvePressurePoisson(grid, rhs, pNew, {
    tol: poissonTol,
    maxIterations: poissonMaxIterations,
  });
  correctVelocities(grid, F, G, dt, rho);

  applyBoundaryConditions(grid, bc);

  return { poissonIterations: poisson.iterations, poissonResidual: poisson.residual };
}

// Divergence of the velocity field at cell centers - the direct measure of
// how well incompressibility (continuity) is being satisfied.
export function computeDivergence(grid) {
  const { nx, ny, h, u, v } = grid;
  const idx = idxFor(grid);

  let max = 0;
  let sumSq = 0;
  let count = 0;
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx; i++) {
      const div = (u[idx(i, j)] - u[idx(i - 1, j)]) / h + (v[idx(i, j)] - v[idx(i, j - 1)]) / h;
      const a = Math.abs(div);
      if (a > max) max = a;
      sumSq += div * div;
      count++;
    }
  }
  return { max, rms: Math.sqrt(sumSq / count) };
}
