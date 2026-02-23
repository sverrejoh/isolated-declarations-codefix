import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  applyReplacements,
  type TextReplacement,
} from "../../src/utils/replacements.ts";
import { isIsolatedDeclarationsError } from "../../src/utils/diagnostics.ts";
import {
  findImportInsertPos,
  insertImportStatement,
} from "../../src/utils/import-inserter.ts";
import { runTransformPipeline } from "../../src/transforms/pipeline.ts";
import type {
  ReadabilityTransform,
  TransformContext,
  TransformOptions,
} from "../../src/transforms/types.ts";
import { stripInnerReturnTypes } from "../../src/transforms/strip-inner-return-types.ts";
import { simplifyGenericAliases } from "../../src/transforms/generic-alias.ts";
import { createProject } from "../../src/project.ts";
import ts from "typescript";

// ── applyReplacements ────────────────────────────────

describe("applyReplacements", () => {
  it("applies single replacement", () => {
    const result = applyReplacements("hello world", [
      { start: 0, end: 5, text: "goodbye" },
    ]);
    expect(result).toBe("goodbye world");
  });

  it("applies multiple non-overlapping replacements", () => {
    const result = applyReplacements("aaa bbb ccc", [
      { start: 0, end: 3, text: "xxx" },
      { start: 4, end: 7, text: "yyy" },
      { start: 8, end: 11, text: "zzz" },
    ]);
    expect(result).toBe("xxx yyy zzz");
  });

  it("handles empty replacements", () => {
    expect(applyReplacements("hello", [])).toBe(
      "hello"
    );
  });

  it("sorts descending by position", () => {
    // Replacements given in forward order; function
    // must sort them descending before applying.
    const repls: TextReplacement[] = [
      { start: 0, end: 1, text: "X" },
      { start: 4, end: 5, text: "Y" },
    ];
    const result = applyReplacements("a---b", repls);
    expect(result).toBe("X---Y");
  });

  it("handles insertion (zero-length span)", () => {
    const result = applyReplacements("ab", [
      { start: 1, end: 1, text: "X" },
    ]);
    expect(result).toBe("aXb");
  });
});

// ── isIsolatedDeclarationsError ──────────────────────

describe("isIsolatedDeclarationsError", () => {
  it("returns true for codes 9007-9025", () => {
    expect(isIsolatedDeclarationsError(9007)).toBe(
      true
    );
    expect(isIsolatedDeclarationsError(9020)).toBe(
      true
    );
    expect(isIsolatedDeclarationsError(9025)).toBe(
      true
    );
  });

  it("returns true for codes 9035-9039", () => {
    expect(isIsolatedDeclarationsError(9035)).toBe(
      true
    );
    expect(isIsolatedDeclarationsError(9039)).toBe(
      true
    );
  });

  it("returns false for non-iso codes", () => {
    expect(isIsolatedDeclarationsError(2300)).toBe(
      false
    );
    expect(isIsolatedDeclarationsError(9006)).toBe(
      false
    );
    expect(isIsolatedDeclarationsError(9026)).toBe(
      false
    );
    expect(isIsolatedDeclarationsError(9034)).toBe(
      false
    );
    expect(isIsolatedDeclarationsError(9040)).toBe(
      false
    );
  });
});

// ── findImportInsertPos ──────────────────────────────

describe("findImportInsertPos", () => {
  it("returns 0 for file with no imports", () => {
    const sf = ts.createSourceFile(
      "test.ts",
      "const x = 1;",
      ts.ScriptTarget.Latest,
      true
    );
    expect(findImportInsertPos(sf)).toBe(0);
  });

  it("returns position after last import", () => {
    const code = [
      'import { a } from "a";',
      'import { b } from "b";',
      "const x = 1;",
    ].join("\n");
    const sf = ts.createSourceFile(
      "test.ts",
      code,
      ts.ScriptTarget.Latest,
      true
    );
    const pos = findImportInsertPos(sf);
    // Should be after the second import's semicolon.
    expect(code.slice(0, pos)).toContain(
      'from "b";'
    );
    expect(code.slice(pos)).toMatch(
      /^\s*\nconst x/
    );
  });
});

// ── insertImportStatement ────────────────────────────

describe("insertImportStatement", () => {
  it("inserts after existing imports", () => {
    const code = 'import { a } from "a";\nconst x = 1;';
    const result = insertImportStatement(
      code,
      "test.ts",
      'import { b } from "b";'
    );
    expect(result).toContain('from "a";');
    expect(result).toContain('import { b } from "b";');
    expect(result).toContain("const x = 1;");
  });

  it("prepends when no imports exist", () => {
    const code = "const x = 1;";
    const result = insertImportStatement(
      code,
      "test.ts",
      'import { a } from "a";'
    );
    expect(result).toMatch(
      /^import \{ a \} from "a";\n/
    );
  });
});

// ── runTransformPipeline ─────────────────────────────

function makeMockProject(
  files: Map<string, string>
): TransformContext["project"] {
  const versions = new Map<string, number>();
  return {
    languageService: {
      getProgram: () => ({
        getSourceFiles: () =>
          [...files.keys()].map((name) => ({
            fileName: name,
            isDeclarationFile: false,
          })),
      }),
    },
    getFileContent: (f: string) =>
      files.get(f) ?? "",
    updateFile: (f: string, c: string) => {
      files.set(f, c);
      versions.set(
        f,
        (versions.get(f) ?? 0) + 1
      );
    },
    getFileNames: () => [...files.keys()],
    getRootDir: () => "/mock",
  } as any;
}

describe("runTransformPipeline", () => {
  it("runs transforms in order", () => {
    const order: string[] = [];
    const files = new Map([["a.ts", "content"]]);
    const ctx: TransformContext = {
      project: makeMockProject(files),
      filesChanged: new Set(["a.ts"]),
      snapshots: new Map(),
      formatOptions:
        ts.getDefaultFormatCodeSettings(),
      preferences: {},
    };
    const opts: TransformOptions = {
      rewriteInlineImports: true,
      extractThreshold: 5,
      verbose: false,
    };

    const transforms: ReadabilityTransform[] = [
      {
        name: "first",
        scope: "changed",
        isEnabled: () => true,
        transformFile: () => {
          order.push("first");
          return false;
        },
      },
      {
        name: "second",
        scope: "changed",
        isEnabled: () => true,
        transformFile: () => {
          order.push("second");
          return false;
        },
      },
    ];

    runTransformPipeline(transforms, ctx, opts);
    expect(order).toEqual(["first", "second"]);
  });

  it("skips disabled transforms", () => {
    const order: string[] = [];
    const files = new Map([["a.ts", "content"]]);
    const ctx: TransformContext = {
      project: makeMockProject(files),
      filesChanged: new Set(["a.ts"]),
      snapshots: new Map(),
      formatOptions:
        ts.getDefaultFormatCodeSettings(),
      preferences: {},
    };
    const opts: TransformOptions = {
      rewriteInlineImports: false,
      extractThreshold: 5,
      verbose: false,
    };

    const transforms: ReadabilityTransform[] = [
      {
        name: "enabled",
        scope: "changed",
        isEnabled: () => true,
        transformFile: () => {
          order.push("enabled");
          return false;
        },
      },
      {
        name: "disabled",
        scope: "changed",
        isEnabled: () => false,
        transformFile: () => {
          order.push("disabled");
          return false;
        },
      },
    ];

    runTransformPipeline(transforms, ctx, opts);
    expect(order).toEqual(["enabled"]);
  });

  it("adds files to filesChanged when modified", () => {
    const files = new Map([
      ["a.ts", "content-a"],
      ["b.ts", "content-b"],
    ]);
    const ctx: TransformContext = {
      project: makeMockProject(files),
      filesChanged: new Set(["a.ts"]),
      snapshots: new Map(),
      formatOptions:
        ts.getDefaultFormatCodeSettings(),
      preferences: {},
    };
    const opts: TransformOptions = {
      rewriteInlineImports: true,
      extractThreshold: 5,
      verbose: false,
    };

    const transforms: ReadabilityTransform[] = [
      {
        name: "all-scope",
        scope: "all",
        isEnabled: () => true,
        transformFile: (fileName) => {
          if (fileName === "b.ts") {
            ctx.project.updateFile(
              "b.ts",
              "modified"
            );
            return true;
          }
          return false;
        },
      },
    ];

    runTransformPipeline(transforms, ctx, opts);
    expect(ctx.filesChanged.has("b.ts")).toBe(true);
  });

  it("calls finalize after all files processed", () => {
    const order: string[] = [];
    const files = new Map([
      ["a.ts", "content-a"],
      ["b.ts", "content-b"],
    ]);
    const ctx: TransformContext = {
      project: makeMockProject(files),
      filesChanged: new Set(["a.ts", "b.ts"]),
      snapshots: new Map(),
      formatOptions:
        ts.getDefaultFormatCodeSettings(),
      preferences: {},
    };
    const opts: TransformOptions = {
      rewriteInlineImports: true,
      extractThreshold: 5,
      verbose: false,
    };

    const transforms: ReadabilityTransform[] = [
      {
        name: "batch",
        scope: "changed",
        isEnabled: () => true,
        transformFile: (fileName) => {
          order.push("file:" + fileName);
          return false;
        },
        finalize: () => {
          order.push("finalize");
        },
      },
    ];

    runTransformPipeline(transforms, ctx, opts);
    expect(order).toEqual([
      "file:a.ts",
      "file:b.ts",
      "finalize",
    ]);
  });

  it("snapshots files before first transform modification", () => {
    const files = new Map([
      ["a.ts", "original-content"],
    ]);
    const ctx: TransformContext = {
      project: makeMockProject(files),
      filesChanged: new Set(),
      snapshots: new Map(),
      formatOptions:
        ts.getDefaultFormatCodeSettings(),
      preferences: {},
    };
    const opts: TransformOptions = {
      rewriteInlineImports: true,
      extractThreshold: 5,
      verbose: false,
    };

    const transforms: ReadabilityTransform[] = [
      {
        name: "modifier",
        scope: "all",
        isEnabled: () => true,
        transformFile: (fileName, c) => {
          c.project.updateFile(
            fileName,
            "modified"
          );
          return true;
        },
      },
    ];

    runTransformPipeline(transforms, ctx, opts);
    expect(ctx.snapshots.get("a.ts")).toBe(
      "original-content"
    );
    expect(files.get("a.ts")).toBe("modified");
  });
});

// ── stripInnerReturnTypes ─────────────────────────────

describe("stripInnerReturnTypes", () => {
  it("strips codefix-added inner return type", () => {
    const original = [
      "export function outer() {",
      "  const cb = (x: number) => {",
      "    return x * 2;",
      "  };",
      "  return cb;",
      "}",
    ].join("\n");
    const current = [
      "export function outer(): (x: number) => number {",
      "  const cb = (x: number): number => {",
      "    return x * 2;",
      "  };",
      "  return cb;",
      "}",
    ].join("\n");
    const result = stripInnerReturnTypes(
      current,
      original,
      "test.ts"
    );
    // Inner `: number` should be removed
    expect(result).toMatch(
      /const cb = \(x: number\) =>/
    );
    // Outer return type preserved
    expect(result).toMatch(
      /outer\(\):\s*\(x: number\) => number/
    );
  });

  it("preserves hand-written inner return type", () => {
    const original = [
      "export function outer() {",
      "  const cb = (x: number): string => {",
      "    return String(x);",
      "  };",
      "  return cb;",
      "}",
    ].join("\n");
    const current = [
      "export function outer(): (x: number) => string {",
      "  const cb = (x: number): string => {",
      "    return String(x);",
      "  };",
      "  return cb;",
      "}",
    ].join("\n");
    const result = stripInnerReturnTypes(
      current,
      original,
      "test.ts"
    );
    // Inner `: string` was in original — preserved
    expect(result).toMatch(
      /\(x: number\):\s*string\s*=>/
    );
  });

  it("preserves generic inner return type", () => {
    const original = [
      "export function outer() {",
      "  const id = <T>(x: T) => x;",
      "  return id;",
      "}",
    ].join("\n");
    const current = [
      "export function outer(): <T>(x: T) => T {",
      "  const id = <T>(x: T): T => x;",
      "  return id;",
      "}",
    ].join("\n");
    const result = stripInnerReturnTypes(
      current,
      original,
      "test.ts"
    );
    // Generic inner function — preserved
    expect(result).toMatch(/<T>\(x: T\):\s*T\s*=>/);
  });

  it("no-op when no inner functions have types", () => {
    const original = [
      "export function outer() {",
      "  return 42;",
      "}",
    ].join("\n");
    const current = [
      "export function outer(): number {",
      "  return 42;",
      "}",
    ].join("\n");
    const result = stripInnerReturnTypes(
      current,
      original,
      "test.ts"
    );
    expect(result).toBe(current);
  });

  it("no-op when original is undefined", () => {
    const current = [
      "export function outer(): number {",
      "  const cb = (x: number): number => x;",
      "  return cb(1);",
      "}",
    ].join("\n");
    const result = stripInnerReturnTypes(
      current,
      undefined,
      "test.ts"
    );
    expect(result).toBe(current);
  });

  it("preserves directly exported return types", () => {
    const original = [
      "export function direct() {",
      "  return 42;",
      "}",
    ].join("\n");
    const current = [
      "export function direct(): number {",
      "  return 42;",
      "}",
    ].join("\n");
    const result = stripInnerReturnTypes(
      current,
      original,
      "test.ts"
    );
    // direct()'s return type is on the export itself
    expect(result).toMatch(/direct\(\):\s*number/);
  });

  it("does not strip when outer has no return type", () => {
    const original = [
      "export function outer() {",
      "  const cb = (x: number) => x;",
      "  return cb;",
      "}",
    ].join("\n");
    // Simulate: codefix added type to inner but not
    // outer (outer still has no type annotation)
    const current = [
      "export function outer() {",
      "  const cb = (x: number): number => x;",
      "  return cb;",
      "}",
    ].join("\n");
    const result = stripInnerReturnTypes(
      current,
      original,
      "test.ts"
    );
    // Outer has no return type → inner is not in a
    // "typed export" → should NOT be stripped
    expect(result).toMatch(
      /\(x: number\):\s*number\s*=>/
    );
  });
});

// ── simplifyGenericAliases re-serialization ──────────

describe("simplifyGenericAliases re-serialization", () => {
  it("re-serializes verbose annotation via typeToTypeNode", () => {
    const tempDir = resolve(
      tmpdir(),
      "iso-decl-reser-" + randomUUID()
    );
    mkdirSync(tempDir, { recursive: true });

    writeFileSync(
      resolve(tempDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "Node16",
          moduleResolution: "Node16",
          rewriteRelativeImportExtensions: true,
          strict: true,
          isolatedDeclarations: true,
          declaration: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["./*.ts"],
      })
    );

    writeFileSync(
      resolve(tempDir, "types.ts"),
      [
        "export interface BigType {",
        "  a: string;",
        "  b: number;",
        "  c: boolean;",
        "  d: {",
        "    x: string;",
        "    y: number;",
        "    z: boolean;",
        "    w: string;",
        "  };",
        "}",
        "",
        "export declare function make(): BigType;",
      ].join("\n")
    );

    const inputContent = [
      'import { make } from "./types.ts";',
      "",
      "export const result: {" +
        " a: string; b: number; c: boolean;" +
        " d: { x: string; y: number;" +
        " z: boolean; w: string; }; } = make();",
    ].join("\n");

    writeFileSync(
      resolve(tempDir, "input.ts"),
      inputContent
    );

    const project = createProject(
      resolve(tempDir, "tsconfig.json")
    );
    const fileName = resolve(tempDir, "input.ts");

    const ctx: TransformContext = {
      project,
      filesChanged: new Set([fileName]),
      snapshots: new Map(),
      formatOptions:
        ts.getDefaultFormatCodeSettings(),
      preferences: {},
    };

    const result = simplifyGenericAliases(
      fileName,
      ctx
    );
    expect(result).toBe(true);

    const content = project.getFileContent(fileName);
    // Should contain the concise alias
    expect(content).toContain("BigType");
    // Should not contain expanded form
    expect(content).not.toContain(
      "x: string; y: number"
    );
    // Annotation should be short
    const match = content.match(
      /result:\s*(.+?)\s*=/s
    );
    expect(match).toBeTruthy();
    expect(match![1].length).toBeLessThan(30);

    rmSync(tempDir, {
      recursive: true,
      force: true,
    });
  });
});
