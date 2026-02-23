import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fixFixture, FIXTURES_DIR } from "./helpers.ts";

// Collect all fixture names that have a tsconfig.json
const fixtureNames = readdirSync(FIXTURES_DIR).filter((name) => {
  const dir = resolve(FIXTURES_DIR, name);
  return (
    statSync(dir).isDirectory() && existsSync(resolve(dir, "tsconfig.json"))
  );
});

describe("benchmark: all fixtures", () => {
  const times: Array<{ name: string; ms: number }> = [];

  for (const name of fixtureNames) {
    it(`fix ${name}`, () => {
      const start = performance.now();
      const t = fixFixture(name);
      const elapsed = performance.now() - start;
      times.push({ name, ms: elapsed });

      // Sanity: no crash
      expect(t.result).toBeDefined();
    });
  }

  it("print timing summary", () => {
    const total = times.reduce((s, t) => s + t.ms, 0);
    console.log("\n--- Benchmark Results ---");
    for (const t of times.sort((a, b) => b.ms - a.ms)) {
      console.log(`  ${t.name}: ${t.ms.toFixed(0)}ms`);
    }
    console.log(`  TOTAL: ${total.toFixed(0)}ms`);
    console.log("------------------------\n");
  });
});
