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
 * Test the validated per-diagnostic fallback.
 *
 * When getCombinedCodeFix produces changes that
 * introduce errors, the fixer reverts and retries
 * with fixFileValidated — which applies and validates
 * each fix individually, skipping bad ones.
 *
 * This test monkey-patches getCombinedCodeFix to
 * inject a bad text change (inserting invalid syntax)
 * alongside good changes. The combined result would
 * fail validation, but fixFileValidated should skip
 * the bad change and keep the good ones.
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

  // Monkey-patch getCombinedCodeFix to inject a bad
  // text change that introduces a non-iso error.
  // This causes rollback, which then triggers the
  // validated per-diagnostic retry.
  const real =
    project.languageService.getCombinedCodeFix.bind(
      project.languageService,
    );
  project.languageService.getCombinedCodeFix = (
    ...args
  ) => {
    const result = real(...args);
    if (result.changes.length > 0) {
      // Inject a bad change: add "const x: BADTYPE;"
      // which will cause a non-iso error (TS2304).
      const firstFile = result.changes[0];
      firstFile.textChanges = [
        ...firstFile.textChanges,
        {
          span: { start: 0, length: 0 },
          newText:
            "const __bad__: NONEXISTENT_TYPE = 0;\n",
        },
      ];
    }
    return result;
  };

  return { project, tempDir };
}

describe("validated per-diagnostic fallback", () => {
  it("saves good fixes when combined fix has one bad change", () => {
    const { project } = setup();
    const result = fix(project);

    // The validated fallback should have saved the
    // good fixes even though the combined fix was
    // contaminated with a bad change.
    expect(
      result.filesChanged.size,
    ).toBeGreaterThan(0);
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

  it("reduces iso-decl errors despite bad combined fix", () => {
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
    // Should have zero or very few remaining
    // iso-decl errors, not the full original count.
    expect(isoErrors.length).toBeLessThanOrEqual(1);
  });
});
