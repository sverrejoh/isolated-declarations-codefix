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

  it("uses typeof for identifiers, type assertion for complex expressions", () => {
    const project = makeProject({
      "mod.ts": [
        "export function run(): void {}",
        "export const noop = (): void => {};",
      ].join("\n"),
      "input.ts": [
        'import { run, noop } from "./mod.ts";',
        "export default {",
        "  simple: run,",
        "  fallback: run || noop,",
        "};",
      ].join("\n"),
    });

    // Force expression fixer path
    project.languageService.getCombinedCodeFix =
      () => ({ changes: [] });
    project.languageService.getCodeFixesAtPosition =
      () => [];

    const file = resolve(
      project.getRootDir(),
      "input.ts"
    );
    fix(project);

    const content = project.getFileContent(file);
    // Identifier → typeof
    expect(content).toContain("as typeof run");
    // Binary expression → checker-serialized type
    expect(content).toContain(") as ");

    const after = project.languageService
      .getSemanticDiagnostics(file)
      .filter((d) => d.code === 9013);
    expect(after).toEqual([]);
  });

  it("fixes X || noop via expression fixer", () => {
    const project = makeProject({
      "actions.ts": [
        "const noop = (): void => {};",
        "export const Module = {",
        "  doThing: undefined as",
        "    | ((x: string) => void)",
        "    | undefined,",
        "};",
        "export const Actions = {",
        "  doThing: Module.doThing || noop,",
        "};",
      ].join("\n"),
    });

    // Force built-in fixer to skip so expression
    // fixer handles the || pattern
    project.languageService.getCombinedCodeFix =
      () => ({ changes: [] });
    project.languageService.getCodeFixesAtPosition =
      () => [];

    const file = resolve(
      project.getRootDir(),
      "actions.ts"
    );

    const before = project.languageService
      .getSemanticDiagnostics(file)
      .filter((d) => d.code === 9013);
    expect(before.length).toBeGreaterThan(0);

    const result = fix(project);
    expect(result.totalChanges).toBeGreaterThan(0);

    const after = project.languageService
      .getSemanticDiagnostics(file)
      .filter((d) => d.code === 9013);
    expect(after).toEqual([]);

    const content = project.getFileContent(file);
    expect(content).toContain(") as ");
  });

  it("fixes multiple || noop in one object", () => {
    const project = makeProject({
      "multi.ts": [
        "const noop = (): void => {};",
        "export const Mod = {",
        "  a: undefined as",
        "    | ((x: string) => void)",
        "    | undefined,",
        "  b: undefined as",
        "    | ((y: number) => void)",
        "    | undefined,",
        "};",
        "export const Actions = {",
        "  a: Mod.a || noop,",
        "  b: Mod.b || noop,",
        "};",
      ].join("\n"),
    });

    // Force expression fixer path
    project.languageService.getCombinedCodeFix =
      () => ({ changes: [] });
    project.languageService.getCodeFixesAtPosition =
      () => [];

    const file = resolve(
      project.getRootDir(),
      "multi.ts"
    );

    const result = fix(project);
    expect(result.totalChanges).toBeGreaterThanOrEqual(
      2
    );

    const after = project.languageService
      .getSemanticDiagnostics(file)
      .filter((d) => d.code === 9013);
    expect(after).toEqual([]);
  });

  it("resolves TS9037 on default export of call expression", () => {
    const project = makeProject({
      "hoc.ts": [
        "interface Wrapped<T> {",
        "  inner: T;",
        "  displayName?: string;",
        "}",
        "function wrap<T>(c: T): Wrapped<T> {",
        "  return { inner: c };",
        "}",
        "function Comp(): string {",
        '  return "hi";',
        "}",
        "export default wrap(Comp);",
      ].join("\n"),
    });

    // Force expression fixer path
    project.languageService.getCombinedCodeFix =
      () => ({ changes: [] });
    project.languageService.getCodeFixesAtPosition =
      () => [];

    const file = resolve(
      project.getRootDir(),
      "hoc.ts"
    );

    const before = project.languageService
      .getSemanticDiagnostics(file)
      .filter((d) => d.code === 9037);
    expect(before.length).toBeGreaterThan(0);

    fix(project);

    const after = project.languageService
      .getSemanticDiagnostics(file)
      .filter((d) => d.code === 9037);
    expect(after).toEqual([]);

    const content = project.getFileContent(file);
    expect(content).toContain(") as ");
  });

  it("sanitizes destructured param renames in serialized type (TS2842)", () => {
    const project = makeProject({
      "memo.ts": [
        "interface Props {",
        "  enabled: boolean;",
        "  label: string;",
        "}",
        "interface Memo<T> {",
        "  inner: T;",
        "}",
        "function memo<T>(c: T): Memo<T> {",
        "  return { inner: c };",
        "}",
        "function Comp({",
        "  enabled: enabledInternal,",
        "  label,",
        "}: Props): string {",
        '  return enabledInternal ? label : "";',
        "}",
        "export default memo(Comp);",
      ].join("\n"),
    });

    // Force expression fixer path
    project.languageService.getCombinedCodeFix =
      () => ({ changes: [] });
    project.languageService.getCodeFixesAtPosition =
      () => [];

    const file = resolve(
      project.getRootDir(),
      "memo.ts"
    );

    fix(project);

    const content = project.getFileContent(file);
    // The type assertion should use simple param name,
    // not the destructured rename
    const assertion = content.slice(
      content.indexOf(") as ")
    );
    expect(assertion).not.toContain(
      "enabledInternal"
    );
    expect(assertion).toContain("args: Props");

    // Should have no TS2842 errors
    const errors = project.languageService
      .getSemanticDiagnostics(file)
      .filter((d) => d.code === 2842);
    expect(errors).toEqual([]);
  });

  it("resolves TS9010 on variable with complex initializer", () => {
    const project = makeProject({
      "lazy.ts": [
        "interface LazyComp<T> {",
        "  load: () => Promise<T>;",
        "  key: string;",
        "}",
        "function createLazy<T>(",
        "  key: string,",
        "  loader: () => Promise<T>",
        "): LazyComp<T> {",
        "  return { load: loader, key };",
        "}",
        "function Comp(): string {",
        '  return "hi";',
        "}",
        'export const LazyComp = createLazy("k",',
        "  () => Promise.resolve(Comp));",
      ].join("\n"),
    });

    // Force expression fixer path
    project.languageService.getCombinedCodeFix =
      () => ({ changes: [] });
    project.languageService.getCodeFixesAtPosition =
      () => [];

    const file = resolve(
      project.getRootDir(),
      "lazy.ts"
    );

    const before = project.languageService
      .getSemanticDiagnostics(file)
      .filter((d) => d.code === 9010);
    expect(before.length).toBeGreaterThan(0);

    fix(project);

    const after = project.languageService
      .getSemanticDiagnostics(file)
      .filter((d) => d.code === 9010);
    expect(after).toEqual([]);

    const content = project.getFileContent(file);
    // Should have inserted a type annotation
    expect(content).toMatch(
      /export const LazyComp: .+ = createLazy/
    );

    // Must not introduce any non-iso errors
    const allErrors = project.languageService
      .getSemanticDiagnostics(file)
      .filter(
        (d) =>
          !(
            d.code >= 9007 && d.code <= 9039
          )
      );
    expect(allErrors).toEqual([]);
  });

  it("TS9010 handler does not interfere with built-in fixer", () => {
    // When the built-in fixer can handle TS9010,
    // the expression fixer should not run (no
    // remaining diagnostics).
    const project = makeProject({
      "simple.ts": [
        "function getValue(): number {",
        "  return 42;",
        "}",
        "export const x = getValue();",
      ].join("\n"),
    });

    const file = resolve(
      project.getRootDir(),
      "simple.ts"
    );

    const before = project.languageService
      .getSemanticDiagnostics(file)
      .filter((d) => d.code === 9010);
    expect(before.length).toBeGreaterThan(0);

    // Run with real (unmocked) fixer
    const result = fix(project);
    expect(result.totalChanges).toBeGreaterThan(0);

    const after = project.languageService
      .getSemanticDiagnostics(file)
      .filter((d) => d.code === 9010);
    expect(after).toEqual([]);

    const content = project.getFileContent(file);
    // Built-in fixer adds `: number`, not our
    // expression fixer's checker-serialized type
    expect(content).toContain("x: number");
  });

  it("TS9010 handles multiple variables in one file", () => {
    const project = makeProject({
      "multi.ts": [
        "interface Box<T> { value: T }",
        "function box<T>(v: T): Box<T> {",
        "  return { value: v };",
        "}",
        'export const a = box("hello");',
        "export const b = box(42);",
      ].join("\n"),
    });

    project.languageService.getCombinedCodeFix =
      () => ({ changes: [] });
    project.languageService.getCodeFixesAtPosition =
      () => [];

    const file = resolve(
      project.getRootDir(),
      "multi.ts"
    );

    fix(project);

    const after = project.languageService
      .getSemanticDiagnostics(file)
      .filter((d) => d.code === 9010);
    expect(after).toEqual([]);

    const content = project.getFileContent(file);
    expect(content).toMatch(
      /export const a: .+ = box\(/
    );
    expect(content).toMatch(
      /export const b: .+ = box\(/
    );
  });
});
