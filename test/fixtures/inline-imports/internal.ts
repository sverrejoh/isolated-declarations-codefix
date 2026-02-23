export interface Config {
  host: string;
  port: number;
}

export interface Logger {
  log(msg: string): void;
  error(msg: string): void;
}

export function createConfig(host: string, port: number): Config {
  return { host, port };
}

export function createLogger(): Logger {
  return {
    log: (msg: string) => console.log(msg),
    error: (msg: string) => console.error(msg),
  };
}
