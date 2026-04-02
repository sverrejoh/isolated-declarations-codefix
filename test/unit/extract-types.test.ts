import { describe, it, expect } from "vitest";
import {
  analyzeExtractions,
  applyExtractions,
  normalizeTypeLiteral,
  analyzeExtractionsWithMetadata,
  planCrossFileExtractions,
  applyCrossFileExtractions,
  computeRelativeImportPath,
} from "../../src/extract-types.ts";
import type { FileAnalysis } from "../../src/extract-types.ts";

describe("analyzeExtractions", () => {
  it("finds type literals with >5 members", () => {
    const source = `export const x: { a: string; b: string; c: string; d: string; e: string; f: string } = getX();`;
    const result = analyzeExtractions(source, "test.ts");
    expect(result.extractions.length).toBe(1);
    expect(result.extractions[0].name).toBe("XType");
  });

  it("skips type literals with <=5 members", () => {
    const source = `export const x: { a: string; b: string; c: string } = getX();`;
    const result = analyzeExtractions(source, "test.ts");
    expect(result.extractions.length).toBe(0);
  });

  it("respects custom threshold (threshold=3)", () => {
    const source = `export const x: { a: string; b: string; c: string; d: string } = getX();`;
    const result = analyzeExtractions(source, "test.ts", 3);
    expect(result.extractions.length).toBe(1);
  });

  it("does not extract when members equal threshold", () => {
    const source = `export const x: { a: string; b: string; c: string } = getX();`;
    const result = analyzeExtractions(source, "test.ts", 3);
    expect(result.extractions.length).toBe(0);
  });

  it("names variables as PascalCase + Type", () => {
    const source = `export const myConfig: { a: string; b: string; c: string; d: string; e: string; f: string } = getX();`;
    const result = analyzeExtractions(source, "test.ts");
    expect(result.extractions[0].name).toBe("MyConfigType");
  });

  it("names function returns as PascalCase + Type", () => {
    const source = `export function createUser(): { a: string; b: string; c: string; d: string; e: string; f: string } { return {} as any; }`;
    const result = analyzeExtractions(source, "test.ts");
    expect(result.extractions[0].name).toBe("CreateUserType");
  });

  it("names arrow function returns from variable name", () => {
    const source = `export const getSettings: () => { a: string; b: string; c: string; d: string; e: string; f: string } = () => ({} as any);`;
    const result = analyzeExtractions(source, "test.ts");
    expect(result.extractions[0].name).toBe("GetSettingsType");
  });

  it("names parameter types from parameter name", () => {
    const source = `export function foo(options: { a: string; b: string; c: string; d: string; e: string; f: string }): void {}`;
    const result = analyzeExtractions(source, "test.ts");
    expect(result.extractions[0].name).toBe("OptionsType");
  });

  it("deduplicates names with numeric suffix", () => {
    const source = [
      `interface XType {}`,
      `export const x: { a: string; b: string; c: string; d: string; e: string; f: string } = getX();`,
    ].join("\n");
    const result = analyzeExtractions(source, "test.ts");
    expect(result.extractions[0].name).toBe("XType2");
  });

  it("handles multiple extractions in one file", () => {
    const source = [
      `export const a: { a1: string; a2: string; a3: string; a4: string; a5: string; a6: string } = getA();`,
      `export const b: { b1: string; b2: string; b3: string; b4: string; b5: string; b6: string } = getB();`,
    ].join("\n");
    const result = analyzeExtractions(source, "test.ts");
    expect(result.extractions.length).toBe(2);
    expect(result.extractions[0].name).toBe("AType");
    expect(result.extractions[1].name).toBe("BType");
  });

  it("skips type literals nested in other type literals", () => {
    const source = `export const x: { a: string; b: string; c: string; d: string; e: string; inner: { x: number; y: number; z: number; w: number; a: number; b: number } } = getX();`;
    const result = analyzeExtractions(source, "test.ts");
    // Only the outer type literal should be extracted, not the inner one
    expect(result.extractions.length).toBe(1);
    expect(result.extractions[0].name).toBe("XType");
  });
});

describe("applyExtractions", () => {
  it("replaces inline types and inserts type aliases", () => {
    const source = `export const config: { a: string; b: string; c: string; d: string; e: string; f: string } = getConfig();`;
    const result = analyzeExtractions(source, "test.ts");
    const output = applyExtractions(source, result);
    expect(output).toContain("type ConfigType = {");
    expect(output).toContain("export const config: ConfigType = getConfig();");
  });

  it("returns source unchanged when no extractions", () => {
    const source = `export const x: { a: string } = getX();`;
    const result = analyzeExtractions(source, "test.ts");
    const output = applyExtractions(source, result);
    expect(output).toBe(source);
  });

  it("inserts type aliases after imports", () => {
    const source = [
      `import { foo } from "./foo";`,
      `export const config: { a: string; b: string; c: string; d: string; e: string; f: string } = getConfig();`,
    ].join("\n");
    const result = analyzeExtractions(source, "test.ts");
    const output = applyExtractions(source, result);
    const lines = output.split("\n");
    // First line should be import, then blank line, then type alias, then export
    expect(lines[0]).toContain("import");
    expect(lines[1]).toBe("");
    expect(lines[2]).toContain("type ConfigType =");
    expect(lines[3]).toContain("export const config: ConfigType");
  });

  it("handles multiple extractions correctly", () => {
    const source = [
      `export const a: { a1: string; a2: string; a3: string; a4: string; a5: string; a6: string } = getA();`,
      `export const b: { b1: string; b2: string; b3: string; b4: string; b5: string; b6: string } = getB();`,
    ].join("\n");
    const result = analyzeExtractions(source, "test.ts");
    const output = applyExtractions(source, result);
    expect(output).toContain("type AType =");
    expect(output).toContain("type BType =");
    expect(output).toContain("export const a: AType");
    expect(output).toContain("export const b: BType");
  });
});

// ─── Cross-file deduplication unit tests ────────────────────────

describe("normalizeTypeLiteral", () => {
  it("produces same key for different whitespace", () => {
    const a = normalizeTypeLiteral(
      "{ a: string; b: number; c: boolean; d: string; e: number; f: boolean }",
    );
    const b = normalizeTypeLiteral(
      "{  a:string ;  b:number ;  c:boolean ;  d:string ;  e:number ;  f:boolean }",
    );
    expect(a).toBe(b);
  });

  it("produces same key for different member order", () => {
    const a = normalizeTypeLiteral(
      "{ a: string; b: number; c: boolean; d: string; e: number; f: boolean }",
    );
    const b = normalizeTypeLiteral(
      "{ f: boolean; e: number; d: string; c: boolean; b: number; a: string }",
    );
    expect(a).toBe(b);
  });

  it("produces different keys for different types", () => {
    const a = normalizeTypeLiteral(
      "{ a: string; b: number; c: boolean; d: string; e: number; f: boolean }",
    );
    const b = normalizeTypeLiteral(
      "{ x: string; y: number; z: boolean; w: string; v: number; u: boolean }",
    );
    expect(a).not.toBe(b);
  });
});

describe("planCrossFileExtractions", () => {
  const sixMemberType =
    "{ host: string; port: number; debug: boolean; timeout: number; retries: number; logLevel: string }";

  it("groups identical types across files", () => {
    const sourceAnalysis = analyzeExtractionsWithMetadata(
      `export function createConfig(): ${sixMemberType} { return {} as any; }`,
      "/src/source.ts",
    );
    const consumerAnalysis = analyzeExtractionsWithMetadata(
      `import { createConfig } from "./source.ts";\nexport const config: ${sixMemberType} = createConfig();`,
      "/src/consumer.ts",
    );
    const analyses = new Map<string, FileAnalysis>([
      ["/src/source.ts", sourceAnalysis],
      ["/src/consumer.ts", consumerAnalysis],
    ]);
    const plan = planCrossFileExtractions(analyses);

    const sourceAction = plan.actions.get("/src/source.ts")!;
    const consumerAction = plan.actions.get("/src/consumer.ts")!;

    expect(sourceAction.exportedExtractions.length).toBe(1);
    expect(consumerAction.importedExtractions.length).toBe(1);
    expect(consumerAction.importedExtractions[0].sourceFileName).toBe(
      "/src/source.ts",
    );
  });

  it("keeps unique types as local extractions", () => {
    const analysis = analyzeExtractionsWithMetadata(
      `export function getMetrics(): ${sixMemberType} { return {} as any; }`,
      "/src/local.ts",
    );
    const analyses = new Map<string, FileAnalysis>([
      ["/src/local.ts", analysis],
    ]);
    const plan = planCrossFileExtractions(analyses);

    const action = plan.actions.get("/src/local.ts")!;
    expect(action.localExtractions.length).toBe(1);
    expect(action.exportedExtractions.length).toBe(0);
    expect(action.importedExtractions.length).toBe(0);
  });

  it("prefers function-return over variable for canonical source", () => {
    const funcAnalysis = analyzeExtractionsWithMetadata(
      `export function create(): ${sixMemberType} { return {} as any; }`,
      "/src/func.ts",
    );
    const varAnalysis = analyzeExtractionsWithMetadata(
      `export const val: ${sixMemberType} = {} as any;`,
      "/src/var.ts",
    );
    const analyses = new Map<string, FileAnalysis>([
      ["/src/func.ts", funcAnalysis],
      ["/src/var.ts", varAnalysis],
    ]);
    const plan = planCrossFileExtractions(analyses);

    // func.ts should be canonical (function-return > variable)
    const funcAction = plan.actions.get("/src/func.ts")!;
    const varAction = plan.actions.get("/src/var.ts")!;
    expect(funcAction.exportedExtractions.length).toBe(1);
    expect(varAction.importedExtractions.length).toBe(1);
    expect(varAction.importedExtractions[0].sourceFileName).toBe(
      "/src/func.ts",
    );
  });
});

describe("applyCrossFileExtractions", () => {
  it("inserts export type for canonical source", () => {
    const source = `export function createConfig(): { host: string; port: number; debug: boolean; timeout: number; retries: number; logLevel: string } { return {} as any; }`;
    const analysis = analyzeExtractionsWithMetadata(
      source,
      "/src/source.ts",
    );
    const ext = analysis.extractions[0];
    const output = applyCrossFileExtractions(source, "/src/source.ts", {
      localExtractions: [],
      exportedExtractions: [
        {
          name: ext.name,
          literalText: ext.literalText,
          start: ext.start,
          end: ext.end,
        },
      ],
      importedExtractions: [],
      insertPos: analysis.insertPos,
    });
    expect(output).toContain("export type CreateConfigType = {");
    expect(output).toContain(
      "export function createConfig(): CreateConfigType",
    );
  });

  it("adds import type for consumer files", () => {
    const source = `import { createConfig } from "./source.ts";\nexport const config: { host: string; port: number; debug: boolean; timeout: number; retries: number; logLevel: string } = createConfig();`;
    const analysis = analyzeExtractionsWithMetadata(
      source,
      "/src/consumer.ts",
    );
    const ext = analysis.extractions[0];
    const output = applyCrossFileExtractions(
      source,
      "/src/consumer.ts",
      {
        localExtractions: [],
        exportedExtractions: [],
        importedExtractions: [
          {
            name: "CreateConfigType",
            sourceFileName: "/src/source.ts",
            start: ext.start,
            end: ext.end,
          },
        ],
        insertPos: analysis.insertPos,
      },
    );
    expect(output).toContain("CreateConfigType");
    expect(output).toContain(
      "export const config: CreateConfigType = createConfig();",
    );
  });

  it("merges type import into existing named import", () => {
    const source = `import { createConfig } from "./source.ts";\nexport const config: { host: string; port: number; debug: boolean; timeout: number; retries: number; logLevel: string } = createConfig();`;
    const analysis = analyzeExtractionsWithMetadata(
      source,
      "/src/consumer.ts",
    );
    const ext = analysis.extractions[0];
    const output = applyCrossFileExtractions(
      source,
      "/src/consumer.ts",
      {
        localExtractions: [],
        exportedExtractions: [],
        importedExtractions: [
          {
            name: "CreateConfigType",
            sourceFileName: "/src/source.ts",
            start: ext.start,
            end: ext.end,
          },
        ],
        insertPos: analysis.insertPos,
      },
    );
    // Should merge into existing import
    expect(output).toContain(
      "import { createConfig, type CreateConfigType } from",
    );
    // Should NOT have a separate import type line
    expect(output).not.toMatch(/^import type/m);
  });
});

describe("computeRelativeImportPath", () => {
  it("produces ./ for same directory", () => {
    expect(
      computeRelativeImportPath("/src/consumer.ts", "/src/source.ts"),
    ).toBe("./source.ts");
  });

  it("produces ../ for parent directory", () => {
    expect(
      computeRelativeImportPath(
        "/src/sub/consumer.ts",
        "/src/source.ts",
      ),
    ).toBe("../source.ts");
  });

  it("produces nested path for deeper directory", () => {
    expect(
      computeRelativeImportPath(
        "/src/consumer.ts",
        "/src/lib/source.ts",
      ),
    ).toBe("./lib/source.ts");
  });
});
