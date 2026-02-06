export class WithGetter {
  get value() { return 42; }
}
export class WithSetter {
  private _v = 0;
  set value(v: number) { this._v = v; }
}
export class GetterSetter {
  private _x = 0;
  get x() { return this._x; }
  set x(value) { this._x = value; }
}
export const obj = {
  get prop() { return "hello"; },
};
export class MultiAccessor {
  private _a = 1;
  private _b = "hi";
  get a() { return this._a; }
  set a(v) { this._a = v; }
  get b() { return this._b; }
  set b(v) { this._b = v; }
}
