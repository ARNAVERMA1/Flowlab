// A scenario plus its live state, and the rules for changing its geometry.
//
// This lives in ui/ rather than scenarios/ because it owns a dye tracer, and
// scenarios/ is sealed against the tracer: a scenario is a physics
// configuration, dye is a display aid, and tests/test9 asserts that deleting
// tracer/ leaves the solver and everything describing the simulation
// untouched. The M3 separation test caught this as soon as the session was
// written in the wrong place.
//
// The session is the DRIVER - the thing an interactive app runs - so it is the
// right home for state only an interactive app needs. A headless use of the
// solver needs none of it.
//
// ---------------------------------------------------------------------------
// WHAT HAPPENS TO THE FIELD WHEN THE GEOMETRY CHANGES
// ---------------------------------------------------------------------------
//
// The field is discarded and the run restarts. Not repaired, not carried over.
//
// The tempting alternative is to keep the flow and patch the difference: zero
// the cells that became solid, seed the ones that became fluid, carry on. It
// would look continuous on screen and it would be wrong in a way that is hard
// to see. Cells that became fluid have no history to carry; cells that became
// solid were carrying momentum that has to go somewhere; and the patched field
// is not divergence-free anywhere near the change, so the first step after it
// would be solving from an initial condition that satisfies nothing. The
// divergence bound step() promises would be met, technically, about a field
// nobody should read.
//
// The honest reason underneath: a domain that changes shape while fluid moves
// through it is a moving-boundary problem. This solver is a fixed-grid method
// and does not model one. Animating the transition would be inventing
// behaviour the simulation did not compute, which is the same failure as fake
// turbulence wearing different clothes.
//
// So the rules are:
//
//   1. A geometry edit stops the run.
//   2. The mask is resampled from the document.
//   3. Velocity, pressure and dye are rebuilt from the scenario's own initial
//      condition - by rebuilding the scenario, so the initial state is exactly
//      what the scenario specifies rather than an approximation of it.
//   4. Iteration count and simulated time return to zero.
//   5. Stepping a grid whose mask has moved since the field was built is
//      REFUSED, not merely discouraged. That guard is mechanical because the
//      alternative is discipline, and discipline is what fails.
//
// The guard tracks whether the field is consistent with the mask, which is the
// property that actually matters - not a proxy for it such as "did the user
// press the edit button".

import { GeometryEditor } from "../geometry/editor.js";
import { PassiveTracer } from "../tracer/passiveScalar.js";
import { tracerConfigFor } from "../tracer/seeds.js";
import { step } from "../solver/ns2d.js";
import { computeStableTimestep } from "../solver/stability.js";
import { buildScenario } from "../scenarios/index.js";

export class StaleFieldError extends Error {
  constructor(message) {
    super(message);
    this.name = "StaleFieldError";
  }
}

export class SimulationSession {
  constructor(scenarioId) {
    this.scenarioId = scenarioId;
    const scenario = buildScenario(scenarioId);
    this.editor = new GeometryEditor(scenario.geometry);
    this.reset();
  }

  get grid() { return this.scenario.grid; }
  get bc() { return this.scenario.bc; }
  get params() { return this.scenario.params; }
  get document() { return this.editor.document; }
  get canUndo() { return this.editor.canUndo; }
  get canRedo() { return this.editor.canRedo; }

  // Rebuilds everything from the scenario definition and the current document.
  // Rebuilding rather than clearing arrays is deliberate: a scenario's initial
  // condition is whatever its build function produces - the cylinder seeds a
  // uniform stream, for instance - and reproducing that by hand somewhere else
  // would be a second definition of it, free to drift.
  reset() {
    // The document is handed to the builder rather than applied afterwards, so
    // the scenario seeds its initial condition against the geometry that will
    // actually be in force. Applying it after would leave cells the edit
    // exposes holding whatever their slots contained.
    this.scenario = buildScenario(this.scenarioId, this.editor.document);
    this.tracer = new PassiveTracer(this.scenario.grid);
    this.tracerConfig = tracerConfigFor(this.scenarioId);
    this.tracer.seed(this.scenario.grid, this.tracerConfig.seed);

    this.iteration = 0;
    this.simulatedTime = 0;
    this.lastTimestep = null;
    this.lastSelection = null;
    this.lastStep = null;
    this.lastTracer = null;
    this.running = false;
    // The field is now consistent with this mask, and with nothing else.
    this.maskVersionAtReset = this.scenario.grid.maskVersion;
    this.geometryRevisionAtReset = this.editor.revision;
    return this;
  }

  // True when the mask has moved since the field was built. Asked of the grid
  // rather than of any record of user actions, so a mask changed by any route
  // counts.
  get fieldIsStale() {
    return this.scenario.grid.maskVersion !== this.maskVersionAtReset;
  }

  // Every geometry change goes through here, so there is one place where the
  // run is stopped and the field rebuilt.
  #edit(mutate) {
    const changed = mutate();
    if (changed === false) return false;
    this.running = false;
    this.reset();
    return true;
  }

  applyEdit(operation) { return this.#edit(() => this.editor.append(operation) && true); }
  replaceEdit(index, operation) { return this.#edit(() => this.editor.replace(index, operation) && true); }
  removeEdit(index) { return this.#edit(() => this.editor.remove(index) && true); }
  clearGeometry() { return this.#edit(() => this.editor.clear() && true); }
  undo() { return this.#edit(() => this.editor.undo()); }
  redo() { return this.#edit(() => this.editor.redo()); }

  // One solver step, with the timestep chosen from the field as it stands.
  // Refuses outright if the geometry has moved underneath it.
  advance() {
    if (this.fieldIsStale) {
      throw new StaleFieldError(
        `the geometry changed after this field was built (mask version ` +
        `${this.maskVersionAtReset} -> ${this.scenario.grid.maskVersion}), so the field ` +
        `describes a domain that no longer exists. Call reset() to rebuild it. The field ` +
        `is not repaired in place because a domain that changes shape mid-flow is a ` +
        `moving-boundary problem, which this fixed-grid solver does not model - see the ` +
        `note at the top of scenarios/session.js.`
      );
    }

    const { grid, bc, params, timestep } = this.scenario;
    const selection = computeStableTimestep(grid, {
      nu: params.nu,
      safety: timestep.safety,
      previousTimestep: this.lastTimestep,
    });
    this.lastTimestep = selection.dt;
    this.lastSelection = selection;
    this.lastStep = step(grid, bc, { ...params, dt: selection.dt });
    this.iteration++;
    this.simulatedTime += selection.dt;
    this.lastTracer = this.tracer.advect(grid, bc, selection.dt, {
      inject: this.tracerConfig.inject,
    });
    return this.lastStep;
  }

  // Switching scenario keeps nothing: a document drawn against one domain has
  // no meaning in another of a different size and shape.
  load(scenarioId) {
    this.scenarioId = scenarioId;
    this.editor = new GeometryEditor(buildScenario(scenarioId).geometry);
    return this.reset();
  }
}
