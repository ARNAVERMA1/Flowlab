// What each connected fluid region is connected TO.
//
// Region connectivity alone does not say whether a drawing is sensible - a
// sealed chamber is perfectly legal and runs fine, while a region fed by an
// inlet with no outlet is impossible. The difference is which boundary
// conditions touch each region, which needs the compiled plan as well as the
// mask.
//
// This is a description, not a verdict. The solver rejects only the case it
// genuinely cannot solve, and it does that from measured flux rather than from
// this analysis; everything here exists so the harness can tell a viewer what
// they have drawn.

import { fluidRegions } from "../geometry/regions.js";
import { BOUNDARY_TYPES, SIDES } from "./conditions.js";

export function analyseRegions(grid, plan) {
  const { label, count, cellCounts } = fluidRegions(grid);
  const regions = [];
  for (let id = 0; id < count; id++) {
    regions.push({
      id,
      cellCount: cellCounts[id],
      families: new Set(),
      boundaryFaces: 0,
    });
  }

  const visit = (faceIndices, t, cell) => {
    const region = label[cell];
    if (region < 0) return;
    const condition = plan.conditions[faceIndices[t]];
    const family = BOUNDARY_TYPES[condition.type]?.family ?? "unknown";
    regions[region].families.add(family);
    regions[region].boundaryFaces++;
  };

  for (let j = 1; j <= grid.ny; j++) {
    visit(plan.faces.left, j, grid.idx(1, j));
    visit(plan.faces.right, j, grid.idx(grid.nx, j));
  }
  for (let i = 1; i <= grid.nx; i++) {
    visit(plan.faces.bottom, i, grid.idx(i, 1));
    visit(plan.faces.top, i, grid.idx(i, grid.ny));
  }

  // Conditions attached to drawn surfaces count too. Without this a cavity
  // whose only opening is a pressure boundary on an interior surface was
  // reported as "sealed - nothing enters or leaves", which is the same shape
  // of mistake as a flux sum that counts one kind of face.
  if (plan.surfaces !== null) {
    const visitSurface = (table, faceIndex, fluidCell) => {
      const index = table[faceIndex];
      if (index < 0) return;
      const region = label[fluidCell];
      if (region < 0) return;
      const condition = plan.surfaces.conditions[index];
      regions[region].families.add(BOUNDARY_TYPES[condition.type]?.family ?? "unknown");
      regions[region].boundaryFaces++;
    };
    for (let j = 1; j <= grid.ny; j++) {
      for (let i = 0; i <= grid.nx; i++) {
        const k = grid.idx(i, j);
        const a = grid.solid[k];
        if (a === grid.solid[grid.idx(i + 1, j)]) continue;
        visitSurface(plan.surfaces.u, k, a ? grid.idx(i + 1, j) : k);
      }
    }
    for (let i = 1; i <= grid.nx; i++) {
      for (let j = 0; j <= grid.ny; j++) {
        const k = grid.idx(i, j);
        const a = grid.solid[k];
        if (a === grid.solid[grid.idx(i, j + 1)]) continue;
        visitSurface(plan.surfaces.v, k, a ? grid.idx(i, j + 1) : k);
      }
    }
  }

  for (const region of regions) {
    const families = region.families;
    region.hasInlet = families.has("inlet");
    region.hasOutlet = families.has("outlet");
    region.hasPressure = families.has("pressure");
    region.hasOpen = families.has("open");
    // Sealed means nothing can enter or leave: every boundary face it touches
    // is a wall, and it touches no interior opening either. A sealed region is
    // VALID - the fluid in it simply circulates or sits still - and saying so
    // matters, because the alternative is a viewer assuming a drawing was
    // rejected when it was merely quiet.
    region.sealed =
      !region.hasInlet && !region.hasOutlet && !region.hasPressure && !region.hasOpen;
    region.summary = region.sealed
      ? "sealed - nothing enters or leaves"
      : [
          region.hasInlet ? "inlet" : null,
          region.hasOutlet ? "outlet" : null,
          region.hasPressure ? "pressure" : null,
          region.hasOpen ? "open" : null,
        ].filter(Boolean).join(" + ");
  }

  return regions;
}

// A one-line description for the panel.
export function describeRegions(regions) {
  if (regions.length === 0) return "no fluid";
  if (regions.length === 1) return `1 region (${regions[0].summary})`;
  const sealed = regions.filter((r) => r.sealed).length;
  return (
    `${regions.length} regions` +
    (sealed > 0 ? `, ${sealed} sealed` : "") +
    ` - ${regions.map((r) => `${r.cellCount} cells ${r.summary}`).join("; ")}`
  );
}
