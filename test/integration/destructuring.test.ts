import { describe, expect, it } from "vitest";
import { fixFixture, getTscErrors, writeTempFiles } from "../helpers.ts";

describe("destructuring", () => {
  it("applies fixes or rolls back bad ones", () => {
    const t = fixFixture("destructuring");
    // The TS code fixer for destructuring exports
    // may produce broken output (duplicate variable
    // declarations). Our rollback catches this.
    // Either files are changed or skipped — never
    // silently corrupted.
    const total = t.result.filesChanged.size + t.result.filesSkipped.size;
    expect(total).toBeGreaterThan(0);
  });

  it("does not introduce non-isolatedDeclarations errors", () => {
    const t = fixFixture("destructuring");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const nonIsoErrors = errors.filter(
      (e) => !/TS90(?:[0-2]\d|3[5-9])/.test(e)
    );
    expect(nonIsoErrors).toEqual([]);
  });
});
