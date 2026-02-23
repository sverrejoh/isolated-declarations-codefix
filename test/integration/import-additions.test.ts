import { describe, expect, it } from "vitest";
import { fixFixture, getTscErrors, writeTempFiles } from "../helpers.ts";

describe("import-additions", () => {
  it("applies fixes", () => {
    const t = fixFixture("import-additions");
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(t.result.filesChanged.size).toBeGreaterThan(0);
  });

  it("produces valid syntax in fixed file", () => {
    const t = fixFixture("import-additions");
    const content = t.project.getFileContent(
      [...t.result.filesChanged].find((f) => f.endsWith("input.ts"))!
    );

    // Must not have double commas
    expect(content).not.toMatch(/,,/);
    // Must not have missing commas before type
    // imports (line ending without comma followed
    // by a type import)
    expect(content).not.toMatch(/[^,]\n\s+type\s/);
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("import-additions");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter((e) => /TS90(?:[0-2]\d|3[5-9])/.test(e));
    expect(isoErrors).toEqual([]);
  });

  it("produces zero syntax errors", () => {
    const t = fixFixture("import-additions");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const syntaxErrors = errors.filter(
      (e) => /TS100[0-9]/.test(e) || /TS1[0-9]{3}/.test(e)
    );
    expect(syntaxErrors).toEqual([]);
  });
});
