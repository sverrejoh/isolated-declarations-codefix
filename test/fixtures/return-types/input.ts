export function getNumber() {
  return 42;
}
export function getString() {
  return "hello";
}
export function getBool() {
  return true;
}
export function getObj() {
  return { x: 1, y: "a" };
}
export function getArr() {
  return [1, 2, 3];
}
export function getUnion(x: boolean) {
  if (x) return 42;
  return "hello";
}
export function doSomething() {
  console.log("hi");
}
export async function fetchData() {
  return 42;
}
export const arrowFn = () => 42;
export const arrowComplex = (x: number) => {
  if (x > 0) return "positive";
  return "non-positive";
};
export const fnExpr = function () {
  return 42;
};
export function* gen() {
  yield 1;
  yield 2;
}
export async function* asyncGen() {
  yield 1;
}
export function multiReturn(x: number) {
  if (x > 0) return x * 2;
  if (x < 0) return x * -1;
  return 0;
}
export function getTuple() {
  return [1, "a"] as const;
}
export function maybeNull(x: boolean) {
  if (x) return "yes";
  return null;
}
