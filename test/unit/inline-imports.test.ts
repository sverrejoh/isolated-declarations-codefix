import { describe, expect, it } from "vitest";
import { rewriteInlineImportTypes } from "../../src/transforms/inline-imports.ts";

describe("rewriteInlineImportTypes", () => {
  it("converts absolute paths to relative imports", () => {
    const fileName = "/project/src/components/Foo.ts";
    const content = [
      'import { bar } from "./bar";',
      "export const x: import(" +
        '"/project/src/utils/helpers"' +
        ").Helper = bar();",
    ].join("\n");

    const result = rewriteInlineImportTypes(
      content,
      fileName
    );

    expect(result).not.toContain("/project/src/");
    expect(result).toContain("../utils/helpers");
    expect(result).toMatch(
      /import type \* as .+ from "\.\.\/utils\/helpers"/
    );
  });

  it("strips .ts/.tsx extensions from absolute paths", () => {
    const fileName = "/project/src/index.ts";
    const content =
      "export const x: import(" +
      '"/project/src/types.tsx"' +
      ").Foo = 1 as any;";

    const result = rewriteInlineImportTypes(
      content,
      fileName
    );

    expect(result).not.toContain(".tsx");
    expect(result).toContain("./types");
  });

  it("preserves relative specifiers unchanged", () => {
    const fileName = "/project/src/index.ts";
    const content =
      "export const x: import(" +
      '"./utils/helpers"' +
      ").Helper = 1 as any;";

    const result = rewriteInlineImportTypes(
      content,
      fileName
    );

    expect(result).toContain("./utils/helpers");
  });
});
