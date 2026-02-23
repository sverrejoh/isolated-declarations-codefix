import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, fix } from "../../src/index.ts";
import { FIXTURES_DIR, getTscErrors } from "../helpers.ts";

/**
 * Bug: the old fixFileFallback always tried diags[0].
 * If that diagnostic had no fix, it broke out of the
 * loop even though later diagnostics were fixable.
 *
 * This test forces the fallback path (getCombinedCodeFix
 * throws) and makes the first diagnostic unfixable
 * (getCodeFixesAtPosition returns []), then asserts
 * that the remaining diagnostics are still fixed.
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

  // Force fallback path.
  project.languageService.getCombinedCodeFix = () => {
    throw new Error("Changes overlap");
  };

  // Make the FIRST getCodeFixesAtPosition call
  // return empty, simulating an unfixable
  // diagnostic at the top of the file.
  const realGetFixes = project.languageService.getCodeFixesAtPosition.bind(
    project.languageService
  );
  let firstCall = true;
  project.languageService.getCodeFixesAtPosition = (
    ...args: Parameters<typeof realGetFixes>
  ) => {
    if (firstCall) {
      firstCall = false;
      return [];
    }
    return realGetFixes(...args);
  };

  return { project, tempDir };
}

describe("fallback iterates all diagnostics", () => {
  it("skips unfixable diag and fixes later ones", () => {
    const { project } = setup();
    const result = fix(project);

    // The old code broke on the first unfixable
    // diagnostic and left everything unfixed.
    // New code skips it and fixes the rest.
    expect(result.filesChanged.size).toBeGreaterThan(0);
  });

  it("produces fewer errors than the unfixed file", () => {
    const { project, tempDir } = setup();
    const result = fix(project);

    for (const fn of result.filesChanged) {
      writeFileSync(fn, project.getFileContent(fn), "utf-8");
    }

    const errors = getTscErrors(tempDir);
    const isoErrors = errors.filter((e) => /TS90(?:[0-2]\d|3[5-9])/.test(e));
    // At most 1 error should remain (the one we
    // made unfixable). Old code left all 9.
    expect(isoErrors.length).toBeLessThanOrEqual(1);
  });
});
