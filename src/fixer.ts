import ts from "typescript";
import { applyTextChanges } from "./changes.ts";
import { isIsolatedDeclarationsError } from "./utils/diagnostics.ts";
import { runTransformPipeline } from "./transforms/pipeline.ts";
import type {
  ReadabilityTransform,
  TransformContext,
  TransformOptions,
} from "./transforms/types.ts";
import { typeofIntersectionTransform } from "./transforms/typeof-intersection.ts";
import { tupleSpreadCollapseTransform } from "./transforms/tuple-spread-collapse.ts";
import { createExtractTypesTransform } from "./transforms/extract-types-transform.ts";
import { inlineImportsTransform } from "./transforms/inline-imports.ts";
import { collapseUnionsTransform } from "./transforms/collapse-unions.ts";
import { genericAliasTransform } from "./transforms/generic-alias.ts";
import { stripInnerReturnTypesTransform } from "./transforms/strip-inner-return-types.ts";
import { banTypesTransform } from "./transforms/ban-types.ts";
import type { Project } from "./project.ts";

const FIX_ID = "fixMissingTypeAnnotationOnExports";

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
  typeofIntersection?: boolean;
  tupleSpreadCollapse?: boolean;
  extractTypes?: boolean;
  extractThreshold?: number;
  collapseUnions?: boolean;
  genericAlias?: boolean;
  stripInnerReturnTypes?: boolean;
  banTypes?: boolean;
  onProgress?: (event: ProgressEvent) => void;
}

/** Internal context threaded through fix phases. */
interface FixContext {
  project: Project;
  maxPasses: number;
  verbose: boolean;
  rewriteInlineImports: boolean;
  typeofIntersection: boolean;
  tupleSpreadCollapse: boolean;
  extractTypes: boolean;
  extractThreshold: number;
  collapseUnions: boolean;
  genericAlias: boolean;
  stripInnerReturnTypes: boolean;
  banTypes: boolean;
  onProgress?: (event: ProgressEvent) => void;
  filesChanged: Set<string>;
  filesSkipped: Map<string, string>;
  snapshots: Map<string, string>;
  totalChanges: number;
  passes: number;
  formatOptions: ts.FormatCodeSettings;
  preferences: ts.UserPreferences;
}

function findEnumMemberAt(
  sourceFile: ts.SourceFile,
  pos: number
): ts.EnumMember | undefined {
  function visit(
    node: ts.Node
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

/**
 * Fix isolatedDeclarations errors one diagnostic at a
 * time using getCodeFixesAtPosition. Used as fallback
 * when getCombinedCodeFix throws, and as a final sweep
 * to catch fixes that getCombinedCodeFix misses (e.g.
 * fixes with fixId: undefined).
 */
function fixFileFallback(
  project: Project,
  fileName: string,
  formatOptions: ts.FormatCodeSettings,
  preferences: ts.UserPreferences,
  snapshots?: Map<string, string>
): number {
  let totalEdits = 0;
  let prevCount = -1;

  for (let round = 0; round < 50; round++) {
    const diags = project.languageService
      .getSemanticDiagnostics(fileName)
      .filter(
        (d) =>
          isIsolatedDeclarationsError(d.code) &&
          d.start !== undefined
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
            preferences
          );
      } catch {
        continue;
      }

      const action =
        fixes.find((f) => f.fixId === FIX_ID) ??
        fixes[0];
      if (!action || action.changes.length === 0) {
        continue;
      }

      let applied = false;
      for (const fc of action.changes) {
        if (fc.textChanges.length === 0) continue;
        const current = project.getFileContent(
          fc.fileName
        );
        if (snapshots && !snapshots.has(fc.fileName)) {
          snapshots.set(fc.fileName, current);
        }
        const updated = applyTextChanges(
          current,
          fc.textChanges
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
 * it's reverted and skipped.
 */
function fixFileValidated(
  project: Project,
  fileName: string,
  formatOptions: ts.FormatCodeSettings,
  preferences: ts.UserPreferences,
  snapshots?: Map<string, string>
): number {
  let totalEdits = 0;
  let prevCount = -1;

  const nonIsoErrorCount = (): number =>
    project.languageService
      .getSemanticDiagnostics(fileName)
      .filter(
        (d) => !isIsolatedDeclarationsError(d.code)
      ).length;

  for (let round = 0; round < 50; round++) {
    const diags = project.languageService
      .getSemanticDiagnostics(fileName)
      .filter(
        (d) =>
          isIsolatedDeclarationsError(d.code) &&
          d.start !== undefined
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
            preferences
          );
      } catch {
        continue;
      }

      const action =
        fixes.find((f) => f.fixId === FIX_ID) ??
        fixes[0];
      if (!action || action.changes.length === 0) {
        continue;
      }

      const saved = new Map<string, string>();
      for (const fc of action.changes) {
        saved.set(
          fc.fileName,
          project.getFileContent(fc.fileName)
        );
      }
      const errorsBefore = nonIsoErrorCount();

      let applied = false;
      let editsThisFix = 0;
      for (const fc of action.changes) {
        if (fc.textChanges.length === 0) continue;
        const current = project.getFileContent(
          fc.fileName
        );
        if (snapshots && !snapshots.has(fc.fileName)) {
          snapshots.set(fc.fileName, current);
        }
        const updated = applyTextChanges(
          current,
          fc.textChanges
        );
        project.updateFile(fc.fileName, updated);
        editsThisFix += fc.textChanges.length;
        applied = true;
      }

      if (!applied) continue;

      const errorsAfter = nonIsoErrorCount();
      if (errorsAfter > errorsBefore) {
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

// ── Core fix phases ──────────────────────────────────

/**
 * Multi-pass combined code fix loop + final sweep.
 * Applies getCombinedCodeFix with fallback to
 * per-diagnostic fixing.
 */
function runCoreFixes(ctx: FixContext): void {
  for (let pass = 1; pass <= ctx.maxPasses; pass++) {
    ctx.passes = pass;
    let changesThisPass = 0;
    let filesFixedThisPass = 0;
    const program =
      ctx.project.languageService.getProgram();
    if (!program) {
      throw new Error(
        "Failed to get program from language service"
      );
    }

    const sourceFiles = program.getSourceFiles();
    for (const sourceFile of sourceFiles) {
      if (
        sourceFile.fileName.includes("node_modules")
      )
        continue;
      if (sourceFile.isDeclarationFile) continue;

      let combinedFix: ts.CombinedCodeActions;
      try {
        combinedFix =
          ctx.project.languageService.getCombinedCodeFix(
            {
              type: "file",
              fileName: sourceFile.fileName,
            },
            FIX_ID,
            ctx.formatOptions,
            ctx.preferences
          );
      } catch (err) {
        let fallbackEdits = 0;
        try {
          fallbackEdits = fixFileFallback(
            ctx.project,
            sourceFile.fileName,
            ctx.formatOptions,
            ctx.preferences,
            ctx.snapshots
          );
        } catch {
          // fallback also failed
        }

        if (fallbackEdits > 0) {
          ctx.filesChanged.add(sourceFile.fileName);
          ctx.filesSkipped.delete(
            sourceFile.fileName
          );
          changesThisPass++;
          filesFixedThisPass++;
          ctx.onProgress?.({
            type: "file",
            fileName: sourceFile.fileName,
            edits: fallbackEdits,
          });
        } else if (
          !ctx.filesChanged.has(sourceFile.fileName)
        ) {
          const msg =
            err instanceof Error
              ? err.message
              : String(err);
          ctx.filesSkipped.set(
            sourceFile.fileName,
            msg
          );
          ctx.onProgress?.({
            type: "file-error",
            fileName: sourceFile.fileName,
            message: msg,
          });
        }

        ctx.onProgress?.({
          type: "file-scanned",
          fileName: sourceFile.fileName,
        });
        continue;
      }

      ctx.onProgress?.({
        type: "file-scanned",
        fileName: sourceFile.fileName,
      });

      if (combinedFix.changes.length === 0) continue;

      if (ctx.verbose) {
        console.log(
          `  Pass ${pass}: ${sourceFile.fileName}`
        );
      }

      let fileEdits = 0;
      for (const fileChange of combinedFix.changes) {
        if (fileChange.textChanges.length === 0)
          continue;
        const current = ctx.project.getFileContent(
          fileChange.fileName
        );
        if (!ctx.snapshots.has(fileChange.fileName)) {
          ctx.snapshots.set(
            fileChange.fileName,
            current
          );
        }
        const newContent = applyTextChanges(
          current,
          fileChange.textChanges
        );
        ctx.project.updateFile(
          fileChange.fileName,
          newContent
        );
        ctx.filesChanged.add(fileChange.fileName);
        changesThisPass++;
        fileEdits += fileChange.textChanges.length;
      }

      filesFixedThisPass++;
      ctx.onProgress?.({
        type: "file",
        fileName: sourceFile.fileName,
        edits: fileEdits,
      });
    }

    ctx.onProgress?.({
      type: "pass-complete",
      pass,
      filesFixed: filesFixedThisPass,
    });

    if (changesThisPass === 0) break;
    ctx.totalChanges += changesThisPass;
  }

  // Final sweep: pick up fixes that
  // getCombinedCodeFix misses.
  let sweepFixed = 0;
  const programSweep =
    ctx.project.languageService.getProgram();
  if (programSweep) {
    for (const sf of programSweep.getSourceFiles()) {
      if (sf.fileName.includes("node_modules"))
        continue;
      if (sf.isDeclarationFile) continue;

      const edits = fixFileFallback(
        ctx.project,
        sf.fileName,
        ctx.formatOptions,
        ctx.preferences,
        ctx.snapshots
      );
      if (edits > 0) {
        ctx.filesChanged.add(sf.fileName);
        ctx.filesSkipped.delete(sf.fileName);
        sweepFixed++;
        ctx.onProgress?.({
          type: "file",
          fileName: sf.fileName,
          edits,
        });
      }
    }
  }
  if (sweepFixed > 0) {
    ctx.totalChanges += sweepFixed;
    ctx.onProgress?.({
      type: "pass-complete",
      pass: ctx.passes + 1,
      filesFixed: sweepFixed,
    });
    ctx.passes++;
  }
}

/**
 * TS9020: enum member initializers that reference
 * external symbols. TypeScript provides no fix for
 * this — we inline the constant value ourselves.
 */
function runEnumFixer(ctx: FixContext): void {
  const programEnum =
    ctx.project.languageService.getProgram();
  if (!programEnum) return;

  const checker = programEnum.getTypeChecker();
  for (const sf of programEnum.getSourceFiles()) {
    if (sf.fileName.includes("node_modules")) continue;
    if (sf.isDeclarationFile) continue;

    const diags = ctx.project.languageService
      .getSemanticDiagnostics(sf.fileName)
      .filter(
        (d) => d.code === 9020 && d.start !== undefined
      );
    if (diags.length === 0) continue;

    let content = ctx.project.getFileContent(
      sf.fileName
    );
    if (!ctx.snapshots.has(sf.fileName)) {
      ctx.snapshots.set(sf.fileName, content);
    }
    let src = ts.createSourceFile(
      sf.fileName,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    let enumFixed = 0;
    const sorted = [...diags].sort(
      (a, b) => b.start! - a.start!
    );
    for (const d of sorted) {
      const pos = d.start!;
      const node = findEnumMemberAt(src, pos);
      if (!node) continue;

      const progSf = programEnum.getSourceFile(
        sf.fileName
      );
      if (!progSf) continue;
      const member = findEnumMemberAt(progSf, pos);
      if (!member) continue;

      let val = checker.getConstantValue(
        member as ts.EnumMember
      );
      if (val === undefined) {
        const init2 = (member as ts.EnumMember)
          .initializer;
        if (init2) {
          const t = checker.getTypeAtLocation(init2);
          if (t.isStringLiteral()) {
            val = t.value;
          } else if (t.isNumberLiteral()) {
            val = t.value;
          }
        }
      }
      if (val === undefined) continue;

      const init = (member as ts.EnumMember)
        .initializer;
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

      src = ts.createSourceFile(
        sf.fileName,
        content,
        ts.ScriptTarget.Latest,
        true
      );
    }

    if (enumFixed > 0) {
      ctx.project.updateFile(sf.fileName, content);
      ctx.filesChanged.add(sf.fileName);
      ctx.filesSkipped.delete(sf.fileName);
      ctx.totalChanges += enumFixed;
      ctx.onProgress?.({
        type: "file",
        fileName: sf.fileName,
        edits: enumFixed,
      });
    }
  }
}

/**
 * Last-resort fixer for iso-decl errors that the
 * built-in TS fixer can't handle or whose fixes
 * were rolled back by validation:
 *
 * TS9010 — variable needs explicit type annotation:
 *   `export const X = createLazy(...)` →
 *   `export const X: ReturnType = createLazy(...)`
 *
 * TS9013 — expression type can't be inferred:
 *   `component: Comp` → `component: Comp as typeof Comp`
 *   Only for identifiers and dotted names.
 *
 * TS9017 — only const arrays can be inferred:
 *   `["autodocs"]` → `["autodocs"] as const`
 *
 * TS9037 — default export can't be inferred:
 *   `export default memo(X)` →
 *   `export default (memo(X)) as <serialized type>`
 */
/**
 * Find the innermost AST node whose span exactly
 * matches [start, start+length).
 */
function findNodeCoveringSpan(
  sf: ts.SourceFile,
  start: number,
  length: number
): ts.Node | undefined {
  const end = start + length;
  function visit(
    node: ts.Node
  ): ts.Node | undefined {
    const ns = node.getStart(sf);
    const ne = node.getEnd();
    if (ns === start && ne === end) return node;
    if (ns <= start && ne >= end) {
      return ts.forEachChild(node, visit);
    }
    return undefined;
  }
  return visit(sf);
}

/** True for Identifier or X.Y.Z property chains. */
function isTypeofTarget(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return true;
  if (ts.isPropertyAccessExpression(node)) {
    return isTypeofTarget(node.expression);
  }
  return false;
}

const typeAsserPrinter = ts.createPrinter();

/**
 * Replace destructured parameter binding patterns
 * with simple identifiers in a type node.
 *
 * checker.typeToTypeNode() preserves destructured
 * parameter names including renames like
 * `{ enabled: enabledInternal }`. In a type position
 * TS interprets `enabled: enabledInternal` as a type
 * annotation, causing TS2842. Fix by replacing the
 * entire binding pattern with a plain identifier.
 */
function sanitizeTypeNode(
  typeNode: ts.TypeNode
): ts.TypeNode {
  const result = ts.transform(typeNode, [
    (context) => {
      const visitor: ts.Visitor<
        ts.Node,
        ts.Node
      > = (node) => {
        if (
          ts.isParameter(node) &&
          (ts.isObjectBindingPattern(node.name) ||
            ts.isArrayBindingPattern(node.name))
        ) {
          return ts.factory.createParameterDeclaration(
            node.modifiers,
            node.dotDotDotToken,
            ts.factory.createIdentifier("args"),
            node.questionToken,
            node.type,
            node.initializer
          );
        }
        return ts.visitEachChild(
          node,
          visitor,
          context
        );
      };
      return (rootNode) =>
        ts.visitNode(
          rootNode,
          visitor
        ) as ts.TypeNode;
    },
  ]);
  const sanitized = result.transformed[0];
  result.dispose();
  return sanitized;
}

function runExpressionFixer(ctx: FixContext): void {
  const program =
    ctx.project.languageService.getProgram();
  if (!program) return;
  const checker = program.getTypeChecker();

  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes("node_modules")) continue;
    if (sf.isDeclarationFile) continue;

    const diags = ctx.project.languageService
      .getSemanticDiagnostics(sf.fileName)
      .filter(
        (d) =>
          (d.code === 9010 ||
            d.code === 9013 ||
            d.code === 9017 ||
            d.code === 9037) &&
          d.start !== undefined
      );
    if (diags.length === 0) continue;

    let content = ctx.project.getFileContent(
      sf.fileName
    );
    if (!ctx.snapshots.has(sf.fileName)) {
      ctx.snapshots.set(sf.fileName, content);
    }

    let fixed = 0;
    const sorted = [...diags].sort(
      (a, b) => b.start! - a.start!
    );
    for (const d of sorted) {
      const pos = d.start!;
      const end = pos + (d.length ?? 0);
      const exprText = content.slice(pos, end);

      // TS9010: variable needs type annotation.
      // Diagnostic span covers the variable name;
      // insert `: Type` right after it.
      if (d.code === 9010) {
        const nameNode = findNodeCoveringSpan(
          sf,
          pos,
          d.length ?? 0
        );
        if (!nameNode) {
          if (ctx.verbose) {
            console.log(
              `  TS9010 skip: no AST node at ` +
                `[${pos},${end}) in ${sf.fileName}`
            );
          }
          continue;
        }
        const varDecl = nameNode.parent;
        if (
          !ts.isVariableDeclaration(varDecl) ||
          !varDecl.initializer ||
          varDecl.type
        ) {
          if (ctx.verbose) {
            console.log(
              `  TS9010 skip: not a bare ` +
                `variable declaration ` +
                `(${exprText})`
            );
          }
          continue;
        }

        const type = checker.getTypeAtLocation(
          varDecl.initializer
        );
        if (type.flags & ts.TypeFlags.Any) {
          if (ctx.verbose) {
            console.log(
              `  TS9010 skip: type is any ` +
                `(${exprText})`
            );
          }
          continue;
        }

        const typeNode = checker.typeToTypeNode(
          type,
          varDecl,
          ts.NodeBuilderFlags.NoTruncation
        );
        if (!typeNode) {
          if (ctx.verbose) {
            console.log(
              `  TS9010 skip: typeToTypeNode ` +
                `returned null (${exprText})`
            );
          }
          continue;
        }

        const sanitized = sanitizeTypeNode(typeNode);
        const typeText =
          typeAsserPrinter.printNode(
            ts.EmitHint.Unspecified,
            sanitized,
            sf
          );

        content =
          content.slice(0, end) +
          `: ${typeText}` +
          content.slice(end);
        fixed++;
        continue;
      }

      if (d.code === 9017) {
        content =
          content.slice(0, end) +
          " as const" +
          content.slice(end);
        fixed++;
        continue;
      }

      // TS9013: find the AST node for the expr
      const node = findNodeCoveringSpan(
        sf,
        pos,
        d.length ?? 0
      );
      if (!node) continue;

      if (isTypeofTarget(node)) {
        // Identifier or A.B.C → `as typeof expr`
        content =
          content.slice(0, end) +
          ` as typeof ${exprText}` +
          content.slice(end);
        fixed++;
      } else {
        // Complex expression → checker-serialized type
        const type = checker.getTypeAtLocation(node);
        if (type.flags & ts.TypeFlags.Any) continue;

        const typeNode = checker.typeToTypeNode(
          type,
          node,
          ts.NodeBuilderFlags.NoTruncation
        );
        if (!typeNode) continue;

        const sanitized = sanitizeTypeNode(typeNode);
        const typeText = typeAsserPrinter.printNode(
          ts.EmitHint.Unspecified,
          sanitized,
          sf
        );
        content =
          content.slice(0, pos) +
          `(${exprText}) as ${typeText}` +
          content.slice(end);
        fixed++;
      }
    }

    if (fixed > 0) {
      ctx.project.updateFile(sf.fileName, content);
      ctx.filesChanged.add(sf.fileName);
      ctx.filesSkipped.delete(sf.fileName);
      ctx.totalChanges += fixed;
      ctx.onProgress?.({
        type: "file",
        fileName: sf.fileName,
        edits: fixed,
      });
    }
  }
}

/**
 * Validate changed files for NEW non-iso errors.
 * Tries organizeImports and bare Promise repair
 * before reverting. Falls back to validated
 * per-diagnostic retry.
 */
function runValidation(ctx: FixContext): void {
  for (const fileName of [...ctx.filesChanged]) {
    const original = ctx.snapshots.get(fileName);
    if (original === undefined) continue;

    let errors = ctx.project.languageService
      .getSemanticDiagnostics(fileName)
      .filter(
        (d) => !isIsolatedDeclarationsError(d.code)
      );
    if (errors.length === 0) continue;

    const fixedContent =
      ctx.project.getFileContent(fileName);
    ctx.project.updateFile(fileName, original);
    const beforeCount = ctx.project.languageService
      .getSemanticDiagnostics(fileName)
      .filter(
        (d) => !isIsolatedDeclarationsError(d.code)
      ).length;
    ctx.project.updateFile(fileName, fixedContent);

    if (errors.length <= beforeCount) continue;

    // Try organizeImports for import corruption.
    const hasImportIssues = errors.some(
      (d) =>
        d.code === 2300 ||
        d.code === 2440 ||
        d.code === 2395
    );
    if (hasImportIssues) {
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
        errors = ctx.project.languageService
          .getSemanticDiagnostics(fileName)
          .filter(
            (d) =>
              !isIsolatedDeclarationsError(d.code)
          );
      } catch {
        // organizeImports failed
      }
    }

    // Try bare Promise → Promise<void> repair.
    const hasBarePromise = errors.some(
      (d) =>
        d.code === 2314 &&
        typeof d.messageText === "string" &&
        d.messageText.includes("Promise")
    );
    if (hasBarePromise) {
      try {
        const content =
          ctx.project.getFileContent(fileName);
        const patched = content.replace(
          /(?<=:\s*)Promise\b(?!\s*<)/g,
          "Promise<void>"
        );
        if (patched !== content) {
          ctx.project.updateFile(fileName, patched);
          errors = ctx.project.languageService
            .getSemanticDiagnostics(fileName)
            .filter(
              (d) =>
                !isIsolatedDeclarationsError(d.code)
            );
        }
      } catch {
        // repair failed
      }
    }

    if (errors.length > beforeCount) {
      // Revert and retry with validated approach.
      ctx.project.updateFile(fileName, original);
      ctx.filesChanged.delete(fileName);

      let retryEdits = 0;
      try {
        retryEdits = fixFileValidated(
          ctx.project,
          fileName,
          ctx.formatOptions,
          ctx.preferences,
          ctx.snapshots
        );
      } catch {
        // validated retry also failed
      }

      if (retryEdits > 0) {
        ctx.filesChanged.add(fileName);
        ctx.filesSkipped.delete(fileName);
        ctx.onProgress?.({
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
                : d.messageText.messageText
            )
            .slice(0, 3)
            .join("; ");
        ctx.filesSkipped.set(fileName, msg);
        ctx.onProgress?.({
          type: "file-error",
          fileName,
          message: msg,
        });
      }
    }
  }
}

/**
 * Check for remaining isolatedDeclarations errors
 * and build the final result.
 */
function buildResult(ctx: FixContext): FixResult {
  const remainingErrors = new Map<string, number>();
  const programCheck =
    ctx.project.languageService.getProgram();
  if (programCheck) {
    for (const sf of programCheck.getSourceFiles()) {
      if (sf.fileName.includes("node_modules"))
        continue;
      if (sf.isDeclarationFile) continue;

      const count = ctx.project.languageService
        .getSemanticDiagnostics(sf.fileName)
        .filter((d) =>
          isIsolatedDeclarationsError(d.code)
        ).length;
      if (count > 0) {
        remainingErrors.set(sf.fileName, count);
      }
    }
  }

  return {
    totalChanges: ctx.totalChanges,
    filesChanged: ctx.filesChanged,
    filesSkipped: ctx.filesSkipped,
    remainingErrors,
    passes: ctx.passes,
  };
}

// ── Public API ───────────────────────────────────────

export function fix(
  project: Project,
  options: FixOptions = {}
): FixResult {
  const {
    maxPasses = 5,
    verbose = false,
    rewriteInlineImports = true,
    typeofIntersection = true,
    tupleSpreadCollapse = true,
    extractTypes = true,
    collapseUnions = true,
    genericAlias = true,
    stripInnerReturnTypes = true,
    banTypes = true,
    onProgress,
  } = options;

  const ctx: FixContext = {
    project,
    maxPasses,
    verbose,
    rewriteInlineImports,
    typeofIntersection,
    tupleSpreadCollapse,
    extractTypes,
    extractThreshold: options.extractThreshold ?? 5,
    collapseUnions,
    genericAlias,
    stripInnerReturnTypes,
    banTypes,
    onProgress,
    filesChanged: new Set(),
    filesSkipped: new Map(),
    snapshots: new Map(),
    totalChanges: 0,
    passes: 0,
    formatOptions: ts.getDefaultFormatCodeSettings(),
    preferences: {},
  };

  runCoreFixes(ctx);
  runEnumFixer(ctx);

  const transforms: ReadabilityTransform[] = [
    typeofIntersectionTransform,
    tupleSpreadCollapseTransform,
    createExtractTypesTransform(),
    inlineImportsTransform,
    collapseUnionsTransform,
    genericAliasTransform,
    stripInnerReturnTypesTransform,
    banTypesTransform,
  ];
  const transformCtx: TransformContext = {
    project: ctx.project,
    filesChanged: ctx.filesChanged,
    snapshots: ctx.snapshots,
    formatOptions: ctx.formatOptions,
    preferences: ctx.preferences,
    onProgress: ctx.onProgress,
  };
  const transformOptions: TransformOptions = {
    rewriteInlineImports: ctx.rewriteInlineImports,
    typeofIntersection: ctx.typeofIntersection,
    tupleSpreadCollapse: ctx.tupleSpreadCollapse,
    extractTypes: ctx.extractTypes,
    extractThreshold: ctx.extractThreshold,
    collapseUnions: ctx.collapseUnions,
    genericAlias: ctx.genericAlias,
    stripInnerReturnTypes: ctx.stripInnerReturnTypes,
    banTypes: ctx.banTypes,
    verbose: ctx.verbose,
  };
  runTransformPipeline(
    transforms,
    transformCtx,
    transformOptions
  );

  runValidation(ctx);

  // Expression fixer runs after validation so its
  // changes aren't reverted when validation rolls
  // back bad built-in fixes. Re-run inline-imports
  // to rewrite any import() types that
  // typeToTypeNode() generates.
  const changesBefore = ctx.totalChanges;
  runExpressionFixer(ctx);
  if (
    ctx.rewriteInlineImports &&
    ctx.totalChanges > changesBefore
  ) {
    for (const fn of ctx.filesChanged) {
      inlineImportsTransform.transformFile(
        fn,
        transformCtx
      );
    }
  }

  return buildResult(ctx);
}
