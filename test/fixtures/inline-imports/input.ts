import { createConfig, createLogger } from "./barrel.ts";

// TS should add named types to the top-level
// import, not generate inline import() types.
export const config = createConfig("localhost", 3000);
export const logger = createLogger();

// Function returning a type from another module
export function getConfig() {
  return createConfig("remote", 8080);
}

// Variable using a callback that returns an
// imported type
export const makeConfig = (host: string) => createConfig(host, 443);
