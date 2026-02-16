import ts from "typescript";

export interface Extraction {
  /** Name for the extracted interface */
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
  /** Position to insert interface declarations */
  insertPos: number;
}

const DEFAULT_THRESHOLD = 5;

/**
 * Analyze a source file for inline type literals that should be
 * extracted to named interfaces.
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
        const interfaceName = deduplicateName(
          toPascalCase(declName) + "Interface",
          usedNames,
        );
        usedNames.add(interfaceName);
        extractions.push({
          name: interfaceName,
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
 * interface names and insert interface declarations.
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

  // Build interface declarations
  const interfaces = result.extractions
    .map((ext) => `interface ${ext.name} ${ext.literalText}`)
    .join("\n");

  // Insert at the insertion point (after imports)
  const before = text.slice(0, result.insertPos);
  const after = text.slice(result.insertPos);
  text = before + interfaces + "\n" + after;

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
 * Deduplicate an interface name by appending numeric suffixes.
 */
function deduplicateName(name: string, existing: Set<string>): string {
  if (!existing.has(name)) return name;
  let i = 2;
  while (existing.has(name + i)) i++;
  return name + i;
}
