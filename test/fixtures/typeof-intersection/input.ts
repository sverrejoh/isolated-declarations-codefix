export const BASE = { a: 1, b: "hello" };
export const EXTENDED = { ...BASE, c: true };

export const EXTRA = { d: 42 };
export const MULTI = { ...BASE, ...EXTRA, e: "own" };

export const CLONE = { ...BASE };

export const OVERRIDDEN = { ...BASE, a: 999, c: true };

export const PLAIN = { x: 1, y: 2 };
