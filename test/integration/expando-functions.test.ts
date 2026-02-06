import { describe, it, expect } from "vitest";
import {
  fixFixture,
  writeTempFiles,
  getTscErrors,
} from "../helpers.js";

describe("expando-functions", () => {
  it("applies fixes or already has no errors", () => {
    const t = fixFixture("expando-functions");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter(
      (e) => /TS90[0-2]\d/.test(e),
    );
    // Expando function fixes may not be available
    // in all TS versions, so accept either outcome:
    // fixes applied OR no errors to begin with.
    const fixedOrClean =
      t.result.totalChanges > 0 ||
      isoErrors.length === 0;
    expect(fixedOrClean).toBe(true);
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("expando-functions");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter(
      (e) => /TS90[0-2]\d/.test(e),
    );
    expect(isoErrors).toEqual([]);
  });
});
