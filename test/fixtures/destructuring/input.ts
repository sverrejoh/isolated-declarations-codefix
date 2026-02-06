function getPoint(): { x: number; y: number } {
  return { x: 1, y: 2 };
}
export const { x, y } = getPoint();

function getPair(): [number, string] { return [1, "a"]; }
export const [first, second] = getPair();

function getA(): { a: number } { return { a: 1 }; }
function getB(): { b: string } { return { b: "hi" }; }
export const { a } = getA();
export const { b } = getB();
