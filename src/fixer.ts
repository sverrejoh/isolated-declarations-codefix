import ts from "typescript";
import { applyTextChanges } from "./changes.ts";
import type { Project } from "./project.ts";

const FIX_ID = "fixMissingTypeAnnotationOnExports";

export interface FixResult {
  totalChanges: number;
  filesChanged: Set<string>;
  passes: number;
}

export interface FixOptions {
  maxPasses?: number;
  verbose?: boolean;
}

export function fix(
  project: Project,
  options: FixOptions = {},
): FixResult {
  const { maxPasses = 5, verbose = false } = options;
  const filesChanged = new Set<string>();
  let totalChanges = 0;
  let passes = 0;

  const formatOptions = ts.getDefaultFormatCodeSettings();
  const preferences: ts.UserPreferences = {};

  for (let pass = 1; pass <= maxPasses; pass++) {
    passes = pass;
    let changesThisPass = 0;
    const program = project.languageService.getProgram();
    if (!program) {
      throw new Error("Failed to get program from language service");
    }

    const sourceFiles = program.getSourceFiles();
    for (const sourceFile of sourceFiles) {
      if (sourceFile.fileName.includes("node_modules")) continue;
      if (sourceFile.isDeclarationFile) continue;

      // Skip diagnostics — getCombinedCodeFix is cheaper
      // than computing declaration diagnostics and returns
      // empty changes when there's nothing to fix.
      const combinedFix =
        project.languageService.getCombinedCodeFix(
          { type: "file", fileName: sourceFile.fileName },
          FIX_ID,
          formatOptions,
          preferences,
        );

      if (combinedFix.changes.length === 0) continue;

      if (verbose) {
        console.log(
          `  Pass ${pass}: ${sourceFile.fileName}`,
        );
      }

      for (const fileChange of combinedFix.changes) {
        if (fileChange.textChanges.length === 0) continue;
        const current = project.getFileContent(
          fileChange.fileName,
        );
        const newContent = applyTextChanges(
          current,
          fileChange.textChanges,
        );
        project.updateFile(fileChange.fileName, newContent);
        filesChanged.add(fileChange.fileName);
        changesThisPass++;
      }
    }

    if (changesThisPass === 0) break;
    totalChanges += changesThisPass;
  }

  return { totalChanges, filesChanged, passes };
}
