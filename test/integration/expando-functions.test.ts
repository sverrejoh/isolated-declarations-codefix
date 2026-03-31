import { describe, expect, it } from "vitest";
import {
  fixFixture,
  getTscErrors,
  writeTempFiles,
} from "../helpers.ts";

describe("expando-functions", () => {
  it("applies fixes", () => {
    const t = fixFixture("expando-functions");
    expect(t.result.totalChanges).toBeGreaterThan(0);
    expect(
      t.result.filesChanged.size
    ).toBeGreaterThan(0);
  });

  it("produces zero isolatedDeclarations errors", () => {
    const t = fixFixture("expando-functions");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const isoErrors = errors.filter((e) =>
      /TS90(?:[0-2]\d|3[5-9])/.test(e)
    );
    expect(isoErrors).toEqual([]);
  });

  it("does not introduce non-iso errors", () => {
    const t = fixFixture("expando-functions");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const nonIsoErrors = errors.filter(
      (e) => !/TS90(?:[0-2]\d|3[5-9])/.test(e)
    );
    expect(nonIsoErrors).toEqual([]);
  });

  it("uses namespace for function-typed props", () => {
    const t = fixFixture("expando-functions");
    const f = [...t.result.filesChanged].find((p) =>
      p.endsWith("input.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);

    // router.get/post should be in a non-declare
    // namespace (function values cause TS2300 with
    // declare namespace).
    expect(content).toContain("namespace router");
    expect(content).not.toContain("router.get =");
    expect(content).not.toContain("router.post =");
  });

  it("uses const in namespace (OXC compat)", () => {
    const t = fixFixture("expando-functions");
    const f = [...t.result.filesChanged].find((p) =>
      p.endsWith("input.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);

    // OXC rejects export var in namespace
    expect(content).toContain("export const get");
    expect(content).toContain("export const post");
  });

  it("widens literal types", () => {
    const t = fixFixture("expando-functions");
    const f = [...t.result.filesChanged].find((p) =>
      p.endsWith("input.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);

    // Type should be "string" not '"hook"'
    expect(content).toContain(
      "displayName: string"
    );
    expect(content).not.toContain(
      'displayName: "hook"'
    );
  });

  it("handles hoisted assignment before function", () => {
    const t = fixFixture("expando-functions");
    const f = [...t.result.filesChanged].find((p) =>
      p.endsWith("input.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);

    // The assignment `hoisted.tag = "hoisted"`
    // should be deleted.
    expect(content).not.toContain(
      'hoisted.tag = "hoisted"'
    );
    // Namespace should be after function declaration
    const funcIdx = content.indexOf(
      "function hoisted()"
    );
    const nsIdx = content.indexOf(
      "namespace hoisted"
    );
    expect(funcIdx).toBeGreaterThan(-1);
    expect(nsIdx).toBeGreaterThan(funcIdx);
  });

  it("removes stale declare namespaces", () => {
    const t = fixFixture("expando-functions");
    const f = [...t.result.filesChanged].find((p) =>
      p.endsWith("input.ts")
    );
    expect(f).toBeDefined();
    const content = t.project.getFileContent(f!);

    // Built-in fixer loops and creates duplicate
    // declare namespace blocks for the hoisted
    // case. Our fixer should remove them.
    const declareNsCount = (
      content.match(
        /declare namespace hoisted/g
      ) ?? []
    ).length;
    expect(declareNsCount).toBe(0);
  });
});
