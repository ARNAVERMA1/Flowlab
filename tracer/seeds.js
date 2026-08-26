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
//
// `seeded` says whether this scenario has anything to reseed. It is declared
// rather than inferred because the harness disables the Reseed control when it
// is false: on an injection-only scenario there is no initial pattern to
// restore, so the button would clear the dye and look like it had done
// nothing. A control that silently no-ops is its own small dishonesty. A test
// checks the flag against what the seed function actually produces, so the two
// cannot drift apart.

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
    seeded: true,
    note: "Seeded in bands at t = 0. Closed domain, so no dye enters or leaves.",
  },

  cylinder: {
    seed: NONE,
    inject: { left: bandsInY(0.5) },
    seeded: false,
    note: "Injected in bands at the inlet. Streaklines through the wake." +
      " There is no initial pattern to restore, so Reseed is disabled here.",
  },

  "bend-sharp": {
    seed: NONE,
    inject: { left: bandsInY(0.25) },
    seeded: false,
    note: "Injected in bands at the inlet. Streaklines around the inner corner." +
      " There is no initial pattern to restore, so Reseed is disabled here.",
  },

  "bend-smooth": {
    seed: NONE,
    inject: { left: bandsInY(0.25) },
    seeded: false,
    note: "Injected in bands at the inlet. Streaklines around the radiused corner." +
      " There is no initial pattern to restore, so Reseed is disabled here.",
  },
};

const EMPTY = {
  seed: NONE,
  inject: {},
  seeded: false,
  note: "No dye configured for this scenario.",
};

export function tracerConfigFor(scenarioId) {
  return TRACER_SEEDS[scenarioId] ?? EMPTY;
}
