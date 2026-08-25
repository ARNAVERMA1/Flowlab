// The single rule for what the panel is allowed to say about a field.
//
// This is deliberately a pure function with no DOM in sight. The judgement it
// encodes - a field with any non-finite cell is a hard stop, and none of the
// derived numbers may be reported as if they were still meaningful - is the one
// piece of the display layer that has to be right, so it is kept somewhere it
// can be tested directly rather than only through a browser.
//
// Note reportedPeakSpeed. `inspection.maxSpeed` is the largest speed among the
// cells that are STILL FINITE, which the colour scale needs in order to draw
// anything at all. It is not a fact about the field once part of the field is
// broken, so it is never handed to the panel: a plausible peak speed printed
// next to a NOT FINITE field state is exactly the mixed message this whole
// layer exists to prevent.

export function assessField(inspection) {
  if (inspection.finite) {
    return {
      ok: true,
      halt: false,
      status: "healthy",
      fieldSummary: `finite (${inspection.finiteCells} fluid cells)`,
      message: null,
      firstBadCell: null,
      reportedPeakSpeed: inspection.maxSpeed,
    };
  }

  const where = inspection.firstNonFinite;
  return {
    ok: false,
    halt: true,
    status: "failed",
    fieldSummary: `NOT FINITE - ${inspection.nonFiniteCells} bad cells`,
    message:
      `${inspection.nonFiniteCells} of ${inspection.fluidCells} fluid cells are not finite` +
      (where ? `, first at cell (${where.i}, ${where.j})` : ""),
    firstBadCell: where,
    reportedPeakSpeed: NaN,
  };
}
