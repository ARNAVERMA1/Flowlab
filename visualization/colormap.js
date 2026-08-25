// Sequential colour ramp for scalar magnitude fields.
//
// One hue, monotonic in lightness - not a rainbow. Rainbow ramps invent
// boundaries that are not in the data (the eye reads the yellow/green edge as a
// feature) and they are not colourblind-safe. A single-hue ramp maps magnitude
// to lightness, which every viewer reads in the same order.
//
// The stops run darkest-first because the instrument renders on a dark surface:
// near-zero speed recedes toward the background and high speed reads brightest.
// The fluid region stays visible at zero because the darkest stop is still
// distinguishable from the page surface.

const SURFACE = "#1a1a19";

const STOPS = [
  [0x0d, 0x36, 0x6b],
  [0x10, 0x42, 0x81],
  [0x18, 0x4f, 0x95],
  [0x1c, 0x5c, 0xab],
  [0x25, 0x6a, 0xbf],
  [0x2a, 0x78, 0xd6],
  [0x39, 0x87, 0xe5],
  [0x55, 0x98, 0xe7],
  [0x6d, 0xa7, 0xec],
  [0x86, 0xb6, 0xef],
  [0x9e, 0xc5, 0xf4],
  [0xb7, 0xd3, 0xf6],
  [0xcd, 0xe2, 0xfb],
];

// Deliberately outside the ramp's hue so it can never be mistaken for a
// magnitude. Any cell painted this colour is not data.
export const NON_FINITE_COLOUR = [0xff, 0x00, 0xaa];

// Solid obstacle / wall material.
export const SOLID_COLOUR = [0x33, 0x33, 0x31];

export const SURFACE_COLOUR = SURFACE;

// Maps a normalised magnitude in [0,1] to an [r,g,b] triple.
// A non-finite input returns NON_FINITE_COLOUR rather than clamping to an end
// of the ramp: clamping is exactly how a broken field acquires a healthy
// looking colour.
export function sampleRamp(t) {
  if (!Number.isFinite(t)) return NON_FINITE_COLOUR;
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const scaled = clamped * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export function rampCss(t) {
  const [r, g, b] = sampleRamp(t);
  return `rgb(${r},${g},${b})`;
}

export function rampStopCount() {
  return STOPS.length;
}
