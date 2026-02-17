export interface Config {
  host: string;
  port: number;
}

export function createConfig(): Config {
  return { host: "localhost", port: 3000 };
}

export const VERSION: string = "1.0.0";
