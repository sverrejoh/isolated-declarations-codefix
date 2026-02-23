import ts from "typescript";
import type { Project } from "../project.ts";
import {
  applyReplacements,
  type TextReplacement,
} from "../utils/replacements.ts";
import type { ProgressEvent } from "../fixer.ts";
import type {
  ReadabilityTransform,
  TransformContext,
  TransformOptions,
} from "./types.ts";

/**
 * Collapse expanded string literal unions back to
 * `keyof typeof X` when they exactly match the keys
 * of an in-scope const object or enum declaration.
 * Only collapses unions with 3+ members.
 */
export function collapseKeyofTypeofUnions(
  content: string,
  fileName: string,
  project: Project,
  _onProgress?: (event: ProgressEvent) => void
): string {
  const program = project.languageService.getProgram();
  if (!program) return content;
  const progSf = program.getSourceFile(fileName);
  if (!progSf) return content;

  const candidates = new Map<string, Set<string>>();

  for (const stmt of progSf.statements) {
    if (ts.isEnumDeclaration(stmt)) {
      const keys = new Set<string>();
      for (const member of stmt.members) {
        const name = ts.isIdentifier(member.name)
          ? member.name.text
          : ts.isStringLiteral(member.name)
            ? member.name.text
            : undefined;
        if (name) keys.add(name);
      }
      if (keys.size >= 3) {
        candidates.set(stmt.name.text, keys);
      }
    }

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList
        .declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        if (!decl.initializer) continue;

        let objExpr: ts.Expression | undefined;
        if (
          ts.isAsExpression(decl.initializer) &&
          ts.isTypeReferenceNode(decl.initializer.type)
        ) {
          const typeText =
            decl.initializer.type.typeName.getText(
              progSf
            );
          if (typeText === "const") {
            objExpr = decl.initializer.expression;
          }
        }

        if (
          !objExpr &&
          ts.isAsExpression(decl.initializer) &&
          ts.isTypeReferenceNode(decl.initializer.type)
        ) {
          const inner = decl.initializer.expression;
          if (
            ts.isSatisfiesExpression(inner) &&
            ts.isObjectLiteralExpression(
              inner.expression
            )
          ) {
            const typeText =
              decl.initializer.type.typeName.getText(
                progSf
              );
            if (typeText === "const") {
              objExpr = inner.expression;
            }
          }
        }

        if (
          objExpr &&
          ts.isObjectLiteralExpression(objExpr)
        ) {
          const keys = new Set<string>();
          for (const prop of objExpr.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name)
            ) {
              keys.add(prop.name.text);
            } else if (
              ts.isPropertyAssignment(prop) &&
              ts.isStringLiteral(prop.name)
            ) {
              keys.add(prop.name.text);
            } else if (
              ts.isShorthandPropertyAssignment(prop)
            ) {
              keys.add(prop.name.text);
            }
          }
          if (keys.size >= 3) {
            candidates.set(decl.name.text, keys);
          }
        }
      }
    }
  }

  if (candidates.size === 0) return content;

  const src = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true
  );

  const unions: ts.UnionTypeNode[] = [];
  function visitNode(node: ts.Node): void {
    if (ts.isUnionTypeNode(node)) {
      let stringLiteralCount = 0;
      for (const t of node.types) {
        if (
          ts.isLiteralTypeNode(t) &&
          ts.isStringLiteral(t.literal)
        ) {
          stringLiteralCount++;
        }
      }
      if (stringLiteralCount >= 3) {
        unions.push(node);
      }
    }
    ts.forEachChild(node, visitNode);
  }
  visitNode(src);

  if (unions.length === 0) return content;

  const replacements: TextReplacement[] = [];

  for (const union of unions) {
    const stringMembers = new Set<string>();
    const otherTypes: string[] = [];
    for (const t of union.types) {
      if (
        ts.isLiteralTypeNode(t) &&
        ts.isStringLiteral(t.literal)
      ) {
        stringMembers.add(t.literal.text);
      } else {
        otherTypes.push(t.getText(src));
      }
    }

    for (const [name, keys] of candidates) {
      if (
        keys.size === stringMembers.size &&
        [...keys].every((k) => stringMembers.has(k))
      ) {
        let text = `keyof typeof ${name}`;
        if (otherTypes.length > 0) {
          text += " | " + otherTypes.join(" | ");
        }
        replacements.push({
          start: union.getStart(src),
          end: union.getEnd(),
          text,
        });
        break;
      }
    }
  }

  return applyReplacements(content, replacements);
}

export const collapseUnionsTransform: ReadabilityTransform =
  {
    name: "collapse-unions",
    scope: "all",
    isEnabled() {
      return true;
    },
    transformFile(
      fileName: string,
      ctx: TransformContext
    ): boolean {
      const content = ctx.project.getFileContent(fileName);
      const collapsed = collapseKeyofTypeofUnions(
        content,
        fileName,
        ctx.project,
        ctx.onProgress
      );
      if (collapsed !== content) {
        ctx.project.updateFile(fileName, collapsed);
        return true;
      }
      return false;
    },
  };
