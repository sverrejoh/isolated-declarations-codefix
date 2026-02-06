const name = "test";
export const obj = { name };

const base = { a: 1, b: 2 };
export const extended = { ...base, c: 3 };

const id = 42;
const extra = { debug: true };
export const config = { id, ...extra, name: "cfg" };
