# Validation record

**This file is generated. Do not edit it by hand — run `npm run validate`.**

Every number below was measured by running the solver through the same harnesses the test suite uses (`validation/measure.js`), and compared against references declared in `validation/registry.js`. A hand-maintained validation record can drift from the code while still reading as authority, which is the one failure mode a document like this must not have.

Generated 2026-08-25 17:02:16 UTC.

## How to read this

**Classification** — what a case's agreement actually establishes:

- `benchmarked` — checked against a reference external to this project, so being wrong is detectable from outside
- `self-validated` — checked against exact invariants and its own grid convergence; nothing external says the answer is right
- `demonstration` — neither — runs and looks plausible

The distinction carries real weight. A cavity agreeing with published measurements and a bend separating where physical reasoning says it should are not the same kind of claim, and presenting them identically would mislead by omission.

**Reference verification** — how far the reference itself can be trusted:

- `derived` — reproducible from the equations
- `verified` — cross-referenced against an independent source
- `unverified` — **recalled, not checked**

## Summary

| case | classification | reference | verification |
|---|---|---|---|
| Still water | `self-validated` | invariants only | — |
| Uniform channel flow | `self-validated` | invariants only | — |
| Viscous diffusion | `benchmarked` | analyticalDiffusion | `derived` |
| Lid-driven cavity | `benchmarked` | ghia1982 | `verified` |
| Flow past a circular cylinder | `benchmarked` | cylinderWakeLength | `unverified` |
| 90-degree channel bend | `self-validated` | planePoiseuille | `derived` |

## Still water

**Classification:** `self-validated` — checked against exact invariants and its own grid convergence; nothing external says the answer is right

**Asserted by:** `tests/test1_still_water.js`

u = 0 is an exact fixed point of the discretised equations, so this is an invariant rather than a comparison. It cannot be close - it is either exact or the solver is manufacturing motion from nothing.

| quantity | reference | measured | tolerance | result |
|---|---|---|---|---|
| max\|u\| after 50 steps | 0 | 0 | 1.000e-10 | pass |
| max\|div u\| | 0 | 0 | 1.000e-10 | pass |

## Uniform channel flow

**Classification:** `self-validated` — checked against exact invariants and its own grid convergence; nothing external says the answer is right

**Asserted by:** `tests/test2_channel_flow.js`

A uniform plug flow with no-penetration, zero-gradient walls is another exact fixed point. Isolates whether the projection preserves a trivial solution.

| quantity | reference | measured | tolerance | result |
|---|---|---|---|---|
| max\|u - U0\| | 0 | 0 | 1.000e-6 | pass |
| max\|div u\| | 0 | 0 | 1.000e-6 | pass |

## Viscous diffusion

**Classification:** `benchmarked` — checked against a reference external to this project, so being wrong is detectable from outside

**Asserted by:** `tests/test3_viscous_diffusion.js`

Compared against exact closed-form solutions. The construction makes the nonlinear and pressure terms vanish identically, which the test verifies by requiring v and divergence to stay at exactly zero, so this isolates the diffusion term alone.

**Reference:** Closed-form solutions of the 1D heat equation: the decaying mode u = U0*cos(k*y)*exp(-nu*k^2*t) and the spreading error-function layer u = (U0/2)(1 + erf((y-y0)/(2*sqrt(nu*t)))).

**Verification:** reproducible from the equations

> Reproducible from the governing equations. For a unidirectional flow the nonlinear and pressure terms vanish identically, so the momentum equation collapses onto the heat equation exactly - the tests assert that collapse rather than assuming it.

| quantity | reference | measured | tolerance | result |
|---|---|---|---|---|
| decay rate vs nu*k^2 (relative) | 0 | 7.635e-4 | 1.000e-3 | pass |
| spatial convergence order | 2 | 2.05348 | 0.3 | pass |
| spreading-layer profile error | 0 | 4.962e-5 | 2.000e-4 | pass |

## Lid-driven cavity

**Classification:** `benchmarked` — checked against a reference external to this project, so being wrong is detectable from outside

**Asserted by:** `tests/test4_lid_driven_cavity.js`

The standard 2D incompressible benchmark and the go/no-go gate for this solver. The first case where advection and pressure are both live.

**Reference:** Ghia, U., Ghia, K. N., & Shin, C. T. (1982). High-Re solutions for incompressible flow using the Navier-Stokes equations and a multigrid method. Journal of Computational Physics, 48(3), 387-411.

**Verification:** cross-referenced against an independent source

> Cross-referenced against an independent public transcription, one source per table. The check found one wrong digit in the previous recalled transcription (Re=1000, x=0.9063: -0.51550 against a true -0.51500) which was setting the reported Re=1000 error. One published point is excluded as unreliable - see tests/support/ghia.js EXCLUDED_POINTS.

| quantity | reference | measured | tolerance | result |
|---|---|---|---|---|
| max\|u - Ghia\| at Re=100 | 0 | 3.802e-3 | 0.015 | pass |
| max\|v - Ghia\| at Re=100 | 0 | 8.545e-3 | 0.015 | pass |
| max\|u - Ghia\| at Re=400 | 0 | 7.334e-3 | 0.015 | pass |
| max\|u - Ghia\| at Re=1000 | 0 | 0.0179 | 0.035 | pass |
| self-convergence order | 2 | 1.90538 | 0.3 | pass |

Also measured, not asserted:

- primary vortex centre offset at Re=100: 7.788e-3 (solver (0.6172, 0.7422) vs Ghia (0.6172, 0.7344))

## Flow past a circular cylinder

**Classification:** `benchmarked` — checked against a reference external to this project, so being wrong is detectable from outside

**Asserted by:** `tests/test5_flow_around_obstacle.js`

Wake length compared against published values for an unbounded cylinder, which requires accounting for channel blockage: the measured length rises monotonically toward the published figure as the channel widens. The structural invariants (exact zero velocity on the body, flux conserved through every cut, a symmetric answer to a symmetric problem) hold to roundoff and are what the case mostly rests on.

**Reference:** Steady recirculation length behind a circular cylinder in unbounded flow, L/D ~ 0.93 at Re=20 and ~2.3 at Re=40. Usually attributed to Coutanceau & Bouard (1977), J. Fluid Mech. 79(2), 231-256, and to Tritton (1959), J. Fluid Mech. 6, 547-567.

**Verification:** **recalled, not checked**

> THE NUMBERS ARE STILL RECALLED, NOT CHECKED. A partial check has since confirmed the citation but not the values. Coutanceau & Bouard (1977), J. Fluid Mech. 79, is a real paper, correctly attributed here, and is the standard experimental benchmark that numerical work compares against for cylinder wake length at Re < 40 - so the attribution is sound. What could not be obtained is the part this project actually depends on: the figures L/D ~ 0.93 at Re=20 and ~2.3 at Re=40 still come from recall, not from any source that could be checked. That is why this stays `unverified` rather than being upgraded on the strength of the citation. Published values also differ by a few percent between sources (2.24 to 2.35 at Re=40 is commonly quoted), which is part of why the test asserts a band rather than a point. This remains the weakest reference in the project.

> ⚠️ **Caveat.** The reference VALUES behind this case are UNVERIFIED. The citation has been confirmed as real, correctly attributed and the standard source for this measurement, but the specific numbers attributed to it have not been checked against it. The agreement is also indirect - it is a trend toward the published number under reducing blockage, not a direct match at a stated condition.

| quantity | reference | measured | tolerance | result |
|---|---|---|---|---|
| wake L/D at Re=20, 6% blockage | 0.93 | 1.03318<br><sub>published unbounded value 0.93</sub> | 15% relative | pass |
| separation onset below Re~5 | 0 | 0<br><sub>0 = attached at Re=1, as expected</sub> | 0 | pass |
| velocity on the body surface | 0 | 0 | 0 | pass |
| flux deviation through all cuts (relative) | 0 | 2.527e-10 | 1.000e-7 | pass |
| centreline asymmetry | 0 | 5.388e-11 | 1.000e-9 | pass |

## 90-degree channel bend

**Classification:** `self-validated` — checked against exact invariants and its own grid convergence; nothing external says the answer is right

**Asserted by:** `tests/test6_channel_bend.js`

There is no published reference for this geometry, so the bend's own behaviour - separation off the sharp inner corner, suppression when the corner is radiused, flow thrown toward the outer wall, higher pressure on the outer wall - is checked against physical reasoning and exact invariants, not against measurements. What IS benchmarked is the inlet leg, which carries fully developed plane Poiseuille flow with a closed-form profile and pressure gradient. That analytical anchor inside the same geometry is what makes the bend numbers worth believing.

**Reference:** Plane Poiseuille flow: for a channel of width w with mean velocity U, u(y) = 1.5*U*(1 - (2(y-yc)/w)^2) and dp/dx = -12*mu*U/w^2.

**Verification:** reproducible from the equations

> Standard closed-form result, reproducible from the equations.

> ⚠️ **Caveat.** The bend results themselves are NOT benchmarked. No external source says the separation bubble should be 1.555w at Re=200; it is reported because the solver is trusted, not the other way round.

| quantity | reference | measured | tolerance | result |
|---|---|---|---|---|
| inlet-leg dp/dx vs -12*mu*U/w^2 (relative) | 0 | 7.792e-3 | 0.02 | pass |
| inlet-leg profile convergence order | 2 | 1.93237 | 0.3 | pass |
| flux deviation through all cuts (relative) | 0 | 6.906e-9 | 1.000e-6 | pass |
| velocity on the duct walls | 0 | 0 | 0 | pass |
| sharp bend separates at the inner corner | — | —<br><sub>bubble 2.768w, peak reverse 0.2214 U0</sub> | — | reported |
| radiusing suppresses the separation | — | —<br><sub>smooth bend peak reverse 0.0011 U0 against 0.2214 sharp</sub> | — | reported |

## Known limitations

Carried forward from `docs/M1-solver-hardening.md`, which has the detail:

- Symmetry costs convergence under the CG pressure solve; it was structurally free under SOR.
- No upwinding: cell Reynolds numbers above ~2 are outside formal validity.
- A CFL-respecting timestep is not sufficient near a geometric singularity.
- Obstacles are staircase-resolved to about one cell.
- The explicit viscous limit scales as h², so refinement gets expensive quickly.

**1 reference is still unverified** (cylinderWakeLength). Any claim resting on it is weaker than the rest of this document, and should be read that way. Each one records what closing it would take, so it stays a piece of open work rather than a permanent disclaimer:

- **cylinderWakeLength** — The 1977 paper is paywalled and its table could not be reached from any openly available source. Closing this needs either institutional or library access to the original, or a secondary paper that digitises and reproduces those exact figures. Recorded as a known limitation and left open deliberately, not pursued further.
