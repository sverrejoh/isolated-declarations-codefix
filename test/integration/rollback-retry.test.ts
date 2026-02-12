import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  mkdirSync,
  cpSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { createProject, fix } from "../../src/index.ts";
import { FIXTURES_DIR, getTscErrors } from "../helpers.ts";

/**
 * When getCombinedCodeFix throws "Changes overlap",
 * the fixer falls back to per-diagnostic fixing.
 * This tests that the per-diagnostic retry on rollback
 * preserves individual working fixes.
 */
function setup() {
  const fixtureDir = resolve(
    FIXTURES_DIR,
    "return-types",
  );
  const tempDir = resolve(
    tmpdir(),
    "iso-decl-test-" + randomUUID(),
  );
  mkdirSync(tempDir, { recursive: true });
  cpSync(fixtureDir, tempDir, { recursive: true });
  cpSync(
    resolve(FIXTURES_DIR, "tsconfig.base.json"),
    resolve(tempDir, "tsconfig.base.json"),
  );

  const tsconfigPath = resolve(
    tempDir,
    "tsconfig.json",
  );
  const project = createProject(tsconfigPath);

  // Force getCombinedCodeFix to throw, triggering
  // the fallback path.
  project.languageService.getCombinedCodeFix = () => {
    throw new Error(
      "Debug Failure. Changes overlap",
    );
  };

  return { project, tempDir };
}

describe("rollback retry via per-diagnostic", () => {
  it("falls back to per-diagnostic and fixes", () => {
    const { project } = setup();
    const result = fix(project);

    expect(
      result.filesChanged.size,
    ).toBeGreaterThan(0);
    expect(result.filesSkipped.size).toBe(0);
  });

  it("produces zero isolatedDeclarations errors", () => {
    const { project, tempDir } = setup();
    const result = fix(project);

    for (const fn of result.filesChanged) {
      writeFileSync(
        fn,
        project.getFileContent(fn),
        "utf-8",
      );
    }

    const errors = getTscErrors(tempDir);
    const isoErrors = errors.filter((e) =>
      /TS90(?:[0-2]\d|3[5-9])/.test(e),
    );
    expect(isoErrors).toEqual([]);
  });

  it("does not introduce non-iso errors", () => {
    const { project, tempDir } = setup();
    const result = fix(project);

    for (const fn of result.filesChanged) {
      writeFileSync(
        fn,
        project.getFileContent(fn),
        "utf-8",
      );
    }

    const errors = getTscErrors(tempDir);
    const nonIsoErrors = errors.filter(
      (e) => !/TS90(?:[0-2]\d|3[5-9])/.test(e),
    );
    expect(nonIsoErrors).toEqual([]);
  });
});
