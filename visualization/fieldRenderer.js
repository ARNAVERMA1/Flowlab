// Paints a prepared scalar view as a colour map.
//
// Consumes solver output; never mutates it. Nothing in this file writes to
// grid.u, grid.v, grid.p, grid.solid or the tracer.
//
// One cell of the simulation becomes one pixel of an offscreen ImageData,
// which is then blitted to the display canvas with smoothing disabled. Drawing
// per-cell rectangles would be far slower and would blur the cell structure -
// and seeing the actual grid cells is a feature, not a defect: the resolution
// the result was computed at should be visible in the picture.
//
// This class knows nothing about what it is drawing. Velocity, pressure and
// dye differ only in the view handed to render(), which is what makes
// switching modes a pure display change: the same pixels get written from a
// different scalar, and no simulation state is touched to do it.

import { NON_FINITE_COLOUR, SOLID_COLOUR } from "./colormap.js";

export class FieldRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.buffer = document.createElement("canvas");
    this.bufferContext = this.buffer.getContext("2d", { alpha: false });
    this.image = null;
  }

  // `view` comes from visualization/fieldSources.prepareView: it carries the
  // per-cell value, the scale, and the ramp. Passing it in rather than
  // computing a range here keeps a single scan as the one authority on the
  // field's range and its health - the renderer cannot quietly disagree with
  // the legend or the readouts about how bright the picture should be.
  // `inset` is the margin in display pixels around the field, where the
  // boundary-condition bands are drawn. The bands go beside the field rather
  // than over its outermost cells because those cells hold the boundary layer,
  // which is the part of the picture the boundary condition is most
  // responsible for - covering it to label it would be a poor trade.
  // `tint` optionally returns [r, g, b, alpha] for a cell, blended over
  // whatever the view painted there. It exists so a drawing preview or a
  // region overlay costs one extra branch inside the loop that already runs,
  // rather than a second pass of per-cell rectangles over the display canvas -
  // which at a few thousand cells is the difference between free and visible.
  render(grid, view, inset = 0, tint = null) {
    const { nx, ny } = grid;

    if (this.buffer.width !== nx || this.buffer.height !== ny) {
      this.buffer.width = nx;
      this.buffer.height = ny;
      this.image = this.bufferContext.createImageData(nx, ny);
    }

    const data = this.image.data;
    const blank = view === null;

    for (let j = 1; j <= ny; j++) {
      // Physical y runs up, canvas y runs down.
      const row = ny - j;
      for (let i = 1; i <= nx; i++) {
        const offset = (row * nx + (i - 1)) * 4;
        let colour;
        if (grid.solid[grid.idx(i, j)]) {
          colour = SOLID_COLOUR;
        } else if (blank) {
          // No view means the requested field does not exist for this state.
          // Painting it as not-finite is the honest answer: it is certainly
          // not a field of zeros.
          colour = NON_FINITE_COLOUR;
        } else {
          colour = view.ramp(view.normalise(view.valueAt(i, j)));
        }
        if (tint !== null) {
          const over = tint(i, j);
          if (over !== null && over !== undefined) {
            const a = over[3];
            colour = [
              Math.round(colour[0] * (1 - a) + over[0] * a),
              Math.round(colour[1] * (1 - a) + over[1] * a),
              Math.round(colour[2] * (1 - a) + over[2] * a),
            ];
          }
        }
        data[offset] = colour[0];
        data[offset + 1] = colour[1];
        data[offset + 2] = colour[2];
        data[offset + 3] = 255;
      }
    }

    this.bufferContext.putImageData(this.image, 0, 0);

    const target = this.context;
    target.imageSmoothingEnabled = false;
    target.clearRect(0, 0, this.canvas.width, this.canvas.height);
    target.drawImage(
      this.buffer,
      inset,
      inset,
      this.canvas.width - 2 * inset,
      this.canvas.height - 2 * inset
    );
  }
}
