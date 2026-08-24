// Analytical reference solutions for validating the solver.
//
// Test-support code only - nothing here is imported by /solver or /geometry.
// These are the "known physical behaviour" side of the comparison, so they
// are written to be independently checkable rather than convenient.

// erf(x), accurate to ~1e-14 absolute for |x| <= 3 and ~1.5e-7 absolute
// beyond it. JavaScript has no built-in erf.
//
// |x| <= 3: Maclaurin series erf(x) = (2/sqrt(pi)) * sum (-1)^n x^(2n+1)/(n!(2n+1)),
//   summed to convergence. Intermediate terms reach ~1e2 at x = 3, so the
//   cancellation costs a few digits but leaves ~1e-14.
// |x| > 3: Abramowitz & Stegun 7.1.26, max absolute error 1.5e-7. In this
//   range erf is within 2.3e-5 of +/-1, so an absolute error of 1.5e-7 is
//   far below any discretization error being measured.
const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI);

export function erf(x) {
  if (x < 0) return -erf(-x);
  if (x === 0) return 0;
  if (x > 6) return 1; // 1 - erf(6) = 2.2e-17, below double precision

  if (x <= 3) {
    const x2 = x * x;
    let a = x; // x^(2n+1)/n!
    let sum = 0;
    for (let n = 0; n < 200; n++) {
      const term = (n % 2 === 0 ? 1 : -1) * a / (2 * n + 1);
      sum += term;
      if (Math.abs(term) < 1e-18 * Math.abs(sum)) break;
      a = a * x2 / (n + 1);
    }
    return TWO_OVER_SQRT_PI * sum;
  }

  const p = 0.3275911;
  const [a1, a2, a3, a4, a5] = [
    0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429,
  ];
  const t = 1 / (1 + p * x);
  const poly = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))));
  return 1 - poly * Math.exp(-x * x);
}

// Decaying shear mode.
//
//   u(y, t) = U0 * cos(k*y) * exp(-nu * k^2 * t),   v = 0
//
// With v = 0 and u independent of x, the nonlinear term u.grad(u) vanishes
// identically and the pressure gradient is zero, so the momentum equation
// reduces exactly to the 1D heat equation du/dt = nu * d2u/dy2. Choosing
// k = m*pi/Ly makes du/dy = 0 at y = 0 and y = Ly, matching a free-slip
// wall exactly.
export function decayingShearMode(y, t, { U0, k, nu }) {
  return U0 * Math.cos(k * y) * Math.exp(-nu * k * k * t);
}

// Spreading shear layer (the diffusing step / Stokes-layer solution).
//
//   u(y, t) = (U0/2) * (1 + erf((y - y0) / (2*sqrt(nu*t))))
//
// The classic self-similar solution of the 1D heat equation for a step
// initial condition in an unbounded domain. The layer thickness grows as
// sqrt(nu*t) - this is the "spreading rate" being validated.
export function spreadingShearLayer(y, t, { U0, y0, nu }) {
  return (U0 / 2) * (1 + erf((y - y0) / (2 * Math.sqrt(nu * t))));
}

// d/dy of the above, evaluated at the layer centre y = y0. The peak slope
// decays as t^(-1/2); this is the sharpest single-number statement of the
// diffusive spreading rate.
export function spreadingShearLayerCentreSlope(t, { U0, nu }) {
  return U0 / (2 * Math.sqrt(Math.PI * nu * t));
}
