import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FixResult, Project } from "../src/index.ts";
import { createProject, fix } from "../src/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const FIXTURES_DIR = resolve(__dirname, "fixtures");

export interface TestResult {
  project: Project;
  result: FixResult;
  tempDir: string;
}

/**
 * Copies a fixture to a temp directory, creates a project,
 * runs the fixer, and returns the results.
 */
export function fixFixture(
  fixtureName: string,
  options?: {
    verbose?: boolean;
    rewriteInlineImports?: boolean;
    extractThreshold?: number;
  }
): TestResult {
  const fixtureDir = resolve(FIXTURES_DIR, fixtureName);
  const tempDir = resolve(tmpdir(), "iso-decl-test-" + randomUUID());
  mkdirSync(tempDir, { recursive: true });

  // Copy fixture to temp dir
  cpSync(fixtureDir, tempDir, { recursive: true });

  // Also copy the base tsconfig if the fixture references it
  cpSync(
    resolve(FIXTURES_DIR, "tsconfig.base.json"),
    resolve(tempDir, "tsconfig.base.json")
  );

  const tsconfigPath = resolve(tempDir, "tsconfig.json");
  const project = createProject(tsconfigPath);
  const result = fix(project, {
    verbose: options?.verbose ?? false,
    rewriteInlineImports: options?.rewriteInlineImports,
    extractThreshold: options?.extractThreshold,
  });

  return { project, result, tempDir };
}

/**
 * Read a file from the temp project directory.
 */
export function readTempFile(tempDir: string, fileName: string): string {
  return readFileSync(resolve(tempDir, fileName), "utf-8");
}

/**
 * Write fixed files to disk so tsc can verify them.
 */
export function writeTempFiles(testResult: TestResult): void {
  for (const fileName of testResult.result.filesChanged) {
    const content = testResult.project.getFileContent(fileName);
    writeFileSync(fileName, content, "utf-8");
  }
}

/**
 * Run tsc --noEmit on a temp directory and return diagnostics.
 */
export function getTscErrors(tempDir: string): string[] {
  const tsconfigPath = resolve(tempDir, "tsconfig.json");
  const project = createProject(tsconfigPath);
  const program = project.languageService.getProgram();
  if (!program) return ["Failed to create program"];

  const errors: string[] = [];
  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes("node_modules")) continue;
    if (sf.isDeclarationFile) continue;

    const diags = [
      ...program.getSemanticDiagnostics(sf),
      ...program.getDeclarationDiagnostics(sf),
    ];
    for (const d of diags) {
      const msg =
        typeof d.messageText === "string"
          ? d.messageText
          : d.messageText.messageText;
      errors.push(`TS${d.code}: ${msg}`);
    }
  }
  return errors;
}
