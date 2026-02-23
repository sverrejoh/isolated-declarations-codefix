import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, fix } from "../../src/index.ts";
import { FIXTURES_DIR, getTscErrors } from "../helpers.ts";

/**
 * Set up a project from the return-types fixture and
 * monkey-patch getCombinedCodeFix to always throw,
 * simulating the TypeScript "Changes overlap" bug.
 */
function setupWithOverlapError() {
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

  // Force getCombinedCodeFix to throw for every call,
  // as if every file triggers the TS overlap bug.
  project.languageService.getCombinedCodeFix = () => {
    throw new Error("Debug Failure. False expression: " + "Changes overlap");
  };

  return { project, tempDir };
}

describe("overlapping changes fallback", () => {
  it("fixes files via per-diagnostic fallback", () => {
    const { project } = setupWithOverlapError();
    const result = fix(project);

    expect(result.filesChanged.size).toBeGreaterThan(0);
    expect(result.filesSkipped.size).toBe(0);
  });

  it("produces zero isolatedDeclarations errors", () => {
    const { project, tempDir } = setupWithOverlapError();
    const result = fix(project);

    for (const fileName of result.filesChanged) {
      writeFileSync(fileName, project.getFileContent(fileName), "utf-8");
    }

    const errors = getTscErrors(tempDir);
    const isoErrors = errors.filter((e) => /TS90(?:[0-2]\d|3[5-9])/.test(e));
    expect(isoErrors).toEqual([]);
  });
});
