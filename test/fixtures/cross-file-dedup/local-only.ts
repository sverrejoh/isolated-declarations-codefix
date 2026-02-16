function getCpu() { return 0; }
export function getMetrics() {
  return { cpu: getCpu(), memory: 0, disk: 0, network: 0, uptime: 0, requests: 0 };
}
