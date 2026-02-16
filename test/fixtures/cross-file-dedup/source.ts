function getHost() { return "localhost"; }
export function createConfig() {
  return { host: getHost(), port: 3000, debug: false, timeout: 5000, retries: 3, logLevel: "info" };
}
