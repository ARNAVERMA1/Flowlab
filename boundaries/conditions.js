// What a boundary condition IS, as data.
//
// A condition is a plain object - `{ type: "wall", u: 1 }` - not an object
// with methods. That is deliberate. A condition carrying code would be code
// handed to the solver, free to write wherever it liked; inert data keeps the
// solver the only thing that writes to a field. It is also serialisable, which
// M5 (interactive geometry) and M13 (save/load) both need, and it lets the UI
// render what is applied where without executing anything.
//
// ---------------------------------------------------------------------------
// THE VELOCITY CONVENTION, which is easy to get wrong
// ---------------------------------------------------------------------------
//
// `u` and `v` are CARTESIAN components, not inward-normal speeds. An inflow on
// the right with u = +1 drives flow in the +x direction, which is out of the
// domain there.
//
// This looks like a wart until you notice Test 2 depends on it: the uniform
// channel specifies `inflow` with u = U0 on BOTH the left and the right, which
// under this convention means flow passing straight through. Under an
// inward-normal convention the right-hand side would invert and the same
// specification would describe two streams colliding head-on. The convention
// stays, and tests/support/boundaryFixtures.js pins it with a case.
//
// The honest name for what most of these do is "prescribed velocity"; "inlet"
// is a label for the case where that velocity points inward. The type names
// below say what the condition does numerically and the labels say what it is
// usually called.

export const SIDES = ["left", "right", "bottom", "top"];

// Which velocity component is normal to each side. Left and right have their
// normal along x, so u is normal and v is tangential; top and bottom are the
// other way round. Nearly every boundary-condition bug in a staggered code is
// a confusion between these two, which is why the compiler carries the
// orientation explicitly rather than leaving each call site to infer it.
export const SIDE_ORIENTATION = {
  left: "vertical",
  right: "vertical",
  bottom: "horizontal",
  top: "horizontal",
};

export function normalComponent(side) {
  return SIDE_ORIENTATION[side] === "vertical" ? "u" : "v";
}

export function tangentialComponent(side) {
  return SIDE_ORIENTATION[side] === "vertical" ? "v" : "u";
}

export const FLOW_PROFILES = ["uniform", "parabolic"];

export const BOUNDARY_TYPES = {
  wall: {
    label: "Wall",
    family: "wall",
    summary:
      "No-slip. The normal velocity is zero and the tangential velocity is " +
      "reflected about the wall value, which is zero unless the wall is moving.",
    // A moving wall prescribes the TANGENTIAL component. A "moving wall" with a
    // normal component would be a wall that fluid passes through, which is an
    // inlet, and the compiler rejects it rather than silently ignoring it.
    optional: (side) => [tangentialComponent(side)],
    describe(condition, side) {
      const t = tangentialComponent(side);
      const speed = condition[t] ?? 0;
      return speed === 0 ? "no-slip, stationary" : `no-slip, moving at ${t} = ${speed}`;
    },
  },

  freeSlip: {
    label: "Slip wall",
    family: "wall",
    summary:
      "No penetration, no shear. The normal velocity is zero and the " +
      "tangential velocity is copied out, so the wall exerts no drag.",
    optional: () => [],
    describe: () => "free-slip, no shear",
  },

  inflow: {
    label: "Velocity inlet",
    family: "inlet",
    summary:
      "Prescribed normal velocity, tangential velocity copied from inside. " +
      "Components are Cartesian: the sign says which way the flow goes, not " +
      "whether it enters.",
    required: (side) => [normalComponent(side)],
    optional: (side) => [tangentialComponent(side)],
    describe(condition, side) {
      const n = normalComponent(side);
      return `${n} = ${condition[n]}`;
    },
  },

  flowInlet: {
    label: "Flow-rate inlet",
    family: "inlet",
    summary:
      "Prescribed volumetric flow rate rather than a velocity. The profile is " +
      "scaled so the flux through the OPEN part of the segment integrates to " +
      "exactly the requested rate - an inlet partly blocked by an obstacle " +
      "delivers the rate it was asked for through what is left, rather than " +
      "quietly delivering less.",
    required: () => ["flowRate"],
    optional: (side) => ["profile", tangentialComponent(side)],
    describe(condition, side) {
      const across = SIDE_ORIENTATION[side] === "vertical" ? "dy" : "dx";
      const n = normalComponent(side);
      return `${condition.profile ?? "uniform"}, integral ${n} ${across} = ${condition.flowRate}`;
    },
  },

  outflow: {
    label: "Outlet",
    family: "outlet",
    summary:
      "Zero gradient, with the total outflow rescaled to match the total " +
      "inflow. The rescale is what makes the pure-Neumann pressure problem " +
      "solvable at all: without it a uniform inlet and a copied outlet do not " +
      "conserve mass, and the projection has no way to fix a global imbalance.",
    optional: () => [],
    describe: () => "zero gradient, flux balanced",
  },

  pressure: {
    label: "Pressure boundary",
    family: "pressure",
    summary:
      "Prescribed pressure, with the velocity through the boundary left free " +
      "for the projection to determine. Unlike every other condition here this " +
      "changes the CHARACTER of the pressure solve: it replaces the pure " +
      "Neumann problem, which is singular up to a constant and requires the " +
      "total inflow and outflow to match, with one that has a unique solution " +
      "and determines its own flux. What is prescribed is the projection " +
      "variable, which approximates the true pressure to O(dt) - see " +
      "docs/M4-boundary-conditions.md before reading absolute values off it.",
    required: () => ["p"],
    optional: () => [],
    describe: (condition) => `p = ${condition.p}`,
  },

  zeroGradient: {
    label: "Open",
    family: "open",
    summary:
      "Both components copied from inside, with no flux rescaling. Unlike " +
      "`outflow` this does not participate in the global mass balance, so it " +
      "is only sound where the flow through it is already balanced.",
    optional: () => [],
    describe: () => "zero gradient, not flux balanced",
  },
};

export function isKnownType(type) {
  return Object.hasOwn(BOUNDARY_TYPES, type);
}

export function describeCondition(condition, side) {
  const spec = BOUNDARY_TYPES[condition.type];
  if (!spec) return `unknown (${condition.type})`;
  return `${spec.label} - ${spec.describe(condition, side)}`;
}
