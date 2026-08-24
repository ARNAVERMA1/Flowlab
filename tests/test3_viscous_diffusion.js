// M0 Test 3 - Viscous diffusion.
//
// Isolates and tests the mu*grad^2(u) term against the analytical diffusion
// solution.
//
// Both cases below use a unidirectional shear flow: u varies with y only,
// v = 0 everywhere. Under those conditions the full momentum equation
// collapses exactly onto the 1D heat equation:
//
//   u.grad(u) = u du/dx + v du/dy = u*0 + 0*du/dy = 0   (nonlinear term dead)
//   div(u)    = du/dx + dv/dy     = 0 + 0        = 0    (pressure term dead)
//   =>  du/dt = nu * d2u/dy2
//
// So the isolation is structural, not approximate - and the tests assert it
// by checking that v and the divergence stay at exactly zero throughout. If
// either drifts, the advection or projection step is leaking into a case
// where it has no business acting, and the diffusion measurement below
// would be meaningless.
//
// Boundaries: free-slip top/bottom (no wall friction, so no boundary layer
// competes with the diffusion being measured - that is Test 4's job), and
// open (zero-gradient) left/right ends, since a y-varying unidirectional
// flow cannot be contained by walls that force the normal velocity to zero.

import test from "node:test";
import assert from "node:assert/strict";
import { StaggeredGrid } from "../geometry/grid.js";
import { step, computeDivergence } from "../solver/ns2d.js";
import {
  decayingShearMode,
  spreadingShearLayer,
  spreadingShearLayerCentreSlope,
} from "./support/analytical.js";

const OPEN_CHANNEL_BC = {
  left: { type: "zeroGradient" },
  right: { type: "zeroGradient" },
  top: { type: "freeSlip" },
  bottom: { type: "freeSlip" },
};

// ---------------------------------------------------------------------------
// Case A - decaying shear mode.
//
// u(y,0) = U0*cos(k*y) with k = 2*pi/Ly is an eigenmode of the diffusion
// operator, so it decays in place without changing shape:
//   u(y,t) = U0*cos(k*y)*exp(-nu*k^2*t)
//
// It is also an eigenmode of the *discrete* Laplacian:
//   (u_{j+1} - 2u_j + u_{j-1})/h^2 = -(4/h^2)*sin^2(k*h/2) * u_j
// and the free-slip ghost mirror (u_0 = u_1, u_{ny+1} = u_ny about cell
// centres at y = (j-0.5)h) is exact for a cosine of this wavenumber. So the
// fully discrete solution is known in closed form, which lets us separate
// "the code has a bug" from "the scheme has truncation error".
// ---------------------------------------------------------------------------

const A = {
  Ly: 1.0,
  nx: 4,
  nu: 0.01,
  rho: 1000,
  U0: 1.0,
  dt: 2e-4,
  steps: 4430, // t = 0.886, i.e. nu*k^2*t = 0.35 -> decays to ~70%
};
A.k = (2 * Math.PI) / A.Ly;
A.t = A.dt * A.steps;

function runDecayingMode(ny) {
  const h = A.Ly / ny;
  const grid = new StaggeredGrid(A.nx, ny, h);

  const mode = [];
  for (let j = 1; j <= ny; j++) mode[j] = Math.cos(A.k * (j - 0.5) * h);

  for (let j = 0; j <= ny + 1; j++) {
    const u0 = decayingShearMode((j - 0.5) * h, 0, { U0: A.U0, k: A.k, nu: A.nu });
    for (let i = 0; i <= A.nx + 1; i++) grid.u[grid.idx(i, j)] = u0;
  }

  const params = { nu: A.nu, rho: A.rho, dt: A.dt };
  let maxV = 0;
  let maxDiv = 0;
  for (let n = 0; n < A.steps; n++) {
    step(grid, OPEN_CHANNEL_BC, params);
    for (const val of grid.v) maxV = Math.max(maxV, Math.abs(val));
    maxDiv = Math.max(maxDiv, computeDivergence(grid).max);
  }

  // Amplitude by projection of the computed field onto the sampled mode.
  let num = 0;
  let den = 0;
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= A.nx - 1; i++) {
      num += grid.u[grid.idx(i, j)] * mode[j];
      den += mode[j] * mode[j];
    }
  }
  const amplitude = num / den;

  // Closed-form fully discrete solution: explicit Euler on the discrete
  // eigenvalue lambdaH, i.e. amplitude = U0 * (1 + nu*lambdaH*dt)^steps.
  const lambdaH = -(4 / (h * h)) * Math.sin((A.k * h) / 2) ** 2;
  const growth = 1 + A.nu * lambdaH * A.dt;
  const amplitudeDiscrete = A.U0 * growth ** A.steps;

  let maxFieldError = 0;
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= A.nx - 1; i++) {
      maxFieldError = Math.max(
        maxFieldError,
        Math.abs(grid.u[grid.idx(i, j)] - amplitudeDiscrete * mode[j])
      );
    }
  }

  const rateExact = A.nu * A.k * A.k;
  const rateMeasured = -Math.log(amplitude / A.U0) / A.t;
  // The scheme's own predicted decay rate, from the closed form above.
  const ratePredicted = -Math.log(growth) / A.dt;

  return {
    ny,
    h,
    amplitude,
    amplitudeDiscrete,
    amplitudeExact: A.U0 * Math.exp(-rateExact * A.t),
    maxFieldError,
    maxV,
    maxDiv,
    rateMeasured,
    rateExact,
    rateRelError: Math.abs(rateMeasured - rateExact) / rateExact,
    ratePredictedRelError: Math.abs(ratePredicted - rateExact) / rateExact,
  };
}

test("Test 3A - decaying shear mode matches the analytical diffusion rate", () => {
  const r = runDecayingMode(64);

  console.log(
    `[Test 3A] ny=${r.ny} t=${A.t}\n` +
    `          amplitude: solver=${r.amplitude.toFixed(10)} ` +
    `discrete-closed-form=${r.amplitudeDiscrete.toFixed(10)} ` +
    `analytical=${r.amplitudeExact.toFixed(10)}\n` +
    `          decay rate: solver=${r.rateMeasured.toFixed(8)} analytical=${r.rateExact.toFixed(8)} ` +
    `(rel err ${r.rateRelError.toExponential(3)})\n` +
    `          |field - discrete closed form|=${r.maxFieldError.toExponential(3)} ` +
    `max|v|=${r.maxV.toExponential(3)} max|div|=${r.maxDiv.toExponential(3)}`
  );

  // Structural: the case really is pure diffusion.
  assert.ok(r.maxV < 1e-14, `v must stay 0 in unidirectional flow, got ${r.maxV}`);
  assert.ok(r.maxDiv < 1e-14, `divergence must stay 0, got ${r.maxDiv}`);

  // Implementation: the solver reproduces the closed-form discrete solution
  // to roundoff. Any real coding error in the diffusion term shows up here.
  assert.ok(
    r.maxFieldError < 1e-11,
    `solver should match the closed-form discrete solution, got ${r.maxFieldError}`
  );

  // Physics: the decay rate agrees with nu*k^2.
  assert.ok(
    r.rateRelError < 1e-3,
    `decay rate should match nu*k^2 within 0.1% at ny=64, got ${r.rateRelError}`
  );

  // And the residual disagreement is the scheme's own truncation error, not
  // something unexplained: the closed-form prediction of the error matches
  // the observed error to better than 1%.
  const explained = Math.abs(r.rateRelError - r.ratePredictedRelError) / r.ratePredictedRelError;
  console.log(
    `          rate error: observed=${r.rateRelError.toExponential(3)} ` +
    `predicted-by-scheme=${r.ratePredictedRelError.toExponential(3)} ` +
    `unexplained=${(explained * 100).toFixed(4)}%`
  );
  assert.ok(
    explained < 0.01,
    `observed rate error should be explained by the scheme's truncation error, off by ${explained}`
  );
});

test("Test 3A - diffusion term converges at 2nd order in space", () => {
  const results = [16, 32, 64].map(runDecayingMode);

  console.log("[Test 3A convergence] decay-rate error vs analytical nu*k^2:");
  for (let n = 0; n < results.length; n++) {
    const r = results[n];
    const order = n > 0 ? Math.log2(results[n - 1].rateRelError / r.rateRelError) : NaN;
    console.log(
      `          ny=${String(r.ny).padStart(3)} h=${r.h.toFixed(5)} ` +
      `relErr=${r.rateRelError.toExponential(3)} ` +
      `order=${n > 0 ? order.toFixed(3) : "  -  "} ` +
      `[leading theory (k*h)^2/12=${((A.k * r.h) ** 2 / 12).toExponential(3)}]`
    );
  }

  for (let n = 1; n < results.length; n++) {
    const order = Math.log2(results[n - 1].rateRelError / results[n].rateRelError);
    assert.ok(
      order > 1.9 && order < 2.2,
      `expected ~2nd order convergence between ny=${results[n - 1].ny} and ny=${results[n].ny}, got ${order}`
    );
  }
});

// ---------------------------------------------------------------------------
// Case B - spreading shear layer.
//
// The literal "give part of the field a velocity and watch it spread" test.
// A shear layer diffuses outward and its thickness grows as sqrt(nu*t):
//   u(y,t) = (U0/2)*(1 + erf((y-y0)/(2*sqrt(nu*t))))
//
// Unlike case A this is a broadband profile, not a single eigenmode, so it
// exercises the discrete Laplacian's response across wavenumbers rather
// than at one. It is started from the analytical profile at t0 > 0 rather
// than from a raw step: a discontinuity sampled on a grid is not resolved
// at any resolution, and the resulting initial-condition error would swamp
// what is being measured. The order-of-accuracy claim lives in case A,
// where the analytical solution is exact to machine precision.
// ---------------------------------------------------------------------------

const B = {
  Ly: 1.0,
  nx: 4,
  ny: 200,
  nu: 0.005,
  rho: 1000,
  U0: 1.0,
  y0: 0.5,
  t0: 0.08, // initial layer thickness 2*sqrt(nu*t0) = 0.04 = 8 cells
  dt: 2.5e-4,
  steps: 2560, // T = 0.64, final thickness 2*sqrt(nu*t1) = 0.12 = 24 cells
};

test("Test 3B - shear layer spreads at the analytical diffusion rate", () => {
  const h = B.Ly / B.ny;
  const grid = new StaggeredGrid(B.nx, B.ny, h);
  const props = { U0: B.U0, y0: B.y0, nu: B.nu };

  // Stability margins for these parameters: diffusion number
  // nu*dt/h^2 = 0.05 (explicit limit 0.25), CFL |u|*dt/h = 0.05.
  const diffusionNumber = (B.nu * B.dt) / (h * h);
  assert.ok(diffusionNumber < 0.25, `diffusion number ${diffusionNumber} exceeds explicit stability limit`);

  for (let j = 0; j <= B.ny + 1; j++) {
    const u0 = spreadingShearLayer((j - 0.5) * h, B.t0, props);
    for (let i = 0; i <= B.nx + 1; i++) grid.u[grid.idx(i, j)] = u0;
  }

  const params = { nu: B.nu, rho: B.rho, dt: B.dt };
  const centreCell = Math.round(B.y0 / h); // y0 sits on the face between centreCell and centreCell+1
  const samples = [];
  let maxV = 0;
  let maxDiv = 0;

  for (let n = 1; n <= B.steps; n++) {
    step(grid, OPEN_CHANNEL_BC, params);
    for (const val of grid.v) maxV = Math.max(maxV, Math.abs(val));
    maxDiv = Math.max(maxDiv, computeDivergence(grid).max);

    if (n % (B.steps / 4) === 0) {
      const t = B.t0 + n * B.dt;
      const slope =
        (grid.u[grid.idx(1, centreCell + 1)] - grid.u[grid.idx(1, centreCell)]) / h;
      samples.push({ t, slope, slopeExact: spreadingShearLayerCentreSlope(t, props) });
    }
  }

  const t1 = B.t0 + B.steps * B.dt;
  let maxProfileError = 0;
  for (let j = 1; j <= B.ny; j++) {
    const exact = spreadingShearLayer((j - 0.5) * h, t1, props);
    for (let i = 1; i <= B.nx - 1; i++) {
      maxProfileError = Math.max(maxProfileError, Math.abs(grid.u[grid.idx(i, j)] - exact));
    }
  }

  console.log(
    `[Test 3B] ny=${B.ny} t=${B.t0} -> ${t1.toFixed(2)}, ` +
    `layer thickness ${(2 * Math.sqrt(B.nu * B.t0) / h).toFixed(0)}h -> ${(2 * Math.sqrt(B.nu * t1) / h).toFixed(0)}h\n` +
    `          max|u - analytical| over whole profile = ${maxProfileError.toExponential(3)}\n` +
    `          max|v|=${maxV.toExponential(3)} max|div|=${maxDiv.toExponential(3)}\n` +
    `          spreading rate (centre slope, should follow t^-1/2):`
  );

  // The self-similar law says slope*sqrt(t) is a constant, U0/(2*sqrt(pi*nu)).
  const spreadConstantExact = B.U0 / (2 * Math.sqrt(Math.PI * B.nu));
  for (const s of samples) {
    const relError = Math.abs(s.slope - s.slopeExact) / s.slopeExact;
    const spreadConstant = s.slope * Math.sqrt(s.t);
    console.log(
      `            t=${s.t.toFixed(3)} slope=${s.slope.toFixed(6)} ` +
      `analytical=${s.slopeExact.toFixed(6)} relErr=${relError.toExponential(3)} ` +
      `slope*sqrt(t)=${spreadConstant.toFixed(6)} (exact ${spreadConstantExact.toFixed(6)})`
    );
  }

  assert.ok(maxV < 1e-14, `v must stay 0 in unidirectional flow, got ${maxV}`);
  assert.ok(maxDiv < 1e-14, `divergence must stay 0, got ${maxDiv}`);
  assert.ok(
    maxProfileError < 2e-4,
    `profile should match the erf solution, got max error ${maxProfileError}`
  );

  for (const s of samples) {
    const relError = Math.abs(s.slope - s.slopeExact) / s.slopeExact;
    assert.ok(
      relError < 1e-3,
      `spreading rate at t=${s.t} should match U0/(2*sqrt(pi*nu*t)) within 0.1%, got ${relError}`
    );
    const spreadRelError =
      Math.abs(s.slope * Math.sqrt(s.t) - spreadConstantExact) / spreadConstantExact;
    assert.ok(
      spreadRelError < 1e-3,
      `layer should spread as sqrt(nu*t) (slope*sqrt(t) constant), off by ${spreadRelError} at t=${s.t}`
    );
  }
});
