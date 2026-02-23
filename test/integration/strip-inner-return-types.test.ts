import { describe, expect, it } from "vitest";
import {
  fixFixture,
  getTscErrors,
  writeTempFiles,
} from "../helpers.ts";

describe("strip-inner-return-types", () => {
  it("applies fixes", () => {
    const t = fixFixture("strip-inner-return-types");
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(
      t.result.filesChanged.size
    ).toBeGreaterThan(0);
  });

  it("strips inner callback return type", () => {
    const t = fixFixture("strip-inner-return-types");
    const f = [...t.result.filesChanged].find(
      (p) => p.endsWith("input.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    // createHandler's inner arrow should NOT have
    // a return type annotation added by codefix
    expect(content).toMatch(
      /const handler = \(x: number\) =>/
    );
    expect(content).not.toMatch(
      /const handler = \(x: number\):\s*number\s*=>/
    );
  });

  it("strips .map() callback return type", () => {
    const t = fixFixture("strip-inner-return-types");
    const f = [...t.result.filesChanged].find(
      (p) => p.endsWith("input.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    // .map((n) => ...) — no return type on inner
    expect(content).toMatch(/\.map\(\(n\)\s*=>/);
  });

  it("preserves hand-written inner return type", () => {
    const t = fixFixture("strip-inner-return-types");
    const f = [...t.result.filesChanged].find(
      (p) => p.endsWith("input.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    // Hand-written `: string` on inner must survive
    expect(content).toMatch(
      /\(x: number\):\s*string\s*=>/
    );
  });

  it("preserves directly exported return type", () => {
    const t = fixFixture("strip-inner-return-types");
    const f = [...t.result.filesChanged].find(
      (p) => p.endsWith("input.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    expect(content).toMatch(
      /directlyExported\(\):\s*number/
    );
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("strip-inner-return-types");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter((e) =>
      /TS90(?:[0-2]\d|3[5-9])/.test(e)
    );
    expect(isoErrors).toEqual([]);
  });

  it("does not introduce non-iso errors", () => {
    const t = fixFixture("strip-inner-return-types");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const nonIsoErrors = errors.filter(
      (e) => !/TS90(?:[0-2]\d|3[5-9])/.test(e)
    );
    expect(nonIsoErrors).toEqual([]);
  });
});
