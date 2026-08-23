# VISION.md — FlowLab

> A visual environment for understanding and solving physical equations, starting with fluid dynamics.

This document describes the **destination**. It is deliberately ambitious and deliberately
non-actionable. It exists so that architectural decisions made today do not close doors
that matter later.

**It is not a task list.** For what to build now, see `ROADMAP.md`.

---

## 1. The north star

A user should be able to do this:

> *"Draw a pipe, put water in it, bend the pipe, press Run, click a point, and understand
> exactly what the equations are doing there."*

That single interaction is the heart of the project. Every feature should be judged by
whether it moves toward that sentence or decorates around it.

## 2. Who this is for

- **Physics and engineering students** who have seen Navier–Stokes on a blackboard but have
  never watched it *do* anything.
- **Self-learners** who want intuition before formalism.
- **Engineers** who want a fast, visual sanity check before reaching for real CFD software.

The same simulation should be presentable two ways:

| Student asks | Engineer asks |
|---|---|
| "Why does this vortex appear?" | "What is the vorticity at probe P3?" |

Educational mode and analysis mode are two views of one simulation, not two products.

## 3. The core loop

```
DRAW → DEFINE → SIMULATE → OBSERVE → MEASURE → UNDERSTAND → MODIFY → SIMULATE AGAIN
```

A user with no CFD background should be able to progress naturally from:

1. *"I drew a pipe and watched water move."*
2. *"I understand why this pressure drop occurs."*
3. *"I changed the Reynolds number and compared the resulting flow."*
4. *"I measured the drag force on this geometry."*

## 4. Non-negotiable principles

### 4.1 Physics first, visualization second, polish third

Priority order when anything conflicts:

```
Correctness → Stable solver → Interactive geometry → Useful visualization
→ Analysis → Educational explanation → Engineering features → Performance → Visual polish
```

Numerical correctness is never sacrificed for visual effect.

### 4.2 Never fake physics

Visual behaviour must emerge from the simulation wherever practical. Do not add fake
turbulence, fake swirl, or cosmetic noise because it looks convincing. If a visual effect
is not physical, it must be explicitly labelled as a visualization aid, not a result.

### 4.3 Never hide numerical limitations

Where relevant, surface: grid resolution, timestep, iteration count, residuals,
convergence state, solver type. A user should always be able to tell the difference
between a **visual demonstration** and a **validated numerical result**.

Never claim engineering accuracy without validation against a benchmark.

### 4.4 Separation of concerns

```
UI
 ↓
Simulation configuration
 ↓
Geometry / Mesh
 ↓
Numerical solver
 ↓
Physical fields
 ↓
Visualization
```

The solver must never be coupled to the frontend. Geometry must never be hardcoded into
the solver. This separation is what makes the 2D → 3D transition possible at all.

## 5. Design direction

The interface should feel like a **scientific instrument**, not a startup dashboard.

- Dark laboratory aesthetic, subtle grid, restrained accent colour
- Clean typography, highly readable numerical information
- Minimal UI chrome — the simulation is the hero
- No decorative complexity, no fake sophistication

The intended feeling: *"This is a serious scientific tool that happens to be beautiful."*

### Reference images

`docs/references/` contains three mockups:

| File | Shows |
|---|---|
| `ui-reference.png` | Intended overall layout, panels, hierarchy |
| `visualization-reference.png` | Intended appearance of velocity/pressure/vorticity/streamline views |
| `3d-reference.png` | Long-term 3D and engineering-analysis direction |

**These are aspirational mockups, not screenshots of anything that exists.**

> ⚠️ **Do not implement visual elements from the reference images unless the current
> milestone explicitly requires them.** They are style references for later milestones.
> Building this UI before the solver works would be exactly the failure mode this
> document exists to prevent.

## 6. Long-term capability targets

Listed to inform architecture only. None of this is scheduled.

**Advanced fluids**
- Higher Reynolds-number regimes
- Real turbulence modelling (RANS / LES) where appropriate
- Unstructured or adaptive meshing
- Benchmark-validated engineering quantities: drag, lift, wall shear stress, pressure drop

**3D**
- Same conceptual architecture, `u(x,y,t)` → `u(x,y,z,t)`
- Volumetric rendering, slices, iso-surfaces, 3D streamlines, particle traces
- Orbit / pan / zoom / clipping camera

**Beyond fluids** — the same engine architecture should eventually host other PDE modules:

- Heat transfer — `∂T/∂t = α∇²T`
- Wave equation — `∂²u/∂t² = c²∇²u`
- Diffusion and reaction–diffusion
- Electromagnetism, acoustics
- Quantum mechanics — `iħ ∂ψ/∂t = Ĥψ`

Note that these do **not** share a solver. Each is a genuinely separate numerical engine
under a shared UI and visualization layer. That is the architectural bet this project is
making, and it is only worth making if the fluid engine is clean first.

## 7. What would make this project a failure

- A beautiful dashboard wrapped around a solver that isn't actually solving anything
- Turbulence that looks right but isn't computed
- 3D attempted before 2D is validated
- A monolith where geometry, solver, and rendering can't be tested independently
- Chasing the reference images instead of the physics
