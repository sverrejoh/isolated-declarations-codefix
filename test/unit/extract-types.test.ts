import { describe, it, expect } from "vitest";
import {
  analyzeExtractions,
  applyExtractions,
} from "../../src/extract-types.ts";

describe("analyzeExtractions", () => {
  it("finds type literals with >5 members", () => {
    const source = `export const x: { a: string; b: string; c: string; d: string; e: string; f: string } = getX();`;
    const result = analyzeExtractions(source, "test.ts");
    expect(result.extractions.length).toBe(1);
    expect(result.extractions[0].name).toBe("XInterface");
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

  it("names variables as PascalCase + Interface", () => {
    const source = `export const myConfig: { a: string; b: string; c: string; d: string; e: string; f: string } = getX();`;
    const result = analyzeExtractions(source, "test.ts");
    expect(result.extractions[0].name).toBe("MyConfigInterface");
  });

  it("names function returns as PascalCase + Interface", () => {
    const source = `export function createUser(): { a: string; b: string; c: string; d: string; e: string; f: string } { return {} as any; }`;
    const result = analyzeExtractions(source, "test.ts");
    expect(result.extractions[0].name).toBe("CreateUserInterface");
  });

  it("names arrow function returns from variable name", () => {
    const source = `export const getSettings: () => { a: string; b: string; c: string; d: string; e: string; f: string } = () => ({} as any);`;
    const result = analyzeExtractions(source, "test.ts");
    expect(result.extractions[0].name).toBe("GetSettingsInterface");
  });

  it("names parameter types from parameter name", () => {
    const source = `export function foo(options: { a: string; b: string; c: string; d: string; e: string; f: string }): void {}`;
    const result = analyzeExtractions(source, "test.ts");
    expect(result.extractions[0].name).toBe("OptionsInterface");
  });

  it("deduplicates names with numeric suffix", () => {
    const source = [
      `interface XInterface {}`,
      `export const x: { a: string; b: string; c: string; d: string; e: string; f: string } = getX();`,
    ].join("\n");
    const result = analyzeExtractions(source, "test.ts");
    expect(result.extractions[0].name).toBe("XInterface2");
  });

  it("handles multiple extractions in one file", () => {
    const source = [
      `export const a: { a1: string; a2: string; a3: string; a4: string; a5: string; a6: string } = getA();`,
      `export const b: { b1: string; b2: string; b3: string; b4: string; b5: string; b6: string } = getB();`,
    ].join("\n");
    const result = analyzeExtractions(source, "test.ts");
    expect(result.extractions.length).toBe(2);
    expect(result.extractions[0].name).toBe("AInterface");
    expect(result.extractions[1].name).toBe("BInterface");
  });

  it("skips type literals nested in other type literals", () => {
    const source = `export const x: { a: string; b: string; c: string; d: string; e: string; inner: { x: number; y: number; z: number; w: number; a: number; b: number } } = getX();`;
    const result = analyzeExtractions(source, "test.ts");
    // Only the outer type literal should be extracted, not the inner one
    expect(result.extractions.length).toBe(1);
    expect(result.extractions[0].name).toBe("XInterface");
  });
});

describe("applyExtractions", () => {
  it("replaces inline types and inserts interfaces", () => {
    const source = `export const config: { a: string; b: string; c: string; d: string; e: string; f: string } = getConfig();`;
    const result = analyzeExtractions(source, "test.ts");
    const output = applyExtractions(source, result);
    expect(output).toContain("interface ConfigInterface {");
    expect(output).toContain("export const config: ConfigInterface = getConfig();");
  });

  it("returns source unchanged when no extractions", () => {
    const source = `export const x: { a: string } = getX();`;
    const result = analyzeExtractions(source, "test.ts");
    const output = applyExtractions(source, result);
    expect(output).toBe(source);
  });

  it("inserts interfaces after imports", () => {
    const source = [
      `import { foo } from "./foo";`,
      `export const config: { a: string; b: string; c: string; d: string; e: string; f: string } = getConfig();`,
    ].join("\n");
    const result = analyzeExtractions(source, "test.ts");
    const output = applyExtractions(source, result);
    const lines = output.split("\n");
    // First line should be import, then interface, then export
    expect(lines[0]).toContain("import");
    expect(lines[1]).toContain("interface ConfigInterface");
    expect(lines[2]).toContain("export const config: ConfigInterface");
  });

  it("handles multiple extractions correctly", () => {
    const source = [
      `export const a: { a1: string; a2: string; a3: string; a4: string; a5: string; a6: string } = getA();`,
      `export const b: { b1: string; b2: string; b3: string; b4: string; b5: string; b6: string } = getB();`,
    ].join("\n");
    const result = analyzeExtractions(source, "test.ts");
    const output = applyExtractions(source, result);
    expect(output).toContain("interface AInterface");
    expect(output).toContain("interface BInterface");
    expect(output).toContain("export const a: AInterface");
    expect(output).toContain("export const b: BInterface");
  });
});
