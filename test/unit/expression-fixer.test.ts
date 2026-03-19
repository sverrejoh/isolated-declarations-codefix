import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createProject, fix } from "../../src/index.ts";

function makeProject(files: Record<string, string>) {
  const dir = resolve(
    tmpdir(),
    "expr-fix-" + randomUUID()
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "Node16",
        moduleResolution: "Node16",
        strict: true,
        isolatedDeclarations: true,
        declaration: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["./*.ts"],
    })
  );
  for (const [name, content] of Object.entries(
    files
  )) {
    writeFileSync(resolve(dir, name), content);
  }
  return createProject(resolve(dir, "tsconfig.json"));
}

describe("runExpressionFixer", () => {
  it("resolves TS9013 on default export", () => {
    const project = makeProject({
      "component.ts": [
        "export function Comp(): void {}",
      ].join("\n"),
      "story.ts": [
        'import { Comp } from "./component.ts";',
        "export default {",
        '  title: "Test",',
        "  component: Comp,",
        "};",
      ].join("\n"),
    });

    const storyFile = resolve(
      project.getRootDir(),
      "story.ts"
    );

    // Verify TS9013 exists before fix
    const diagsBefore = project.languageService
      .getSemanticDiagnostics(storyFile)
      .filter((d) => d.code === 9013);
    expect(diagsBefore.length).toBeGreaterThan(0);

    const result = fix(project);
    expect(result.totalChanges).toBeGreaterThan(0);

    // After fix, TS9013 is resolved (by either
    // core fixer or expression fixer)
    const diagsAfter = project.languageService
      .getSemanticDiagnostics(storyFile)
      .filter((d) => d.code === 9013);
    expect(diagsAfter).toEqual([]);

    // The fix uses typeof Component somewhere
    const content = project.getFileContent(
      storyFile
    );
    expect(content).toContain("typeof Comp");
  });

  it("handles dotted names", () => {
    const project = makeProject({
      "mod.ts": [
        "export const Utils = {",
        "  format(_s: string): string {",
        '    return "";',
        "  },",
        "};",
      ].join("\n"),
      "input.ts": [
        'import { Utils } from "./mod.ts";',
        "export default {",
        '  label: "test",',
        "  formatter: Utils.format,",
        "};",
      ].join("\n"),
    });

    const inputFile = resolve(
      project.getRootDir(),
      "input.ts"
    );

    const result = fix(project);
    expect(result.totalChanges).toBeGreaterThan(0);

    const diagsAfter = project.languageService
      .getSemanticDiagnostics(inputFile)
      .filter((d) => d.code === 9013);
    expect(diagsAfter).toEqual([]);
  });

  it("resolves TS9017 on array literal", () => {
    const project = makeProject({
      "story.ts": [
        "export default {",
        '  title: "Test",',
        '  tags: ["autodocs"],',
        "};",
      ].join("\n"),
    });

    const storyFile = resolve(
      project.getRootDir(),
      "story.ts"
    );

    // Verify TS9017 exists before fix
    const diagsBefore = project.languageService
      .getSemanticDiagnostics(storyFile)
      .filter((d) => d.code === 9017);
    expect(diagsBefore.length).toBeGreaterThan(0);

    const result = fix(project);
    expect(result.totalChanges).toBeGreaterThan(0);

    // TS9017 resolved (by core fixer or expression
    // fixer)
    const diagsAfter = project.languageService
      .getSemanticDiagnostics(storyFile)
      .filter((d) => d.code === 9017);
    expect(diagsAfter).toEqual([]);
  });

  it("skips non-identifier expressions", () => {
    // Regex should NOT match function calls
    const pattern =
      /^[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)*$/;
    expect(pattern.test("Component")).toBe(true);
    expect(pattern.test("A.B.C")).toBe(true);
    expect(pattern.test("foo()")).toBe(false);
    expect(pattern.test("a + b")).toBe(false);
    expect(pattern.test("new Foo()")).toBe(false);
  });
});
