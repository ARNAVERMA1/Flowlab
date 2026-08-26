# M3 — Basic visualization

Working agreement item 7: *document the numerical method chosen and why —
stability, accuracy, implementation cost, and room to expand.*

M3 added a pressure view, a dye tracer and a way to switch between views. None
of it changed the solver: `solver/`, `geometry/` and `scenarios/` were not
modified, so Tests 1–6 are running identical code and stayed green throughout
by construction rather than by tolerance.

---

## 1. The tracer's numerics

The scalar satisfies pure advection with no diffusion term:

```
dc/dt + u . grad c = 0
```

discretised in conservative flux form on the pressure cells, using the MAC face
velocities directly:

```
c[i,j] -= (dt/h) * ( Fx[i,j] - Fx[i-1,j] + Fy[i,j] - Fy[i,j-1] )
Fx[i,j] = u[i,j] * cFace
```

### Two schemes rejected, for stated reasons

**The solver's own scheme.** Momentum is advected with explicit central
differences and no upwinding, which is defensible there because physical
viscosity damps the 2h mode. A tracer with zero diffusivity has no such
damping, and forward-Euler central differencing applied to pure advection is
*unconditionally* unstable — the von Neumann amplification factor exceeds one
for every timestep. Matching the surrounding code would have produced a field
that blows up regardless of `dt`.

**First-order donor cell.** Monotone, positivity-preserving, about thirty
lines, and the obvious reading of "basic dye/tracer". Rejected on its modified
equation, whose numerical diffusivity is `|u|*h*(1-CFL)/2`:

| scenario | h | ν | est. `D_num` at CFL 0.4 | ratio |
|---|---|---|---|---|
| cavity, Re 1000 | 1/64 | 1e-3 | ~4.7e-3 | ~4.7× ν |
| cylinder, Re 100 | 1/12 | 1e-2 | ~2.5e-2 | ~2.5× ν |

Dye would spread several times faster than momentum — effective Schmidt number
around 0.2 — and every thin filament would be gone within a few hundred steps.
A picture that looks plausible and is wrong about the one thing dye exists to
show.

### Measured, not asserted

The claim above is checked rather than argued. Translating a Gaussian
(σ = 0.05) a distance of 0.5 over 500 steps on a 400-cell grid, exact solution
available:

| scheme | L1 error | peak error | crest (exact: 1.0) |
|---|---|---|---|
| van Leer | 2.65e-4 | 1.02e-2 | 0.9895 |
| donor cell | 1.59e-2 | 1.23e-1 | 0.8768 |

60× better in L1. The limiter is a pluggable function and returning zero from
it recovers donor cell exactly, so both rows come from the same code path with
one argument changed.

### A bug worth recording

The first implementation omitted the `(1 - |Courant|)` factor on the
antidiffusive flux, making it the second-order **spatial** correction rather
than the Sweby form — which paired with forward Euler is the unstable central
scheme, held together only by the limiter clamping it.

What makes this worth writing down is how it presented. The crest still held at
0.9996, so nothing looked smeared or damped; the profile simply **lagged**, and
the peak error was 1.40e-1 against 1.02e-2 once fixed. A test asserting only
that the dye stayed sharp would have passed a broken scheme. The suite now
asserts peak error alongside L1 for exactly this reason.

### Honest limits

- **TVD is a one-dimensional result.** In 2D unsplit with forward Euler,
  boundedness is not proven. The tests therefore *measure* the excursion rather
  than asserting `c ∈ [0,1]`: a sharp step through 200 cavity steps overshoots
  by 2.7e-8 and undershoots by 0. That figure tracks the accumulated divergence
  residual, not the limiter — the discrete field is divergence-free only to the
  Poisson tolerance, so no exact maximum principle is available to appeal to.
- **It still smears.** Less diffusive than donor cell, not non-diffusive.
- **Near solids and domain edges the scheme drops to donor cell**, because the
  limited reconstruction needs a cell the stencil cannot reach there. Obstacles
  therefore carry a locally more diffusive band about one cell thick.

---

## 2. Stability: the tracer never votes on `dt`

The tracer measures its own Courant number — the **per-cell outward face sum**,
which is the coefficient that actually governs positivity in the donor-cell
update, not `(|u|+|v|)`. Two looser measures were tried first and both roughly
doubled it on the bend, which would have meant permanent substepping for a
bound that was not binding:

| measure | bend, same moment |
|---|---|
| largest \|u\| anywhere + largest \|v\| anywhere | 0.85 |
| per cell, max of the two faces on each axis | 0.81 |
| per cell, outward faces only | 0.45 |

**If the bound binds, the tracer subdivides its own step.** It does not ask for
a smaller `dt`. That is the one coupling that would be easy to introduce by
accident and would mean a display feature silently altering the fluid solution.

### The bound does bind — the proposal said it would not

Predicted: the solver sizes `dt` from the same convective limit at safety 0.4,
so the tracer would sit at CFL ≤ 0.4 against its own bound of 0.5 and never
substep. In steady operation that holds (0.39–0.50 on the bend, one substep).

It fails on the **first step of every impulsively started scenario**:

```
step |   dt     | peakCellSpeed | tracer CFL | substeps | dt limited by
   1 | 1.39e-1  |     3.087     |    5.14    |    11    | viscous
   2 | 1.08e-2  |     3.070     |    0.398   |     1    | convective
```

`computeStableTimestep` sizes `dt` from the field **before** the step. Before
step 1 the bend is at rest, so there is no convective limit to find and `dt`
comes from the viscous one — roughly thirteen times what step 2 will use. The
flow that exists afterwards moves at speed 3. The tracer advects with that
post-step field, so it is the one layer that sees the real number, and it
absorbs the discrepancy in its own substeps.

**Carried forward as an observation about the solver, not acted on:** the same
arithmetic says the solver itself takes that first step at an effective
convective CFL near 5. It survives — `dt` drops by 13× immediately after, and
all six validation scenarios are unaffected — but the first step from rest is
not covered by the stability limit the driver believes it is enforcing. This
was found while building the tracer; the solver was out of scope for M3 and M1
is closed, so nothing was changed. It may be worth a look when the timestep
logic is next opened.

---

## 3. Separation from the fluid state

VISION 4.2's line between what the simulation computes and what the display
invents. The dye sits on the display side of it.

Structurally: everything tracer-side lives in `tracer/`. The concentration is
held in the `PassiveTracer` object's own array, **not** on the grid — hanging
it off `grid` would make it part of the fluid state object, and the next person
to touch the solver would find it sitting there looking like something the
physics uses. `solver/`, `geometry/`, `physics/` and `scenarios/` contain no
reference to it.

The guarantee is tested rather than asserted. The same scenario is run with and
without the tracer and the velocity and pressure fields must come out
**bit-identical** — not within tolerance, because a tolerance would hide
exactly the small perturbation that is hardest to notice and most likely to be
real. Mutation-checked: injecting a single ulp of change into one velocity
fails both separation tests. (A first mutation attempt using `1e-300` survived,
because adding that to an O(1) value rounds away — the mutant was below the
ulp, not the test below par.)

---

## 4. The three views

Velocity, pressure and dye differ only in the view object handed to the
renderer. Switching is a pure display change: `setMode()` sets a string and
redraws. Verified in the browser mid-run and paused — iteration and simulated
time untouched across six switches, and the painted canvas different each time.

**Pressure** uses a diverging blue/amber ramp (blue against orange is the axis
that survives both deuteranopia and protanopia; blue against red does not),
centred on the domain mean. All four scenarios use Neumann pressure boundaries,
so `p` is defined only up to an additive constant and absolute values carry no
meaning — a +1000 gauge shift moves the picture by 4e-13, which is asserted.
The view states that, and states that this is the first-order Chorin projection
pressure, accurate to O(dt) with a known error layer near walls where
`dp/dn = 0` is a numerical convenience rather than the true condition.

**Dye** is scaled at a fixed 0..1 rather than fitted to the dye present. An
auto-scaled dye view repaints a nearly empty domain as a full one every frame,
which would make brightness mean "the most there is right now" instead of
concentration.

The NaN discipline carries into all three: one bad cell is counted and painted
as not-finite in every view, and a wholly broken field withholds its scale
entirely rather than showing the survivors' range.

---

## Known limitations added by M3

- 2D unsplit TVD is not proven; boundedness is measured (2.7e-8 excursion) and
  bounded by the divergence residual rather than guaranteed.
- The tracer drops to first-order donor cell adjacent to solids and domain
  edges, giving a more diffusive band about one cell wide around obstacles.
- Dye is a visualization aid and is labelled as one. It is not validated
  against anything and no case in `validation/registry.js` covers it — there is
  nothing external that says a dye pattern is right.
- The projection pressure shown is not the true pressure near walls. The view
  says so; nothing corrects it.

## Handover to M4

Nothing in M3 is unfinished. The one item deliberately left open is the
first-step CFL observation in §2 — recorded here so it is not lost in a commit
message, and not acted on because the solver was out of scope.
