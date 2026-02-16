import { describe, it, expect } from "vitest";
import {
  fixFixture,
  writeTempFiles,
  getTscErrors,
} from "../helpers.ts";

describe("extract-types", () => {
  it("applies fixes", () => {
    const t = fixFixture("extract-types");
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(t.result.filesChanged.size).toBeGreaterThan(0);
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("extract-types");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter(
      (e) => /TS90[0-2]\d/.test(e),
    );
    expect(isoErrors).toEqual([]);
  });

  it("produces zero other TS errors", () => {
    const t = fixFixture("extract-types");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    expect(errors).toEqual([]);
  });

  it("extracts large inline types to interfaces", () => {
    const t = fixFixture("extract-types");
    const content = t.project.getFileContent(
      [...t.result.filesChanged][0],
    );
    // Should have interface declarations for large types
    expect(content).toContain("interface ConfigInterface");
    expect(content).toContain("interface CreateUserInterface");
    expect(content).toContain("interface GetUserInterface");
    expect(content).toContain("interface BuildResponseInterface");
    // Inline types should be replaced with interface names
    expect(content).toMatch(/export const config: ConfigInterface/);
  });

  it("does not extract small types", () => {
    const t = fixFixture("extract-types");
    const content = t.project.getFileContent(
      [...t.result.filesChanged][0],
    );
    // getPoint returns { x: number; y: number; z: number } — only 3 members
    // Should NOT have a GetPointInterface
    expect(content).not.toContain("GetPointInterface");
    // The inline type should remain
    expect(content).toMatch(/getPoint\(\).*\{/);
  });
});
