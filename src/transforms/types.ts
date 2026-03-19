import type ts from "typescript";
import type { Project } from "../project.ts";
import type { ProgressEvent } from "../fixer.ts";

export type TransformScope = "changed" | "all";

export interface TransformContext {
  project: Project;
  filesChanged: Set<string>;
  snapshots: Map<string, string>;
  formatOptions: ts.FormatCodeSettings;
  preferences: ts.UserPreferences;
  onProgress?: (event: ProgressEvent) => void;
}

export interface TransformOptions {
  rewriteInlineImports: boolean;
  typeofIntersection: boolean;
  tupleSpreadCollapse: boolean;
  extractTypes: boolean;
  extractThreshold: number;
  collapseUnions: boolean;
  genericAlias: boolean;
  stripInnerReturnTypes: boolean;
  banTypes: boolean;
  verbose: boolean;
}

export interface ReadabilityTransform {
  readonly name: string;
  readonly scope: TransformScope;
  isEnabled(options: TransformOptions): boolean;
  transformFile(
    fileName: string,
    ctx: TransformContext
  ): boolean;
  /** For batch transforms (e.g. cross-file dedup). */
  finalize?(ctx: TransformContext): void;
}
