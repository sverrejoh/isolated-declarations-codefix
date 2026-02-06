#!/usr/bin/env node
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("tsx/esm", pathToFileURL("./"));
const { main } = await import("../src/cli.js");
main();
