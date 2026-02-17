import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createProject, fix } from "../../src/index.ts";
import type { Project, FixResult } from "../../src/index.ts";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const MONOREPO_ROOT = "/Users/briansilah/Work/1JS";
const PKG_DIR = resolve(
  MONOREPO_ROOT,
  "midgard/packages/fai-react-copilot-nav",
);
const TSCONFIG = resolve(PKG_DIR, "tsconfig.json");
const TARGET_FILE = resolve(
  PKG_DIR,
  "src/shared/copilotNavDrawerMotion.ts",
);

const canRun = existsSync(TSCONFIG);

describe.skipIf(!canRun)(
  "generic-alias-simplify (real codebase)",
  { timeout: 120_000 },
  () => {
    let project: Project;
    let result: FixResult;
    let fixedContent: string;
    let originalContent: string;

    beforeAll(() => {
      // Save current content
      originalContent = readFileSync(TARGET_FILE, "utf8");

      // Reset to main's version (no annotations)
      execSync(
        `cd ${MONOREPO_ROOT} && git checkout main -- midgard/packages/fai-react-copilot-nav/src/shared/copilotNavDrawerMotion.ts`,
      );

      project = createProject(TSCONFIG);
      result = fix(project, { verbose: false });
      fixedContent = project.getFileContent(TARGET_FILE);
    }, 120_000);

    afterAll(() => {
      // Restore original content
      execSync(
        `cd ${MONOREPO_ROOT} && git checkout HEAD -- midgard/packages/fai-react-copilot-nav/src/shared/copilotNavDrawerMotion.ts`,
      );
    });

    it("applies fixes to copilotNavDrawerMotion.ts", () => {
      expect(result.filesChanged.has(TARGET_FILE)).toBe(
        true,
      );
    });

    it("uses PresenceComponent<DrawerMotionParams> alias", () => {
      expect(fixedContent).toContain(
        "PresenceComponent<DrawerMotionParams>",
      );
    });

    it("does NOT contain expanded structural type in annotations", () => {
      // Remove import lines — DetailedHTMLProps may appear in imports
      // but should NOT appear in type annotations
      const withoutImports = fixedContent
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("import"))
        .join("\n");
      expect(withoutImports).not.toContain(
        "DetailedHTMLProps",
      );
      expect(withoutImports).not.toContain(
        "DO_NOT_USE_OR_YOU_WILL_BE_FIRED",
      );
    });

    it("keeps file reasonably sized (< 250 lines)", () => {
      const lines = fixedContent.split("\n").length;
      expect(lines).toBeLessThan(250);
    });
  },
);
