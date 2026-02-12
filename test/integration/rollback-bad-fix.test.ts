import { describe, it, expect } from "vitest";
import {
  fixFixture,
  writeTempFiles,
  getTscErrors,
} from "../helpers.ts";

describe("rollback bad fix", () => {
  it("does not introduce new errors", () => {
    const t = fixFixture("duplicate-import");
    writeTempFiles(t);

    const errors = getTscErrors(t.tempDir);
    // Filter out isolatedDeclarations errors (those
    // are expected to remain if unfixable). Any
    // other error was introduced by our tool.
    const nonIsoErrors = errors.filter(
      (e) => !/TS90(?:[0-2]\d|3[5-9])/.test(e),
    );
    expect(nonIsoErrors).toEqual([]);
  });

  it("reverts files where fix caused errors", () => {
    const t = fixFixture("duplicate-import");

    // The input.ts file should have been reverted
    // since the fix introduces duplicate imports.
    const inputFile = [...t.result.filesChanged]
      .find((f) => f.endsWith("input.ts"));

    // Either input.ts was not changed (reverted)
    // or it was changed without introducing errors.
    if (inputFile) {
      const diags = t.project.languageService
        .getSemanticDiagnostics(inputFile)
        .filter(
          (d) =>
            (d.code < 9007 || d.code > 9025) &&
            (d.code < 9035 || d.code > 9039),
        );
      expect(diags.length).toBe(0);
    }
  });
});
