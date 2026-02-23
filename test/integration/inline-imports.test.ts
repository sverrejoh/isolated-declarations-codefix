import { describe, expect, it } from "vitest";
import { fixFixture, getTscErrors, writeTempFiles } from "../helpers.ts";

describe("inline-imports", () => {
  it("applies fixes", () => {
    const t = fixFixture("inline-imports");
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(t.result.filesChanged.size).toBeGreaterThan(0);
  });

  it("adds top-level imports for named types", () => {
    const t = fixFixture("inline-imports");
    const inputFile = [...t.result.filesChanged].find((f) =>
      f.endsWith("input.ts")
    );
    expect(inputFile).toBeDefined();
    const content = t.project.getFileContent(inputFile!);
    expect(content).toMatch(/import\s*\{[^}]*Config[^}]*\}/);
    expect(content).not.toMatch(/import\("\.\/barrel[^"]*"\)\.Config/);
    expect(content).not.toMatch(/import\("\.\/internal[^"]*"\)\.Config/);
  });

  it("rewrites top-level typeof import()", () => {
    const t = fixFixture("inline-imports");
    const preFile = [...t.result.filesChanged].find((f) =>
      f.endsWith("pre-existing.ts")
    );
    expect(preFile).toBeDefined();
    const content = t.project.getFileContent(preFile!);
    expect(content).not.toMatch(/typeof import\("/);
    expect(content).toMatch(/typeof InternalModule\b/);
  });

  it("adds namespace import statement", () => {
    const t = fixFixture("inline-imports");
    const preFile = [...t.result.filesChanged].find((f) =>
      f.endsWith("pre-existing.ts")
    );
    expect(preFile).toBeDefined();
    const content = t.project.getFileContent(preFile!);
    expect(content).toMatch(/import type \* as InternalModule from/);
  });

  it("resolves name conflicts", () => {
    const t = fixFixture("inline-imports");
    const conflictsFile = [...t.result.filesChanged].find((f) =>
      f.endsWith("conflicts.ts")
    );
    expect(conflictsFile).toBeDefined();
    const content = t.project.getFileContent(conflictsFile!);
    // InternalModule and InternalModule2 are taken,
    // so the alias should be InternalModule3
    expect(content).toMatch(/import type \* as InternalModule3 from/);
    expect(content).toMatch(/typeof InternalModule3\b/);
  });

  it("increments past all conflicts", () => {
    const t = fixFixture("inline-imports");
    const conflictsFile = [...t.result.filesChanged].find((f) =>
      f.endsWith("conflicts.ts")
    );
    expect(conflictsFile).toBeDefined();
    const content = t.project.getFileContent(conflictsFile!);
    // Should not use InternalModule or InternalModule2
    // as the namespace import name
    expect(content).not.toMatch(/import type \* as InternalModule\b[^3]/);
    expect(content).not.toMatch(/import type \* as InternalModule2\b/);
  });

  it("skips typeof import() inside TypeLiteral", () => {
    const t = fixFixture("inline-imports");
    const lazyFile = [...t.result.filesChanged].find((f) =>
      f.endsWith("lazy.ts")
    );
    expect(lazyFile).toBeDefined();
    const content = t.project.getFileContent(lazyFile!);
    // TS fixer generates expanded object type with
    // typeof import() inside TypeLiteral — we skip
    // rewriting these to avoid breaking declaration
    // checking.
    expect(content).toMatch(/typeof import\("/);
  });

  it("reuses existing namespace import", () => {
    const t = fixFixture("inline-imports");
    const nsFile = [...t.result.filesChanged].find((f) =>
      f.endsWith("existing-ns.ts")
    );
    expect(nsFile).toBeDefined();
    const content = t.project.getFileContent(nsFile!);
    // Should reuse "internal" for the type alias
    expect(content).toMatch(/typeof internal\b/);
    // No new import type * as should be added
    expect(content).not.toMatch(/import type \* as/);
  });

  it("does not modify dynamic import calls", () => {
    const t = fixFixture("inline-imports");
    const lazyFile = [...t.result.filesChanged].find((f) =>
      f.endsWith("lazy.ts")
    );
    expect(lazyFile).toBeDefined();
    const content = t.project.getFileContent(lazyFile!);
    expect(content).toMatch(/import\("\.\/internal/);
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("inline-imports");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter((e) => /TS90(?:[0-2]\d|3[5-9])/.test(e));
    expect(isoErrors).toEqual([]);
  });

  it("does not introduce non-iso errors", () => {
    const t = fixFixture("inline-imports");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const nonIsoErrors = errors.filter(
      (e) => !/TS90(?:[0-2]\d|3[5-9])/.test(e)
    );
    expect(nonIsoErrors).toEqual([]);
  });
});
