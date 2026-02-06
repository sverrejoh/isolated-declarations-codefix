export function fn1() { return 1; }
export function fn2() {
  return "hello world this is a long string";
}
export function fn3() { return { x: 1, y: 2, z: 3 }; }
export const v1 = fn1();
export const v2 = fn2();
export const v3 = fn3();
export function fn4() { return [1, 2, 3]; }
export function fn5() { return true; }
export const v4 = fn4();
export const v5 = fn5();
export function fn6(x = fn1()) { return x + 1; }
export function fn7() { return fn3(); }
export const v6 = fn6();
export const v7 = fn7();
export async function fn8() {
  return await Promise.resolve(42);
}
export const v8 = fn8();
