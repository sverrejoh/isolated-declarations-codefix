// Dynamic import — TS must use typeof import()
export const loadModule = () => import("./internal.ts");

// Re-export from dynamic import
export function getLazyConfig() {
  return import("./internal.ts").then((m) => m.createConfig("lazy", 9999));
}
