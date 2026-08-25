// Renders velocity magnitude as a colour map.
//
// Consumes solver output; never mutates it. Nothing in this file writes to
// grid.u, grid.v, grid.p or grid.solid.
//
// One cell of the simulation becomes one pixel of an offscreen ImageData,
// which is then blitted to the display canvas with smoothing disabled. Drawing
// per-cell rectangles would be far slower and would blur the cell structure -
// and at M0 seeing the actual grid cells is a feature, not a defect: the
// resolution the result was computed at should be visible in the picture.

import { sampleRamp, NON_FINITE_COLOUR, SOLID_COLOUR } from "./colormap.js";
import { speedAtCell } from "../physics/fieldStats.js";

export class VelocityFieldRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.buffer = document.createElement("canvas");
    this.bufferContext = this.buffer.getContext("2d", { alpha: false });
    this.image = null;
  }

  // `inspection` is the result of physics/fieldStats.inspectField for this same
  // grid. It is required, not optional: the colour scale comes from it, and it
  // is the only thing that knows whether the field is trustworthy. Passing it
  // in rather than recomputing a max here is deliberate - it keeps a single
  // scan as the one authority on the field's range and its health.
  render(grid, inspection) {
    const { nx, ny } = grid;

    if (this.buffer.width !== nx || this.buffer.height !== ny) {
      this.buffer.width = nx;
      this.buffer.height = ny;
      this.image = this.bufferContext.createImageData(nx, ny);
    }

    // Scale to the largest finite speed present. If there is no finite speed at
    // all, `scale` is NaN, every normalised value is NaN, and every fluid cell
    // paints as non-finite - which is the honest picture of that field.
    const peak = inspection.maxSpeed;
    const scale = peak > 0 ? peak : Number.isFinite(peak) ? 1 : NaN;
    const data = this.image.data;

    for (let j = 1; j <= ny; j++) {
      // Physical y runs up, canvas y runs down.
      const row = ny - j;
      for (let i = 1; i <= nx; i++) {
        const offset = (row * nx + (i - 1)) * 4;
        let colour;
        if (grid.solid[grid.idx(i, j)]) {
          colour = SOLID_COLOUR;
        } else {
          const speed = speedAtCell(grid, i, j);
          colour = Number.isFinite(speed) ? sampleRamp(speed / scale) : NON_FINITE_COLOUR;
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
