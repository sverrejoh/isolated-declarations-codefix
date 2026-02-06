export class Props {
  name = "default";
  count = 0;
  active = true;
}
function getConfig(): { debug: boolean } {
  return { debug: false };
}
export class Config {
  settings = getConfig();
}
export class Constants {
  static MAX = 100;
}
export class ReadOnly {
  readonly id = Symbol();
}
