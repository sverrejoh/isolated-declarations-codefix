import ts from "typescript";
import { applyTextChanges } from "./changes.ts";
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
): number {
  let totalEdits = 0;
  let prevCount = -1;

  for (let round = 0; round < 50; round++) {
    const diags = project.languageService
      .getSemanticDiagnostics(fileName)
      .filter(
        (d) =>
          d.code >= 9007 &&
          d.code <= 9029 &&
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
          (d) => d.code >= 9007 && d.code <= 9029,
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
