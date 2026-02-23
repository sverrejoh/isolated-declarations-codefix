import { describe, expect, it } from "vitest";
import { fixFixture, getTscErrors, writeTempFiles } from "../helpers.ts";

describe("tuple-spread-collapse", () => {
  it("applies fixes", () => {
    const t = fixFixture("tuple-spread-collapse");
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(t.result.filesChanged.size).toBeGreaterThan(0);
  });

  it("collapses all-spread tuple to variadic typeof", () => {
    const t = fixFixture("tuple-spread-collapse");
    const f = [...t.result.filesChanged].find((p) =>
      p.endsWith("input.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    expect(content).toMatch(
      /operators:\s*readonly \[\.\.\.typeof arithmetic,\s*\.\.\.typeof comparison,\s*\.\.\.typeof membership\]/
    );
  });

  it("keeps non-spread literals inline", () => {
    const t = fixFixture("tuple-spread-collapse");
    const f = [...t.result.filesChanged].find((p) =>
      p.endsWith("input.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    expect(content).toMatch(
      /withOwn:\s*readonly \[\.\.\.typeof arithmetic,\s*"extra",\s*\.\.\.typeof comparison\]/
    );
  });

  it("collapses chained spreads", () => {
    const t = fixFixture("tuple-spread-collapse");
    const f = [...t.result.filesChanged].find((p) =>
      p.endsWith("input.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    expect(content).toMatch(
      /all:\s*readonly \[\.\.\.typeof operators,\s*"\?",\s*"\."\]/
    );
  });

  it("does not collapse plain arrays without spreads", () => {
    const t = fixFixture("tuple-spread-collapse");
    const f = [...t.result.filesChanged].find((p) =>
      p.endsWith("input.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    expect(content).not.toMatch(/plain:\s*readonly \[\.\.\.typeof/);
  });

  it("skips non-exported spread source", () => {
    const t = fixFixture("tuple-spread-collapse");
    const f = [...t.result.filesChanged].find((p) =>
      p.endsWith("not-exported.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);
    expect(content).not.toMatch(/typeof priv/);
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("tuple-spread-collapse");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter((e) =>
      /TS90(?:[0-2]\d|3[5-9])/.test(e)
    );
    expect(isoErrors).toEqual([]);
  });

  it("does not introduce non-iso errors", () => {
    const t = fixFixture("tuple-spread-collapse");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const nonIsoErrors = errors.filter(
      (e) => !/TS90(?:[0-2]\d|3[5-9])/.test(e)
    );
    expect(nonIsoErrors).toEqual([]);
  });
});
