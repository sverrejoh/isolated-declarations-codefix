// Hand-written typeof import() that should be rewritten
export const internalNs: typeof import("./internal.ts") =
  null as unknown as typeof import("./internal.ts");

export type InternalType = typeof import("./internal.ts");

export function getModule(): typeof import("./internal.ts") {
  return null as unknown as typeof import("./internal.ts");
}
