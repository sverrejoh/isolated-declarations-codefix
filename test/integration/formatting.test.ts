import { describe, expect, it } from "vitest";
import {
  fixFixture,
  getTscErrors,
  readTempFile,
  writeTempFiles,
} from "../helpers.ts";

describe("formatting", () => {
  it("applies fixes", () => {
    const t = fixFixture("formatting");
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(t.result.filesChanged.size).toBeGreaterThan(0);
  });

  it("preserves JSDoc comments", () => {
    const t = fixFixture("formatting");
    writeTempFiles(t);
    const content = readTempFile(t.tempDir, "input.ts");
    expect(content).toContain("Gets a user by ID.");
    expect(content).toContain("@param id");
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("formatting");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter((e) => /TS90(?:[0-2]\d|3[5-9])/.test(e));
    expect(isoErrors).toEqual([]);
  });
});
