import ts from "typescript";

/**
 * Find the position after the last import/import-equals
 * statement. Returns 0 if there are no imports.
 */
export function findImportInsertPos(
  sourceFile: ts.SourceFile
): number {
  let pos = 0;
  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) ||
      ts.isImportEqualsDeclaration(stmt)
    ) {
      pos = stmt.getEnd();
    } else {
      break;
    }
  }
  return pos;
}

/**
 * Insert an import statement into source text at the
 * correct position (after existing imports). If there
 * are no imports, prepends to the file.
 */
export function insertImportStatement(
  content: string,
  fileName: string,
  importText: string
): string {
  const src = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true
  );
  const insertPos = findImportInsertPos(src);
  if (insertPos > 0) {
    return (
      content.slice(0, insertPos) +
      "\n" + importText +
      content.slice(insertPos)
    );
  }
  return importText + "\n" + content;
}
