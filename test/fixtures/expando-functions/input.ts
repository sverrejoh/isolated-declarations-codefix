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

// displayName pattern
export function hook() {
  return { value: 1 };
}
hook.displayName = "hook";

// Hoisted: assignment before function declaration
hoisted.tag = "hoisted";

export function hoisted(): void {}
