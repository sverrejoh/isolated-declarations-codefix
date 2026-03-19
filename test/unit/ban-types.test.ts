import { describe, expect, it } from "vitest";
import { rewriteBanTypes } from "../../src/transforms/ban-types.ts";

describe("rewriteBanTypes", () => {
  it("replaces {} type annotation with object", () => {
    const input =
      "export const x: {} = {};";
    const result = rewriteBanTypes(input, "test.ts");
    expect(result).toBe(
      "export const x: object = {};"
    );
  });

  it("replaces {} in parameter type", () => {
    const input =
      "export function foo(x: {}): void {}";
    const result = rewriteBanTypes(input, "test.ts");
    expect(result).toBe(
      "export function foo(x: object): void {}"
    );
  });

  it("replaces {} in union type", () => {
    const input =
      "export const x: {} | string = {};";
    const result = rewriteBanTypes(input, "test.ts");
    expect(result).toBe(
      "export const x: object | string = {};"
    );
  });

  it("does not touch non-empty type literals", () => {
    const input =
      "export const x: { a: number } = { a: 1 };";
    const result = rewriteBanTypes(input, "test.ts");
    expect(result).toBe(input);
  });

  it("does not touch object literal values", () => {
    const input = "export const x: object = {};";
    const result = rewriteBanTypes(input, "test.ts");
    expect(result).toBe(input);
  });

  it("replaces multiple occurrences", () => {
    const input = [
      "export const a: {} = {};",
      "export const b: {} = {};",
    ].join("\n");
    const result = rewriteBanTypes(input, "test.ts");
    expect(result).not.toContain(": {}");
    expect(result).toContain("a: object");
    expect(result).toContain("b: object");
  });

  it("handles {} in generic constraints", () => {
    const input =
      "export function foo<T extends {}>(): T" +
      " { return {} as T; }";
    const result = rewriteBanTypes(input, "test.ts");
    expect(result).toContain("extends object");
    expect(result).not.toMatch(/extends \{\}/);
  });
});
