function getVal(): string {
  return "hi";
}
function getNum(): number {
  return 1;
}
function getStr(): string {
  return "a";
}
export const obj1 = { prop: getVal() };
export const obj2 = {
  a: getNum(),
  b: getStr(),
};
export const obj3 = {
  outer: {
    inner: getVal(),
  },
};
