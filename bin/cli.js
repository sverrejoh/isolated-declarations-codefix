#!/usr/bin/env -S node --max-old-space-size=32768 --import=tsx/esm
const { main } = await import("../src/cli.ts");
main();
