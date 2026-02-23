import { describe, it, expect } from "vitest";
import {
  fixFixture,
  writeTempFiles,
  getTscErrors,
} from "../helpers.ts";

describe("hoc-collapse", () => {
  it("applies fixes", () => {
    const t = fixFixture("hoc-collapse", {
      extractThreshold: 999,
    });
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(t.result.filesChanged.size).toBeGreaterThan(
      0,
    );
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("hoc-collapse", {
      extractThreshold: 999,
    });
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter((e) =>
      /TS90(?:[0-2]\d|3[5-9])/.test(e),
    );
    expect(isoErrors).toEqual([]);
  });

  it("produces zero other TS errors", () => {
    const t = fixFixture("hoc-collapse", {
      extractThreshold: 999,
    });
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    expect(errors).toEqual([]);
  });

  it("collapses verbose annotation to use named types", () => {
    const t = fixFixture("hoc-collapse", {
      extractThreshold: 999,
    });
    const wrapped = [...t.result.filesChanged].find(
      (f) => f.endsWith("wrapped.ts"),
    )!;
    const content = t.project.getFileContent(wrapped);
    // The verbose 400+ char structural annotation on
    // WrappedA should be replaced with the compact form
    // referencing ComponentProps & CardFrameContext.
    expect(content).toContain("ComponentProps");
    expect(content).toContain("CardFrameContext");
    expect(content).not.toMatch(
      /WrappedA:.*\{[\s\S]*primary: string/,
    );
  });

  it("annotation is shorter than raw expansion", () => {
    const t = fixFixture("hoc-collapse", {
      extractThreshold: 999,
    });
    const wrapped = [...t.result.filesChanged].find(
      (f) => f.endsWith("wrapped.ts"),
    )!;
    const content = t.project.getFileContent(wrapped);
    // Extract annotation for WrappedA
    const match = content.match(
      /WrappedA: (.+?) =/s,
    );
    expect(match).toBeTruthy();
    // Should be well under 200 chars
    expect(match![1].length).toBeLessThan(200);
  });
});
