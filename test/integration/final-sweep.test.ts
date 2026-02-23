import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, fix } from "../../src/index.ts";
import { FIXTURES_DIR, getTscErrors } from "../helpers.ts";

/**
 * Bug: getCombinedCodeFix(fixId) only collects fixes
 * whose fixId matches. Some TS fixes (e.g. generators)
 * have fixId: undefined, so they're silently missed.
 * The final sweep catches these via individual
 * getCodeFixesAtPosition calls.
 *
 * This test makes getCombinedCodeFix return empty
 * changes (not throw — just return nothing), so the
 * main multi-pass loop has no work to do. Only the
 * final sweep can fix the errors.
 */
function setup() {
  const fixtureDir = resolve(FIXTURES_DIR, "return-types");
  const tempDir = resolve(tmpdir(), "iso-decl-test-" + randomUUID());
  mkdirSync(tempDir, { recursive: true });
  cpSync(fixtureDir, tempDir, { recursive: true });
  cpSync(
    resolve(FIXTURES_DIR, "tsconfig.base.json"),
    resolve(tempDir, "tsconfig.base.json")
  );

  const tsconfigPath = resolve(tempDir, "tsconfig.json");
  const project = createProject(tsconfigPath);

  // getCombinedCodeFix returns empty — doesn't throw,
  // just acts like there's nothing to fix. Without a
  // final sweep, all errors remain.
  project.languageService.getCombinedCodeFix = () => ({
    changes: [],
    commands: undefined,
  });

  return { project, tempDir };
}

describe("final sweep", () => {
  it("fixes files that getCombinedCodeFix missed", () => {
    const { project } = setup();
    const result = fix(project);

    // Without the sweep: 0 files fixed (combined
    // returns empty, multi-pass loop exits).
    // With the sweep: files are fixed via individual
    // getCodeFixesAtPosition.
    expect(result.filesChanged.size).toBeGreaterThan(0);
  });

  it("produces zero isolatedDeclarations errors", () => {
    const { project, tempDir } = setup();
    const result = fix(project);

    for (const fn of result.filesChanged) {
      writeFileSync(fn, project.getFileContent(fn), "utf-8");
    }

    const errors = getTscErrors(tempDir);
    const isoErrors = errors.filter((e) => /TS90(?:[0-2]\d|3[5-9])/.test(e));
    expect(isoErrors).toEqual([]);
  });
});
