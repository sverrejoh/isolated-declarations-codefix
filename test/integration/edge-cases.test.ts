import { describe, it, expect } from "vitest";
import {
  fixFixture,
  writeTempFiles,
  getTscErrors,
} from "../helpers.ts";

describe("edge-cases", () => {
  it("applies fixes", () => {
    const t = fixFixture("edge-cases");
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(t.result.filesChanged.size).toBeGreaterThan(0);
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("edge-cases");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter(
      (e) => /TS90(?:[0-2]\d|3[5-9])/.test(e),
    );
    expect(isoErrors).toEqual([]);
  });
});
