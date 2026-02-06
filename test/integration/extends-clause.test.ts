import { describe, it, expect } from "vitest";
import {
  fixFixture,
  writeTempFiles,
  getTscErrors,
} from "../helpers.js";

describe("extends-clause", () => {
  it("applies fixes", () => {
    const t = fixFixture("extends-clause");
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(t.result.filesChanged.size).toBeGreaterThan(0);
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("extends-clause");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter(
      (e) => /TS90[0-2]\d/.test(e),
    );
    expect(isoErrors).toEqual([]);
  });
});
