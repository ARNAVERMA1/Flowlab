// Drawing which boundary condition is applied where.
//
// M4 requires that a viewer can see this, and the requirement has a trap in
// it: the obvious implementation reads the specification and works out where
// each condition lands, which is a second implementation of the rule the
// compiler already applies. Two implementations of one rule drift, and the
// drift is invisible - the picture and the solver disagree and the picture is
// the only one anyone looks at.
//
// So everything here is derived from the COMPILED plan: the same Int32Array
// per side that the solver reads every step, and the spans run-length encoded
// from it. If a segment edge rounds onto a cell boundary differently than the
// specification suggests, the picture shows where it actually landed.
//
// The geometry and the legend are pure functions, testable in node. Only
// drawBoundaryOverlay touches a canvas.

import { BOUNDARY_TYPES, SIDES, describeCondition, tangentialComponent } from "../boundaries/conditions.js";

// One colour per kind of boundary, chosen to sit apart from the field ramps -
// a band the same blue as the velocity map would read as part of the flow.
// A moving wall gets its own colour rather than a variant of the wall colour,
// because "this wall is driving the flow" is the single most important thing
// to notice about a lid-driven cavity.
const COLOURS = {
  wall: "#7a7a72",
  movingWall: "#e0c46c",
  freeSlip: "#9aa8b8",
  inflow: "#7fd18b",
  flowInlet: "#4fb974",
  outflow: "#6da7ec",
  zeroGradient: "#5b6b7a",
  pressure: "#c98bdc",
};

export function boundaryColour(condition, side) {
  if (condition.type === "wall") {
    const moving = condition[tangentialComponent(side)];
    return moving ? COLOURS.movingWall : COLOURS.wall;
  }
  return COLOURS[condition.type] ?? "#ff00aa";
}

// What each condition on this plan covers, one entry per distinct condition.
// Built from the compiled spans, so the extents are the ones in force.
export function boundaryLegend(plan) {
  const entries = new Map();
  for (const side of SIDES) {
    for (const span of plan.sides[side].spans) {
      const condition = plan.conditions[span.condition];
      // Keyed by condition index and side: the same condition on two sides is
      // one legend row listing both, but a moving wall's colour depends on
      // which side it is on, so the side has to travel with it.
      const key = `${span.condition}:${side}`;
      const existing = entries.get(key);
      if (existing) {
        existing.cells += span.cells;
        existing.spans.push(span);
        continue;
      }
      entries.set(key, {
        condition,
        conditionIndex: span.condition,
        side,
        family: BOUNDARY_TYPES[condition.type]?.family ?? "unknown",
        label: describeCondition(condition, side),
        colour: boundaryColour(condition, side),
        cells: span.cells,
        spans: [span],
      });
    }
  }
  return [...entries.values()];
}

// Flux through each side, measured from the velocity field rather than read
// off the specification.
//
// Measured, because that is the question worth answering: a flow-rate inlet
// asked for 0.75 and the panel should show what actually crossed the boundary,
// not repeat the request back. On a pressure boundary nothing was requested at
// all - the flux is an output of the solve, and it is the interesting number.
//
// Sign convention here is INTO the domain, which differs from the Cartesian
// convention the specification uses. That is deliberate and labelled: a reader
// looking at a picture wants to know what is coming in, while a specification
// has to say which way along an axis. Non-finite faces are counted, never
// summed, so a broken field cannot report a plausible flux.
export function measureBoundaryFlux(grid, plan) {
  const { nx, ny, h, u, v, solid } = grid;
  const result = {};
  for (const side of SIDES) {
    let flux = 0;
    let nonFinite = 0;
    const cells = side === "left" || side === "right" ? ny : nx;
    for (let t = 1; t <= cells; t++) {
      let value;
      let interior;
      if (side === "left") {
        value = u[grid.idx(0, t)];
        interior = grid.idx(1, t);
      } else if (side === "right") {
        value = -u[grid.idx(nx, t)];
        interior = grid.idx(nx, t);
      } else if (side === "bottom") {
        value = v[grid.idx(t, 0)];
        interior = grid.idx(t, 1);
      } else {
        value = -v[grid.idx(t, ny)];
        interior = grid.idx(t, ny);
      }
      if (solid[interior]) continue;
      if (!Number.isFinite(value)) {
        nonFinite++;
        continue;
      }
      flux += value * h;
    }
    result[side] = { flux: nonFinite > 0 ? NaN : flux, nonFiniteCells: nonFinite };
  }
  const total = SIDES.reduce((sum, side) => sum + result[side].flux, 0);
  result.net = total;
  return result;
}

// Geometry of the bands, in canvas pixels. Separated from the drawing so the
// arithmetic can be checked without a canvas.
//
// `layout` describes where the field sits inside the canvas: the field's
// top-left corner, the pixels per cell, and how wide the band should be. The
// bands go in the margin AROUND the field rather than over its edge, because a
// band drawn over the outermost cells would hide the boundary layer, which is
// the part of the picture the boundary condition is most responsible for.
export function boundaryBands(plan, layout) {
  const { originX, originY, scale, band } = layout;
  const width = plan.nx * scale;
  const height = plan.ny * scale;
  const rectangles = [];

  const push = (side, span, rect) => {
    rectangles.push({ side, conditionIndex: span.condition, ...rect });
  };

  for (const span of plan.sides.left.spans) {
    // Physical y runs up, canvas y runs down.
    const top = originY + height - (span.to / plan.h) * scale;
    push("left", span, {
      x: originX - band, y: top, w: band, h: ((span.to - span.from) / plan.h) * scale,
    });
  }
  for (const span of plan.sides.right.spans) {
    const top = originY + height - (span.to / plan.h) * scale;
    push("right", span, {
      x: originX + width, y: top, w: band, h: ((span.to - span.from) / plan.h) * scale,
    });
  }
  for (const span of plan.sides.bottom.spans) {
    push("bottom", span, {
      x: originX + (span.from / plan.h) * scale, y: originY + height,
      w: ((span.to - span.from) / plan.h) * scale, h: band,
    });
  }
  for (const span of plan.sides.top.spans) {
    push("top", span, {
      x: originX + (span.from / plan.h) * scale, y: originY - band,
      w: ((span.to - span.from) / plan.h) * scale, h: band,
    });
  }
  return rectangles;
}

export function drawBoundaryOverlay(context, plan, layout) {
  for (const rect of boundaryBands(plan, layout)) {
    const condition = plan.conditions[rect.conditionIndex];
    context.fillStyle = boundaryColour(condition, rect.side);
    context.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
}
