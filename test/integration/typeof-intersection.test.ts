import { describe, expect, it } from "vitest";
import { fixFixture, getTscErrors, writeTempFiles } from "../helpers.ts";

describe("typeof-intersection", () => {
  it("applies fixes", () => {
    const t = fixFixture("typeof-intersection");
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(t.result.filesChanged.size).toBeGreaterThan(0);
  });

  it("rewrites basic spread to typeof", () => {
    const t = fixFixture("typeof-intersection");
    const f = [...t.result.filesChanged].find((p) => p.endsWith("input.ts"));
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    // EXTENDED = { ...BASE, c: true } should use
    // typeof BASE & { c: boolean }
    expect(content).toMatch(
      /EXTENDED:\s*typeof BASE\s*&\s*\{[^}]*c:\s*boolean/
    );
  });

  it("rewrites multiple spreads", () => {
    const t = fixFixture("typeof-intersection");
    const f = [...t.result.filesChanged].find((p) => p.endsWith("input.ts"));
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    // MULTI = { ...BASE, ...EXTRA, e: "own" }
    expect(content).toMatch(/MULTI:\s*typeof BASE\s*&\s*typeof EXTRA\s*&\s*\{/);
  });

  it("rewrites all-spread with no own props", () => {
    const t = fixFixture("typeof-intersection");
    const f = [...t.result.filesChanged].find((p) => p.endsWith("input.ts"));
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    // CLONE = { ...BASE } should be typeof BASE
    // with no & { ... } part
    expect(content).toMatch(/CLONE:\s*typeof BASE\s*=/);
  });

  it("skips non-exported spread source", () => {
    const t = fixFixture("typeof-intersection");
    const f = [...t.result.filesChanged].find((p) =>
      p.endsWith("not-exported.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    // PRIVATE is not exported, so no typeof PRIVATE
    expect(content).not.toMatch(/typeof PRIVATE/);
  });

  it("keeps override props in inline type", () => {
    const t = fixFixture("typeof-intersection");
    const f = [...t.result.filesChanged].find((p) => p.endsWith("input.ts"));
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    // OVERRIDDEN = { ...BASE, a: 999, c: true }
    // a overrides BASE's a, so it stays in the
    // inline block along with c
    expect(content).toMatch(
      /OVERRIDDEN:\s*typeof BASE\s*&\s*\{[^}]*a:\s*number/
    );
    expect(content).toMatch(
      /OVERRIDDEN:\s*typeof BASE\s*&\s*\{[^}]*c:\s*boolean/
    );
  });

  it("rewrites large objects", () => {
    // Disable extract-types so it doesn't replace
    // the typeof intersection with a named interface
    const t = fixFixture("typeof-intersection", {
      extractThreshold: Infinity,
    });
    const f = [...t.result.filesChanged].find((p) =>
      p.endsWith("large-object.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    expect(content).toMatch(/LARGE_EXTENDED:\s*typeof LARGE_BASE\s*&\s*\{/);
  });

  it("does not add typeof to non-spread object", () => {
    const t = fixFixture("typeof-intersection");
    const f = [...t.result.filesChanged].find((p) => p.endsWith("input.ts"));
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    // PLAIN has no spread, should not have typeof
    expect(content).not.toMatch(/PLAIN:\s*typeof/);
  });

  it("rewrites multiple objects in same file", () => {
    const t = fixFixture("typeof-intersection");
    const f = [...t.result.filesChanged].find((p) =>
      p.endsWith("multi-objects.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    expect(content).toMatch(/THEME1:\s*typeof COLORS\s*&/);
    expect(content).toMatch(/THEME2:\s*typeof COLORS\s*&/);
  });

  it("skips imported spread source", () => {
    const t = fixFixture("typeof-intersection");
    const f = [...t.result.filesChanged].find((p) =>
      p.endsWith("imported-spread.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    // IMPORTED_BASE is from another file
    expect(content).not.toMatch(/typeof IMPORTED_BASE/);
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("typeof-intersection");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter((e) => /TS90(?:[0-2]\d|3[5-9])/.test(e));
    expect(isoErrors).toEqual([]);
  });

  it("does not introduce non-iso errors", () => {
    const t = fixFixture("typeof-intersection");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const nonIsoErrors = errors.filter(
      (e) => !/TS90(?:[0-2]\d|3[5-9])/.test(e)
    );
    expect(nonIsoErrors).toEqual([]);
  });
});
