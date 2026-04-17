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
import { jestMockTransform } from "./transforms/jest-mock.ts";
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
  jestMock?: boolean;
  expandoFix?: boolean;
  /** Skip the validation rollback phase. Faster for large packages where
   *  fixes are unlikely to introduce new non-isolated-declarations errors. */
  skipValidation?: boolean;
  /** Run only the core fix passes (Pass 1 + enum) and skip all post-processing
   *  (transforms, validation, expando, expression fixer, buildResult scan).
   *  Fastest mode — use for large packages where post-processing is too slow. */
  coreOnly?: boolean;
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
  jestMock: boolean;
  expandoFix: boolean;
  skipValidation: boolean;
  coreOnly: boolean;
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
  function visit(node: ts.Node): ts.EnumMember | undefined {
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
        (d) => isIsolatedDeclarationsError(d.code) && d.start !== undefined
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
        fixes = project.languageService.getCodeFixesAtPosition(
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

      const action = fixes.find((f) => f.fixId === FIX_ID) ?? fixes[0];
      if (!action || action.changes.length === 0) {
        continue;
      }

      let applied = false;
      for (const fc of action.changes) {
        if (fc.textChanges.length === 0) continue;
        const current = project.getFileContent(fc.fileName);
        if (snapshots && !snapshots.has(fc.fileName)) {
          snapshots.set(fc.fileName, current);
        }
        const updated = applyTextChanges(current, fc.textChanges);
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
      .filter((d) => !isIsolatedDeclarationsError(d.code)).length;

  for (let round = 0; round < 50; round++) {
    const diags = project.languageService
      .getSemanticDiagnostics(fileName)
      .filter(
        (d) => isIsolatedDeclarationsError(d.code) && d.start !== undefined
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
        fixes = project.languageService.getCodeFixesAtPosition(
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

      const action = fixes.find((f) => f.fixId === FIX_ID) ?? fixes[0];
      if (!action || action.changes.length === 0) {
        continue;
      }

      const saved = new Map<string, string>();
      for (const fc of action.changes) {
        saved.set(fc.fileName, project.getFileContent(fc.fileName));
      }
      const errorsBefore = nonIsoErrorCount();

      let applied = false;
      let editsThisFix = 0;
      for (const fc of action.changes) {
        if (fc.textChanges.length === 0) continue;
        const current = project.getFileContent(fc.fileName);
        if (snapshots && !snapshots.has(fc.fileName)) {
          snapshots.set(fc.fileName, current);
        }
        const updated = applyTextChanges(current, fc.textChanges);
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
    const program = ctx.project.languageService.getProgram();
    if (!program) {
      throw new Error("Failed to get program from language service");
    }

    const sourceFiles = program.getSourceFiles();
    for (const sourceFile of sourceFiles) {
      if (sourceFile.fileName.includes("node_modules")) continue;
      if (sourceFile.isDeclarationFile) continue;

      let combinedFix: ts.CombinedCodeActions;
      try {
        combinedFix = ctx.project.languageService.getCombinedCodeFix(
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
          ctx.filesSkipped.delete(sourceFile.fileName);
          changesThisPass++;
          filesFixedThisPass++;
          ctx.onProgress?.({
            type: "file",
            fileName: sourceFile.fileName,
            edits: fallbackEdits,
          });
        } else if (!ctx.filesChanged.has(sourceFile.fileName)) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.filesSkipped.set(sourceFile.fileName, msg);
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
        console.log(`  Pass ${pass}: ${sourceFile.fileName}`);
      }

      let fileEdits = 0;
      for (const fileChange of combinedFix.changes) {
        if (fileChange.textChanges.length === 0) continue;
        const current = ctx.project.getFileContent(fileChange.fileName);
        if (!ctx.snapshots.has(fileChange.fileName)) {
          ctx.snapshots.set(fileChange.fileName, current);
        }
        const newContent = applyTextChanges(current, fileChange.textChanges);
        ctx.project.updateFile(fileChange.fileName, newContent);
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

  // Final sweep: pick up fixes that getCombinedCodeFix misses.
  // Only check files that were skipped by the main pass — files already
  // in filesChanged are fixed, and files with no diagnostics don't need
  // the fallback. Scanning all source files is too expensive for large pkgs.
  // Skip entirely in --core-only mode.
  if (ctx.coreOnly) return;
  let sweepFixed = 0;
  const programSweep = ctx.project.languageService.getProgram();
  if (programSweep) {
    const sweepCandidates = new Set(ctx.filesSkipped.keys());
    for (const sf of programSweep.getSourceFiles()) {
      if (sf.fileName.includes("node_modules")) continue;
      if (sf.isDeclarationFile) continue;
      if (!sweepCandidates.has(sf.fileName)) continue;

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
  const programEnum = ctx.project.languageService.getProgram();
  if (!programEnum) return;

  const checker = programEnum.getTypeChecker();
  // Only scan changed files — avoid full-project diagnostic scan.
  const enumFilesToScan = new Set(ctx.filesChanged);
  for (const sf of programEnum.getSourceFiles()) {
    if (sf.fileName.includes("node_modules")) continue;
    if (sf.isDeclarationFile) continue;
    if (!enumFilesToScan.has(sf.fileName)) continue;

    const diags = ctx.project.languageService
      .getSemanticDiagnostics(sf.fileName)
      .filter((d) => d.code === 9020 && d.start !== undefined);
    if (diags.length === 0) continue;

    let content = ctx.project.getFileContent(sf.fileName);
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
    const sorted = [...diags].sort((a, b) => b.start! - a.start!);
    for (const d of sorted) {
      const pos = d.start!;
      const node = findEnumMemberAt(src, pos);
      if (!node) continue;

      const progSf = programEnum.getSourceFile(sf.fileName);
      if (!progSf) continue;
      const member = findEnumMemberAt(progSf, pos);
      if (!member) continue;

      let val = checker.getConstantValue(member as ts.EnumMember);
      if (val === undefined) {
        const init2 = (member as ts.EnumMember).initializer;
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

      const init = (member as ts.EnumMember).initializer;
      if (!init) continue;

      const replacement =
        typeof val === "string" ? JSON.stringify(val) : String(val);

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
 * TS9023: assigning properties to functions without
 * declaring them. The built-in TS fixer generates
 * `export declare namespace` which causes TS2300 for
 * function-typed properties. We use a non-declare
 * namespace with the initialiser moved inside and
 * `const` (OXC rejects `var` in namespace exports):
 *
 *   handler.version = 1;
 *   router.get = (path: string) => {};
 *   →  (delete assignments)
 *   +  export namespace handler {
 *        export const version: number = 1;
 *      }
 *   +  export namespace router {
 *        export const get: (path: string) => void
 *          = (path: string) => {};
 *      }
 *
 * Non-declare namespaces MUST be placed AFTER the
 * function declaration they merge with (TS2434).
 * Namespace merge only works with `function`
 * declarations — `const` arrow functions are skipped.
 *
 * Runs after validation so its changes survive
 * rollbacks of the built-in fix.
 */
function runExpandoFixer(ctx: FixContext): void {
  const program = ctx.project.languageService.getProgram();
  if (!program) return;

  const checker = program.getTypeChecker();
  const printer = ts.createPrinter();

  // Only scan files we changed — avoid full-project diagnostic scan.
  const filesToScan = new Set(ctx.filesChanged);
  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes("node_modules")) continue;
    if (sf.isDeclarationFile) continue;
    if (!filesToScan.has(sf.fileName)) continue;

    const diags = ctx.project.languageService
      .getSemanticDiagnostics(sf.fileName)
      .filter((d) => d.code === 9023 && d.start !== undefined);
    if (diags.length === 0) continue;

    let content = ctx.project.getFileContent(sf.fileName);
    if (!ctx.snapshots.has(sf.fileName)) {
      ctx.snapshots.set(sf.fileName, content);
    }
    const src = ts.createSourceFile(
      sf.fileName,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    // Collect property assignments grouped by
    // target function, preserving order.
    interface PropInfo {
      prop: string;
      typeStr: string;
      initText: string;
      stmtStart: number;
      stmtEnd: number;
    }
    const groups = new Map<string, { props: PropInfo[]; funcEnd: number }>();

    for (const d of diags) {
      const assign = findExpandoAssignment(src, d.start!);
      if (!assign) continue;

      const progSf = program.getSourceFile(sf.fileName);
      if (!progSf) continue;
      const progAssign = findExpandoAssignment(progSf, d.start!);
      if (!progAssign) continue;

      const rawType = checker.getTypeAtLocation(progAssign.right);
      // Widen literal types ("foo" → string,
      // 42 → number) to match what tsc emits.
      const rightType = checker.getBaseTypeOfLiteralType(rawType);
      const typeNode = checker.typeToTypeNode(
        rightType,
        progAssign.stmt,
        ts.NodeBuilderFlags.NoTruncation
      );
      const typeStr = typeNode
        ? printer.printNode(ts.EmitHint.Unspecified, typeNode, progSf)
        : "unknown";

      const funcName = assign.funcName;
      if (!groups.has(funcName)) {
        // Namespace only merges with function
        // declarations (not const/let/var).
        const funcDecl = findFunctionDecl(src, funcName);
        if (!funcDecl) continue;
        groups.set(funcName, {
          props: [],
          funcEnd: funcDecl.getEnd(),
        });
      }
      groups.get(funcName)!.props.push({
        prop: assign.propName,
        typeStr,
        initText: assign.right.getText(src),
        stmtStart: assign.stmt.getStart(src),
        stmtEnd: assign.stmt.getEnd(),
      });
    }

    if (groups.size === 0) continue;

    // Build edits: delete original assignments,
    // remove stale declare namespaces left by the
    // built-in fixer, and insert our non-declare
    // namespace after the function declaration.
    interface Edit {
      start: number;
      end: number;
      replacement: string;
    }
    const edits: Edit[] = [];
    let expandoFixed = 0;

    // Remove existing declare namespace blocks
    // that the built-in fixer's loop created.
    for (const stmt of src.statements) {
      if (
        ts.isModuleDeclaration(stmt) &&
        stmt.name &&
        groups.has(stmt.name.text) &&
        // Only remove ambient (declare) namespaces
        // — never remove user-written namespaces.
        !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)
      ) {
        let delEnd = stmt.getEnd();
        if (content[delEnd] === "\n") delEnd++;
        edits.push({
          start: stmt.getStart(src),
          end: delEnd,
          replacement: "",
        });
      }
    }

    for (const [funcName, group] of groups) {
      // Delete all assignment statements.
      for (const p of group.props) {
        let delEnd = p.stmtEnd;
        if (content[delEnd] === "\n") delEnd++;
        edits.push({
          start: p.stmtStart,
          end: delEnd,
          replacement: "",
        });
        expandoFixed++;
      }

      const members = group.props
        .map(
          (p) => `  export const ${p.prop}` + `: ${p.typeStr} = ${p.initText};`
        )
        .join("\n");
      const ns = `\n\nexport namespace ${funcName} {\n` + members + "\n}\n";

      // Insert namespace right after the function
      // declaration (TS2434: must come after).
      edits.push({
        start: group.funcEnd,
        end: group.funcEnd,
        replacement: ns,
      });
    }

    edits.sort((a, b) => b.start - a.start);
    for (const e of edits) {
      content =
        content.slice(0, e.start) + e.replacement + content.slice(e.end);
    }

    if (expandoFixed > 0) {
      ctx.project.updateFile(sf.fileName, content);
      ctx.filesChanged.add(sf.fileName);
      ctx.filesSkipped.delete(sf.fileName);
      ctx.totalChanges += expandoFixed;
      ctx.onProgress?.({
        type: "file",
        fileName: sf.fileName,
        edits: expandoFixed,
      });
    }
  }
}

/** Find a function declaration by name. */
function findFunctionDecl(
  sf: ts.SourceFile,
  name: string
): ts.FunctionDeclaration | undefined {
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
      return stmt;
    }
  }
  return undefined;
}

/** Find the expando assignment at a diagnostic pos. */
function findExpandoAssignment(
  sf: ts.SourceFile,
  pos: number
): {
  funcName: string;
  propName: string;
  right: ts.Expression;
  stmt: ts.ExpressionStatement;
} | null {
  for (const stmt of sf.statements) {
    if (!ts.isExpressionStatement(stmt)) continue;
    const expr = stmt.expression;
    if (
      !ts.isBinaryExpression(expr) ||
      expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken
    )
      continue;
    const left = expr.left;
    if (!ts.isPropertyAccessExpression(left)) continue;
    if (left.getStart(sf) !== pos) continue;

    return {
      funcName: left.expression.getText(sf),
      propName: left.name.text,
      right: expr.right,
      stmt,
    };
  }
  return null;
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
  function visit(node: ts.Node): ts.Node | undefined {
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

/** Get the root Identifier of a dotted chain. */
function getRootIdentifier(node: ts.Node): ts.Identifier | undefined {
  if (ts.isIdentifier(node)) return node;
  if (ts.isPropertyAccessExpression(node)) {
    return getRootIdentifier(node.expression);
  }
  return undefined;
}

/**
 * True when the root identifier of a typeof target
 * is a destructured binding element.
 * OXC rejects typeof references to binding elements
 * with TS9019 even when the variable isn't exported.
 */
function refsBindingElement(node: ts.Node, checker: ts.TypeChecker): boolean {
  const root = getRootIdentifier(node);
  if (!root) return false;
  const sym = checker.getSymbolAtLocation(root);
  if (!sym?.valueDeclaration) return false;
  return ts.isBindingElement(sym.valueDeclaration);
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
function sanitizeTypeNode(typeNode: ts.TypeNode): ts.TypeNode {
  const result = ts.transform(typeNode, [
    (context) => {
      const visitor: ts.Visitor<ts.Node, ts.Node> = (node) => {
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
        return ts.visitEachChild(node, visitor, context);
      };
      return (rootNode) => ts.visitNode(rootNode, visitor) as ts.TypeNode;
    },
  ]);
  const sanitized = result.transformed[0];
  result.dispose();
  return sanitized;
}

const EXPR_FIXER_CODES = new Set([9010, 9013, 9017, 9037]);

interface ExpressionFixResult {
  content: string;
  /**
   * Safe fixes only reference existing names
   * (typeof X, as const) and skip validation.
   * Unsafe fixes use typeToTypeNode() which may
   * produce types with unimported names.
   */
  safe: boolean;
}

/**
 * Serialize a type via the checker and sanitize the
 * output. Returns null when the type can't be
 * serialized (private names, cycles, etc).
 */
function serializeType(
  checker: ts.TypeChecker,
  node: ts.Node,
  sf: ts.SourceFile
): string | null {
  const type = checker.getTypeAtLocation(node);
  if (type.flags & ts.TypeFlags.Any) return null;

  const typeNode = checker.typeToTypeNode(
    type,
    node,
    ts.NodeBuilderFlags.NoTruncation
  );
  if (!typeNode) return null;

  const sanitized = sanitizeTypeNode(typeNode);
  return typeAsserPrinter.printNode(ts.EmitHint.Unspecified, sanitized, sf);
}

/** True for `||` or `??` binary expressions. */
function isFallbackExpr(node: ts.Node): node is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  );
}

/**
 * Try to fix a single diagnostic. Returns modified
 * content or null if unfixable.
 *
 * Fix strategies by priority:
 *  TS9010 — insert `: SerializedType` on variable
 *  TS9017 — append `as const`
 *  Identifier/dotted name — `as typeof expr`
 *  X || Y where X is dotted — `as typeof X`
 *  Complex expression — `(expr) as SerializedType`
 *
 * typeof paths skip binding elements (OXC TS9019).
 */
function computeExpressionFix(
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
  d: ts.Diagnostic,
  content: string
): ExpressionFixResult | null {
  const pos = d.start!;
  const end = pos + (d.length ?? 0);
  const exprText = content.slice(pos, end);

  // TS9010: variable needs `: Type` annotation.
  if (d.code === 9010) {
    const nameNode = findNodeCoveringSpan(sf, pos, d.length ?? 0);
    if (!nameNode) return null;
    const varDecl = nameNode.parent;
    if (
      !ts.isVariableDeclaration(varDecl) ||
      !varDecl.initializer ||
      varDecl.type
    )
      return null;

    const typeText = serializeType(checker, varDecl.initializer, sf);
    if (!typeText) return null;

    return {
      content: content.slice(0, end) + `: ${typeText}` + content.slice(end),
      safe: false,
    };
  }

  // TS9017: array literal needs explicit type.
  // Prefer a checker-serialized type over `as const` to avoid
  // producing `readonly` tuple types that break assignments where
  // a mutable `string[]` (or similar) is expected.
  if (d.code === 9017) {
    const node = findNodeCoveringSpan(sf, pos, d.length ?? 0);
    if (node) {
      const typeText = serializeType(checker, node, sf);
      if (typeText) {
        return {
          content:
            content.slice(0, pos) +
            `(${exprText}) as ${typeText}` +
            content.slice(end),
          safe: false,
        };
      }
    }
    // Fallback: `as const` (may produce a readonly tuple type).
    return {
      content: content.slice(0, end) + " as const" + content.slice(end),
      safe: true,
    };
  }

  // TS9013 / TS9037: expression needs type.
  const node = findNodeCoveringSpan(sf, pos, d.length ?? 0);
  if (!node) return null;

  // Identifier or A.B.C → `as typeof expr`.
  if (isTypeofTarget(node) && !refsBindingElement(node, checker)) {
    return {
      content:
        content.slice(0, end) + ` as typeof ${exprText}` + content.slice(end),
      safe: true,
    };
  }

  // X || Y / X ?? Y where X is a dotted name →
  // `(expr) as typeof X`.
  if (
    isFallbackExpr(node) &&
    isTypeofTarget(node.left) &&
    !refsBindingElement(node.left, checker)
  ) {
    const leftText = node.left.getText(sf);
    return {
      content:
        content.slice(0, pos) +
        `(${exprText}) as typeof ${leftText}` +
        content.slice(end),
      safe: true,
    };
  }

  // Last resort: checker-serialized type assertion.
  const typeText = serializeType(checker, node, sf);
  if (!typeText) return null;

  return {
    content:
      content.slice(0, pos) +
      `(${exprText}) as ${typeText}` +
      content.slice(end),
    safe: false,
  };
}

// ── Expression fixer helpers ─────────────────────

/** Count non-iso errors in a file. */
function nonIsoErrorCount(ctx: FixContext, fileName: string): number {
  return ctx.project.languageService
    .getSemanticDiagnostics(fileName)
    .filter((d) => !isIsolatedDeclarationsError(d.code)).length;
}

/** Record a file as changed by the expression fixer. */
function recordExprFix(ctx: FixContext, fileName: string, edits: number): void {
  ctx.filesChanged.add(fileName);
  ctx.filesSkipped.delete(fileName);
  ctx.totalChanges += edits;
  ctx.onProgress?.({
    type: "file",
    fileName,
    edits,
  });
}

/**
 * Per-fix validated fallback: apply one fix at a
 * time, keeping only those that don't introduce
 * non-iso errors.
 */
function fixExpressionValidated(ctx: FixContext, fileName: string): number {
  let totalFixed = 0;
  let prevCount = -1;

  for (let round = 0; round < 50; round++) {
    const prog = ctx.project.languageService.getProgram();
    if (!prog) break;
    const chk = prog.getTypeChecker();
    const curSf = prog.getSourceFile(fileName);
    if (!curSf) break;

    const diags = ctx.project.languageService
      .getSemanticDiagnostics(fileName)
      .filter((d) => EXPR_FIXER_CODES.has(d.code) && d.start !== undefined);

    if (diags.length === 0) break;
    if (diags.length === prevCount) break;
    prevCount = diags.length;

    let fixedAny = false;
    for (const d of diags) {
      const content = ctx.project.getFileContent(fileName);
      const errorsBefore = nonIsoErrorCount(ctx, fileName);

      const fix = computeExpressionFix(curSf, chk, d, content);
      if (!fix) continue;

      ctx.project.updateFile(fileName, fix.content);

      if (!fix.safe && nonIsoErrorCount(ctx, fileName) > errorsBefore) {
        ctx.project.updateFile(fileName, content);
        continue;
      }

      totalFixed++;
      fixedAny = true;
      break; // re-fetch diags, positions shifted
    }

    if (!fixedAny) break;
  }

  return totalFixed;
}

/**
 * Last-resort fixer for iso-decl errors the built-in
 * TS fixer can't handle. Runs after validation so
 * its changes survive rollbacks.
 *
 * Uses a batch fast-path when all fixes are safe.
 * Falls back to per-fix validation when any fix
 * uses typeToTypeNode() (which may produce types
 * with unimported names).
 */
function runExpressionFixer(ctx: FixContext): void {
  const program = ctx.project.languageService.getProgram();
  if (!program) return;
  const checker = program.getTypeChecker();

  // Only scan files we already changed — scanning all source files calls
  // getSemanticDiagnostics on every file in the project, which is a
  // full type-check that can take hours on large packages.
  const filesToScan = new Set(ctx.filesChanged);
  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes("node_modules")) continue;
    if (sf.isDeclarationFile) continue;
    if (!filesToScan.has(sf.fileName)) continue;

    const diags = ctx.project.languageService
      .getSemanticDiagnostics(sf.fileName)
      .filter((d) => EXPR_FIXER_CODES.has(d.code) && d.start !== undefined);
    if (diags.length === 0) continue;

    if (!ctx.snapshots.has(sf.fileName)) {
      ctx.snapshots.set(sf.fileName, ctx.project.getFileContent(sf.fileName));
    }

    // Batch: apply all fixes at once.
    let content = ctx.project.getFileContent(sf.fileName);
    let fixed = 0;
    let allSafe = true;
    const sorted = [...diags].sort((a, b) => b.start! - a.start!);
    for (const d of sorted) {
      const fix = computeExpressionFix(sf, checker, d, content);
      if (fix) {
        content = fix.content;
        if (!fix.safe) allSafe = false;
        fixed++;
      }
    }

    if (fixed === 0) continue;

    // Safe batch: skip validation entirely.
    if (allSafe) {
      ctx.project.updateFile(sf.fileName, content);
      recordExprFix(ctx, sf.fileName, fixed);
      continue;
    }

    // Unsafe batch: validate before applying.
    const before = ctx.project.getFileContent(sf.fileName);
    ctx.project.updateFile(sf.fileName, content);
    const after = nonIsoErrorCount(ctx, sf.fileName);
    ctx.project.updateFile(sf.fileName, before);

    if (after <= nonIsoErrorCount(ctx, sf.fileName)) {
      ctx.project.updateFile(sf.fileName, content);
      recordExprFix(ctx, sf.fileName, fixed);
      continue;
    }

    // Batch introduced errors — keep only safe
    // individual fixes via per-fix validation.
    const perFix = fixExpressionValidated(ctx, sf.fileName);
    if (perFix > 0) {
      recordExprFix(ctx, sf.fileName, perFix);
    } else {
      ctx.onProgress?.({
        type: "file-error",
        fileName: sf.fileName,
        message: "expression fixer: all fixes " + "introduce errors",
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
  if (ctx.skipValidation) return;
  for (const fileName of [...ctx.filesChanged]) {
    const original = ctx.snapshots.get(fileName);
    if (original === undefined) continue;

    let errors = ctx.project.languageService
      .getSemanticDiagnostics(fileName)
      .filter((d) => !isIsolatedDeclarationsError(d.code));
    if (errors.length === 0) continue;

    const fixedContent = ctx.project.getFileContent(fileName);
    ctx.project.updateFile(fileName, original);
    const beforeCount = ctx.project.languageService
      .getSemanticDiagnostics(fileName)
      .filter((d) => !isIsolatedDeclarationsError(d.code)).length;
    ctx.project.updateFile(fileName, fixedContent);

    if (errors.length <= beforeCount) continue;

    // Try organizeImports for import corruption.
    const hasImportIssues = errors.some(
      (d) => d.code === 2300 || d.code === 2440 || d.code === 2395
    );
    if (hasImportIssues) {
      try {
        const orgChanges = ctx.project.languageService.organizeImports(
          { type: "file", fileName },
          ctx.formatOptions,
          ctx.preferences
        );
        for (const oc of orgChanges) {
          if (oc.textChanges.length === 0) continue;
          const cur = ctx.project.getFileContent(oc.fileName);
          ctx.project.updateFile(
            oc.fileName,
            applyTextChanges(cur, oc.textChanges)
          );
        }
        errors = ctx.project.languageService
          .getSemanticDiagnostics(fileName)
          .filter((d) => !isIsolatedDeclarationsError(d.code));
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
        const content = ctx.project.getFileContent(fileName);
        const patched = content.replace(
          /(?<=:\s*)Promise\b(?!\s*<)/g,
          "Promise<void>"
        );
        if (patched !== content) {
          ctx.project.updateFile(fileName, patched);
          errors = ctx.project.languageService
            .getSemanticDiagnostics(fileName)
            .filter((d) => !isIsolatedDeclarationsError(d.code));
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
  // Only check files we touched (changed or skipped) — not the entire
  // project. Scanning all source files via getSemanticDiagnostics is a
  // full-project type-check that can take hours on large packages and
  // often crashes with OOM before writing any results to disk.
  const filesToCheck = new Set([
    ...ctx.filesChanged,
    ...ctx.filesSkipped.keys(),
  ]);
  for (const fileName of filesToCheck) {
    if (fileName.includes("node_modules")) continue;
    const count = ctx.project.languageService
      .getSemanticDiagnostics(fileName)
      .filter((d) => isIsolatedDeclarationsError(d.code)).length;
    if (count > 0) {
      remainingErrors.set(fileName, count);
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

export function fix(project: Project, options: FixOptions = {}): FixResult {
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
    jestMock = true,
    expandoFix = true,
    skipValidation = false,
    coreOnly = false,
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
    jestMock,
    expandoFix,
    skipValidation,
    coreOnly,
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

  // --core-only: skip all post-processing (transforms, validation, expando,
  // expression fixer, buildResult scan). Just write what Pass 1 found.
  if (ctx.coreOnly) {
    return {
      totalChanges: ctx.totalChanges,
      filesChanged: ctx.filesChanged,
      filesSkipped: ctx.filesSkipped,
      remainingErrors: new Map(),
      passes: ctx.passes,
    };
  }

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
    jestMockTransform,
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
    jestMock: ctx.jestMock,
    verbose: ctx.verbose,
  };
  runTransformPipeline(transforms, transformCtx, transformOptions);

  runValidation(ctx);

  // Expando and expression fixers run after
  // validation so their changes survive rollbacks.
  if (ctx.expandoFix) {
    runExpandoFixer(ctx);
  }

  // Re-run inline-imports to rewrite any import()
  // types that typeToTypeNode() generates.
  const changesBefore = ctx.totalChanges;
  runExpressionFixer(ctx);
  if (ctx.rewriteInlineImports && ctx.totalChanges > changesBefore) {
    for (const fn of ctx.filesChanged) {
      inlineImportsTransform.transformFile(fn, transformCtx);
    }
  }

  return buildResult(ctx);
}
