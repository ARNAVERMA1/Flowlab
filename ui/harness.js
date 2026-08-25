// Solver harness: Run / Pause / Reset, a velocity-magnitude colour map, and the
// raw numbers behind it.
//
// This layer drives the solver and reads its output. It never reaches into the
// numerics: the only solver entry point used is step(), and the only fields
// read are grid.u/v/p/solid.
//
// The panel's job is to let someone watch the validated solver and trust what
// they are seeing, which means it has to be incapable of showing a healthy
// number for a broken field. Two rules enforce that:
//
//   1. Every frame calls inspectField(), which classifies each fluid cell with
//      Number.isFinite rather than reducing with a bare comparison.
//   2. If the field is not finite the run halts immediately, the panel switches
//      to a failure state, and the affected quantities are shown as NaN. The
//      simulation cannot be restarted except through Reset, so a stale frame
//      can never be mistaken for a live one.

import { step, computeDivergence, SolverDivergenceError } from "../solver/ns2d.js";
import { computeStableTimestep, SolverStabilityError } from "../solver/stability.js";
import { inspectField } from "../physics/fieldStats.js";
import { VelocityFieldRenderer } from "../visualization/velocityField.js";
import { rampCss } from "../visualization/colormap.js";
import { buildScenario, SCENARIOS, DEFAULT_SCENARIO } from "../scenarios/index.js";
import { assessField } from "./fieldHealth.js";
import { exponential, fixed, integer, isBad } from "./format.js";

const STEPS_PER_FRAME = 4;
const FRAME_BUDGET_MS = 24;

export class Harness {
  constructor(root) {
    this.root = root;
    this.scenarioId = DEFAULT_SCENARIO;
    this.renderer = new VelocityFieldRenderer(root.querySelector("#field"));
    this.state = "paused"; // paused | running | failed
    this.iteration = 0;
    this.simulatedTime = 0;
    this.lastStep = null;
    this.lastTimestep = null;
    this.failure = null;
    this.frame = null;

    this.bindControls();
    this.load(this.scenarioId);
  }

  bindControls() {
    const { root } = this;
    root.querySelector("#run").addEventListener("click", () => this.run());
    root.querySelector("#pause").addEventListener("click", () => this.pause());
    root.querySelector("#reset").addEventListener("click", () => this.load(this.scenarioId));

    const select = root.querySelector("#scenario");
    for (const entry of SCENARIOS) {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.label;
      select.appendChild(option);
    }
    select.value = this.scenarioId;
    select.addEventListener("change", () => {
      this.scenarioId = select.value;
      this.load(this.scenarioId);
    });
  }

  // Cancels the animation loop without drawing. load() needs this because
  // drawing requires a scenario, and load() runs before one exists.
  stopLoop() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  load(id) {
    this.stopLoop();
    this.scenario = buildScenario(id);
    this.iteration = 0;
    this.simulatedTime = 0;
    this.lastStep = null;
    this.lastTimestep = null;
    this.failure = null;
    this.state = "paused";

    const { grid } = this.scenario;
    const canvas = this.root.querySelector("#field");
    const scale = Math.max(1, Math.min(9, Math.floor(760 / grid.nx)));
    canvas.width = grid.nx * scale;
    canvas.height = grid.ny * scale;

    this.root.querySelector("#note").textContent = this.scenario.note;
    this.draw();
  }

  run() {
    if (this.state === "failed") return; // only Reset clears a failure
    if (this.state === "running") return;
    this.state = "running";
    this.tick();
  }

  pause() {
    this.stopLoop();
    if (this.state === "running") this.state = "paused";
    if (this.scenario) this.draw();
  }

  tick() {
    if (this.state !== "running") return;
    const { grid, bc, params, timestep } = this.scenario;
    const started = performance.now();

    // The timestep is chosen from the field before every step, not fixed for
    // the run. A stability failure is an exception, not a status code, so it
    // is caught here and turned into the same hard stop as a non-finite field.
    try {
      for (let n = 0; n < STEPS_PER_FRAME; n++) {
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
        if (performance.now() - started > FRAME_BUDGET_MS) break;
      }
    } catch (error) {
      // Both solver failure modes are hard stops here: the scheme coming apart
      // (stability) and the projection failing to deliver the incompressibility
      // it promised (divergence).
      const isSolverFailure =
        error instanceof SolverStabilityError || error instanceof SolverDivergenceError;
      if (!isSolverFailure) throw error;
      this.state = "failed";
      this.stopLoop();
      this.failure = error.message;
      this.draw();
      return;
    }

    this.draw();
    if (this.state === "running") this.frame = requestAnimationFrame(() => this.tick());
  }

  draw() {
    const { grid } = this.scenario;
    const inspection = inspectField(grid);
    const divergence = computeDivergence(grid);
    const health = assessField(inspection);

    // A field that has stopped being finite is a hard stop, not a warning.
    if (health.halt && this.state !== "failed") {
      this.state = "failed";
      this.stopLoop();
      this.failure = health.message;
    }

    this.renderer.render(grid, inspection);
    this.updateReadouts(inspection, divergence, health);
  }

  updateReadouts(inspection, divergence, health) {
    const { scenario, root } = this;
    const { params, grid } = scenario;

    const set = (id, text, bad = false) => {
      const node = root.querySelector(id);
      node.textContent = text;
      node.classList.toggle("bad", bad);
    };

    set("#nu", exponential(params.nu, 3));
    set("#rho", fixed(params.rho, 1));
    const sel = this.lastSelection;
    set("#dt", sel ? exponential(sel.dt, 3) : "chosen per step");
    set("#cfl", sel ? `${fixed(sel.cflNumber, 3)} / ${fixed(sel.diffusionNumber, 3)}` : "-");
    set("#dtlimit", sel ? sel.limitedBy : "-");
    set("#grid", `${grid.nx} x ${grid.ny}  (h = ${exponential(grid.h, 2)})`);
    set("#re", integer(scenario.Re));
    set("#iteration", integer(this.iteration));
    set("#time", fixed(this.simulatedTime, 3));

    set("#divmax", exponential(divergence.max, 2), isBad(divergence.max));
    set("#divrms", exponential(divergence.rms, 2), isBad(divergence.rms));

    // assessField decides what may be reported; see ui/fieldHealth.js for why
    // the peak speed is not simply inspection.maxSpeed.
    const reportedPeak = health.reportedPeakSpeed;
    set("#peak", exponential(reportedPeak, 3), isBad(reportedPeak));

    if (this.lastStep === null) {
      set("#poisson", "not stepped yet");
      set("#poissonits", "-");
    } else {
      const converged = this.lastStep.poissonConverged;
      set("#poisson", converged ? "converged" : "DID NOT CONVERGE", !converged);
      set(
        "#poissonits",
        `${integer(this.lastStep.poissonIterations)} iterations, residual ${exponential(this.lastStep.poissonResidual, 2)}`,
        isBad(this.lastStep.poissonResidual)
      );
    }

    set("#fieldstate", health.fieldSummary, !health.ok);

    const banner = root.querySelector("#banner");
    if (this.state === "failed") {
      banner.hidden = false;
      banner.textContent = `SIMULATION DIVERGED - ${this.failure}. Numbers below are from the broken field. Press Reset.`;
    } else {
      banner.hidden = true;
    }

    set("#status", this.state.toUpperCase(), this.state === "failed");
    root.querySelector("#run").disabled = this.state !== "paused";
    root.querySelector("#pause").disabled = this.state !== "running";

    this.updateLegend(health);
  }

  updateLegend(health) {
    const bar = this.root.querySelector("#legendbar");
    if (!bar.dataset.painted) {
      const stops = [];
      for (let k = 0; k <= 12; k++) stops.push(`${rampCss(k / 12)} ${(k / 12) * 100}%`);
      bar.style.background = `linear-gradient(to right, ${stops.join(", ")})`;
      bar.dataset.painted = "1";
    }
    // Same rule as the peak readout: a scale drawn from a partly broken field
    // is not a scale anyone should read a value off.
    const max = health.reportedPeakSpeed;
    this.root.querySelector("#legendmax").textContent = exponential(max, 2);
    this.root.querySelector("#legendmax").classList.toggle("bad", isBad(max));
  }
}
