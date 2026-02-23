function mixin<T extends new (...a: any[]) => any>(ctor: T): T {
  return ctor;
}
class Base {
  x = 1;
}

export class Extended extends mixin(Base) {
  y = 2;
}

function mixA<T extends new (...a: any[]) => any>(c: T): T {
  return c;
}
function mixB<T extends new (...a: any[]) => any>(c: T): T {
  return c;
}

export class DoubleMixed extends mixB(mixA(Base)) {
  z = 3;
}
