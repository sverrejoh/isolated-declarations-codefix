import type {
  ReadabilityTransform,
  TransformContext,
  TransformOptions,
} from "./types.ts";

/**
 * Get all non-node_modules, non-declaration source
 * file names from the project's current program.
 */
function getAllSourceFileNames(
  ctx: TransformContext
): string[] {
  const program = ctx.project.languageService.getProgram();
  if (!program) return [];
  const names: string[] = [];
  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes("node_modules")) continue;
    if (sf.isDeclarationFile) continue;
    names.push(sf.fileName);
  }
  return names;
}

/**
 * Run all enabled readability transforms in order.
 * For "changed" scope, processes only files in
 * ctx.filesChanged. For "all" scope, processes every
 * project source file. If a transform modifies a
 * file, it's added to ctx.filesChanged.
 */
export function runTransformPipeline(
  transforms: ReadabilityTransform[],
  ctx: TransformContext,
  options: TransformOptions,
): void {
  for (const transform of transforms) {
    if (!transform.isEnabled(options)) continue;

    const fileNames =
      transform.scope === "all"
        ? getAllSourceFileNames(ctx)
        : [...ctx.filesChanged];

    for (const fileName of fileNames) {
      // Capture pre-transform content for rollback
      // if this file hasn't been snapshotted yet.
      const needsSnapshot =
        !ctx.snapshots.has(fileName);
      const beforeContent = needsSnapshot
        ? ctx.project.getFileContent(fileName)
        : undefined;

      const changed = transform.transformFile(
        fileName,
        ctx
      );
      if (changed) {
        if (beforeContent !== undefined) {
          ctx.snapshots.set(fileName, beforeContent);
        }
        ctx.filesChanged.add(fileName);
      }
    }

    transform.finalize?.(ctx);
  }
}
