import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createProject, fix } from "../../src/index.ts";

/**
 * Simulates a pnpm-style .store layout where transitive
 * dependencies are only reachable through realpath resolution.
 *
 * Layout:
 *   project/
 *     node_modules/
 *       pkg-a -> .store/pkg-a@1.0/node_modules/pkg-a
 *     .store/
 *       pkg-a@1.0/
 *         node_modules/
 *           pkg-a/       (the actual package)
 *             index.d.ts (re-exports from pkg-b)
 *           pkg-b -> ../../pkg-b@1.0/node_modules/pkg-b
 *       pkg-b@1.0/
 *         node_modules/
 *           pkg-b/       (the actual package)
 *             index.d.ts (defines StyleResult)
 *
 * From the symlink path node_modules/pkg-a/index.d.ts,
 * resolving "pkg-b" walks up to node_modules/ and finds
 * nothing. Only from the realpath (.store/pkg-a@1.0/
 * node_modules/pkg-a/) can pkg-b be found as a sibling.
 */
function createSymlinkFixture(): string {
  const tempDir = resolve(
    tmpdir(),
    "iso-decl-realpath-" + randomUUID(),
  );

  // .store/pkg-b@1.0/node_modules/pkg-b/
  const pkgBReal = resolve(
    tempDir,
    ".store/pkg-b@1.0/node_modules/pkg-b",
  );
  mkdirSync(pkgBReal, { recursive: true });
  writeFileSync(
    resolve(pkgBReal, "package.json"),
    JSON.stringify({ name: "pkg-b", types: "./index.d.ts" }),
  );
  writeFileSync(
    resolve(pkgBReal, "index.d.ts"),
    [
      "export interface StyleResult {",
      "  className: string;",
      "  variant: number;",
      "}",
      "export declare function makeStyle(",
      "  input: Record<string, string>,",
      "): StyleResult;",
      "",
    ].join("\n"),
  );

  // .store/pkg-a@1.0/node_modules/pkg-a/
  const pkgAReal = resolve(
    tempDir,
    ".store/pkg-a@1.0/node_modules/pkg-a",
  );
  mkdirSync(pkgAReal, { recursive: true });
  writeFileSync(
    resolve(pkgAReal, "package.json"),
    JSON.stringify({ name: "pkg-a", types: "./index.d.ts" }),
  );
  writeFileSync(
    resolve(pkgAReal, "index.d.ts"),
    [
      'export { makeStyle, StyleResult } from "pkg-b";',
      "",
    ].join("\n"),
  );

  // .store/pkg-a@1.0/node_modules/pkg-b -> symlink
  // to .store/pkg-b@1.0/node_modules/pkg-b
  symlinkSync(
    pkgBReal,
    resolve(
      tempDir,
      ".store/pkg-a@1.0/node_modules/pkg-b",
    ),
  );

  // project/node_modules/pkg-a -> symlink to
  // .store/pkg-a@1.0/node_modules/pkg-a
  mkdirSync(resolve(tempDir, "node_modules"), {
    recursive: true,
  });
  symlinkSync(
    pkgAReal,
    resolve(tempDir, "node_modules/pkg-a"),
  );

  // tsconfig.json — use Node10 resolution which matches
  // the real-world 1JS config where this bug manifests
  writeFileSync(
    resolve(tempDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "node",
        strict: true,
        isolatedDeclarations: true,
        declaration: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["./*.ts"],
    }),
  );

  // input.ts
  writeFileSync(
    resolve(tempDir, "input.ts"),
    [
      'import { makeStyle } from "pkg-a";',
      "",
      "export const styles = makeStyle({",
      '  root: "root-class",',
      '  header: "header-class",',
      "});",
      "",
    ].join("\n"),
  );

  return tempDir;
}

describe("realpath symlink resolution", () => {
  it("resolves types through pnpm-style symlinks", () => {
    const tempDir = createSymlinkFixture();
    try {
      const project = createProject(
        resolve(tempDir, "tsconfig.json"),
      );
      const result = fix(project);

      expect(result.totalChanges).toBeGreaterThan(0);

      // The key assertion: the type must NOT be "any"
      const content = project.getFileContent(
        resolve(tempDir, "input.ts"),
      );
      expect(content).not.toContain(": any");
      expect(content).toContain("StyleResult");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("produces zero errors after fix", () => {
    const tempDir = createSymlinkFixture();
    try {
      const project = createProject(
        resolve(tempDir, "tsconfig.json"),
      );
      fix(project);

      // Write fixed files
      for (const fileName of project.getFileNames()) {
        writeFileSync(
          fileName,
          project.getFileContent(fileName),
        );
      }

      // Re-check with a fresh project
      const check = createProject(
        resolve(tempDir, "tsconfig.json"),
      );
      const program = check.languageService.getProgram()!;
      const errors: string[] = [];
      for (const sf of program.getSourceFiles()) {
        if (sf.fileName.includes("node_modules")) continue;
        if (sf.isDeclarationFile) continue;
        const diags = program.getDeclarationDiagnostics(sf);
        for (const d of diags) {
          if (d.code >= 9007 && d.code <= 9029) {
            const msg =
              typeof d.messageText === "string"
                ? d.messageText
                : d.messageText.messageText;
            errors.push(`TS${d.code}: ${msg}`);
          }
        }
      }
      expect(errors).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
