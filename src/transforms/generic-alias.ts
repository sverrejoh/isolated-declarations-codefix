import ts from "typescript";
import { applyTextChanges } from "../changes.ts";
import {
  applyReplacements,
  type TextReplacement,
} from "../utils/replacements.ts";
import { findImportInsertPos } from "../utils/import-inserter.ts";
import {
  getNonIsoErrorCount,
} from "../utils/diagnostics.ts";
import type {
  ReadabilityTransform,
  TransformContext,
  TransformOptions,
} from "./types.ts";

type AliasReplacement = TextReplacement & {
  aliasName: string;
  moduleName: string | undefined;
};

/**
 * Apply alias-symbol replacements, add missing
 * imports, and run organizeImports.
 */
function applyAliasRepls(
  repls: AliasReplacement[],
  fileName: string,
  sf: ts.SourceFile,
  ctx: TransformContext
): void {
  let content =
    ctx.project.getFileContent(fileName);
  content = applyReplacements(content, repls);

  // Add missing imports for the alias type
  const updatedSrc = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true
  );
  const importedNames = new Set<string>();
  for (const stmt of updatedSrc.statements) {
    if (
      !ts.isImportDeclaration(stmt) ||
      !stmt.importClause?.namedBindings
    )
      continue;
    if (
      ts.isNamedImports(
        stmt.importClause.namedBindings
      )
    ) {
      for (const el of stmt.importClause.namedBindings
        .elements) {
        importedNames.add(el.name.text);
      }
    }
  }

  for (const r of repls) {
    if (
      importedNames.has(r.aliasName) ||
      !r.moduleName
    )
      continue;
    let inserted = false;
    const src2 = ts.createSourceFile(
      fileName,
      content,
      ts.ScriptTarget.Latest,
      true
    );
    for (const stmt of src2.statements) {
      if (
        !ts.isImportDeclaration(stmt) ||
        !ts.isStringLiteral(stmt.moduleSpecifier)
      )
        continue;
      if (
        stmt.moduleSpecifier.text === r.moduleName &&
        stmt.importClause?.namedBindings &&
        ts.isNamedImports(
          stmt.importClause.namedBindings
        )
      ) {
        const lastEl =
          stmt.importClause.namedBindings.elements[
            stmt.importClause.namedBindings.elements
              .length - 1
          ];
        const pos = lastEl.getEnd();
        content =
          content.slice(0, pos) +
          `, type ${r.aliasName}` +
          content.slice(pos);
        inserted = true;
        importedNames.add(r.aliasName);
        break;
      }
    }
    if (!inserted) {
      const insertPos = findImportInsertPos(src2);
      content =
        content.slice(0, insertPos) +
        `\nimport type { ${r.aliasName} }` +
        ` from "${r.moduleName}";` +
        content.slice(insertPos);
      importedNames.add(r.aliasName);
    }
  }

  ctx.project.updateFile(fileName, content);
  runOrganizeImports(fileName, ctx);
}

/**
 * Run organizeImports to clean up unused imports.
 */
function runOrganizeImports(
  fileName: string,
  ctx: TransformContext
): void {
  try {
    const orgChanges =
      ctx.project.languageService.organizeImports(
        { type: "file", fileName },
        ctx.formatOptions,
        ctx.preferences
      );
    for (const oc of orgChanges) {
      if (oc.textChanges.length === 0) continue;
      const cur = ctx.project.getFileContent(
        oc.fileName
      );
      ctx.project.updateFile(
        oc.fileName,
        applyTextChanges(cur, oc.textChanges)
      );
    }
  } catch {
    // organizeImports failed
  }
}

/**
 * Fix "Cannot find name" errors by applying TS's
 * addMissingImport code fix for each undefined name.
 */
function fixMissingImports(
  fileName: string,
  ctx: TransformContext
): void {
  // TS2304 = Cannot find name 'X'
  const diags = ctx.project.languageService
    .getSemanticDiagnostics(fileName)
    .filter(
      (d) => d.code === 2304 && d.start !== undefined
    );
  if (diags.length === 0) return;

  for (const d of diags) {
    const start = d.start!;
    const end = start + (d.length ?? 0);
    let fixes: readonly ts.CodeFixAction[];
    try {
      fixes =
        ctx.project.languageService.getCodeFixesAtPosition(
          fileName,
          start,
          end,
          [d.code],
          ctx.formatOptions,
          ctx.preferences
        );
    } catch {
      continue;
    }
    const importFix = fixes.find(
      (f) =>
        f.fixName === "import" ||
        f.fixName === "fixMissingImport"
    );
    if (!importFix) continue;

    for (const fc of importFix.changes) {
      if (fc.textChanges.length === 0) continue;
      const cur = ctx.project.getFileContent(
        fc.fileName
      );
      ctx.project.updateFile(
        fc.fileName,
        applyTextChanges(cur, fc.textChanges)
      );
    }
  }
}

/**
 * Simplify expanded type annotations: when TS expands
 * a generic return type into its full structural form,
 * replace with the concise alias + call type args.
 */
export function simplifyGenericAliases(
  fileName: string,
  ctx: TransformContext
): boolean {
  const prog =
    ctx.project.languageService.getProgram();
  if (!prog) return false;
  const sf = prog.getSourceFile(fileName);
  if (!sf) return false;
  const chk = prog.getTypeChecker();

  let changed = false;

  // ── Pass 1: alias-symbol based simplification ──
  const repls: AliasReplacement[] = [];

  ts.forEachChild(sf, (node) => {
    if (!ts.isVariableStatement(node)) return;
    if (
      !node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword
      )
    )
      return;
    for (const decl of node.declarationList
      .declarations) {
      if (
        !ts.isIdentifier(decl.name) ||
        !decl.type ||
        !decl.initializer
      )
        continue;
      if (
        !ts.isCallExpression(decl.initializer) ||
        !decl.initializer.typeArguments?.length
      )
        continue;

      const type = chk.getTypeAtLocation(
        decl.initializer
      );
      const aliasSymbol = (type as any).aliasSymbol as
        | ts.Symbol
        | undefined;
      if (!aliasSymbol) continue;

      const aliasName = aliasSymbol.name;
      const typeArgTexts =
        decl.initializer.typeArguments.map((ta) =>
          ta.getText(sf)
        );
      const simplified =
        typeArgTexts.length > 0
          ? `${aliasName}<${typeArgTexts.join(", ")}>`
          : aliasName;
      const currentAnnotation = decl.type.getText(sf);
      if (currentAnnotation.length <= simplified.length)
        continue;

      let moduleName: string | undefined;
      const aliasDecls = aliasSymbol.getDeclarations();
      if (aliasDecls?.length) {
        const aliasFile =
          aliasDecls[0].getSourceFile().fileName;
        if (aliasFile.includes("node_modules")) {
          const nmIdx = aliasFile.lastIndexOf(
            "node_modules/"
          );
          if (nmIdx >= 0) {
            let pkg = aliasFile.slice(
              nmIdx + "node_modules/".length
            );
            if (pkg.startsWith("@")) {
              const parts = pkg.split("/");
              pkg = parts[0] + "/" + parts[1];
            } else {
              pkg = pkg.split("/")[0];
            }
            const afterPkg = aliasFile.slice(
              nmIdx +
                "node_modules/".length +
                pkg.length
            );
            const subpath = afterPkg
              .replace(
                /^\/(?:dist|lib|src)\//,
                "/"
              )
              .replace(/\.d\.ts$/, "")
              .replace(/\/index$/, "");
            moduleName =
              subpath === "" || subpath === "/"
                ? pkg
                : pkg + subpath;
          }
        }
      }

      repls.push({
        start: decl.type.getStart(sf),
        end: decl.type.getEnd(),
        text: simplified,
        aliasName,
        moduleName,
      });
    }
  });

  if (repls.length > 0) {
    applyAliasRepls(repls, fileName, sf, ctx);
    changed = true;
  }

  // ── Pass 2: typeToTypeNode re-serialization ──
  // For declarations where the call has no explicit
  // type arguments (or aliasSymbol was undefined),
  // re-serialize the inferred type. Replace if shorter.
  const prog2 =
    ctx.project.languageService.getProgram();
  if (!prog2) return changed;
  const sf2 = prog2.getSourceFile(fileName);
  if (!sf2) return changed;
  const chk2 = prog2.getTypeChecker();

  const reserRepls: TextReplacement[] = [];
  const printer = ts.createPrinter({
    removeComments: true,
  });

  ts.forEachChild(sf2, (node) => {
    if (!ts.isVariableStatement(node)) return;
    if (
      !node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword
      )
    )
      return;
    for (const decl of node.declarationList
      .declarations) {
      if (
        !ts.isIdentifier(decl.name) ||
        !decl.type ||
        !decl.initializer
      )
        continue;
      if (!ts.isCallExpression(decl.initializer))
        continue;

      const currentAnnotation =
        decl.type.getText(sf2);
      if (currentAnnotation.length < 80) continue;

      const inferredType = chk2.getTypeAtLocation(
        decl.initializer
      );
      let typeNode: ts.TypeNode | undefined;
      try {
        typeNode = chk2.typeToTypeNode(
          inferredType,
          decl,
          ts.NodeBuilderFlags.NoTruncation |
            ts.NodeBuilderFlags
              .UseAliasDefinedOutsideCurrentScope
        );
      } catch {
        continue;
      }
      if (!typeNode) continue;

      const simplified = printer.printNode(
        ts.EmitHint.Unspecified,
        typeNode,
        sf2
      );
      if (simplified.length >= currentAnnotation.length)
        continue;

      reserRepls.push({
        start: decl.type.getStart(sf2),
        end: decl.type.getEnd(),
        text: simplified,
      });
    }
  });

  if (reserRepls.length > 0) {
    const content =
      ctx.project.getFileContent(fileName);
    const beforeErrors = getNonIsoErrorCount(
      ctx.project,
      fileName
    );
    const newContent = applyReplacements(
      content,
      reserRepls
    );
    ctx.project.updateFile(fileName, newContent);

    // Fix missing imports introduced by the
    // re-serialized type references.
    fixMissingImports(fileName, ctx);

    const afterErrors = getNonIsoErrorCount(
      ctx.project,
      fileName
    );
    if (afterErrors > beforeErrors) {
      ctx.project.updateFile(fileName, content);
    } else {
      changed = true;
      runOrganizeImports(fileName, ctx);
    }
  }

  return changed;
}

export const genericAliasTransform: ReadabilityTransform =
  {
    name: "generic-alias",
    scope: "changed",
    isEnabled(options: TransformOptions) {
      return options.genericAlias;
    },
    transformFile(
      fileName: string,
      ctx: TransformContext
    ): boolean {
      return simplifyGenericAliases(fileName, ctx);
    },
  };
