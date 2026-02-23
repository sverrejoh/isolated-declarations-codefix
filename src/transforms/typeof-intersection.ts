import ts from "typescript";
import type { Project } from "../project.ts";
import {
  applyReplacements,
  type TextReplacement,
} from "../utils/replacements.ts";
import type {
  ReadabilityTransform,
  TransformContext,
  TransformOptions,
} from "./types.ts";

export function hasExportModifier(
  node: ts.VariableStatement
): boolean {
  return (
    node.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword
    ) ?? false
  );
}

export function findSymbolInProgSf(
  progSf: ts.SourceFile,
  checker: ts.TypeChecker,
  name: string
): ts.Symbol | undefined {
  for (const stmt of progSf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.name.text === name
      ) {
        return checker.getSymbolAtLocation(decl.name);
      }
    }
  }
  return undefined;
}

function stripTrailingSep(text: string): string {
  return text.replace(/\s*[;,]\s*$/, "");
}

/**
 * Post-processing pass that replaces verbose inlined
 * type annotations from spread objects with compact
 * `typeof X & { ... }` intersections.
 *
 * Only rewrites when the spread source is an exported
 * variable declared in the same file.
 */
export function rewriteTypeofIntersections(
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

    for (const decl of stmt.declarationList.declarations) {
      if (!decl.initializer || !decl.type) continue;
      if (!ts.isObjectLiteralExpression(decl.initializer)) {
        continue;
      }
      if (!ts.isTypeLiteralNode(decl.type)) continue;

      const init = decl.initializer;
      const spreads = init.properties.filter(
        ts.isSpreadAssignment
      );
      if (spreads.length === 0) continue;

      const ownInitProps = new Set<string>();
      for (const prop of init.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          prop.name &&
          ts.isIdentifier(prop.name)
        ) {
          ownInitProps.add(prop.name.text);
        }
        if (
          ts.isShorthandPropertyAssignment(prop) &&
          ts.isIdentifier(prop.name)
        ) {
          ownInitProps.add(prop.name.text);
        }
      }

      const typeofParts: string[] = [];
      const spreadPropNames = new Set<string>();
      let skipEntireDecl = false;

      for (const spread of spreads) {
        if (!ts.isIdentifier(spread.expression)) {
          skipEntireDecl = true;
          break;
        }
        const spreadName = spread.expression.text;

        if (!exportedVarNames.has(spreadName)) {
          continue;
        }

        const sym = findSymbolInProgSf(
          progSf,
          checker,
          spreadName
        );
        if (!sym) continue;

        const symType = checker.getTypeOfSymbol(sym);
        const props = symType.getProperties();

        let hasComputed = false;
        for (const p of props) {
          if (
            p.escapedName.toString().startsWith("__@")
          ) {
            hasComputed = true;
            break;
          }
        }
        if (hasComputed) continue;

        const propNames = props.map((p) =>
          p.escapedName.toString()
        );
        for (const name of propNames) {
          spreadPropNames.add(name);
        }
        typeofParts.push("typeof " + spreadName);
      }

      if (skipEntireDecl) continue;
      if (typeofParts.length === 0) continue;

      const ownAnnotationMembers: string[] = [];
      for (const member of decl.type.members) {
        if (!ts.isPropertySignature(member)) {
          ownAnnotationMembers.push(
            stripTrailingSep(member.getText(src))
          );
          continue;
        }
        if (
          !member.name ||
          !ts.isIdentifier(member.name)
        ) {
          ownAnnotationMembers.push(
            stripTrailingSep(member.getText(src))
          );
          continue;
        }
        const propName = member.name.text;
        const isFromSpread =
          spreadPropNames.has(propName);
        const isOwnOverride = ownInitProps.has(propName);

        if (!isFromSpread || isOwnOverride) {
          ownAnnotationMembers.push(
            stripTrailingSep(member.getText(src))
          );
        }
      }

      let newType: string;
      if (ownAnnotationMembers.length > 0) {
        const ownBlock =
          "{ " +
          ownAnnotationMembers.join("; ") +
          " }";
        newType =
          typeofParts.join(" & ") + " & " + ownBlock;
      } else {
        newType = typeofParts.join(" & ");
      }

      replacements.push({
        start: decl.type.getStart(src),
        end: decl.type.getEnd(),
        text: newType,
      });
    }
  }

  return applyReplacements(content, replacements);
}

export const typeofIntersectionTransform: ReadabilityTransform =
  {
    name: "typeof-intersection",
    scope: "changed",
    isEnabled() {
      return true;
    },
    transformFile(
      fileName: string,
      ctx: TransformContext
    ): boolean {
      const content = ctx.project.getFileContent(fileName);
      const rewritten = rewriteTypeofIntersections(
        content,
        fileName,
        ctx.project
      );
      if (rewritten !== content) {
        ctx.project.updateFile(fileName, rewritten);
        return true;
      }
      return false;
    },
  };
