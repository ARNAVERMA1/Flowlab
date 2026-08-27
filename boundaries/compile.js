// Compiles a boundary specification into what the solver reads every step.
//
// A specification gives each side either one condition or a list of segments:
//
//   left: { type: "wall" }
//   left: [ { from: 0,   to: 0.5, type: "wall" },
//           { from: 0.5, to: 1.0, type: "inflow", u: 1 } ]
//
// The single-condition form is not a compatibility shim - it is the whole-side
// case, which is what almost every domain wants, written without ceremony. All
// six validated scenarios use it and none of them changed when segments were
// added.
//
// Compilation produces, per side, one Int32Array indexed by the same face
// index the solver's loops already use, holding an index into a deduplicated
// table of conditions. That buys three things:
//
//   1. O(1) lookup in the inner loop. Searching a segment list per face would
//      put a linear scan inside the hot path for a value that never changes.
//   2. One place for validation. A gap between segments, an overlap, a segment
//      running off the end, an inlet with no velocity - all are caught here,
//      once, with a message naming the side and the position, instead of
//      surfacing as a NaN sixty steps into a run.
//   3. The UI draws from the same array the solver reads, so the picture of
//      "which condition is applied where" cannot disagree with what is applied.
//      The alternative - the UI re-deriving it from the specification - is two
//      implementations of one rule, and they drift.
//
// Positions are physical, measured along the side from its origin: y from the
// bottom for the left and right sides, x from the left for the bottom and top.

import {
  BOUNDARY_TYPES, FLOW_PROFILES, SIDES, SIDE_ORIENTATION, isKnownType, normalComponent,
} from "./conditions.js";

export class BoundarySpecError extends Error {
  constructor(message) {
    super(message);
    this.name = "BoundarySpecError";
  }
}

// Segment edges are compared with a tolerance because a specification written
// in physical units will not land exactly on cell boundaries, and demanding
// exact float equality between `to` and the next `from` would reject correct
// input. A thousandth of a cell is far below anything that could be meant.
function edgeTolerance(grid) {
  return grid.h / 1000;
}

export function sideGeometry(grid, side) {
  const vertical = SIDE_ORIENTATION[side] === "vertical";
  const cells = vertical ? grid.ny : grid.nx;
  return {
    orientation: SIDE_ORIENTATION[side],
    // Ghost indices 0 and cells+1 are included: the solver's boundary loops
    // run over them, and they need a condition like any other face.
    faceCount: cells + 2,
    cells,
    length: cells * grid.h,
    // The centre of face t along the side. t = 0 and t = cells+1 are the corner
    // ghosts, which fall outside [0, length] and are clamped to the nearest
    // segment - the same thing the whole-side form does implicitly.
    positionAt: (t) => (t - 0.5) * grid.h,
  };
}

function validateCondition(condition, side, where) {
  if (!condition || typeof condition !== "object") {
    throw new BoundarySpecError(`${side}${where}: expected a condition object, got ${condition}`);
  }
  if (!isKnownType(condition.type)) {
    throw new BoundarySpecError(
      `${side}${where}: unknown boundary type "${condition.type}". ` +
      `Known types: ${Object.keys(BOUNDARY_TYPES).join(", ")}`
    );
  }
  const spec = BOUNDARY_TYPES[condition.type];
  for (const field of spec.required?.(side) ?? []) {
    if (!Number.isFinite(condition[field])) {
      throw new BoundarySpecError(
        `${side}${where}: "${condition.type}" needs a finite ${field} ` +
        `(the component normal to this side), got ${condition[field]}. ` +
        `Components are Cartesian, so the sign says which way the flow goes.`
      );
    }
  }
  // A wall with a normal component would be a wall fluid passes through. The
  // old code silently ignored it; saying so is better than quietly not doing
  // what the specification asked for.
  if (spec.family === "wall") {
    const n = normalComponent(side);
    if (condition[n] !== undefined && condition[n] !== 0) {
      throw new BoundarySpecError(
        `${side}${where}: a ${condition.type} cannot have a normal component ` +
        `(${n} = ${condition[n]}). A wall fluid passes through is an inlet - ` +
        `use type "inflow" if that is what you meant.`
      );
    }
  }
  if (condition.type === "flowInlet" && condition.profile !== undefined) {
    if (!FLOW_PROFILES.includes(condition.profile)) {
      throw new BoundarySpecError(
        `${side}${where}: unknown flow profile "${condition.profile}". ` +
        `Known profiles: ${FLOW_PROFILES.join(", ")}`
      );
    }
  }
  const allowed = new Set([
    "type", "from", "to", "label",
    ...(spec.required?.(side) ?? []),
    ...(spec.optional?.(side) ?? []),
  ]);
  for (const key of Object.keys(condition)) {
    if (!allowed.has(key)) {
      throw new BoundarySpecError(
        `${side}${where}: "${condition.type}" does not use "${key}". ` +
        `A parameter that is silently ignored is worse than one that is rejected - ` +
        `it looks like it took effect. Allowed here: ${[...allowed].join(", ")}`
      );
    }
  }
}

// Turns whatever a side was given into an ordered, gap-free, non-overlapping
// list of segments covering the whole side.
function normaliseSide(entry, side, grid) {
  const geometry = sideGeometry(grid, side);
  const tol = edgeTolerance(grid);

  if (!Array.isArray(entry)) {
    validateCondition(entry, side, "");
    return [{ from: 0, to: geometry.length, condition: entry }];
  }

  if (entry.length === 0) {
    throw new BoundarySpecError(`${side}: an empty segment list leaves the side unspecified`);
  }

  const segments = entry.map((raw, n) => {
    const where = ` segment ${n}`;
    if (!Number.isFinite(raw.from) || !Number.isFinite(raw.to)) {
      throw new BoundarySpecError(
        `${side}${where}: needs finite "from" and "to" positions along the side ` +
        `(0 to ${geometry.length}), got ${raw.from} to ${raw.to}`
      );
    }
    if (raw.to <= raw.from) {
      throw new BoundarySpecError(`${side}${where}: "to" (${raw.to}) must exceed "from" (${raw.from})`);
    }
    validateCondition(raw, side, where);
    const { from, to, ...condition } = raw;
    return { from, to, condition };
  });

  segments.sort((a, b) => a.from - b.from);

  if (Math.abs(segments[0].from) > tol) {
    throw new BoundarySpecError(
      `${side}: segments start at ${segments[0].from} but the side starts at 0. ` +
      `Every part of a boundary needs a condition; there is no default.`
    );
  }
  const last = segments[segments.length - 1];
  if (Math.abs(last.to - geometry.length) > tol) {
    throw new BoundarySpecError(
      `${side}: segments end at ${last.to} but the side ends at ${geometry.length}.`
    );
  }
  for (let n = 1; n < segments.length; n++) {
    const gap = segments[n].from - segments[n - 1].to;
    if (Math.abs(gap) <= tol) continue;
    throw new BoundarySpecError(
      gap > 0
        ? `${side}: nothing covers ${segments[n - 1].to} to ${segments[n].from}`
        : `${side}: segments overlap between ${segments[n].from} and ${segments[n - 1].to}`
    );
  }
  return segments;
}

function segmentAt(segments, position) {
  for (const segment of segments) {
    if (position < segment.to) return segment;
  }
  // Past the end: the last segment. Reached only by the far corner ghost.
  return segments[segments.length - 1];
}

// Run-length encodes a compiled face array back into spans, for the UI. Derived
// from the compiled array rather than from the specification so that what is
// displayed is what the solver reads, including the rounding of a segment edge
// onto the cell grid.
function spansOf(faces, geometry, grid) {
  const spans = [];
  for (let t = 1; t <= geometry.cells; t++) {
    const index = faces[t];
    const previous = spans[spans.length - 1];
    if (previous && previous.condition === index) {
      previous.to = t * grid.h;
      previous.cells++;
      continue;
    }
    spans.push({ condition: index, from: (t - 1) * grid.h, to: t * grid.h, cells: 1 });
  }
  return spans;
}

// Turns each flow-rate inlet into per-face velocities.
//
// The requested rate is delivered through the OPEN faces of the segment - the
// ones whose adjacent interior cell is fluid. An inlet half covered by an
// obstacle still delivers its stated rate, at twice the velocity, rather than
// silently delivering half.
//
// Both profiles are RENORMALISED after sampling rather than evaluated from a
// closed form and hoped over: the sum of the sampled shape times h is divided
// into the requested rate, so the discrete flux equals the request exactly,
// at any resolution, for any open length. Sampling a parabola at face centres
// and trusting the algebra would leave an O(h^2) shortfall, and "the inlet
// delivers almost the requested flow" is not a property worth shipping when
// the exact one costs one division.
function buildFlowProfile(grid, side, geometry, faceConditions, conditions) {
  let needed = false;
  for (let t = 1; t <= geometry.cells; t++) {
    if (conditions[faceConditions[t]].type === "flowInlet") { needed = true; break; }
  }
  if (!needed) return null;

  const profile = new Float64Array(geometry.faceCount);
  const openAt = (t) => {
    const cell =
      side === "left" ? grid.idx(1, t)
      : side === "right" ? grid.idx(grid.nx, t)
      : side === "bottom" ? grid.idx(t, 1)
      : grid.idx(t, grid.ny);
    return grid.solid[cell] === 0;
  };

  // Contiguous runs of faces sharing one condition. Runs rather than condition
  // index, so two separate segments each deliver their own rate.
  let start = 1;
  while (start <= geometry.cells) {
    const index = faceConditions[start];
    let end = start;
    while (end + 1 <= geometry.cells && faceConditions[end + 1] === index) end++;
    const condition = conditions[index];
    if (condition.type === "flowInlet") {
      fillRun(profile, condition, side, start, end, openAt, grid.h);
    }
    start = end + 1;
  }

  // Corner ghosts take their neighbour's value. They are overwritten by the
  // perpendicular sides anyway; leaving them at zero would put a step in the
  // field for the one moment before that happens.
  profile[0] = profile[1];
  profile[geometry.faceCount - 1] = profile[geometry.faceCount - 2];
  return profile;
}

function fillRun(profile, condition, side, start, end, openAt, h) {
  const open = [];
  for (let t = start; t <= end; t++) if (openAt(t)) open.push(t);

  if (open.length === 0) {
    throw new BoundarySpecError(
      `${side}: a flow-rate inlet is completely blocked by solid cells, so the ` +
      `requested rate of ${condition.flowRate} cannot be delivered anywhere.`
    );
  }

  const profileKind = condition.profile ?? "uniform";
  const shape = new Map();

  if (profileKind === "uniform") {
    for (const t of open) shape.set(t, 1);
  } else {
    // A parabola needs a single channel to span. Two open stretches separated
    // by an obstacle have no unambiguous "centre", and guessing one would
    // invent a profile nobody asked for.
    const contiguous = open[open.length - 1] - open[0] + 1 === open.length;
    if (!contiguous) {
      throw new BoundarySpecError(
        `${side}: a parabolic flow-rate inlet needs one unbroken open stretch, but ` +
        `solid cells split this one into separate openings. Use profile "uniform", ` +
        `or give each opening its own segment.`
      );
    }
    const width = open.length * h;
    for (const t of open) {
      // Position of this face centre measured from the start of the opening.
      const s = (t - open[0] + 0.5) * h;
      const centred = (s - width / 2) / (width / 2);
      shape.set(t, Math.max(0, 1 - centred * centred));
    }
  }

  let total = 0;
  for (const value of shape.values()) total += value * h;
  const scale = condition.flowRate / total;
  for (const [t, value] of shape) profile[t] = value * scale;
}

export function compileBoundaryConditions(grid, spec) {
  if (!spec || typeof spec !== "object") {
    throw new BoundarySpecError(`expected a boundary specification object, got ${spec}`);
  }
  for (const side of SIDES) {
    if (spec[side] === undefined) {
      throw new BoundarySpecError(
        `no condition given for the ${side} boundary. All four sides must be specified; ` +
        `there is no default, because the default a reader assumes and the default the ` +
        `code picks are rarely the same.`
      );
    }
  }

  const conditions = [];
  const interned = new Map();
  const intern = (condition, uniqueKey = null) => {
    // Deduplicated so that the same condition applied to several sides appears
    // once in the legend rather than four times.
    //
    // Flow-rate inlets are the exception and are NEVER merged: each one
    // delivers its stated rate, so two segments asking for Q carry 2Q between
    // them. Merging them into one entry would make the pair deliver Q in
    // total, which is a wrong answer that looks like tidy deduplication.
    // Keyed on the WHOLE condition, every property, sorted. An earlier version
    // listed the fields by hand - type, u, v, label - and when the `pressure`
    // type was added with its own `p` parameter, `{ pressure: 1 }` and
    // `{ pressure: 0 }` hashed to the same key and were merged into one
    // condition. The result was a channel with the same pressure at both ends:
    // it solved cleanly, converged in four iterations, and sat there at
    // exactly zero flow. Nothing about it looked broken.
    //
    // A key that has to be updated whenever a parameter is added is a key that
    // will eventually be forgotten, so this one cannot be.
    const key = uniqueKey ?? JSON.stringify(
      Object.keys(condition).sort().map((field) => [field, condition[field]])
    );
    if (interned.has(key)) return interned.get(key);
    const index = conditions.length;
    conditions.push(Object.freeze({ ...condition }));
    interned.set(key, index);
    return index;
  };

  const faces = {};
  const sides = {};
  const profiles = {};
  let flowInlets = 0;
  for (const side of SIDES) {
    const geometry = sideGeometry(grid, side);
    const segments = normaliseSide(spec[side], side, grid);
    const array = new Int32Array(geometry.faceCount);
    for (let t = 0; t < geometry.faceCount; t++) {
      const segment = segmentAt(segments, geometry.positionAt(t));
      if (segment.condition.type === "flowInlet") {
        segment.uniqueKey ??= `flowInlet:${side}:${flowInlets++}`;
      }
      array[t] = intern(segment.condition, segment.uniqueKey);
    }
    faces[side] = array;
    profiles[side] = buildFlowProfile(grid, side, geometry, array, conditions);
    sides[side] = {
      orientation: geometry.orientation,
      length: geometry.length,
      cells: geometry.cells,
      spans: spansOf(array, geometry, grid),
    };
  }

  // Precomputed per-condition flags, so the solver's hot paths test an array
  // entry rather than comparing strings. `outflow` is singled out because the
  // global flux balance has to know, per face, whether that face participates
  // in the rescale - which with segments is no longer a property of a whole
  // side.
  const outflowMask = Uint8Array.from(conditions, (c) => (c.type === "outflow" ? 1 : 0));
  const pressureMask = Uint8Array.from(conditions, (c) => (c.type === "pressure" ? 1 : 0));

  // A pressure boundary determines its own flux; `outflow` exists to force the
  // total flux to balance because the pure-Neumann problem is otherwise
  // unsolvable. Together they fight: the rescale would overwrite velocities the
  // pressure solve is entitled to set, every step. There is no sensible
  // reading of a specification that asks for both.
  const usesOutflow = conditions.some((c) => c.type === "outflow");
  const usesPressure = conditions.some((c) => c.type === "pressure");
  if (usesOutflow && usesPressure) {
    throw new BoundarySpecError(
      `this specification mixes "outflow" with "pressure". An outflow boundary has its ` +
      `velocity rescaled so the domain's total inflow and outflow balance, which is what ` +
      `makes a pure-Neumann pressure problem solvable; a pressure boundary determines its ` +
      `own flux instead and needs no such balance. Use one or the other: pressure at both ` +
      `ends for a pressure-driven flow, or a velocity inlet with an outflow outlet.`
    );
  }

  return {
    conditions,
    outflowMask,
    pressureMask,
    hasPressure: usesPressure,
    faces,
    // Per-face normal velocity for flow-rate inlets, zero elsewhere. Held
    // separately from `conditions` because it depends on the solid mask - an
    // inlet partly blocked by an obstacle has a different open length, and
    // therefore a different velocity, for the same requested rate.
    profiles,
    hasFlowInlet: flowInlets > 0,
    sides,
    nx: grid.nx,
    ny: grid.ny,
    h: grid.h,
    // Flow-rate inlets read the solid mask to find their open length, so a
    // plan built against one mask does not apply to another. Recorded even
    // when no flow inlet is present, so the caching rule has no special case.
    maskVersion: grid.maskVersion,
  };
}

// True when a plan was built for this grid's dimensions. The solver caches
// compiled plans and needs to know when a cached one no longer applies.
export function planMatchesGrid(plan, grid) {
  return (
    plan.nx === grid.nx &&
    plan.ny === grid.ny &&
    plan.h === grid.h &&
    plan.maskVersion === grid.maskVersion
  );
}
