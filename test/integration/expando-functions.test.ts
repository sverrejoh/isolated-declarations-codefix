import { describe, expect, it } from "vitest";
import { fixFixture, getTscErrors, writeTempFiles } from "../helpers.ts";

describe("expando-functions", () => {
  it("applies fixes or already has no errors", () => {
    const t = fixFixture("expando-functions");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter((e) => /TS90(?:[0-2]\d|3[5-9])/.test(e));
    const fixedOrClean = t.result.totalChanges > 0 || isoErrors.length === 0;
    expect(fixedOrClean).toBe(true);
  });

  it("does not introduce non-isolatedDeclarations errors", () => {
    const t = fixFixture("expando-functions");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const nonIsoErrors = errors.filter(
      (e) => !/TS90(?:[0-2]\d|3[5-9])/.test(e)
    );
    expect(nonIsoErrors).toEqual([]);
  });
});
