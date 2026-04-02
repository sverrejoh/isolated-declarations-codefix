import { describe, it, expect } from "vitest";
import {
  fixFixture,
  writeTempFiles,
  getTscErrors,
} from "../helpers.ts";

describe("cross-file-dedup", () => {
  it("applies fixes", () => {
    const t = fixFixture("cross-file-dedup");
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(t.result.filesChanged.size).toBeGreaterThan(0);
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("cross-file-dedup");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter((e) =>
      /TS90(?:[0-2]\d|3[5-9])/.test(e),
    );
    expect(isoErrors).toEqual([]);
  });

  it("produces zero other TS errors", () => {
    const t = fixFixture("cross-file-dedup");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    expect(errors).toEqual([]);
  });

  it("exports type from canonical source file", () => {
    const t = fixFixture("cross-file-dedup");
    const sourceFile = [...t.result.filesChanged].find((f) =>
      f.endsWith("source.ts"),
    );
    expect(sourceFile).toBeDefined();
    const content = t.project.getFileContent(sourceFile!);
    expect(content).toMatch(/export type \w+Type =/);
  });

  it("consumers import the type instead of duplicating", () => {
    const t = fixFixture("cross-file-dedup");
    for (const fileName of t.result.filesChanged) {
      if (
        fileName.endsWith("consumer-a.ts") ||
        fileName.endsWith("consumer-b.ts")
      ) {
        const content = t.project.getFileContent(fileName);
        // Should reference the type name, not have a local type declaration
        expect(content).toMatch(/\w+Type/);
        expect(content).not.toMatch(
          /^(?:export )?type \w+Type =/m,
        );
      }
    }
  });

  it("local-only types get local non-exported type aliases", () => {
    const t = fixFixture("cross-file-dedup");
    const localFile = [...t.result.filesChanged].find((f) =>
      f.endsWith("local-only.ts"),
    );
    expect(localFile).toBeDefined();
    const content = t.project.getFileContent(localFile!);
    // Should have a local type alias (not exported)
    expect(content).toMatch(/^type \w+Type =/m);
    expect(content).not.toMatch(
      /^export type \w+Type =/m,
    );
  });
});
