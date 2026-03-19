export { applyFileTextChanges, applyTextChanges } from "./changes.ts";
export { fix } from "./fixer.ts";
export type { FixOptions, FixResult, ProgressEvent } from "./fixer.ts";
export { rewriteTypeofIntersections } from "./transforms/typeof-intersection.ts";
export { collapseTupleSpreads } from "./transforms/tuple-spread-collapse.ts";
export { collapseKeyofTypeofUnions } from "./transforms/collapse-unions.ts";
export { rewriteInlineImportTypes } from "./transforms/inline-imports.ts";
export { stripInnerReturnTypes } from "./transforms/strip-inner-return-types.ts";
export { rewriteBanTypes } from "./transforms/ban-types.ts";
export { runTransformPipeline } from "./transforms/pipeline.ts";
export type {
  ReadabilityTransform,
  TransformContext,
  TransformOptions,
  TransformScope,
} from "./transforms/types.ts";
export { isIsolatedDeclarationsError } from "./utils/diagnostics.ts";
export {
  applyReplacements,
  type TextReplacement,
} from "./utils/replacements.ts";
export {
  findImportInsertPos,
  insertImportStatement,
} from "./utils/import-inserter.ts";
export {
  analyzeExtractions,
  applyExtractions,
  normalizeTypeLiteral,
  classifyDeclarationKind,
  analyzeExtractionsWithMetadata,
  planCrossFileExtractions,
  applyCrossFileExtractions,
  computeRelativeImportPath,
  findExistingImport,
} from "./extract-types.ts";
export type {
  Extraction,
  ExtractionResult,
  DeclarationKind,
  FileExtraction,
  FileAnalysis,
  FileAction,
  CrossFileExtractionPlan,
} from "./extract-types.ts";
export { createProject } from "./project.ts";
export type { Project } from "./project.ts";
export { createPlainRenderer, createTtyRenderer } from "./renderer.ts";
export type { Renderer } from "./renderer.ts";
