import ts from "typescript";
import { applyTextChanges } from "./changes.ts";
import {
  analyzeExtractionsWithMetadata,
  planCrossFileExtractions,
  applyCrossFileExtractions,
} from "./extract-types.ts";
import type { FileAnalysis } from "./extract-types.ts";
import type { Project } from "./project.ts";

const FIX_ID = "fixMissingTypeAnnotationOnExports";

function isIsolatedDeclarationsError(
  code: number,
): boolean {
  return (
    (code >= 9007 && code <= 9025) ||
    (code >= 9035 && code <= 9039)
  );
}

function findEnumMemberAt(
  sourceFile: ts.SourceFile,
  pos: number,
): ts.EnumMember | undefined {
  function visit(
    node: ts.Node,
  ): ts.EnumMember | undefined {
    if (
      ts.isEnumMember(node) &&
      node.getStart(sourceFile) <= pos &&
      node.getEnd() > pos
    ) {
      return node;
    }
    return ts.forEachChild(node, visit);
  }
  return visit(sourceFile);
}

export interface FixResult {
  totalChanges: number;
  filesChanged: Set<string>;
  filesSkipped: Map<string, string>;
  remainingErrors: Map<string, number>;
  passes: number;
}

export type ProgressEvent =
  | { type: "file-scanned"; fileName: string }
  | {
      type: "file";
      fileName: string;
      edits: number;
    }
  | {
      type: "file-error";
      fileName: string;
      message: string;
    }
  | {
      type: "file-warning";
      fileName: string;
      message: string;
    }
  | {
      type: "pass-complete";
      pass: number;
      filesFixed: number;
    };

export interface FixOptions {
  maxPasses?: number;
  verbose?: boolean;
  rewriteInlineImports?: boolean;
  extractThreshold?: number;
  onProgress?: (event: ProgressEvent) => void;
}

/**
 * Fix isolatedDeclarations errors one diagnostic at a
 * time using getCodeFixesAtPosition. Used as fallback
 * when getCombinedCodeFix throws, and as a final sweep
 * to catch fixes that getCombinedCodeFix misses (e.g.
 * fixes with fixId: undefined).
 *
 * Returns the total number of text edits applied.
 */
function fixFileFallback(
  project: Project,
  fileName: string,
  formatOptions: ts.FormatCodeSettings,
  preferences: ts.UserPreferences,
  snapshots?: Map<string, string>,
): number {
  let totalEdits = 0;
  let prevCount = -1;

  for (let round = 0; round < 50; round++) {
    const diags = project.languageService
      .getSemanticDiagnostics(fileName)
      .filter(
        (d) =>
          isIsolatedDeclarationsError(d.code) &&
          d.start !== undefined,
      );

    if (diags.length === 0) break;
    if (diags.length === prevCount) break;
    prevCount = diags.length;

    let fixedAny = false;
    for (const d of diags) {
      const start = d.start!;
      const end = start + (d.length ?? 0);

      let fixes: readonly ts.CodeFixAction[];
      try {
        fixes =
          project.languageService.getCodeFixesAtPosition(
            fileName,
            start,
            end,
            [d.code],
            formatOptions,
            preferences,
          );
      } catch {
        continue;
      }

      const action =
        fixes.find((f) => f.fixId === FIX_ID) ??
        fixes[0];
      if (
        !action ||
        action.changes.length === 0
      ) {
        continue;
      }

      let applied = false;
      for (const fc of action.changes) {
        if (fc.textChanges.length === 0) continue;
        const current = project.getFileContent(
          fc.fileName,
        );
        if (
          snapshots &&
          !snapshots.has(fc.fileName)
        ) {
          snapshots.set(fc.fileName, current);
        }
        const updated = applyTextChanges(
          current,
          fc.textChanges,
        );
        project.updateFile(fc.fileName, updated);
        totalEdits += fc.textChanges.length;
        applied = true;
      }

      if (applied) {
        fixedAny = true;
        break; // re-fetch diags, positions shifted
      }
    }

    if (!fixedAny) break;
  }

  return totalEdits;
}

/**
 * Like fixFileFallback but validates each fix
 * individually. If a fix increases non-iso errors,
 * it's reverted and skipped. This preserves good
 * fixes even when some fixes produce side effects.
 *
 * Returns the total number of text edits applied.
 */
function fixFileValidated(
  project: Project,
  fileName: string,
  formatOptions: ts.FormatCodeSettings,
  preferences: ts.UserPreferences,
  snapshots?: Map<string, string>,
): number {
  let totalEdits = 0;
  let prevCount = -1;

  const nonIsoErrorCount = (): number =>
    project.languageService
      .getSemanticDiagnostics(fileName)
      .filter(
        (d) =>
          !isIsolatedDeclarationsError(d.code),
      ).length;

  for (let round = 0; round < 50; round++) {
    const diags = project.languageService
      .getSemanticDiagnostics(fileName)
      .filter(
        (d) =>
          isIsolatedDeclarationsError(d.code) &&
          d.start !== undefined,
      );

    if (diags.length === 0) break;
    if (diags.length === prevCount) break;
    prevCount = diags.length;

    let fixedAny = false;
    for (const d of diags) {
      const start = d.start!;
      const end = start + (d.length ?? 0);

      let fixes: readonly ts.CodeFixAction[];
      try {
        fixes =
          project.languageService.getCodeFixesAtPosition(
            fileName,
            start,
            end,
            [d.code],
            formatOptions,
            preferences,
          );
      } catch {
        continue;
      }

      const action =
        fixes.find((f) => f.fixId === FIX_ID) ??
        fixes[0];
      if (
        !action ||
        action.changes.length === 0
      ) {
        continue;
      }

      // Save state before applying this fix.
      const saved = new Map<string, string>();
      for (const fc of action.changes) {
        saved.set(
          fc.fileName,
          project.getFileContent(fc.fileName),
        );
      }
      const errorsBefore = nonIsoErrorCount();

      let applied = false;
      let editsThisFix = 0;
      for (const fc of action.changes) {
        if (fc.textChanges.length === 0) continue;
        const current = project.getFileContent(
          fc.fileName,
        );
        if (
          snapshots &&
          !snapshots.has(fc.fileName)
        ) {
          snapshots.set(fc.fileName, current);
        }
        const updated = applyTextChanges(
          current,
          fc.textChanges,
        );
        project.updateFile(fc.fileName, updated);
        editsThisFix += fc.textChanges.length;
        applied = true;
      }

      if (!applied) continue;

      // Validate: did this fix introduce errors?
      const errorsAfter = nonIsoErrorCount();
      if (errorsAfter > errorsBefore) {
        // Revert just this fix.
        for (const [fn, content] of saved) {
          project.updateFile(fn, content);
        }
        continue;
      }

      totalEdits += editsThisFix;
      fixedAny = true;
      break; // re-fetch diags, positions shifted
    }

    if (!fixedAny) break;
  }

  return totalEdits;
}

function moduleSpecifierToAlias(
  specifier: string,
): string {
  // Strip directory path
  let name = specifier.split("/").pop() ?? specifier;
  // Strip npm scope prefix if bare specifier
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    name = parts[parts.length - 1] ?? name;
  }
  // Strip file extension
  name = name.replace(/\.\w+$/, "");
  // PascalCase: split on non-alphanum, capitalize
  const pascal = name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join("");
  return pascal + "Module";
}

function collectIdentifiers(
  node: ts.Node,
  ids: Set<string>,
): void {
  if (ts.isIdentifier(node)) {
    ids.add(node.text);
  }
  ts.forEachChild(node, (child) =>
    collectIdentifiers(child, ids),
  );
}

export function rewriteInlineImportTypes(
  content: string,
  fileName: string,
  original?: string,
  onProgress?: (event: ProgressEvent) => void,
): string {
  const src = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true,
  );

  // Collect all ImportTypeNode with isTypeOf,
  // skipping nodes inside TypeLiterals (object types)
  // where replacing typeof import() with typeof X
  // can break declaration checking for modules with
  // default exports.
  const nodes: ts.ImportTypeNode[] = [];
  function isInsideTypeLiteral(
    node: ts.Node,
  ): boolean {
    let cur = node.parent;
    while (cur) {
      if (ts.isTypeLiteralNode(cur)) return true;
      cur = cur.parent;
    }
    return false;
  }
  function visit(node: ts.Node): void {
    if (
      ts.isImportTypeNode(node) &&
      node.isTypeOf &&
      !isInsideTypeLiteral(node)
    ) {
      nodes.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(src);

  if (nodes.length === 0) return content;

  // Group by specifier
  const bySpec = new Map<
    string,
    ts.ImportTypeNode[]
  >();
  for (const node of nodes) {
    if (!ts.isLiteralTypeNode(node.argument)) {
      continue;
    }
    const lit = node.argument.literal;
    if (!ts.isStringLiteral(lit)) continue;
    const spec = lit.text;
    let arr = bySpec.get(spec);
    if (!arr) {
      arr = [];
      bySpec.set(spec, arr);
    }
    arr.push(node);
  }

  if (bySpec.size === 0) return content;

  // Check for existing namespace imports to reuse
  const existingNs = new Map<string, string>();
  for (const stmt of src.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.importClause?.namedBindings &&
      ts.isNamespaceImport(
        stmt.importClause.namedBindings,
      )
    ) {
      existingNs.set(
        stmt.moduleSpecifier.text,
        stmt.importClause.namedBindings.name.text,
      );
    }
  }

  // Collect all identifiers for conflict check
  const allIds = new Set<string>();
  collectIdentifiers(src, allIds);

  // Assign aliases
  const aliasMap = new Map<string, string>();
  for (const spec of bySpec.keys()) {
    const existing = existingNs.get(spec);
    if (existing) {
      aliasMap.set(spec, existing);
      continue;
    }
    let base = moduleSpecifierToAlias(spec);
    let alias = base;
    let counter = 2;
    while (allIds.has(alias)) {
      alias = base.replace(/Module$/, "") +
        "Module" + counter;
      counter++;
    }
    aliasMap.set(spec, alias);
    allIds.add(alias);
  }

  // Warn about pre-existing inline imports
  if (original && onProgress) {
    for (const [spec, nodeList] of bySpec) {
      for (const node of nodeList) {
        const nodeText = node.getText(src);
        if (original.includes(nodeText)) {
          onProgress({
            type: "file-warning",
            fileName,
            message:
              "pre-existing typeof import() " +
              "rewritten: " +
              nodeText,
          });
        }
      }
    }
  }

  // Build replacement list sorted by descending pos
  const replacements: {
    start: number;
    end: number;
    text: string;
  }[] = [];
  for (const [spec, nodeList] of bySpec) {
    const alias = aliasMap.get(spec)!;
    for (const node of nodeList) {
      let replacement = "typeof " + alias;
      if (node.qualifier) {
        replacement +=
          "." + node.qualifier.getText(src);
      }
      if (
        node.typeArguments &&
        node.typeArguments.length > 0
      ) {
        const args = node.typeArguments
          .map((a) => a.getText(src))
          .join(", ");
        replacement += "<" + args + ">";
      }
      replacements.push({
        start: node.getStart(src),
        end: node.getEnd(),
        text: replacement,
      });
    }
  }
  replacements.sort((a, b) => b.start - a.start);

  // Apply replacements in reverse order
  let result = content;
  for (const r of replacements) {
    result =
      result.slice(0, r.start) +
      r.text +
      result.slice(r.end);
  }

  // Insert new import statements for new aliases
  const newImports: string[] = [];
  for (const [spec, alias] of aliasMap) {
    if (existingNs.has(spec)) continue;
    newImports.push(
      `import type * as ${alias} from "${spec}";`,
    );
  }

  if (newImports.length > 0) {
    // Find position after last import statement
    const resultSrc = ts.createSourceFile(
      fileName,
      result,
      ts.ScriptTarget.Latest,
      true,
    );
    let insertPos = 0;
    for (const stmt of resultSrc.statements) {
      if (
        ts.isImportDeclaration(stmt) ||
        ts.isImportEqualsDeclaration(stmt)
      ) {
        insertPos = stmt.getEnd();
      } else {
        break;
      }
    }

    const importBlock =
      "\n" + newImports.join("\n");
    if (insertPos > 0) {
      result =
        result.slice(0, insertPos) +
        importBlock +
        result.slice(insertPos);
    } else {
      result = newImports.join("\n") + "\n" + result;
    }
  }

  return result;
}

export function fix(
  project: Project,
  options: FixOptions = {},
): FixResult {
  const {
    maxPasses = 5,
    verbose = false,
    rewriteInlineImports = true,
    onProgress,
  } = options;
  const filesChanged = new Set<string>();
  const filesSkipped = new Map<string, string>();
  // Snapshot original content before first change,
  // so we can rollback if a fix introduces errors.
  const snapshots = new Map<string, string>();
  let totalChanges = 0;
  let passes = 0;

  const formatOptions = ts.getDefaultFormatCodeSettings();
  const preferences: ts.UserPreferences = {};

  for (let pass = 1; pass <= maxPasses; pass++) {
    passes = pass;
    let changesThisPass = 0;
    let filesFixedThisPass = 0;
    const program = project.languageService.getProgram();
    if (!program) {
      throw new Error(
        "Failed to get program from language service",
      );
    }

    const sourceFiles = program.getSourceFiles();
    for (const sourceFile of sourceFiles) {
      if (sourceFile.fileName.includes("node_modules"))
        continue;
      if (sourceFile.isDeclarationFile) continue;

      let combinedFix: ts.CombinedCodeActions;
      try {
        combinedFix =
          project.languageService.getCombinedCodeFix(
            {
              type: "file",
              fileName: sourceFile.fileName,
            },
            FIX_ID,
            formatOptions,
            preferences,
          );
      } catch (err) {
        // Fallback: fix one diagnostic at a time
        let fallbackEdits = 0;
        try {
          fallbackEdits = fixFileFallback(
            project,
            sourceFile.fileName,
            formatOptions,
            preferences,
            snapshots,
          );
        } catch {
          // fallback also failed
        }

        if (fallbackEdits > 0) {
          filesChanged.add(sourceFile.fileName);
          filesSkipped.delete(sourceFile.fileName);
          changesThisPass++;
          filesFixedThisPass++;
          onProgress?.({
            type: "file",
            fileName: sourceFile.fileName,
            edits: fallbackEdits,
          });
        } else if (
          !filesChanged.has(sourceFile.fileName)
        ) {
          const msg =
            err instanceof Error
              ? err.message
              : String(err);
          filesSkipped.set(
            sourceFile.fileName,
            msg,
          );
          onProgress?.({
            type: "file-error",
            fileName: sourceFile.fileName,
            message: msg,
          });
        }

        onProgress?.({
          type: "file-scanned",
          fileName: sourceFile.fileName,
        });
        continue;
      }

      onProgress?.({
        type: "file-scanned",
        fileName: sourceFile.fileName,
      });

      if (combinedFix.changes.length === 0) continue;

      if (verbose) {
        console.log(
          `  Pass ${pass}: ${sourceFile.fileName}`,
        );
      }

      let fileEdits = 0;
      for (const fileChange of combinedFix.changes) {
        if (fileChange.textChanges.length === 0) continue;
        const current = project.getFileContent(
          fileChange.fileName,
        );
        if (!snapshots.has(fileChange.fileName)) {
          snapshots.set(fileChange.fileName, current);
        }
        const newContent = applyTextChanges(
          current,
          fileChange.textChanges,
        );
        project.updateFile(
          fileChange.fileName,
          newContent,
        );
        filesChanged.add(fileChange.fileName);
        changesThisPass++;
        fileEdits += fileChange.textChanges.length;
      }

      filesFixedThisPass++;
      onProgress?.({
        type: "file",
        fileName: sourceFile.fileName,
        edits: fileEdits,
      });
    }

    onProgress?.({
      type: "pass-complete",
      pass,
      filesFixed: filesFixedThisPass,
    });

    if (changesThisPass === 0) break;
    totalChanges += changesThisPass;
  }

  // Final sweep: pick up fixes that getCombinedCodeFix
  // misses (e.g. fixes with fixId: undefined).
  let sweepFixed = 0;
  const programSweep =
    project.languageService.getProgram();
  if (programSweep) {
    for (const sf of programSweep.getSourceFiles()) {
      if (sf.fileName.includes("node_modules"))
        continue;
      if (sf.isDeclarationFile) continue;

      const edits = fixFileFallback(
        project,
        sf.fileName,
        formatOptions,
        preferences,
        snapshots,
      );
      if (edits > 0) {
        filesChanged.add(sf.fileName);
        filesSkipped.delete(sf.fileName);
        sweepFixed++;
        onProgress?.({
          type: "file",
          fileName: sf.fileName,
          edits,
        });
      }
    }
  }
  if (sweepFixed > 0) {
    totalChanges += sweepFixed;
    onProgress?.({
      type: "pass-complete",
      pass: passes + 1,
      filesFixed: sweepFixed,
    });
    passes++;
  }

  // TS9020: enum member initializers that reference
  // external symbols. TypeScript provides no fix for
  // this — we inline the constant value ourselves.
  const programEnum =
    project.languageService.getProgram();
  if (programEnum) {
    const checker = programEnum.getTypeChecker();
    for (const sf of programEnum.getSourceFiles()) {
      if (sf.fileName.includes("node_modules"))
        continue;
      if (sf.isDeclarationFile) continue;

      const diags = project.languageService
        .getSemanticDiagnostics(sf.fileName)
        .filter(
          (d) =>
            d.code === 9020 &&
            d.start !== undefined,
        );
      if (diags.length === 0) continue;

      let content =
        project.getFileContent(sf.fileName);
      if (!snapshots.has(sf.fileName)) {
        snapshots.set(sf.fileName, content);
      }
      // Build a fresh source file to walk AST.
      let src = ts.createSourceFile(
        sf.fileName,
        content,
        ts.ScriptTarget.Latest,
        true,
      );

      let enumFixed = 0;
      // Process diagnostics in reverse order so
      // replacing text doesn't shift later positions.
      const sorted = [...diags].sort(
        (a, b) => b.start! - a.start!,
      );
      for (const d of sorted) {
        const pos = d.start!;
        const node = findEnumMemberAt(src, pos);
        if (!node) continue;

        // Re-bind to the program's source file to
        // use the checker.
        const progSf = programEnum.getSourceFile(
          sf.fileName,
        );
        if (!progSf) continue;
        const member = findEnumMemberAt(
          progSf,
          pos,
        );
        if (!member) continue;

        let val = checker.getConstantValue(
          member as ts.EnumMember,
        );
        // Fallback: use type literal detection
        // when getConstantValue can't resolve
        // (e.g. cross-module const references).
        if (val === undefined) {
          const init2 = (
            member as ts.EnumMember
          ).initializer;
          if (init2) {
            const t =
              checker.getTypeAtLocation(init2);
            if (t.isStringLiteral()) {
              val = t.value;
            } else if (t.isNumberLiteral()) {
              val = t.value;
            }
          }
        }
        if (val === undefined) continue;

        const init = (
          member as ts.EnumMember
        ).initializer;
        if (!init) continue;

        const replacement =
          typeof val === "string"
            ? JSON.stringify(val)
            : String(val);

        content =
          content.slice(0, init.getStart(progSf)) +
          replacement +
          content.slice(init.getEnd());
        enumFixed++;

        // Re-create AST after text change.
        src = ts.createSourceFile(
          sf.fileName,
          content,
          ts.ScriptTarget.Latest,
          true,
        );
      }

      if (enumFixed > 0) {
        project.updateFile(sf.fileName, content);
        filesChanged.add(sf.fileName);
        filesSkipped.delete(sf.fileName);
        totalChanges += enumFixed;
        onProgress?.({
          type: "file",
          fileName: sf.fileName,
          edits: enumFixed,
        });
      }
    }
  }

  // Extract verbose inline types to named interfaces (cross-file dedup).
  const threshold = options.extractThreshold ?? 5;
  const fileAnalyses = new Map<string, FileAnalysis>();
  for (const fileName of [...filesChanged]) {
    const content = project.getFileContent(fileName);
    const analysis = analyzeExtractionsWithMetadata(
      content,
      fileName,
      threshold,
    );
    if (analysis.extractions.length > 0) {
      fileAnalyses.set(fileName, analysis);
    }
  }

  if (fileAnalyses.size > 0) {
    const plan = planCrossFileExtractions(fileAnalyses);
    for (const [fileName, action] of plan.actions) {
      const content = project.getFileContent(fileName);
      const updated = applyCrossFileExtractions(
        content,
        fileName,
        action,
      );
      if (updated !== content) {
        project.updateFile(fileName, updated);
      }
    }
  }

  // Validate: check each changed file for NEW
  // non-isolatedDeclarations errors. Try to repair
  // (e.g. organizeImports for duplicate imports)
  // before reverting.
  for (const fileName of [...filesChanged]) {
    const original = snapshots.get(fileName);
    if (original === undefined) continue;

    let errors = project.languageService
      .getSemanticDiagnostics(fileName)
      .filter(
        (d) => !isIsolatedDeclarationsError(d.code),
      );
    if (errors.length === 0) continue;

    // Save fixed content, check pre-existing count.
    const fixedContent =
      project.getFileContent(fileName);
    project.updateFile(fileName, original);
    const beforeCount = project.languageService
      .getSemanticDiagnostics(fileName)
      .filter(
        (d) => !isIsolatedDeclarationsError(d.code),
      ).length;
    // Restore fixed content for repair attempt.
    project.updateFile(fileName, fixedContent);

    if (errors.length <= beforeCount) continue;

    // Try organizeImports to fix import corruption.
    // TS2300: Duplicate identifier
    // TS2440: Import declaration conflicts
    // TS2395: Merged declaration conflict
    const hasImportIssues = errors.some(
      (d) =>
        d.code === 2300 ||
        d.code === 2440 ||
        d.code === 2395,
    );
    if (hasImportIssues) {
      try {
        const orgChanges =
          project.languageService.organizeImports(
            { type: "file", fileName },
            formatOptions,
            preferences,
          );
        for (const oc of orgChanges) {
          if (oc.textChanges.length === 0) continue;
          const cur =
            project.getFileContent(oc.fileName);
          project.updateFile(
            oc.fileName,
            applyTextChanges(
              cur,
              oc.textChanges,
            ),
          );
        }
        errors = project.languageService
          .getSemanticDiagnostics(fileName)
          .filter(
            (d) =>
              !isIsolatedDeclarationsError(d.code),
          );
      } catch {
        // organizeImports failed
      }
    }

    // Try to fix bare Promise annotations (TS2314).
    // TypeScript's fixer sometimes generates `Promise`
    // without a type argument for async functions.
    // Replace with `Promise<void>` — if the function
    // actually returns a value, validation will still
    // revert due to type mismatch.
    const hasBarePromise = errors.some(
      (d) =>
        d.code === 2314 &&
        typeof d.messageText === "string" &&
        d.messageText.includes("Promise"),
    );
    if (hasBarePromise) {
      try {
        const content =
          project.getFileContent(fileName);
        const patched = content.replace(
          /(?<=:\s*)Promise\b(?!\s*<)/g,
          "Promise<void>",
        );
        if (patched !== content) {
          project.updateFile(fileName, patched);
          errors = project.languageService
            .getSemanticDiagnostics(fileName)
            .filter(
              (d) =>
                !isIsolatedDeclarationsError(
                  d.code,
                ),
            );
        }
      } catch {
        // repair failed
      }
    }

    if (errors.length > beforeCount) {
      // Combined fix broke the file — revert and
      // retry with validated per-diagnostic approach
      // that checks each fix individually, skipping
      // any that introduce errors.
      project.updateFile(fileName, original);
      filesChanged.delete(fileName);

      let retryEdits = 0;
      try {
        retryEdits = fixFileValidated(
          project,
          fileName,
          formatOptions,
          preferences,
          snapshots,
        );
      } catch {
        // validated retry also failed
      }

      if (retryEdits > 0) {
        filesChanged.add(fileName);
        filesSkipped.delete(fileName);
        onProgress?.({
          type: "file",
          fileName,
          edits: retryEdits,
        });
      } else {
        const msg =
          "fix introduced errors: " +
          errors
            .map((d) =>
              typeof d.messageText === "string"
                ? d.messageText
                : d.messageText.messageText,
            )
            .slice(0, 3)
            .join("; ");
        filesSkipped.set(fileName, msg);
        onProgress?.({
          type: "file-error",
          fileName,
          message: msg,
        });
      }
    }
  }

  // Rewrite typeof import() to namespace imports.
  // Process ALL source files, not just changed ones,
  // to also rewrite pre-existing typeof import().
  if (rewriteInlineImports) {
    const programRewrite =
      project.languageService.getProgram();
    if (programRewrite) {
      for (const sf of programRewrite
        .getSourceFiles()) {
        if (sf.fileName.includes("node_modules"))
          continue;
        if (sf.isDeclarationFile) continue;
        const content =
          project.getFileContent(sf.fileName);
        const orig = snapshots.get(sf.fileName);
        const rewritten = rewriteInlineImportTypes(
          content,
          sf.fileName,
          orig,
          onProgress,
        );
        if (rewritten !== content) {
          project.updateFile(
            sf.fileName,
            rewritten,
          );
          filesChanged.add(sf.fileName);
        }
      }
    }
  }

  // Check for remaining isolatedDeclarations errors.
  const remainingErrors = new Map<string, number>();
  const programCheck =
    project.languageService.getProgram();
  if (programCheck) {
    for (const sf of programCheck.getSourceFiles()) {
      if (sf.fileName.includes("node_modules"))
        continue;
      if (sf.isDeclarationFile) continue;

      const count = project.languageService
        .getSemanticDiagnostics(sf.fileName)
        .filter(
          (d) => isIsolatedDeclarationsError(d.code),
        ).length;
      if (count > 0) {
        remainingErrors.set(sf.fileName, count);
      }
    }
  }

  return {
    totalChanges,
    filesChanged,
    filesSkipped,
    remainingErrors,
    passes,
  };
}
