# M1 — Solver hardening

Working agreement item 7: *document the numerical method chosen and why —
stability, accuracy, implementation cost, and room to expand.*

M1 changed four things about how the solver behaves, none of them about what
it computes. All six M0 validation scenarios pass unchanged throughout.

---

## 1. Pressure solve: SOR → conjugate gradient

### Why the previous method was replaced

The Poisson solve has been through three methods, each replaced for a concrete
measured reason.

**Jacobi** was first — the simplest thing that works. It needs O(N²) iterations
on an N×N grid: 19,600 per timestep on a 64×64 cavity, about three hours for one
steady-state run.

**Red-black SOR** replaced it and is O(N) *at the optimal relaxation factor* —
but it has to be told that factor, and the estimate was wrong in every geometry:

| geometry | measured optimum | formula gave | cost of the error |
|---|---|---|---|
| cavity 64×64 | 1.930 | 1.9065 | 1.70× more iterations |
| bend 84×84 | 1.970 | 1.9279 | 2.60× |
| cylinder 168×73 | 1.970 | 1.9633 | 1.14× |

Deriving the estimate properly does not rescue it. The formula in use came from
the **Dirichlet** Jacobi spectral radius, `[cos(π/nx)+cos(π/ny)]/2`. For the
**Neumann** problem here the (0,0) mode is the constant null space, so the
slowest *convergent* mode is (1,0) or (0,1), giving `[cos(π/N)+1]/2` with
N = max(nx, ny). That is strictly larger, which is exactly why every estimate
came in low. The corrected form is **exact for the cavity** (1.9329 predicted
against 1.930 measured) and still **1.87× off for the bend**, because a bounding
box says nothing useful about an L-shaped channel whose slowest mode runs the
length of the duct. No formula over grid dimensions fixes that.

### Conjugate gradient

The operator is the discrete Laplacian restricted to fluid cells: symmetric,
negative semi-definite, with the constant as its only null direction. CG needs
no tuning parameter at all, and beats the tuning each scenario was actually
using:

| geometry | SOR as configured | CG |
|---|---|---|
| cavity | 313 its/step | **193** |
| bend | 372 | **232** |
| cylinder | 419 | **321** |

It also **cannot be mis-tuned**, which SOR emphatically can: ω = 1.99 on the
cavity costs 1223 iterations against 184 at the optimum. Against optimally tuned
SOR, CG is slightly slower on the cavity (0.77× wall-clock) and faster on the
other two — trading a little best-case speed for the removal of a parameter that
was wrong everywhere it was estimated.

The singular system is handled by projecting the residual to zero mean each
iteration and zero-meaning the result.

### The one property that was lost

SOR preserved discrete mirror symmetry **structurally**: it is a stationary
iteration whose red-black colouring is itself mirror-symmetric when the row
count is odd, so symmetry held to 2e-15 regardless of how loosely it converged.

CG has no such guarantee. Its symmetry is only as good as its convergence, and
the Re=40 cylinder wake — sitting just below the shedding threshold near Re≈47 —
accumulates the residual asymmetry rather than damping it:

| | step 20 | step 200 | step 1200 | vs solve tolerance |
|---|---|---|---|---|
| SOR | 8.9e-16 | 6.7e-16 | 8.9e-14 | independent |
| CG | 8.9e-16 | 1.7e-10 | 1.0e-7 | proportional |

Two candidate fixes were tried and **rejected on measurement**: Kahan summation
of CG's dot products, and pairing opposite neighbours in the matrix-vector
product so mirror cells compute bit-identically. Neither changed the result.

The resolution is to converge harder where symmetry is asserted. Test 5 now runs
at `divergenceTol = 1e-9` instead of 1e-7, giving asymmetry 5.4e-11 against an
unchanged 1e-9 assertion — an 18× margin — and incidentally improving divergence
from 9.4e-8 to 9.5e-10. **This is a real limitation, not a solved problem:** a
symmetric answer now costs convergence where it used to be free.

---

## 2. Adaptive timestep

Δt was previously a fixed number per scenario with a hand-guessed peak velocity.
That is how the bend came to diverge: sizing against a peak of 2·U₀ put the CFL
number at 0.86 once the corner jet formed, because the flow actually accelerates
to about 2.9·U₀. The guess was wrong and nothing checked it.

Δt is now chosen from the field before every step:

```
Δt = safety · min( h²/(4ν) ,  h / max_cells(|u| + |v|) )
```

The convective limit is stated **per cell on the sum of the components**, not on
each maximum separately: a flow running diagonally through a cell is constrained
by both at once, and independent maxima would under-constrain it.

Two modifiers:

- **Growth limiter** (1.1×/step). Δt may fall instantly but rises gently.
  Without the asymmetry Δt oscillates — a large step raises the peak velocity,
  which forces a small step, which lets the flow settle, which permits a large
  step again.
- **Δt cap**, independent of stability. A nearly stationary field has no
  convective limit at all, and an enormous step would be perfectly stable while
  destroying temporal accuracy.

### The safety factor is measured, not guessed

Walking it up until each scenario diverges:

| safety | cavity | sharp bend | cylinder |
|---|---|---|---|
| 0.20 | stable | stable | stable |
| 0.40 | stable | stable | stable |
| 0.60 | stable | stable | stable |
| 0.80 | stable | **diverged** | stable |
| 0.90 | stable | **diverged** | stable |
| 0.95 | stable | **diverged** | stable |

**0.4 is the default**, leaving 1.5× margin below the tightest observed boundary.

The bend is the binding constraint and the only one: the cavity and the cylinder
both survive 0.95. It fails at 0.80, 0.90 and 0.95 alike, so this is a
reproducible boundary between 0.6 and 0.8 rather than one unlucky run.

The bend's failure at 0.8 is instructive: it was caught by the post-step
backstop as `became-non-finite`, not by the CFL check. The blow-up is local to
the mitre corner, which the linearised stability limit does not describe. The
adaptive controller responded by collapsing Δt — 10,860 steps to reach t=2.90 —
and still lost. **A CFL-respecting timestep is necessary but not sufficient near
a geometric singularity.**

### It does not change the answer

A cavity marched to the same physical time twice — adaptively, and with a fixed
conservative Δt — agrees to **0.038% of peak velocity** on the centreline, in 519
steps instead of 820.

---

## 3. Divergence control

Distinct from the failure handling below: that is about the scheme coming
apart, this is about the continuity constraint `∇·u = 0` being met.

Three of the four parts were already in place and are sound:

- **Measurement** — `computeDivergence` reports max and rms, and cannot report a
  calm number on a broken field.
- **A bound in physical units** — `divergenceTol` is stated as a promise about
  the field a step produces, not as an opaque solver tolerance. It works
  because after the correction the remaining divergence is *exactly*
  `−(dt/ρ) × (Poisson residual)`.
- **No accumulation** — the projection re-enforces incompressibility every step.
  Measured over 1200 steps: 9.0e-9, 7.3e-9, 8.4e-9, worst 1.00e-8 against a
  1e-8 bound. It sits at the tolerance rather than creeping.

The fourth was missing: **the bound was a target, not a contract.** A pressure
solve that ran out of iterations returned `poissonConverged: false` and `step()`
carried on regardless. Measured with a starved solve: divergence **9.0e-3
against a promised 1e-8 — 900,000× over** — with nothing but an easily ignored
flag to say so. That is the same ignorable-status pattern that produced both
non-finite reporting bugs.

`step()` now throws `SolverDivergenceError` when the bound is not met, naming
what was asked, what was achieved, how many iterations were used, and the
remedy. **The check is free**: the achieved value follows from the residual, so
no second pass over the field is needed. The identity is pinned by a test
against an independent scan rather than trusted — they agree to 3.6e-6
relative, the gap being cancellation in the direct scan (differencing
velocities of order 1 to get a result of order 1e-10), not error in the
identity.

---

## 4. Failure behaviour

The decision: **hard stop with a diagnostic, never a silent clamp.**

Clamping would mean `step()` advancing by something other than the Δt it was
asked for, putting the caller's clock out of step with the solver's without
saying so — the same class of quiet wrongness as a divergence readout of zero on
a NaN field, which this project has already been bitten by twice. A throw cannot
be ignored; a returned status can be.

Four layers, outermost first:

1. **Prevent.** Adaptive Δt respects the limits by construction.
2. **Reject before stepping.** `step()` validates the supplied Δt against limits
   computed from the current field and throws `SolverStabilityError` naming the
   limit, the ratio, and what to do. The field is left untouched.
3. **Backstop after stepping.** The pre-step check is necessary but not
   sufficient. If the field was sound on entry and is not on exit, this step
   broke it, and that throws too.
4. **The harness catches it** and shows the same hard-stop banner as a
   non-finite field.

One deliberate asymmetry: a field that arrives **already** non-finite is
*reported*, not thrown at. `step()` throws for what it would itself produce; a
caller that hands in garbage gets the existing non-finite reporting path. This
keeps `tests/regression_nonfinite_reporting.js` meaningful and is pinned by its
own M1 test so it cannot be erased by accident.

---

## Known limitations carried forward

- **Symmetry now costs convergence.** See above. Scenarios asserting symmetry
  must converge to ~1e-9.
- **Central differencing has no upwinding.** Cell Reynolds numbers above ~2 are
  outside its formal validity; the cavity holds to 2% at cell Re 15.6, but this
  is the ceiling on Reynolds number at a given resolution.
- **Obstacles are staircase-resolved** to about one cell. Cut-cell or
  immersed-boundary treatment is not attempted.
- **Near a geometric singularity, CFL is not sufficient** — see the bend at
  safety 0.8.
- **The explicit scheme's viscous limit scales as h²**, so refinement gets
  expensive quickly. An implicit diffusion treatment would lift that and is the
  obvious next hardening step.

---

## Handover to M2

M1 is closed. The one thing M2 must address before anything else:

**The Ghia et al. reference tables in `tests/support/ghia.js` are transcribed
from memory, not read from the paper.** They carry a provenance warning saying
so, and one Re=400 v-velocity entry (x = 0.9063) is already marked `null` as
unverifiable — found because the solver reproduced all sixteen other points on
that row to within 8e-3 and disagreed with that one by 1.4e-1.

Status of the cross-checking so far:

| table | status |
|---|---|
| Table I (u along the vertical centreline) | **partially** cross-checked against an independent source |
| Table II (v along the horizontal centreline) | **unconfirmed** |

This matters more than anything else in the suite because Test 4 is the
go/no-go benchmark gate — the test that decides whether this is a solver or an
animation — and it rests entirely on these numbers. A validation suite built on
unverified reference data is not a validation suite.

**M2's first task, ahead of formalising the rest of the suite: replace the
transcribed Ghia tables with a verified source, and resolve the flagged Re=400
point.** The continuity self-check already in Test 4 is a weak guard (trapezoid
quadrature over 17 sparse points, its own error ~1e-2) and explicitly did not
catch the bad entry — that was found by comparison against the solver, which is
not a method that generalises.
