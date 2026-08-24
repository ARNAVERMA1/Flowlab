// 2D incompressible Navier-Stokes solver.
//
// Method: Chorin projection (fractional step) on a MAC staggered grid.
//   1. Compute intermediate velocities F, G from advection (central
//      differencing, finite-volume flux form) + diffusion (mu * grad^2 u).
//   2. Solve the pressure Poisson equation grad^2 p = (rho/dt) * div(F,G).
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
//   { type: "wall", u?, v? }  no-slip. Optionally a moving wall with a
//                             prescribed tangential velocity: u for the
//                             top/bottom walls, v for left/right. Default 0.
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
    } else if (L.type === "zeroGradient") {
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
      u[idx(i, 0)] = 2 * (B.u ?? 0) - u[idx(i, 1)];
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
      u[idx(i, ny + 1)] = 2 * (T.u ?? 0) - u[idx(i, ny)];
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
// The Poisson solve itself does not use these ghost values (see the
// reduced-diagonal treatment below); they are maintained so the stored
// pressure field is consistent for anything that reads it.
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

// Pressure Poisson solve: red-black Gauss-Seidel with over-relaxation (SOR).
//
// Chosen over plain Jacobi because Jacobi needs O(N^2) iterations to
// converge on an N x N grid, which is affordable for the trivial cases but
// not for a driven cavity: measured 19,600 Jacobi iterations per timestep at
// 64x64, about 3 hours for a single steady-state run. SOR with the optimal
// relaxation factor needs O(N) iterations instead. Red-black ordering is
// used because the two colours decouple (every neighbour of a red cell is
// black), which is what makes the classical optimal-omega theory apply and
// keeps the sweep order irrelevant.
//
// Neumann boundaries are imposed by dropping the out-of-domain neighbour and
// reducing the diagonal accordingly. That is algebraically identical to
// mirroring a ghost cell, but needs no ghost update inside the sweep - which
// matters here, because with red-black ordering a boundary cell's mirrored
// ghost has the same colour as the cell itself.
//
// The pure-Neumann system is singular (defined up to an additive constant);
// we pin it by zero-meaning the result, since M0 never prescribes pressure.
function solvePressurePoisson(grid, rhs, { residualTol, maxIterations, omega }) {
  const { nx, ny, h, stride, p } = grid;
  const idx = idxFor(grid);
  const h2 = h * h;

  // Optimal SOR factor for the Poisson problem on this grid.
  const w = omega ?? 2 / (1 + Math.sin(Math.PI / Math.max(nx, ny)));

  let iterations = 0;
  let residual = Infinity;
  let converged = false;

  while (iterations < maxIterations) {
    for (let color = 0; color < 2; color++) {
      for (let j = 1; j <= ny; j++) {
        for (let i = 1; i <= nx; i++) {
          if (((i + j) & 1) !== color) continue;
          const k = idx(i, j);
          let sum = 0;
          let n = 0;
          if (i > 1) { sum += p[k - 1]; n++; }
          if (i < nx) { sum += p[k + 1]; n++; }
          if (j > 1) { sum += p[k - stride]; n++; }
          if (j < ny) { sum += p[k + stride]; n++; }
          p[k] += w * ((sum - h2 * rhs[k]) / n - p[k]);
        }
      }
    }
    iterations++;

    residual = 0;
    for (let j = 1; j <= ny; j++) {
      for (let i = 1; i <= nx; i++) {
        const k = idx(i, j);
        let sum = 0;
        let n = 0;
        if (i > 1) { sum += p[k - 1]; n++; }
        if (i < nx) { sum += p[k + 1]; n++; }
        if (j > 1) { sum += p[k - stride]; n++; }
        if (j < ny) { sum += p[k + stride]; n++; }
        const r = Math.abs((sum - n * p[k]) / h2 - rhs[k]);
        if (r > residual) residual = r;
      }
    }
    if (residual < residualTol) { converged = true; break; }
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

  return { iterations, residual, converged };
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
    s = { F: new Float64Array(size), G: new Float64Array(size), rhs: new Float64Array(size) };
    scratchByGrid.set(grid, s);
  }
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

  const { F, G, rhs } = scratchFor(grid);

  applyBoundaryConditions(grid, bc);

  computeIntermediateVelocities(grid, nu, dt, fx, fy, F, G);
  applyVelocityBoundaryConditions(grid, bc, F, G);

  computeRHS(grid, F, G, dt, rho, rhs);
  const poisson = solvePressurePoisson(grid, rhs, {
    residualTol: (divergenceTol * rho) / dt,
    maxIterations: poissonMaxIterations,
    omega,
  });
  correctVelocities(grid, F, G, dt, rho);

  applyBoundaryConditions(grid, bc);

  return {
    poissonIterations: poisson.iterations,
    poissonResidual: poisson.residual,
    poissonConverged: poisson.converged,
  };
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
