import { describe, it, expect } from "vitest";
import {
  fixFixture,
  writeTempFiles,
  getTscErrors,
} from "../helpers.js";

describe("default-exports", () => {
  it("applies fixes", () => {
    const t = fixFixture("default-exports");
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(t.result.filesChanged.size).toBeGreaterThan(0);
  });

  it("fixes at least one default export file", () => {
    const t = fixFixture("default-exports");
    expect(t.result.filesChanged.size).toBeGreaterThan(0);
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("default-exports");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter(
      (e) => /TS90[0-2]\d/.test(e),
    );
    expect(isoErrors).toEqual([]);
  });
});
