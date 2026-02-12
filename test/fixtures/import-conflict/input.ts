import type { Foo } from "./types.ts";

export function makeFoo(): Foo {
  return { x: 1 };
}

export const Foo = "conflict";

export function useFoo(f: Foo) {
  return f;
}
