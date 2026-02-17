export { createProject } from "./project.ts";
export type { Project } from "./project.ts";
export { fix } from "./fixer.ts";
export type {
  FixResult,
  FixOptions,
  ProgressEvent,
} from "./fixer.ts";
export {
  applyTextChanges,
  applyFileTextChanges,
} from "./changes.ts";
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
export {
  createTtyRenderer,
  createPlainRenderer,
} from "./renderer.ts";
export type { Renderer } from "./renderer.ts";
