import ts from "typescript";
import {
  applyReplacements,
  type TextReplacement,
} from "../utils/replacements.ts";
import {
  getNonIsoErrorCount,
} from "../utils/diagnostics.ts";
import type {
  ReadabilityTransform,
  TransformContext,
  TransformOptions,
} from "./types.ts";

/**
 * Build a "function identity key" for matching
 * functions between original and current AST.
 * Key = ancestor names joined by `.` + `(params)`.
 */
function computeFunctionKey(
  node: ts.Node,
  sf: ts.SourceFile
): string {
  const parts: string[] = [];
  let cur = node.parent;

  while (cur && !ts.isSourceFile(cur)) {
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) {
      parts.unshift(cur.name.text);
    } else if (ts.isFunctionDeclaration(cur) && cur.name) {
      parts.unshift(cur.name.text);
    } else if (
      ts.isPropertyAssignment(cur) && ts.isIdentifier(cur.name)
    ) {
      parts.unshift(cur.name.text);
    } else if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) {
      parts.unshift(cur.name.text);
    } else if (ts.isClassDeclaration(cur) && cur.name) {
      parts.unshift(cur.name.text);
    } else if (
      ts.isCallExpression(cur) &&
      node.parent === cur
    ) {
      // Anonymous callback arg: callName[argIdx]
      const callName = cur.expression.getText(sf);
      const argIdx = cur.arguments.indexOf(
        node as ts.Expression
      );
      if (argIdx >= 0) {
        parts.unshift(`${callName}[${argIdx}]`);
      }
    }
    cur = cur.parent;
  }

  // Append parameter names
  let params = "";
  if (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  ) {
    const fn = node as
      | ts.ArrowFunction
      | ts.FunctionExpression
      | ts.FunctionDeclaration
      | ts.MethodDeclaration;
    params =
      "(" +
      fn.parameters
        .map((p) => p.name.getText(sf))
        .join(",") +
      ")";
  }

  return parts.join(".") + params;
}

/**
 * Check if a node is directly exported. True when:
 * - node IS a FunctionDeclaration with export keyword
 * - node is the initializer of `export const x = <node>`
 * - node is the expression of `export default <node>`
 */
function isDirectlyExported(node: ts.Node): boolean {
  // FunctionDeclaration: export function foo() {}
  if (
    ts.isFunctionDeclaration(node) &&
    ts.isSourceFile(node.parent)
  ) {
    return (
      node.modifiers?.some(
        (m) =>
          m.kind === ts.SyntaxKind.ExportKeyword
      ) ?? false
    );
  }

  // Arrow/FunctionExpr in VariableDeclaration:
  // export const foo = () => {}
  if (
    node.parent &&
    ts.isVariableDeclaration(node.parent) &&
    node.parent.initializer === node
  ) {
    const declList = node.parent.parent;
    if (
      declList &&
      ts.isVariableDeclarationList(declList)
    ) {
      const stmt = declList.parent;
      if (
        stmt &&
        ts.isVariableStatement(stmt) &&
        ts.isSourceFile(stmt.parent)
      ) {
        return (
          stmt.modifiers?.some(
            (m) =>
              m.kind ===
              ts.SyntaxKind.ExportKeyword
          ) ?? false
        );
      }
    }
  }

  // export default <node>
  if (
    node.parent &&
    ts.isExportAssignment(node.parent) &&
    node.parent.expression === node
  ) {
    return true;
  }

  return false;
}

/**
 * Check if a node is nested inside an exported
 * function that has a return type annotation.
 */
function isNestedInTypedExport(
  node: ts.Node,
  _sf: ts.SourceFile
): boolean {
  let cur = node.parent;
  while (cur && !ts.isSourceFile(cur)) {
    if (
      (ts.isArrowFunction(cur) ||
        ts.isFunctionExpression(cur) ||
        ts.isFunctionDeclaration(cur) ||
        ts.isMethodDeclaration(cur)) &&
      cur.type
    ) {
      if (isDirectlyExported(cur)) return true;
    }
    cur = cur.parent;
  }
  return false;
}

type FunctionLike =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.MethodDeclaration;

/**
 * Compute the range to remove for a return type
 * annotation: from after `)` to end of type node.
 */
function getReturnTypeRemovalRange(
  fn: FunctionLike,
  sf: ts.SourceFile,
  content: string
): { start: number; end: number } | undefined {
  if (!fn.type) return undefined;

  const typeStart = fn.type.getStart(sf);
  const typeEnd = fn.type.getEnd();

  // Search backward from type start to find `:`
  let colonPos = typeStart - 1;
  while (
    colonPos >= 0 &&
    content[colonPos] !== ":"
  ) {
    colonPos--;
  }
  if (colonPos < 0) return undefined;

  // Search backward from `:` to find `)`
  let closeParenPos = colonPos - 1;
  while (
    closeParenPos >= 0 &&
    /\s/.test(content[closeParenPos])
  ) {
    closeParenPos--;
  }
  if (content[closeParenPos] !== ")") {
    return undefined;
  }

  return {
    start: closeParenPos + 1,
    end: typeEnd,
  };
}

/**
 * Strip redundant inner callback return types that
 * were added by the codefix. Returns modified content,
 * or the original if no changes.
 *
 * @param content - Current file content (after codefix)
 * @param original - Original file content before codefix
 *   (undefined means no snapshot → skip)
 * @param fileName - File name for TS parsing
 */
export function stripInnerReturnTypes(
  content: string,
  original: string | undefined,
  fileName: string
): string {
  if (original === undefined) return content;

  // Parse original AST and build set of function
  // keys that already had return type annotations.
  const origSf = ts.createSourceFile(
    fileName,
    original,
    ts.ScriptTarget.Latest,
    true
  );
  const originalKeys = new Set<string>();

  function collectOriginal(node: ts.Node): void {
    if (
      (ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node)) &&
      node.type
    ) {
      originalKeys.add(
        computeFunctionKey(node, origSf)
      );
    }
    ts.forEachChild(node, collectOriginal);
  }
  collectOriginal(origSf);

  // Parse current AST and find candidates.
  const curSf = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true
  );
  const replacements: TextReplacement[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node)) &&
      node.type
    ) {
      const fn = node as FunctionLike;

      // Skip if directly exported
      if (!isDirectlyExported(fn)) {
        // Must be nested in a typed export
        if (isNestedInTypedExport(fn, curSf)) {
          // Must not be in original
          const key = computeFunctionKey(
            fn,
            curSf
          );
          if (!originalKeys.has(key)) {
            // Skip generic functions
            if (
              !fn.typeParameters?.length
            ) {
              const range =
                getReturnTypeRemovalRange(
                  fn,
                  curSf,
                  content
                );
              if (range) {
                replacements.push({
                  start: range.start,
                  end: range.end,
                  text: "",
                });
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(curSf);

  if (replacements.length === 0) return content;
  return applyReplacements(content, replacements);
}

export const stripInnerReturnTypesTransform: ReadabilityTransform =
  {
    name: "strip-inner-return-types",
    scope: "changed",
    isEnabled(options: TransformOptions) {
      return options.stripInnerReturnTypes;
    },
    transformFile(
      fileName: string,
      ctx: TransformContext
    ): boolean {
      const content =
        ctx.project.getFileContent(fileName);
      const original = ctx.snapshots.get(fileName);
      const stripped = stripInnerReturnTypes(
        content,
        original,
        fileName
      );
      if (stripped !== content) {
        const beforeErrors = getNonIsoErrorCount(
          ctx.project,
          fileName
        );
        ctx.project.updateFile(fileName, stripped);
        const afterErrors = getNonIsoErrorCount(
          ctx.project,
          fileName
        );
        if (afterErrors > beforeErrors) {
          ctx.project.updateFile(fileName, content);
          return false;
        }
        return true;
      }
      return false;
    },
  };
