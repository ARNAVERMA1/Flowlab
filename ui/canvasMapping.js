// Screen coordinates to physical coordinates, and back.
//
// Three transforms sit between a pointer event and a position in the fluid,
// and every one of them is a chance to be off by something that still looks
// plausible:
//
//   1. CSS pixels to intrinsic canvas pixels. The canvas is displayed with
//      `max-width: 100%`, so on a narrow window it is drawn smaller than its
//      backing store and the ratio is not 1.
//   2. The M4 inset margin. The field does not start at the canvas origin -
//      the boundary-condition bands live in a margin around it. An error here
//      shifts every drawn shape by one band width, which looks like sloppy
//      aiming rather than a bug.
//   3. Canvas y runs down, physical y runs up.
//
// This module is pure and takes explicit numbers so all three can be tested
// without a browser. The harness supplies them from getBoundingClientRect.

// Where the pointer is, in physical units. `rect` is the canvas's displayed
// box; `canvasWidth`/`canvasHeight` its intrinsic size.
export function screenToPhysical(clientX, clientY, layout) {
  const { rect, canvasWidth, canvasHeight, margin, scale, h, ny } = layout;
  // CSS pixels to intrinsic pixels.
  const px = (clientX - rect.left) * (canvasWidth / rect.width);
  const py = (clientY - rect.top) * (canvasHeight / rect.height);
  // Intrinsic pixels to cell coordinates, past the margin.
  const cellX = (px - margin) / scale;
  const cellY = (py - margin) / scale;
  return { x: cellX * h, y: (ny - cellY) * h };
}

// The inverse, for drawing a preview back onto the canvas. Returns intrinsic
// canvas pixels, which is what a 2D context wants.
export function physicalToCanvas(x, y, layout) {
  const { margin, scale, h, ny } = layout;
  return { px: margin + (x / h) * scale, py: margin + (ny - y / h) * scale };
}

// Clamps a physical point into the domain. A drag that leaves the canvas
// should draw up to the edge rather than producing a shape reaching off into
// coordinates the grid has no cells for.
export function clampToDomain(point, layout) {
  const { nx, ny, h } = layout;
  return {
    x: Math.min(Math.max(point.x, 0), nx * h),
    y: Math.min(Math.max(point.y, 0), ny * h),
  };
}

// Whether a physical point is inside the field area at all, used to ignore
// presses that land on the boundary bands rather than on the fluid.
//
// `tolerance` is in physical units and exists for the edges. A press aimed at
// the outermost row of cells lands within a pixel of the boundary, and the
// exact edge is a coin flip in floating point: `screenToPhysical` of the
// bottom edge returns something like -1e-16 as readily as 0, so a bare
// `>= 0` refuses roughly half the presses aimed at it. Drawing a wall from one
// side of the channel to the other is an obvious thing to want, and demanding
// sub-pixel accuracy to start it is not a real boundary check - it is a bug
// that feels like a bad mouse.
//
// The caller passes half a cell, which is narrower than the boundary band, so
// a press genuinely aimed at the band still reads as the band.
export function isInsideDomain(point, layout, tolerance = 0) {
  const { nx, ny, h } = layout;
  return (
    point.x >= -tolerance && point.x <= nx * h + tolerance &&
    point.y >= -tolerance && point.y <= ny * h + tolerance
  );
}
