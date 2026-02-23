import { describe, expect, it } from "vitest";
import { fixFixture, getTscErrors, writeTempFiles } from "../helpers.ts";

describe("multi-pass", () => {
  it("applies fixes", () => {
    const t = fixFixture("multi-pass");
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(t.result.filesChanged.size).toBeGreaterThan(0);
  });

  it("may require more than one pass", () => {
    const t = fixFixture("multi-pass");
    expect(t.result.passes).toBeGreaterThanOrEqual(1);
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("multi-pass");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter((e) => /TS90(?:[0-2]\d|3[5-9])/.test(e));
    expect(isoErrors).toEqual([]);
  });
});
