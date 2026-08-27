// Solver harness: Run / Pause / Reset, a scalar colour map, and the raw
// numbers behind it.
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
//
// M3 adds two more views and a dye tracer. The rule they are held to:
// switching what is displayed is a PURE DISPLAY CHANGE. setMode() sets a
// string and redraws - it does not step, reset, rebuild the scenario or touch
// a field. The dye is advected by the flow and feeds nothing back into it;
// see tracer/passiveScalar.js for how that separation is enforced and
// tests/test9_m3_visualization.js for the assertion that it holds.

import {
  step, computeDivergence, boundaryPlanFor, SolverDivergenceError,
} from "../solver/ns2d.js";
import { computeStableTimestep, SolverStabilityError } from "../solver/stability.js";
import { inspectField } from "../physics/fieldStats.js";
import { FieldRenderer } from "../visualization/fieldRenderer.js";
import { samplerCss } from "../visualization/colormap.js";
import {
  drawBoundaryOverlay, boundaryLegend, measureBoundaryFlux,
} from "../visualization/boundaryOverlay.js";
import { analyseRegions, describeRegions } from "../boundaries/regionAnalysis.js";
import {
  prepareView,
  FIELD_SOURCES,
  DEFAULT_FIELD_SOURCE,
} from "../visualization/fieldSources.js";
import { buildScenario, SCENARIOS, DEFAULT_SCENARIO } from "../scenarios/index.js";
import { PassiveTracer } from "../tracer/passiveScalar.js";
import { tracerConfigFor } from "../tracer/seeds.js";
import { assessField } from "./fieldHealth.js";
import { ValidationPanel } from "./validationPanel.js";
import { exponential, fixed, integer, isBad } from "./format.js";

function escapeHtml(text) {
  return String(text).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

const STEPS_PER_FRAME = 4;
const FRAME_BUDGET_MS = 24;

// Width of the boundary-condition bands, and the margin they live in. The
// bands sit BESIDE the field, not over its edge: the outermost cells carry the
// boundary layer, which is the part of the picture the boundary condition is
// most responsible for, and covering it to label it would be a poor trade.
const BAND = 7;
const MARGIN = BAND + 2;

export class Harness {
  constructor(root) {
    this.root = root;
    this.scenarioId = DEFAULT_SCENARIO;
    this.mode = DEFAULT_FIELD_SOURCE;
    this.renderer = new FieldRenderer(root.querySelector("#field"));
    this.state = "paused"; // paused | running | failed
    this.iteration = 0;
    this.simulatedTime = 0;
    this.lastStep = null;
    this.lastTimestep = null;
    this.lastTracer = null;
    this.failure = null;
    this.frame = null;

    this.validation = new ValidationPanel(root);
    this.bindControls();
    this.load(this.scenarioId);
    // The validation record is fetched asynchronously; re-render once it lands
    // so the panel stops saying "loading" and starts showing measurements.
    this.validation.load().then(() => this.validation.render(this.scenarioId));
  }

  bindControls() {
    const { root } = this;
    root.querySelector("#run").addEventListener("click", () => this.run());
    root.querySelector("#pause").addEventListener("click", () => this.pause());
    root.querySelector("#reset").addEventListener("click", () => this.load(this.scenarioId));
    root.querySelector("#reseed").addEventListener("click", () => this.seedTracer());
    root.querySelector("#cleardye").addEventListener("click", () => this.clearTracer());

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

    const mode = root.querySelector("#mode");
    for (const source of FIELD_SOURCES) {
      const option = document.createElement("option");
      option.value = source.id;
      option.textContent = source.label;
      mode.appendChild(option);
    }
    mode.value = this.mode;
    mode.addEventListener("change", () => this.setMode(mode.value));
  }

  // A pure display change. No step, no reset, no field is touched - which is
  // the whole requirement for M3's mode switching, and is asserted rather than
  // assumed in tests/test9_m3_visualization.js.
  setMode(id) {
    this.mode = id;
    this.draw();
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
    this.lastTracer = null;
    this.failure = null;
    this.state = "paused";

    const { grid } = this.scenario;
    // Compiled once per load and handed to both the solver and the overlay, so
    // the picture of what is applied where cannot disagree with what is
    // applied. Compiling separately for the display would be two
    // implementations of one rule.
    this.plan = boundaryPlanFor(grid, this.scenario.bc);
    this.tracer = new PassiveTracer(grid);
    this.tracerConfig = tracerConfigFor(id);
    this.seedTracer();

    // Reseed is only meaningful where there is an initial pattern to restore.
    // On an injection-only scenario it would clear the dye and appear to do
    // nothing, so it says why it is unavailable instead.
    const reseed = this.root.querySelector("#reseed");
    reseed.disabled = !this.tracerConfig.seeded;
    reseed.title = this.tracerConfig.note;
    this.root.querySelector("#dyenote").textContent = this.tracerConfig.note;

    const canvas = this.root.querySelector("#field");
    const scale = Math.max(1, Math.min(9, Math.floor((760 - 2 * MARGIN) / grid.nx)));
    this.scale = scale;
    canvas.width = grid.nx * scale + 2 * MARGIN;
    canvas.height = grid.ny * scale + 2 * MARGIN;

    this.root.querySelector("#note").textContent = this.scenario.note;
    this.validation.render(id);
    this.draw();
  }

  // Dye controls only ever touch the tracer. They do not reset the run: the
  // flow keeps whatever state it has and only what is painted into it changes.
  seedTracer() {
    if (!this.tracer || !this.scenario) return;
    if (!this.tracerConfig.seeded) return;
    this.tracer.clear();
    this.tracer.seed(this.scenario.grid, this.tracerConfig.seed);
    if (this.scenario) this.draw();
  }

  clearTracer() {
    if (!this.tracer) return;
    this.tracer.clear();
    if (this.scenario) this.draw();
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
        // The tracer runs after the step, on the velocity field the solver has
        // just produced, and takes the timestep it is given. It never asks for
        // a different one - see PassiveTracer.advect.
        this.lastTracer = this.tracer.advect(grid, bc, selection.dt, {
          inject: this.tracerConfig.inject,
        });
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

    const view = prepareView(this.mode, { grid, tracer: this.tracer });
    this.renderer.render(grid, view, MARGIN);
    drawBoundaryOverlay(this.renderer.context, this.plan, {
      originX: MARGIN,
      originY: MARGIN,
      scale: this.scale,
      band: BAND,
    });
    this.updateReadouts(inspection, divergence, health, view);
  }

  updateReadouts(inspection, divergence, health, view) {
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

    this.updateTracerReadouts();
    this.updateBoundaryPanel();
    this.updateLegend(view);
  }

  updateTracerReadouts() {
    const { root } = this;
    const set = (id, text, bad = false) => {
      const node = root.querySelector(id);
      node.textContent = text;
      node.classList.toggle("bad", bad);
    };

    const { total, nonFiniteCells } = this.tracer.total(this.scenario.grid);
    set("#dyetotal", exponential(total, 3), isBad(total));
    set(
      "#dyebroken",
      nonFiniteCells === 0 ? "none" : `${integer(nonFiniteCells)} cells`,
      nonFiniteCells > 0
    );

    const advection = this.lastTracer;
    set("#dyecfl", advection ? fixed(advection.cfl, 3) : "-", advection ? isBad(advection.cfl) : false);
    // Substeps above 1 mean the tracer's own bound was tighter than the step
    // it was handed and it subdivided rather than asking for a smaller dt.
    // Shown because a silent substep would hide exactly the situation the
    // separate constraint exists to handle.
    set("#dyesubsteps", advection ? integer(advection.substeps) : "-");
  }

  // The boundary panel. Every row is derived from the compiled plan, and the
  // flux beside it is MEASURED from the velocity field rather than read back
  // off the specification - which is the whole point on a pressure boundary,
  // where nothing was specified and the flux is the answer.
  updateBoundaryPanel() {
    const list = this.root.querySelector("#bclist");
    const signature = this.scenarioId;
    if (list.dataset.builtFor !== signature) {
      list.innerHTML = "";
      for (const entry of boundaryLegend(this.plan)) {
        const row = document.createElement("div");
        row.className = "bcrow";
        const extent =
          entry.spans.length === 1 && entry.cells === this.plan.sides[entry.side].cells
            ? "whole side"
            : entry.spans
                .map((s) => `${fixed(s.from, 2)}-${fixed(s.to, 2)}`)
                .join(", ");
        row.innerHTML =
          `<i class="sw" style="background:${entry.colour}"></i>` +
          `<span class="bcside">${entry.side}</span>` +
          `<span class="bctext">${escapeHtml(entry.label)}` +
          `<span class="bcextent">${escapeHtml(extent)}</span></span>`;
        list.appendChild(row);
      }
      list.dataset.builtFor = signature;
    }

    const flux = measureBoundaryFlux(this.scenario.grid, this.plan);
    const set = (id, text, bad = false) => {
      const node = this.root.querySelector(id);
      node.textContent = text;
      node.classList.toggle("bad", bad);
    };
    set(
      "#bcflux",
      ["left", "right", "bottom", "top"]
        .map((side) => `${side[0]} ${exponential(flux[side].flux, 2)}`)
        .join("  "),
      ["left", "right", "bottom", "top"].some((side) => isBad(flux[side].flux))
    );
    // Net flux is the quantity that must be zero for an incompressible domain.
    // Shown because a boundary specification that does not balance is a real
    // error, and this is where it becomes visible.
    set("#bcnet", exponential(flux.net, 2), isBad(flux.net) || Math.abs(flux.net) > 1e-6);

    // Connected fluid regions. A second region is not an error - a sealed
    // chamber runs perfectly well - so this reports rather than warns. The
    // solver rejects only the region it genuinely cannot solve, and says so
    // itself when it does.
    set("#bcregions", describeRegions(analyseRegions(this.scenario.grid, this.plan)));
  }

  updateLegend(view) {
    const bar = this.root.querySelector("#legendbar");
    const painted = view ? view.id : "none";
    if (bar.dataset.painted !== painted) {
      if (view) {
        const stops = [];
        for (let k = 0; k <= 24; k++) {
          stops.push(`${samplerCss(view.ramp, k / 24)} ${(k / 24) * 100}%`);
        }
        bar.style.background = `linear-gradient(to right, ${stops.join(", ")})`;
      } else {
        bar.style.background = "transparent";
      }
      bar.dataset.painted = painted;
    }

    const set = (id, text, bad = false) => {
      const node = this.root.querySelector(id);
      node.textContent = text;
      node.classList.toggle("bad", bad);
    };

    if (!view) {
      set("#legendmin", "-");
      set("#legendmid", "");
      set("#legendmax", "-");
      set("#viewnote", "This view is not available for the current state.");
      return;
    }

    // Same rule as the peak readout: a scale drawn from a partly broken field
    // is not a scale anyone should read a value off, and prepareView hands
    // back NaN bounds rather than the survivors' range when that happens.
    const { lo, hi, centre } = view.scale;
    set("#legendmin", exponential(lo, 2), isBad(lo));
    set("#legendmid", centre === null ? "" : exponential(centre, 2));
    set("#legendmax", exponential(hi, 2), isBad(hi));
    set("#viewnote", view.note);
  }
}
