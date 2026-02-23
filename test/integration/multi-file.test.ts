import { describe, expect, it } from "vitest";
import { fixFixture, getTscErrors, writeTempFiles } from "../helpers.ts";

describe("multi-file", () => {
  it("applies fixes to multiple files", () => {
    const t = fixFixture("multi-file");
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(t.result.filesChanged.size).toBeGreaterThan(0);
  });

  it("does not change types.ts", () => {
    const t = fixFixture("multi-file");
    const changedNames = [...t.result.filesChanged].map((f) =>
      f.replace(/.*[/\\]/, "")
    );
    expect(changedNames).not.toContain("types.ts");
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("multi-file");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter((e) => /TS90(?:[0-2]\d|3[5-9])/.test(e));
    expect(isoErrors).toEqual([]);
  });
});
