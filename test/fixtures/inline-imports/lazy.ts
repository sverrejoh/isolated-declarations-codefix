// Dynamic import — should not be modified
export function loadInternal() {
  return import("./internal.ts");
}

// typeof import() inside TypeLiteral — rewriter should skip
export type LazyModule = {
  internal: typeof import("./internal.ts");
};
