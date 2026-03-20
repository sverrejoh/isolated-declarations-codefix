#!/usr/bin/env -S node --max-old-space-size=32768
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("tsx/esm", pathToFileURL("./"));
const { main } = await import("../src/cli.js");
main();
