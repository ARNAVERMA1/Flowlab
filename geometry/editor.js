// Editing a geometry document, with undo and redo.
//
// A document is an ordered list of operations, so an edit is a change to that
// list: append a shape, replace one (move, resize), or remove one. Undo is
// implemented by SNAPSHOTTING the list before and after each edit rather than
// by inverting operations.
//
// Snapshots because they cannot be wrong. An inverse-operation scheme has to
// get every inverse right, and a single incorrect one corrupts the document
// silently and only on the undo path - which is exactly the kind of code that
// is exercised least and trusted most. Documents here are tens of shapes, so a
// snapshot costs nothing worth optimising.
//
// `revision` advances on every change. Anything downstream that caches
// something derived from the geometry - a sampled mask, a compiled boundary
// plan, a simulation's field - can compare against it to know it is stale.

import { validateDocument } from "./document.js";

export class GeometryEditor {
  constructor(document = { operations: [] }) {
    validateDocument(document);
    this.operations = document.operations.map((operation) => ({ ...operation }));
    this.past = [];
    this.future = [];
    this.revision = 0;
  }

  // A plain document, safe to hand to sampleDocument or to serialise. Copied,
  // so a caller holding one cannot mutate the editor's state through it.
  get document() {
    return { operations: this.operations.map((operation) => ({ ...operation })) };
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  get size() {
    return this.operations.length;
  }

  // Every mutation goes through here, so there is one place where history is
  // recorded and one place where the result is validated. An edit that would
  // produce an invalid document throws and leaves the editor untouched.
  #commit(next) {
    validateDocument({ operations: next });
    this.past.push(this.operations);
    this.future.length = 0; // a new edit discards the redo branch
    this.operations = next;
    this.revision++;
  }

  append(operation) {
    this.#commit([...this.operations, { ...operation }]);
    return this;
  }

  replace(index, operation) {
    this.#assertIndex(index, "replace");
    const next = this.operations.slice();
    next[index] = { ...operation };
    this.#commit(next);
    return this;
  }

  remove(index) {
    this.#assertIndex(index, "remove");
    const next = this.operations.slice();
    next.splice(index, 1);
    this.#commit(next);
    return this;
  }

  clear() {
    this.#commit([]);
    return this;
  }

  undo() {
    if (!this.canUndo) return false;
    this.future.push(this.operations);
    this.operations = this.past.pop();
    this.revision++;
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this.past.push(this.operations);
    this.operations = this.future.pop();
    this.revision++;
    return true;
  }

  #assertIndex(index, what) {
    if (!Number.isInteger(index) || index < 0 || index >= this.operations.length) {
      throw new RangeError(
        `cannot ${what} operation ${index}: the document has ${this.operations.length}`
      );
    }
  }
}

// The drawing tools, as constructors for document operations. A tool is not a
// mode or a piece of state - it is a function from a gesture to an operation,
// which is what keeps the editor free of anything to do with input.
export const TOOLS = {
  rectangle: (x0, y0, x1, y1) => ({
    op: "add",
    region: { kind: "rect", x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) },
  }),
  circle: (cx, cy, radius) => ({
    op: "add",
    // Explicit conventions, as everywhere else. A drawn circle is closed and
    // uses squared distance, matching stampCircle and therefore the cylinder.
    region: { kind: "disk", cx, cy, radius, metric: "squared", closed: true },
  }),
  polygon: (vertices) => ({ op: "add", region: { kind: "polygon", vertices: vertices.map((v) => ({ ...v })) } }),
  // The eraser is the same shape with the opposite operation, not a separate
  // primitive. Carving is what "subtract" already means.
  eraseRectangle: (x0, y0, x1, y1) => ({ ...TOOLS.rectangle(x0, y0, x1, y1), op: "subtract" }),
  eraseCircle: (cx, cy, radius) => ({ ...TOOLS.circle(cx, cy, radius), op: "subtract" }),
};
