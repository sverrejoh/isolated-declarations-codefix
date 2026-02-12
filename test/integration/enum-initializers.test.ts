import { describe, it, expect } from "vitest";
import {
  fixFixture,
  writeTempFiles,
  getTscErrors,
} from "../helpers.ts";

describe("enum-initializers", () => {
  it("applies fixes", () => {
    const t = fixFixture("enum-initializers");
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(
      t.result.filesChanged.size,
    ).toBeGreaterThan(0);
  });

  it("inlines constant values", () => {
    const t = fixFixture("enum-initializers");
    const inputFile = [...t.result.filesChanged].find(
      (f) => f.endsWith("input.ts"),
    );
    expect(inputFile).toBeDefined();
    const content =
      t.project.getFileContent(inputFile!);
    expect(content).toContain('"hub"');
    expect(content).toContain('"teams"');
    expect(content).toContain("42");
    // Original references should be replaced.
    expect(content).not.toContain("= HUB");
    expect(content).not.toContain("= TEAMS");
    expect(content).not.toContain("= NUM_VAL");
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("enum-initializers");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter((e) =>
      /TS90(?:[0-2]\d|3[5-9])/.test(e),
    );
    expect(isoErrors).toEqual([]);
  });

  it("does not introduce non-iso errors", () => {
    const t = fixFixture("enum-initializers");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const nonIsoErrors = errors.filter(
      (e) => !/TS90(?:[0-2]\d|3[5-9])/.test(e),
    );
    expect(nonIsoErrors).toEqual([]);
  });
});
