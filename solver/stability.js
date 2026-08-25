// Explicit-scheme stability limits, timestep selection, and the failure mode.
//
// The projection scheme in ns2d.js treats both advection and diffusion
// explicitly, so it has two hard stability limits and no way to survive
// violating either. Until now the timestep was a fixed number chosen per
// scenario by hand, with a guessed peak velocity - which is how the bend came
// to diverge: sizing against a peak of 2*U0 put the CFL number at 0.86 once
// the corner jet formed, because the flow actually accelerates to about
// 2.9*U0. The guess was wrong and nothing checked it.
//
// The two limits, for uniform h:
//
//   viscous     nu*dt*(2/h^2 + 2/h^2) <= 1   ->   dt <= h^2 / (4*nu)
//   convective  dt*(|u|/h + |v|/h) <= 1      ->   dt <= h / max(|u| + |v|)
//
// The convective one is stated per cell on the sum of the two components
// rather than on each separately: a flow running diagonally through a cell is
// constrained by both at once, and taking the maxima of |u| and |v|
// independently would under-constrain it.

export class SolverStabilityError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "SolverStabilityError";
    Object.assign(this, detail);
  }
}

// Largest |u| + |v| at any fluid cell centre, and whether the field is finite.
// Non-finite entries are counted rather than compared, for the reason spelled
// out in tests/regression_nonfinite_reporting.js: `s > max` is false for NaN
// and would report a calm field where there is a blown-up one.
export function peakCellSpeed(grid) {
  const { nx, ny, u, v, solid, stride } = grid;
  const idx = (i, j) => i + stride * j;
  let peak = 0;
  let nonFinite = 0;
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx; i++) {
      const k = idx(i, j);
      if (solid[k]) continue;
      const uc = (u[k - 1] + u[k]) / 2;
      const vc = (v[k - stride] + v[k]) / 2;
      const s = Math.abs(uc) + Math.abs(vc);
      if (!Number.isFinite(s)) { nonFinite++; continue; }
      if (s > peak) peak = s;
    }
  }
  return { peak: nonFinite > 0 ? NaN : peak, nonFiniteCells: nonFinite, finite: nonFinite === 0 };
}

// The hard limits for the current field. Exceeding either of these is not a
// matter of degree - the scheme is unconditionally unstable beyond them.
export function stabilityLimits(grid, nu) {
  const { h } = grid;
  const { peak, finite, nonFiniteCells } = peakCellSpeed(grid);
  return {
    viscous: nu > 0 ? (h * h) / (4 * nu) : Infinity,
    convective: peak > 0 ? h / peak : Infinity,
    peakSpeed: peak,
    finite,
    nonFiniteCells,
  };
}

// Picks the largest timestep the current field can be advanced with safely.
//
// safety is the fraction of the hard limit actually used. It is not a guess:
// see tests/test7_m1_hardening.js, which walks the safety factor up
// across the scenarios until each one diverges, and the documented margin in
// docs/M1-solver-hardening.md.
//
// growthLimit stops the timestep jumping upward the instant the flow relaxes.
// Without it dt oscillates - a large step raises the peak velocity, which
// forces a small step, which lets the velocity settle, which permits a large
// step again. Ramping up gently and dropping immediately is the standard
// asymmetry, and it is what makes the sequence stable rather than merely
// stable-on-average.
//
// maxTimestep caps the result independently of stability. A nearly stationary
// field has no convective limit at all, and taking an enormous step would be
// stable while destroying the temporal accuracy of the answer.
export function computeStableTimestep(grid, {
  nu,
  safety = 0.4,
  maxTimestep = Infinity,
  previousTimestep = null,
  growthLimit = 1.1,
}) {
  const limits = stabilityLimits(grid, nu);

  if (!limits.finite) {
    throw new SolverStabilityError(
      `cannot choose a timestep: the velocity field has ${limits.nonFiniteCells} non-finite cells`,
      { reason: "non-finite-field", nonFiniteCells: limits.nonFiniteCells }
    );
  }

  const viscous = safety * limits.viscous;
  const convective = safety * limits.convective;

  let dt = Math.min(viscous, convective);
  let limitedBy = viscous <= convective ? "viscous" : "convective";

  if (dt > maxTimestep) {
    dt = maxTimestep;
    limitedBy = "maxTimestep";
  }
  if (previousTimestep !== null && dt > previousTimestep * growthLimit) {
    dt = previousTimestep * growthLimit;
    limitedBy = "growthLimit";
  }

  return {
    dt,
    limitedBy,
    peakSpeed: limits.peakSpeed,
    // The numbers a reader needs to judge the choice, not just the choice.
    cflNumber: limits.convective === Infinity ? 0 : dt / limits.convective,
    diffusionNumber: limits.viscous === Infinity ? 0 : dt / limits.viscous,
    viscousLimit: limits.viscous,
    convectiveLimit: limits.convective,
  };
}

// Rejects a timestep the current field cannot survive. Called by step() before
// it does any work.
//
// This throws rather than clamping. Clamping would mean step() silently
// advancing by something other than the dt it was asked for, which puts the
// caller's clock out of step with the solver's without saying so - the same
// class of quiet wrongness as a divergence readout of zero on a NaN field.
// A throw cannot be ignored; a returned status can be, and this project has
// already been bitten once by a status nobody looked at.
export function assertTimestepIsStable(grid, nu, dt) {
  const limits = stabilityLimits(grid, nu);
  if (!limits.finite) return limits; // already broken on entry; reported, not thrown

  if (!(dt > 0) || !Number.isFinite(dt)) {
    throw new SolverStabilityError(`timestep must be a positive finite number, got ${dt}`, {
      reason: "invalid-timestep", dt,
    });
  }
  if (dt > limits.viscous) {
    throw new SolverStabilityError(
      `timestep ${dt.toExponential(3)} exceeds the viscous stability limit ` +
      `${limits.viscous.toExponential(3)} (diffusion number ${(dt / limits.viscous).toFixed(3)}, ` +
      `must be below 1). Reduce dt, coarsen the grid, or lower the viscosity.`,
      { reason: "viscous", dt, limit: limits.viscous, ratio: dt / limits.viscous }
    );
  }
  if (dt > limits.convective) {
    throw new SolverStabilityError(
      `timestep ${dt.toExponential(3)} exceeds the convective (CFL) stability limit ` +
      `${limits.convective.toExponential(3)} at a peak speed of ${limits.peakSpeed.toExponential(3)} ` +
      `(CFL ${(dt / limits.convective).toFixed(3)}, must be below 1). The flow has accelerated ` +
      `beyond what this fixed timestep allows - use computeStableTimestep to adapt it.`,
      { reason: "convective", dt, limit: limits.convective, ratio: dt / limits.convective,
        peakSpeed: limits.peakSpeed }
    );
  }
  return limits;
}
