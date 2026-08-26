// Per-scenario dye configuration.
//
// This lives here rather than in scenarios/index.js so that the entire tracer
// feature is one deletable directory. scenarios/ describes the simulation; a
// dye pattern is not part of the simulation, and putting it there would make
// "delete the tracer and nothing else changes" false.
//
// Two ways dye gets into a domain:
//
//   seed    an initial concentration, for closed domains. The cavity has no
//           inlet, so the only way to see the lid wind the fluid up is to
//           stripe the field at t = 0 and watch the stripes deform.
//   inject  a ghost-cell concentration at an inflow boundary, for open
//           domains. Continuous injection in bands produces streaklines - the
//           path dye released from a fixed point traces out - which is what
//           makes separation and recirculation legible.
//
// Bands rather than a single blob because a blob shows where the flow went and
// bands show what it did to the fluid between them: shear, roll-up and
// recirculation all read directly off how the band spacing distorts.

// Alternating bands in y, `band` wide. Positions are physical, not cell
// indices, so this is independent of grid resolution.
function bandsInY(band) {
  return (x, y) => (Math.floor(y / band) % 2 === 0 ? 1 : 0);
}

const NONE = () => 0;

export const TRACER_SEEDS = {
  // Closed domain: seed once, no injection. Conservation of total dye is an
  // exact property here and tests/test9 asserts it.
  cavity: {
    seed: bandsInY(1 / 8),
    inject: {},
    note: "Seeded in bands at t = 0. Closed domain, so no dye enters or leaves.",
  },

  cylinder: {
    seed: NONE,
    inject: { left: bandsInY(0.5) },
    note: "Injected in bands at the inlet. Streaklines through the wake.",
  },

  "bend-sharp": {
    seed: NONE,
    inject: { left: bandsInY(0.25) },
    note: "Injected in bands at the inlet. Streaklines around the inner corner.",
  },

  "bend-smooth": {
    seed: NONE,
    inject: { left: bandsInY(0.25) },
    note: "Injected in bands at the inlet. Streaklines around the radiused corner.",
  },
};

const EMPTY = { seed: NONE, inject: {}, note: "No dye configured for this scenario." };

export function tracerConfigFor(scenarioId) {
  return TRACER_SEEDS[scenarioId] ?? EMPTY;
}
