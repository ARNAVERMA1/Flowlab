// What the colour map is showing, and how it is scaled.
//
// Each source turns the state the driver already has into a scalar per cell
// plus the scale and ramp to paint it with. Switching between them is a pure
// display change: nothing here steps the solver, touches the tracer, rebuilds
// a scenario or writes to any field. prepareView() reads and returns; that is
// the whole contract, and tests/test9 pins it with checksums taken either side
// of a switch.
//
// Keeping this layer free of the DOM is deliberate. The renderer needs a
// canvas and can only be exercised in a browser; the decisions that could
// actually be wrong - what gets subtracted before pressure is shown, what a
// broken field normalises to, whether dye is auto-scaled - live here, where
// node can test them.

import { inspectScalar, speedAtCell } from "../physics/fieldStats.js";
import { sampleRamp, sampleDiverging, sampleDye } from "./colormap.js";

// A scale is NaN-poisoned rather than defaulted when the field is not usable.
// Every normalise() below divides by it, so a broken field yields NaN for
// every cell, and sampleRamp turns NaN into the not-finite colour instead of
// clamping it to an end of the ramp. That chain is the reason a NaN field
// cannot come out looking like a healthy picture.
const VELOCITY = {
  id: "velocity",
  label: "velocity magnitude",
  requires: "grid",
  note:
    "Speed at cell centres, averaged from the surrounding staggered faces. " +
    "Scaled to the largest speed currently present.",
  prepare(context) {
    const { grid } = context;
    const valueAt = (i, j) => speedAtCell(grid, i, j);
    const summary = inspectScalar(grid, valueAt);
    // A flat zero field is still a legitimate picture - still water - so it
    // scales to 1 and paints uniformly at the bottom of the ramp rather than
    // dividing by zero.
    const hi = summary.finite ? (summary.max > 0 ? summary.max : 1) : NaN;
    return {
      valueAt,
      summary,
      scale: { lo: 0, hi, centre: null, diverging: false },
      normalise: (value) => value / hi,
      ramp: sampleRamp,
    };
  },
};

const PRESSURE = {
  id: "pressure",
  label: "pressure",
  requires: "grid",
  // Two limitations that a pressure picture hides unless it is told not to,
  // both VISION 4.3 items. They are shown next to the view, not left for the
  // viewer to work out.
  note:
    "Shown relative to the domain mean: every scenario uses Neumann pressure " +
    "boundaries, so p is defined only up to an additive constant and absolute " +
    "values carry no meaning - only differences do. This is also the " +
    "projection pressure from a first-order Chorin step, which is accurate to " +
    "O(dt) and carries a known error layer near walls, where the numerical " +
    "condition dp/dn = 0 is a convenience rather than the true boundary " +
    "condition.",
  prepare(context) {
    const { grid } = context;
    const raw = (i, j) => grid.p[grid.idx(i, j)];
    const summary = inspectScalar(grid, raw);
    const mean = summary.mean;
    const spread = summary.finite
      ? Math.max(Math.abs(summary.max - mean), Math.abs(summary.min - mean))
      : NaN;
    // A perfectly uniform pressure field is meaningful (still water) and must
    // land on the centre stop rather than dividing by zero.
    const amplitude = summary.finite ? (spread > 0 ? spread : 1) : NaN;
    return {
      valueAt: (i, j) => raw(i, j) - mean,
      summary,
      scale: { lo: -amplitude, hi: amplitude, centre: 0, diverging: true },
      normalise: (value) => 0.5 + (0.5 * value) / amplitude,
      ramp: sampleDiverging,
    };
  },
};

const DYE = {
  id: "dye",
  label: "dye (visualization aid)",
  requires: "tracer",
  note:
    "A passive scalar advected by the velocity field. It is NOT a solver " +
    "state field and nothing computed from it feeds back into the flow - see " +
    "tracer/passiveScalar.js. Concentration runs 0 to 1 by construction and " +
    "the scale is FIXED at that range, never fitted to the dye currently " +
    "present: an auto-scaled dye view would repaint a nearly empty domain as " +
    "a full one every frame.",
  prepare(context) {
    const { grid, tracer } = context;
    const valueAt = (i, j) => tracer.c[grid.idx(i, j)];
    const summary = inspectScalar(grid, valueAt);
    // The scale stays 0..1 even when the field is broken; what must not
    // survive a broken field is the per-cell value, and a NaN concentration
    // normalises to NaN and paints as not-finite regardless of the scale.
    return {
      valueAt,
      summary,
      scale: { lo: 0, hi: 1, centre: null, diverging: false },
      normalise: (value) => value,
      ramp: sampleDye,
    };
  },
};

export const FIELD_SOURCES = [VELOCITY, PRESSURE, DYE];
export const DEFAULT_FIELD_SOURCE = "velocity";

export function fieldSourceById(id) {
  return FIELD_SOURCES.find((source) => source.id === id) ?? null;
}

export function fieldSourceAvailable(id, context) {
  const source = fieldSourceById(id);
  if (!source) return false;
  if (source.requires === "tracer") return Boolean(context?.tracer);
  return Boolean(context?.grid);
}

// Builds everything the renderer and the legend need for one frame.
// Returns null for a source that cannot be shown with the state on hand -
// the dye view with no tracer - so the caller says so rather than painting
// an empty field and letting it read as "no dye here".
export function prepareView(sourceId, context) {
  const source = fieldSourceById(sourceId) ?? fieldSourceById(DEFAULT_FIELD_SOURCE);
  if (!fieldSourceAvailable(source.id, context)) return null;
  const prepared = source.prepare(context);
  return {
    id: source.id,
    label: source.label,
    note: source.note,
    ...prepared,
  };
}
