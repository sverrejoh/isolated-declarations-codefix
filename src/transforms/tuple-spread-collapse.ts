import ts from "typescript";
import type { Project } from "../project.ts";
import {
  applyReplacements,
  type TextReplacement,
} from "../utils/replacements.ts";
import {
  hasExportModifier,
  findSymbolInProgSf,
} from "./typeof-intersection.ts";
import type {
  ReadabilityTransform,
  TransformContext,
  TransformOptions,
} from "./types.ts";

/**
 * Post-processing pass that collapses expanded readonly
 * tuple annotations back to variadic spread syntax when
 * the initializer uses array spreads of exported const
 * arrays from the same file.
 *
 * Example:
 *   readonly ["+", "-", "==", "!=", "in"]
 * becomes:
 *   readonly [...typeof a, ...typeof b, ...typeof c]
 */
export function collapseTupleSpreads(
  content: string,
  fileName: string,
  project: Project
): string {
  const src = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true
  );

  const program = project.languageService.getProgram();
  if (!program) return content;
  const checker = program.getTypeChecker();

  const progSf = program.getSourceFile(fileName);
  if (!progSf) return content;

  const exportedVarNames = new Set<string>();
  for (const stmt of progSf.statements) {
    if (
      !ts.isVariableStatement(stmt) ||
      !hasExportModifier(stmt)
    ) {
      continue;
    }
    if (
      !(stmt.declarationList.flags & ts.NodeFlags.Const)
    )
      continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        exportedVarNames.add(decl.name.text);
      }
    }
  }

  const replacements: TextReplacement[] = [];

  for (const stmt of src.statements) {
    if (
      !ts.isVariableStatement(stmt) ||
      !hasExportModifier(stmt)
    ) {
      continue;
    }
    if (
      !(stmt.declarationList.flags & ts.NodeFlags.Const)
    )
      continue;

    for (const decl of stmt.declarationList.declarations) {
      if (!decl.type || !decl.initializer) continue;

      let arrayLiteral:
        | ts.ArrayLiteralExpression
        | undefined;
      if (
        ts.isAsExpression(decl.initializer) &&
        ts.isArrayLiteralExpression(
          decl.initializer.expression
        )
      ) {
        arrayLiteral = decl.initializer.expression;
      } else if (
        ts.isArrayLiteralExpression(decl.initializer)
      ) {
        arrayLiteral = decl.initializer;
      }
      if (!arrayLiteral) continue;

      if (!arrayLiteral.elements.some(ts.isSpreadElement))
        continue;

      let tupleType: ts.TupleTypeNode | undefined;
      if (
        ts.isTypeOperatorNode(decl.type) &&
        decl.type.operator ===
          ts.SyntaxKind.ReadonlyKeyword &&
        ts.isTupleTypeNode(decl.type.type)
      ) {
        tupleType = decl.type.type;
      }
      if (!tupleType) continue;

      const parts: string[] = [];
      let tupleIdx = 0;
      let valid = true;

      for (const elem of arrayLiteral.elements) {
        if (ts.isSpreadElement(elem)) {
          if (!ts.isIdentifier(elem.expression)) {
            valid = false;
            break;
          }
          const name = elem.expression.text;
          if (!exportedVarNames.has(name)) {
            valid = false;
            break;
          }

          const sym = findSymbolInProgSf(
            progSf,
            checker,
            name
          );
          if (!sym) {
            valid = false;
            break;
          }
          const symType = checker.getTypeOfSymbol(sym);

          if (
            !(symType.flags & ts.TypeFlags.Object)
          ) {
            valid = false;
            break;
          }
          const objType = symType as ts.ObjectType;
          if (
            !(
              objType.objectFlags &
              ts.ObjectFlags.Reference
            )
          ) {
            valid = false;
            break;
          }
          const ref = symType as ts.TypeReference;
          if (
            !(
              ref.target.objectFlags &
              ts.ObjectFlags.Tuple
            )
          ) {
            valid = false;
            break;
          }
          const count =
            ref.typeArguments?.length ?? 0;
          if (
            count === 0 ||
            tupleIdx + count >
              tupleType.elements.length
          ) {
            valid = false;
            break;
          }

          tupleIdx += count;
          parts.push(`...typeof ${name}`);
        } else {
          if (
            tupleIdx >= tupleType.elements.length
          ) {
            valid = false;
            break;
          }
          parts.push(
            tupleType.elements[tupleIdx].getText(src)
          );
          tupleIdx++;
        }
      }

      if (
        !valid ||
        tupleIdx !== tupleType.elements.length
      )
        continue;
      if (
        !parts.some((p) => p.startsWith("...typeof "))
      )
        continue;

      const newType = `readonly [${parts.join(", ")}]`;
      replacements.push({
        start: decl.type.getStart(src),
        end: decl.type.getEnd(),
        text: newType,
      });
    }
  }

  return applyReplacements(content, replacements);
}

export const tupleSpreadCollapseTransform: ReadabilityTransform =
  {
    name: "tuple-spread-collapse",
    scope: "changed",
    isEnabled(options: TransformOptions) {
      return options.tupleSpreadCollapse;
    },
    transformFile(
      fileName: string,
      ctx: TransformContext
    ): boolean {
      const content = ctx.project.getFileContent(fileName);
      const collapsed = collapseTupleSpreads(
        content,
        fileName,
        ctx.project
      );
      if (collapsed !== content) {
        ctx.project.updateFile(fileName, collapsed);
        return true;
      }
      return false;
    },
  };
