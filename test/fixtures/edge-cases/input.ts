function getLongType() {
  return {
    a: 1, b: 2, c: 3, d: 4, e: 5,
    f: "a", g: "b", h: "c", i: "d", j: "e",
    nested: { x: 1, y: 2, z: 3 },
  };
}
export const longType = getLongType();

export function identity<T>(x: T) { return x; }

export function overloaded(x: number): number;
export function overloaded(x: string): string;
export function overloaded(x: number | string) { return x; }

export const enum Direction {
  Up = "UP",
  Down = "DOWN",
}

export namespace NS {
  export function inner() { return 1; }
}
