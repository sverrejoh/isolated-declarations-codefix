import ts from "typescript";
import { dirname, relative } from "node:path";

export interface Extraction {
  /** Name for the extracted type */
  name: string;
  /** The text of the type literal (e.g. `{ a: string; b: number }`) */
  literalText: string;
  /** Start offset of the type literal in the source */
  start: number;
  /** End offset of the type literal in the source */
  end: number;
}

export interface ExtractionResult {
  /** Extractions to apply, sorted by start position */
  extractions: Extraction[];
  /** Position to insert type declarations */
  insertPos: number;
}

export type DeclarationKind =
  | "function-return"
  | "variable"
  | "parameter"
  | "method"
  | "property"
  | "other";

export interface FileExtraction extends Extraction {
  fileName: string;
  normalizedText: string;
  declarationKind: DeclarationKind;
}

export interface FileAnalysis {
  extractions: FileExtraction[];
  insertPos: number;
}

export interface FileAction {
  localExtractions: Extraction[];
  exportedExtractions: Extraction[];
  importedExtractions: Array<{
    name: string;
    sourceFileName: string;
    start: number;
    end: number;
  }>;
  insertPos: number;
}

export interface CrossFileExtractionPlan {
  actions: Map<string, FileAction>;
}

const DEFAULT_THRESHOLD = 5;

/**
 * Analyze a source file for inline type literals that should be
 * extracted to named type aliases.
 */
export function analyzeExtractions(
  sourceText: string,
  fileName: string,
  threshold: number = DEFAULT_THRESHOLD,
): ExtractionResult {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );

  const insertPos = findInsertionPoint(sourceFile, sourceText);
  const existingNames = collectTopLevelNames(sourceFile);
  const usedNames = new Set(existingNames);
  const extractions: Extraction[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isTypeLiteralNode(node) &&
      node.members.length > threshold &&
      !isNestedInTypeLiteral(node) &&
      isAnnotationPosition(node)
    ) {
      const declName = findEnclosingDeclarationName(node);
      if (declName) {
        const typeName = deduplicateName(
          toPascalCase(declName) + "Type",
          usedNames,
        );
        usedNames.add(typeName);
        extractions.push({
          name: typeName,
          literalText: sourceText.slice(node.getStart(sourceFile), node.getEnd()),
          start: node.getStart(sourceFile),
          end: node.getEnd(),
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);

  // Sort by start position for consistent ordering
  extractions.sort((a, b) => a.start - b.start);

  return { extractions, insertPos };
}

/**
 * Apply extractions to the source text: replace inline types with
 * type names and insert type declarations.
 */
export function applyExtractions(
  sourceText: string,
  result: ExtractionResult,
): string {
  if (result.extractions.length === 0) return sourceText;

  let text = sourceText;

  // Replace inline types bottom-to-top to preserve offsets
  const sorted = [...result.extractions].sort(
    (a, b) => b.start - a.start,
  );
  for (const ext of sorted) {
    text =
      text.slice(0, ext.start) +
      ext.name +
      text.slice(ext.end);
  }

  // Build type declarations
  const types = result.extractions
    .map((ext) => `type ${ext.name} = ${ext.literalText}`)
    .join("\n");

  // Insert at the insertion point (after imports)
  const before = text.slice(0, result.insertPos);
  const after = text.slice(result.insertPos);
  text = before + "\n" + types + "\n" + after;

  return text;
}

/**
 * Find the position after the last import statement.
 * If no imports, returns 0.
 */
function findInsertionPoint(
  sourceFile: ts.SourceFile,
  sourceText: string,
): number {
  let lastImportEnd = 0;
  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt)) {
      lastImportEnd = stmt.getEnd();
    } else {
      break;
    }
  }
  if (lastImportEnd > 0) {
    // Skip past the newline after the last import
    const nextNewline = sourceText.indexOf("\n", lastImportEnd);
    return nextNewline >= 0 ? nextNewline + 1 : lastImportEnd;
  }
  return 0;
}

/**
 * Collect all top-level declaration names in the source file.
 */
function collectTopLevelNames(sourceFile: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)) {
      if (stmt.name) names.push(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          names.push(decl.name.text);
        }
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      names.push(stmt.name.text);
    }
  }
  return names;
}

/**
 * Check if a TypeLiteralNode is nested inside another TypeLiteralNode.
 * We only extract top-level type literals.
 */
function isNestedInTypeLiteral(node: ts.Node): boolean {
  let parent = node.parent;
  while (parent) {
    if (ts.isTypeLiteralNode(parent)) return true;
    parent = parent.parent;
  }
  return false;
}

/**
 * Check if the type literal is in an annotation position
 * (variable type annotation, function return type, parameter type, etc.)
 */
function isAnnotationPosition(node: ts.Node): boolean {
  let current = node.parent;
  while (current) {
    if (
      ts.isVariableDeclaration(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isParameter(current) ||
      ts.isPropertyDeclaration(current) ||
      ts.isGetAccessorDeclaration(current)
    ) {
      return true;
    }
    // Walk through type wrappers
    if (
      ts.isFunctionTypeNode(current) ||
      ts.isUnionTypeNode(current) ||
      ts.isIntersectionTypeNode(current) ||
      ts.isArrayTypeNode(current) ||
      ts.isParenthesizedTypeNode(current)
    ) {
      current = current.parent;
      continue;
    }
    break;
  }
  return false;
}

/**
 * Walk up from a TypeLiteralNode to find the enclosing declaration
 * and derive a suitable name.
 */
function findEnclosingDeclarationName(node: ts.Node): string | undefined {
  let current = node.parent;
  while (current) {
    // Variable declaration: const config: { ... }
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    // Function declaration: function createUser(): { ... }
    if (ts.isFunctionDeclaration(current) && current.name) {
      return current.name.text;
    }
    // Method declaration: getUser(): { ... }
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    // Parameter: function foo(options: { ... })
    if (ts.isParameter(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    // Property declaration
    if (ts.isPropertyDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    // Get accessor
    if (ts.isGetAccessorDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    // Arrow function / function expression — look at parent variable declaration
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      if (current.parent && ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) {
        return current.parent.name.text;
      }
    }
    // Walk through type wrappers
    if (
      ts.isFunctionTypeNode(current) ||
      ts.isUnionTypeNode(current) ||
      ts.isIntersectionTypeNode(current) ||
      ts.isArrayTypeNode(current) ||
      ts.isParenthesizedTypeNode(current)
    ) {
      current = current.parent;
      continue;
    }
    break;
  }
  return undefined;
}

/**
 * Convert a name to PascalCase.
 * e.g. "getConfig" -> "GetConfig", "my_var" -> "MyVar"
 */
function toPascalCase(name: string): string {
  // Split on non-alphanumeric, underscores, or camelCase boundaries
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/**
 * Deduplicate a type name by appending numeric suffixes.
 */
function deduplicateName(name: string, existing: Set<string>): string {
  if (!existing.has(name)) return name;
  let i = 2;
  while (existing.has(name + i)) i++;
  return name + i;
}

// ─── Cross-file deduplication ───────────────────────────────────

/**
 * Normalize a type literal for grouping: use the TS printer
 * for canonical output, sort members alphabetically.
 */
export function normalizeTypeLiteral(text: string): string {
  const wrapper = `type __T = ${text}`;
  const sf = ts.createSourceFile(
    "__normalize.ts",
    wrapper,
    ts.ScriptTarget.Latest,
    true,
  );
  const stmt = sf.statements[0];
  if (
    !ts.isTypeAliasDeclaration(stmt) ||
    !ts.isTypeLiteralNode(stmt.type)
  ) {
    return text.replace(/\s+/g, " ").trim();
  }
  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
  });
  const members = stmt.type.members.map((m) =>
    printer
      .printNode(ts.EmitHint.Unspecified, m, sf)
      .replace(/[;,]\s*$/, "")
      .trim(),
  );
  members.sort();
  return "{ " + members.join("; ") + " }";
}

/**
 * Classify the declaration kind for a type literal node
 * by walking up the AST.
 */
export function classifyDeclarationKind(
  node: ts.Node,
): DeclarationKind {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current)) return "function-return";
    if (
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessorDeclaration(current)
    )
      return "method";
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current)
    )
      return "function-return";
    if (ts.isVariableDeclaration(current)) return "variable";
    if (ts.isParameter(current)) return "parameter";
    if (ts.isPropertyDeclaration(current)) return "property";
    if (
      ts.isFunctionTypeNode(current) ||
      ts.isUnionTypeNode(current) ||
      ts.isIntersectionTypeNode(current) ||
      ts.isArrayTypeNode(current) ||
      ts.isParenthesizedTypeNode(current)
    ) {
      current = current.parent;
      continue;
    }
    break;
  }
  return "other";
}

/**
 * Analyze extractions with cross-file metadata.
 * Like analyzeExtractions but returns FileExtraction[] with
 * normalizedText and declarationKind.
 */
export function analyzeExtractionsWithMetadata(
  sourceText: string,
  fileName: string,
  threshold: number = DEFAULT_THRESHOLD,
): FileAnalysis {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );

  const insertPos = findInsertionPoint(sourceFile, sourceText);
  const existingNames = collectTopLevelNames(sourceFile);
  const usedNames = new Set(existingNames);
  const extractions: FileExtraction[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isTypeLiteralNode(node) &&
      node.members.length > threshold &&
      !isNestedInTypeLiteral(node) &&
      isAnnotationPosition(node)
    ) {
      const declName = findEnclosingDeclarationName(node);
      if (declName) {
        const typeName = deduplicateName(
          toPascalCase(declName) + "Type",
          usedNames,
        );
        usedNames.add(typeName);
        const literalText = sourceText.slice(
          node.getStart(sourceFile),
          node.getEnd(),
        );
        extractions.push({
          name: typeName,
          literalText,
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          fileName,
          normalizedText: normalizeTypeLiteral(literalText),
          declarationKind: classifyDeclarationKind(node),
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
  extractions.sort((a, b) => a.start - b.start);

  return { extractions, insertPos };
}

const DECLARATION_KIND_PRIORITY: Record<DeclarationKind, number> = {
  "function-return": 0,
  method: 1,
  variable: 2,
  parameter: 3,
  property: 4,
  other: 5,
};

function pickCanonicalSource(
  group: FileExtraction[],
): FileExtraction {
  return group.slice().sort((a, b) => {
    const kindDiff =
      DECLARATION_KIND_PRIORITY[a.declarationKind] -
      DECLARATION_KIND_PRIORITY[b.declarationKind];
    if (kindDiff !== 0) return kindDiff;
    if (a.fileName.length !== b.fileName.length)
      return a.fileName.length - b.fileName.length;
    return a.fileName.localeCompare(b.fileName);
  })[0];
}

/**
 * Plan cross-file extractions: group identical types, pick
 * canonical source, produce per-file actions.
 */
export function planCrossFileExtractions(
  fileAnalyses: Map<string, FileAnalysis>,
): CrossFileExtractionPlan {
  const actions = new Map<string, FileAction>();

  for (const [fileName, analysis] of fileAnalyses) {
    actions.set(fileName, {
      localExtractions: [],
      exportedExtractions: [],
      importedExtractions: [],
      insertPos: analysis.insertPos,
    });
  }

  // Group extractions by normalized text
  const groups = new Map<string, FileExtraction[]>();
  for (const [, analysis] of fileAnalyses) {
    for (const ext of analysis.extractions) {
      const key = ext.normalizedText;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(ext);
    }
  }

  for (const [, group] of groups) {
    const fileSet = new Set(group.map((e) => e.fileName));

    if (fileSet.size === 1) {
      // Single-file type → local type alias
      const canonical = pickCanonicalSource(group);
      const action = actions.get(canonical.fileName)!;
      for (const ext of group) {
        action.localExtractions.push({
          name: canonical.name,
          literalText: canonical.literalText,
          start: ext.start,
          end: ext.end,
        });
      }
    } else {
      // Cross-file type → export from canonical, import elsewhere
      const canonical = pickCanonicalSource(group);
      const canonicalAction = actions.get(canonical.fileName)!;

      canonicalAction.exportedExtractions.push({
        name: canonical.name,
        literalText: canonical.literalText,
        start: canonical.start,
        end: canonical.end,
      });

      for (const ext of group) {
        if (ext === canonical) continue;
        if (ext.fileName === canonical.fileName) {
          // Same file as canonical — just replace inline type
          canonicalAction.exportedExtractions.push({
            name: canonical.name,
            literalText: ext.literalText,
            start: ext.start,
            end: ext.end,
          });
        } else {
          const action = actions.get(ext.fileName)!;
          action.importedExtractions.push({
            name: canonical.name,
            sourceFileName: canonical.fileName,
            start: ext.start,
            end: ext.end,
          });
        }
      }
    }
  }

  return { actions };
}

/**
 * Apply cross-file extraction actions to a single file.
 * Replaces inline types, inserts type aliases, adds imports.
 */
export function applyCrossFileExtractions(
  sourceText: string,
  fileName: string,
  action: FileAction,
): string {
  if (
    action.localExtractions.length === 0 &&
    action.exportedExtractions.length === 0 &&
    action.importedExtractions.length === 0
  ) {
    return sourceText;
  }

  const sf = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );

  // Collect all edits: { pos, end, text }
  const edits: Array<{
    pos: number;
    end: number;
    text: string;
  }> = [];

  // 1. Type literal replacements
  for (const ext of action.localExtractions) {
    edits.push({ pos: ext.start, end: ext.end, text: ext.name });
  }
  for (const ext of action.exportedExtractions) {
    edits.push({ pos: ext.start, end: ext.end, text: ext.name });
  }
  for (const ext of action.importedExtractions) {
    edits.push({ pos: ext.start, end: ext.end, text: ext.name });
  }

  // 2. Type declarations
  const seenNames = new Set<string>();
  const typeDecls: string[] = [];
  for (const ext of action.exportedExtractions) {
    if (!seenNames.has(ext.name)) {
      seenNames.add(ext.name);
      typeDecls.push(
        `export type ${ext.name} = ${ext.literalText}`,
      );
    }
  }
  for (const ext of action.localExtractions) {
    if (!seenNames.has(ext.name)) {
      seenNames.add(ext.name);
      typeDecls.push(
        `type ${ext.name} = ${ext.literalText}`,
      );
    }
  }

  // 3. Import handling
  const newImportLines: string[] = [];
  if (action.importedExtractions.length > 0) {
    const importsBySource = new Map<string, string[]>();
    for (const ext of action.importedExtractions) {
      if (!importsBySource.has(ext.sourceFileName))
        importsBySource.set(ext.sourceFileName, []);
      const names = importsBySource.get(ext.sourceFileName)!;
      if (!names.includes(ext.name)) names.push(ext.name);
    }

    for (const [sourceFile, names] of importsBySource) {
      const importPath = computeRelativeImportPath(
        fileName,
        sourceFile,
      );
      const existingImport = findExistingImport(sf, importPath);

      if (
        existingImport?.importClause?.namedBindings &&
        ts.isNamedImports(
          existingImport.importClause.namedBindings,
        )
      ) {
        // Merge type imports into existing named import
        const namedBindings =
          existingImport.importClause.namedBindings;
        const lastElement =
          namedBindings.elements[
            namedBindings.elements.length - 1
          ];
        const insertAt = lastElement.getEnd();
        const typeImports = names
          .map((n) => `type ${n}`)
          .join(", ");
        edits.push({
          pos: insertAt,
          end: insertAt,
          text: `, ${typeImports}`,
        });
      } else {
        newImportLines.push(
          `import type { ${names.join(", ")} } from "${importPath}";`,
        );
      }
    }
  }

  // 4. Build the insert block at insertPos
  const insertBlock = [
    ...newImportLines,
    ...typeDecls,
  ];
  if (insertBlock.length > 0) {
    edits.push({
      pos: action.insertPos,
      end: action.insertPos,
      text: "\n" + insertBlock.join("\n") + "\n",
    });
  }

  // Apply all edits in reverse position order
  edits.sort((a, b) => b.pos - a.pos);

  let result = sourceText;
  for (const edit of edits) {
    result =
      result.slice(0, edit.pos) +
      edit.text +
      result.slice(edit.end);
  }

  return result;
}

/**
 * Compute a relative import path from one file to another.
 */
export function computeRelativeImportPath(
  fromFile: string,
  toFile: string,
): string {
  let rel = relative(dirname(fromFile), toFile);
  rel = rel.replace(/\\/g, "/");
  if (!rel.startsWith(".")) {
    rel = "./" + rel;
  }
  return rel;
}

/**
 * Find an existing import declaration for the given module specifier.
 */
export function findExistingImport(
  sourceFile: ts.SourceFile,
  moduleSpecifier: string,
): ts.ImportDeclaration | undefined {
  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      if (stmt.moduleSpecifier.text === moduleSpecifier) {
        return stmt;
      }
    }
  }
  return undefined;
}
