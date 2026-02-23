import {
  analyzeExtractionsWithMetadata,
  planCrossFileExtractions,
  applyCrossFileExtractions,
} from "../extract-types.ts";
import type { FileAnalysis } from "../extract-types.ts";
import type {
  ReadabilityTransform,
  TransformContext,
  TransformOptions,
} from "./types.ts";

/**
 * Adapter that wraps the existing extract-types
 * analysis/plan/apply pipeline as a
 * ReadabilityTransform. Uses transformFile for
 * per-file analysis and finalize for cross-file
 * planning and application.
 */
export function createExtractTypesTransform(): ReadabilityTransform & {
  readonly fileAnalyses: Map<string, FileAnalysis>;
} {
  const fileAnalyses = new Map<string, FileAnalysis>();
  let threshold = 5;

  return {
    name: "extract-types",
    scope: "changed",
    fileAnalyses,

    isEnabled(options: TransformOptions) {
      threshold = options.extractThreshold;
      return true;
    },

    transformFile(
      fileName: string,
      ctx: TransformContext
    ): boolean {
      const content =
        ctx.project.getFileContent(fileName);
      const analysis =
        analyzeExtractionsWithMetadata(
          content,
          fileName,
          threshold
        );
      if (analysis.extractions.length > 0) {
        fileAnalyses.set(fileName, analysis);
      }
      // No changes yet — finalize does the work.
      return false;
    },

    finalize(ctx: TransformContext): void {
      if (fileAnalyses.size === 0) return;

      const plan =
        planCrossFileExtractions(fileAnalyses);
      for (const [fileName, action] of plan.actions) {
        const content =
          ctx.project.getFileContent(fileName);
        const updated = applyCrossFileExtractions(
          content,
          fileName,
          action
        );
        if (updated !== content) {
          ctx.project.updateFile(fileName, updated);
        }
      }

      // Clear for potential reuse.
      fileAnalyses.clear();
    },
  };
}
