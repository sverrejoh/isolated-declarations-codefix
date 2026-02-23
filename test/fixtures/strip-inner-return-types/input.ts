// ── Exported function with inner callback ────────────
// Codefix adds return type to both outer and inner.
// Inner should be stripped (outer covers it).
export function createHandler() {
  const handler = (x: number) => {
    return x * 2;
  };
  return handler;
}

// ── Exported arrow with .map() callback ──────────────
export const doubled = (nums: number[]) => {
  return nums.map((n) => {
    return n * 2;
  });
};

// ── Exported arrow with .filter() callback ───────────
export const evens = (nums: number[]) => {
  return nums.filter((n) => {
    return n % 2 === 0;
  });
};

// ── Hand-written inner return type (must preserve) ───
export function withHandWritten(): (x: number) => string {
  const inner = (x: number): string => {
    return String(x);
  };
  return inner;
}

// ── Non-exported top-level function ──────────────────
// Inner return type should NOT be stripped because
// outer is not exported.
function notExported() {
  const cb = (x: number) => {
    return x + 1;
  };
  return cb;
}

// ── Nested depth > 1 ────────────────────────────────
export function deepNesting() {
  const outer = (a: number) => {
    const inner = (b: number) => {
      return a + b;
    };
    return inner;
  };
  return outer;
}

// ── Inner generic function (must preserve) ───────────
export function withGeneric() {
  const identity = <T>(x: T) => {
    return x;
  };
  return identity;
}

// ── Directly exported function ──────────────────────
// Own return type must be preserved.
export function directlyExported(): number {
  return 42;
}
