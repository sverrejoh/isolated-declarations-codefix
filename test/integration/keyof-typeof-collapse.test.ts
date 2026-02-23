import { describe, expect, it } from "vitest";
import { fixFixture, getTscErrors, writeTempFiles } from "../helpers.ts";

describe("keyof-typeof-collapse", () => {
  it("applies fixes", () => {
    const t = fixFixture("keyof-typeof-collapse");
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(t.result.filesChanged.size).toBeGreaterThan(0);
  });

  it("collapses expanded union to keyof typeof for const objects", () => {
    const t = fixFixture("keyof-typeof-collapse");
    const inputFile = [...t.result.filesChanged].find((f) =>
      f.endsWith("input.ts")
    );
    expect(inputFile).toBeDefined();
    const content = t.project.getFileContent(inputFile!);
    // The mixed union should be collapsed back
    expect(content).toContain("keyof typeof ErrorCodes | undefined");
    expect(content).not.toMatch(
      /"NotFound" \| "Unauthorized" \| "Forbidden" \| "BadRequest" \| undefined/
    );
  });

  it("collapses expanded union to keyof typeof for enums", () => {
    const t = fixFixture("keyof-typeof-collapse");
    const inputFile = [...t.result.filesChanged].find((f) =>
      f.endsWith("input.ts")
    );
    expect(inputFile).toBeDefined();
    const content = t.project.getFileContent(inputFile!);
    expect(content).toContain("keyof typeof Direction | undefined");
    expect(content).not.toMatch(
      /"Up" \| "Down" \| "Left" \| "Right" \| undefined/
    );
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("keyof-typeof-collapse");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter((e) => /TS90(?:[0-2]\d|3[5-9])/.test(e));
    expect(isoErrors).toEqual([]);
  });

  it("does not introduce non-iso errors", () => {
    const t = fixFixture("keyof-typeof-collapse");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const nonIsoErrors = errors.filter(
      (e) => !/TS90(?:[0-2]\d|3[5-9])/.test(e)
    );
    expect(nonIsoErrors).toEqual([]);
  });
});
