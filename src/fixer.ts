import ts from "typescript";
import { applyTextChanges } from "./changes.ts";
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
      type: "pass-complete";
      pass: number;
      filesFixed: number;
    };

export interface FixOptions {
  maxPasses?: number;
  verbose?: boolean;
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

export function fix(
  project: Project,
  options: FixOptions = {},
): FixResult {
  const {
    maxPasses = 5,
    verbose = false,
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

        const val = checker.getConstantValue(
          member as ts.EnumMember,
        );
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
      // retry with per-diagnostic approach which
      // applies fixes one at a time, skipping the
      // ones that cause errors.
      project.updateFile(fileName, original);
      filesChanged.delete(fileName);

      let retryEdits = 0;
      try {
        retryEdits = fixFileFallback(
          project,
          fileName,
          formatOptions,
          preferences,
          snapshots,
        );
      } catch {
        // per-diagnostic retry also failed
      }

      if (retryEdits > 0) {
        // Validate the per-diagnostic result.
        const retryErrors = project.languageService
          .getSemanticDiagnostics(fileName)
          .filter(
            (d) =>
              !isIsolatedDeclarationsError(d.code),
          );
        if (retryErrors.length <= beforeCount) {
          filesChanged.add(fileName);
          filesSkipped.delete(fileName);
          onProgress?.({
            type: "file",
            fileName,
            edits: retryEdits,
          });
        } else {
          // Per-diagnostic also broke — revert.
          project.updateFile(fileName, original);
          const msg =
            "fix introduced errors: " +
            retryErrors
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
