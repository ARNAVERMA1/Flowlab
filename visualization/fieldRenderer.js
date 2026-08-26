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
  render(grid, view) {
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
    target.drawImage(this.buffer, 0, 0, this.canvas.width, this.canvas.height);
  }
}
