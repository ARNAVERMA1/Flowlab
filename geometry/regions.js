// Connected fluid regions.
//
// Two cells belong to the same region when fluid can pass between them, which
// on this grid means 4-connectivity: the same neighbours the pressure stencil
// couples. Diagonal contact is not connection - two cells meeting only at a
// corner have no shared face, so no flux crosses between them.
//
// Before M5 every scenario had exactly one fluid region and nothing needed to
// know this. A drawn wall creates a second region instantly, and the solver
// turns out to depend on regions in one specific way - see the note on
// enforceFluxBalance in solver/ns2d.js. What it does NOT depend on is worth
// recording too, because the obvious guess was wrong: a second region does not
// break the pressure solve. Two sealed chambers, symmetric or not, and a
// sealed pocket inside an obstacle all run normally, holding their per-region
// mean pressures at around 1e-15 over hundreds of steps. The constant that is
// undetermined between regions never reaches the velocity, which only ever
// uses the pressure gradient.

const cache = new WeakMap();

// Labels every fluid cell with its region index; solid cells get -1.
// Cached against the grid's mask version, since the flood fill is O(N) and the
// mask changes far less often than the field does.
export function fluidRegions(grid) {
  const cached = cache.get(grid);
  if (cached && cached.maskVersion === grid.maskVersion && cached.label.length === grid.solid.length) {
    return cached;
  }

  const { nx, ny, stride, solid } = grid;
  const label = new Int32Array(solid.length).fill(-1);
  const cellCounts = [];
  const stack = [];

  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx; i++) {
      const seed = i + stride * j;
      if (solid[seed] || label[seed] !== -1) continue;
      const id = cellCounts.length;
      let count = 0;
      label[seed] = id;
      stack.push(seed);
      while (stack.length > 0) {
        const k = stack.pop();
        count++;
        const ci = k % stride;
        const cj = (k - ci) / stride;
        // Only the four face neighbours, and only within the interior: a
        // diagonal touch shares no face, so no flux crosses it.
        if (ci > 1 && !solid[k - 1] && label[k - 1] === -1) { label[k - 1] = id; stack.push(k - 1); }
        if (ci < nx && !solid[k + 1] && label[k + 1] === -1) { label[k + 1] = id; stack.push(k + 1); }
        if (cj > 1 && !solid[k - stride] && label[k - stride] === -1) { label[k - stride] = id; stack.push(k - stride); }
        if (cj < ny && !solid[k + stride] && label[k + stride] === -1) { label[k + stride] = id; stack.push(k + stride); }
      }
      cellCounts.push(count);
    }
  }

  const result = {
    label,
    count: cellCounts.length,
    cellCounts: Int32Array.from(cellCounts),
    maskVersion: grid.maskVersion,
  };
  cache.set(grid, result);
  return result;
}
