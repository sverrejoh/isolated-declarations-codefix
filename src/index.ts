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
} from "./extract-types.ts";
export type {
  Extraction,
  ExtractionResult,
} from "./extract-types.ts";
export {
  createTtyRenderer,
  createPlainRenderer,
} from "./renderer.ts";
export type { Renderer } from "./renderer.ts";
