// Identifiers that conflict with generated names
const InternalModule = "conflict";
const InternalModule2 = "double conflict";

// Will generate typeof import("./internal.ts")
// Name should be InternalModule3 (skipping 1 and 2)
export const loadInternal = () =>
  import("./internal.ts");

// Will generate typeof import("./component.ts")
// ComponentModule doesn't conflict — use as-is
export const loadComponent = () =>
  import("./component.ts");

// Top-level typeof import() for conflict testing
export type InternalNs =
  typeof import("./internal.ts");

export { InternalModule, InternalModule2 };
