export class Calculator {
  add(a: number, b: number) { return a + b; }
}
export class Utils {
  static create() { return new Utils(); }
}
export abstract class Base {
  abstract getValue(): number;
  concrete() { return 42; }
}
export class Builder {
  setValue(v: number) { return this; }
}
export class Foo {
  private helper() { return 1; }
  public getValue() { return this.helper(); }
}
export class Overloaded {
  process(x: number): number;
  process(x: string): string;
  process(x: number | string) {
    return x;
  }
}
