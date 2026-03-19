import ts from "typescript";
import {
  applyReplacements,
  type TextReplacement,
} from "../utils/replacements.ts";
import type {
  ReadabilityTransform,
  TransformContext,
  TransformOptions,
} from "./types.ts";

/**
 * Replace empty `{}` type literals with `object`
 * to satisfy @typescript-eslint/ban-types.
 */
export function rewriteBanTypes(
  content: string,
  fileName: string
): string {
  const src = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true
  );

  const replacements: TextReplacement[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isTypeLiteralNode(node) &&
      node.members.length === 0
    ) {
      replacements.push({
        start: node.getStart(src),
        end: node.getEnd(),
        text: "object",
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(src);

  return applyReplacements(content, replacements);
}

export const banTypesTransform: ReadabilityTransform = {
  name: "ban-types",
  scope: "changed",
  isEnabled(options: TransformOptions) {
    return options.banTypes;
  },
  transformFile(
    fileName: string,
    ctx: TransformContext
  ): boolean {
    const content =
      ctx.project.getFileContent(fileName);
    const rewritten = rewriteBanTypes(
      content,
      fileName
    );
    if (rewritten !== content) {
      ctx.project.updateFile(fileName, rewritten);
      return true;
    }
    return false;
  },
};
