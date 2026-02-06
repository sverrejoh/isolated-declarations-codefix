import ts from "typescript";
import { applyTextChanges } from "./changes.js";
import type { Project } from "./project.js";

// All isolatedDeclarations error codes handled by
// fixMissingTypeAnnotationOnExports
const ISO_DECL_ERROR_CODES = new Set([
  9007, // Function must have an explicit return type
  // annotation with --isolatedDeclarations
  9008, // Variable must have an explicit type
  // annotation with --isolatedDeclarations
  9009, // Parameter must have an explicit type
  // annotation with --isolatedDeclarations
  9010, // Property must have an explicit type
  // annotation with --isolatedDeclarations
  9011, // Accessor must have an explicit return type
  // annotation with --isolatedDeclarations
  9012, // Expression type can't be inferred
  // with --isolatedDeclarations
  9013, // Binding elements can't be exported
  // directly with --isolatedDeclarations
  9014, // Computed property names can't be inferred
  // with --isolatedDeclarations
  9015, // Enum member initializers must be computable
  // without type info with --isolatedDeclarations
  9016, // Extends clause can't contain expression
  // with --isolatedDeclarations
  9017, // Shorthand properties can't be used in
  // declaration emit for --isolatedDeclarations
  9018, // Spread properties can't be used in
  // declaration emit for --isolatedDeclarations
  9019, // Array spread can't be inferred
  // with --isolatedDeclarations
  9020, // Default export expressions must be
  // extractable with --isolatedDeclarations
  9021, // Only const arrays can be inferred
  // with --isolatedDeclarations
  9022, // Type containing private name can't be
  // used with --isolatedDeclarations
  9023, // Add satisfies and type assertion
  9025, // Declaration emit for class requires
  // type annotation
  9026, // Declaration emit for class expression
  // requires annotation
  9027, // Inferred type cannot be named
  9028, // Add missing type annotation
  9029, // Enum member value must be computable
]);

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
      // Skip node_modules and declaration files
      if (sourceFile.fileName.includes("node_modules")) continue;
      if (sourceFile.isDeclarationFile) continue;

      const diagnostics = [
        ...program.getSemanticDiagnostics(sourceFile),
        ...program.getDeclarationDiagnostics(sourceFile),
      ];

      const isoErrors = diagnostics.filter((d) =>
        ISO_DECL_ERROR_CODES.has(d.code),
      );
      if (isoErrors.length === 0) continue;

      if (verbose) {
        console.log(
          `  Pass ${pass}: ${sourceFile.fileName}` +
            ` (${isoErrors.length} errors)`,
        );
      }

      const combinedFix =
        project.languageService.getCombinedCodeFix(
          { type: "file", fileName: sourceFile.fileName },
          FIX_ID,
          formatOptions,
          preferences,
        );

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
