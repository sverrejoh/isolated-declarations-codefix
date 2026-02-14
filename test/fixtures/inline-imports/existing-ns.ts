import * as internal from "./internal.ts";

// Should reuse "internal" binding, not create new
export const loadInternal = () =>
  import("./internal.ts");

// Top-level typeof import() — should reuse "internal"
export type InternalAll =
  typeof import("./internal.ts");

export { internal };
