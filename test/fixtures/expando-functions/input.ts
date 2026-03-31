// Primitive property: handled by built-in fixer
// via declare namespace (no TS2300 for non-functions)
export function handler() {
  return "ok";
}
handler.version = 1;

// Function-typed properties: built-in fixer's
// declare namespace causes TS2300 — our fixer uses
// non-declare namespace with const + assignment inside
export function router() {}
router.get = (path: string) => {};
router.post = (path: string) => {};

// displayName pattern (React hooks)
export function hook() {
  return { value: 1 };
}
hook.displayName = "hook";

// Hoisted: assignment before function declaration
// (uses function hoisting). Declare namespace can't
// fix this — TS9023 persists when assignment is
// before the function. Our fixer deletes the
// assignment and inserts namespace after the function.
hoisted.tag = "hoisted";

export function hoisted(): void {}
