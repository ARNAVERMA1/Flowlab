// Number formatting for the readouts.
//
// These functions never substitute a placeholder for a bad value. There is no
// `?? 0`, no `|| "-"`, no try/catch that falls back to a dash. If a quantity is
// NaN or infinite, that is what the panel shows, because the alternative is a
// readout that looks fine while the simulation is broken - which is the exact
// failure this harness is required not to have.
//
// `Number.prototype.toExponential` already renders NaN as "NaN" and Infinity as
// "Infinity", so the honest path is mostly a matter of not adding a fallback.
// The explicit checks below exist so the intent survives future edits.

export function isBad(value) {
  return typeof value !== "number" || !Number.isFinite(value);
}

export function exponential(value, digits = 2) {
  if (typeof value !== "number") return "not a number";
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "+Infinity" : "-Infinity";
  return value.toExponential(digits);
}

export function fixed(value, digits = 4) {
  if (typeof value !== "number") return "not a number";
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "+Infinity" : "-Infinity";
  return value.toFixed(digits);
}

export function integer(value) {
  if (typeof value !== "number") return "not a number";
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "+Infinity" : "-Infinity";
  return String(Math.round(value));
}
