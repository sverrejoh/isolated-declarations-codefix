export const num = 42;
export const str = "hello";
export const sym = Symbol();
export const symFor = Symbol.for("key");
export let computed = Math.random();
function helper(): { x: number; y: string } {
  return { x: 1, y: "a" };
}
export const complex = helper();
export const tmpl = `value: ${42}`;
export const arr = [1, 2, 3].map(x => x * 2);
export const conditional = true ? 1 : "no";
class MyClass { value = 1; }
export const instance = new MyClass();
