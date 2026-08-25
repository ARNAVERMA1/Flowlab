// M0 harness: Run / Pause / Reset, a velocity-magnitude colour map, and the
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

import { step, computeDivergence } from "../solver/ns2d.js";
import { inspectField } from "../physics/fieldStats.js";
import { VelocityFieldRenderer } from "../visualization/velocityField.js";
import { rampCss } from "../visualization/colormap.js";
import { buildScenario, SCENARIOS, DEFAULT_SCENARIO } from "../scenarios/index.js";
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
    const { grid, bc, params } = this.scenario;
    const started = performance.now();

    for (let n = 0; n < STEPS_PER_FRAME; n++) {
      this.lastStep = step(grid, bc, params);
      this.iteration++;
      this.simulatedTime += params.dt;
      if (performance.now() - started > FRAME_BUDGET_MS) break;
    }

    this.draw();
    if (this.state === "running") this.frame = requestAnimationFrame(() => this.tick());
  }

  draw() {
    const { grid } = this.scenario;
    const inspection = inspectField(grid);
    const divergence = computeDivergence(grid);

    // A field that has stopped being finite is a hard stop, not a warning.
    if (!inspection.finite && this.state !== "failed") {
      this.state = "failed";
      this.stopLoop();
      const where = inspection.firstNonFinite;
      this.failure =
        `${inspection.nonFiniteCells} of ${inspection.fluidCells} fluid cells are not finite` +
        (where ? `, first at cell (${where.i}, ${where.j})` : "");
    }

    this.renderer.render(grid, inspection);
    this.updateReadouts(inspection, divergence);
  }

  updateReadouts(inspection, divergence) {
    const { scenario, root } = this;
    const { params, grid } = scenario;

    const set = (id, text, bad = false) => {
      const node = root.querySelector(id);
      node.textContent = text;
      node.classList.toggle("bad", bad);
    };

    set("#nu", exponential(params.nu, 3));
    set("#rho", fixed(params.rho, 1));
    set("#dt", exponential(params.dt, 3));
    set("#grid", `${grid.nx} x ${grid.ny}  (h = ${exponential(grid.h, 2)})`);
    set("#re", integer(scenario.Re));
    set("#iteration", integer(this.iteration));
    set("#time", fixed(this.simulatedTime, 3));

    set("#divmax", exponential(divergence.max, 2), isBad(divergence.max));
    set("#divrms", exponential(divergence.rms, 2), isBad(divergence.rms));

    // inspection.maxSpeed is the largest speed among the cells that are still
    // finite, which is what the colour scale needs in order to draw anything at
    // all. It is NOT a fact about the field once part of the field is broken,
    // so the panel reports NaN rather than that number: a plausible peak speed
    // sitting beside a NOT FINITE field state is precisely the mixed message
    // this panel is supposed to be incapable of sending.
    const reportedPeak = inspection.finite ? inspection.maxSpeed : NaN;
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

    const finiteBad = !inspection.finite;
    set(
      "#fieldstate",
      finiteBad
        ? `NOT FINITE - ${inspection.nonFiniteCells} bad cells`
        : `finite (${integer(inspection.finiteCells)} fluid cells)`,
      finiteBad
    );

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

    this.updateLegend(inspection);
  }

  updateLegend(inspection) {
    const bar = this.root.querySelector("#legendbar");
    if (!bar.dataset.painted) {
      const stops = [];
      for (let k = 0; k <= 12; k++) stops.push(`${rampCss(k / 12)} ${(k / 12) * 100}%`);
      bar.style.background = `linear-gradient(to right, ${stops.join(", ")})`;
      bar.dataset.painted = "1";
    }
    // Same rule as the peak readout: a scale drawn from a partly broken field
    // is not a scale anyone should read a value off.
    const max = inspection.finite ? inspection.maxSpeed : NaN;
    this.root.querySelector("#legendmax").textContent = exponential(max, 2);
    this.root.querySelector("#legendmax").classList.toggle("bad", isBad(max));
  }
}
