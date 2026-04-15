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
 * Returns the root call expression in a call chain.
 * For `jest.fn().mockReturnValue(x)`, returns the
 * `jest.fn()` call node.
 */
function getRootCall(node: ts.Expression): ts.CallExpression | undefined {
  // Strip type assertions
  while (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
    node = node.expression;
  }
  if (ts.isCallExpression(node)) {
    // If the callee is itself a call expression chain,
    // recurse to find the root.
    const expr = node.expression;
    if (ts.isPropertyAccessExpression(expr)) {
      const root = getRootCall(expr.expression);
      if (root) return root;
    }
    return node;
  }
  return undefined;
}

/**
 * Checks whether a call expression is `jest.fn(...)`.
 */
function isJestFnCall(node: ts.CallExpression): boolean {
  const expr = node.expression;
  if (!ts.isPropertyAccessExpression(expr)) return false;
  const obj = expr.expression;
  const method = expr.name.text;
  if (method !== "fn") return false;
  return ts.isIdentifier(obj) && obj.text === "jest";
}

/**
 * Add `: jest.Mock<any, any[]>` type annotations to
 * exported const declarations whose initializer is a
 * `jest.fn()` call chain and that currently have no
 * type annotation.
 *
 * Handles patterns like:
 *   export const spy = jest.fn()
 *   export const spy = jest.fn().mockReturnValue(...)
 *   export const spy = jest.fn().mockResolvedValue(...)
 */
export function rewriteJestMocks(content: string, fileName: string): string {
  const src = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true
  );

  const replacements: TextReplacement[] = [];

  for (const stmt of src.statements) {
    if (!ts.isVariableStatement(stmt)) continue;

    // Must be exported
    const mods = ts.getModifiers(stmt);
    const isExported = mods?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword
    );
    if (!isExported) continue;

    for (const decl of stmt.declarationList.declarations) {
      // Skip if already has a type annotation
      if (decl.type) continue;

      const init = decl.initializer;
      if (!init) continue;

      // Walk the call chain to find the root call
      const root = getRootCall(init);
      if (!root || !isJestFnCall(root)) continue;

      // Insert `: jest.Mock<any, any[]>` after the binding name
      const nameEnd = decl.name.getEnd();
      replacements.push({
        start: nameEnd,
        end: nameEnd,
        text: ": jest.Mock<any, any[]>",
      });
    }
  }

  return applyReplacements(content, replacements);
}

export const jestMockTransform: ReadabilityTransform = {
  name: "jest-mock",
  scope: "changed",
  isEnabled(options: TransformOptions) {
    return options.jestMock;
  },
  transformFile(fileName: string, ctx: TransformContext): boolean {
    // Only apply to test/mock files
    if (
      !fileName.includes(".mock.") &&
      !fileName.includes(".spec.") &&
      !fileName.includes(".test.") &&
      !fileName.includes("__mocks__")
    ) {
      return false;
    }
    const content = ctx.project.getFileContent(fileName);
    const rewritten = rewriteJestMocks(content, fileName);
    if (rewritten !== content) {
      ctx.project.updateFile(fileName, rewritten);
      return true;
    }
    return false;
  },
};
