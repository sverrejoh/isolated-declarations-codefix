import type ts from "typescript";

export function applyTextChanges(
  text: string,
  changes: readonly ts.TextChange[],
): string {
  // Sort descending by start position so earlier
  // edits don't shift later ones. For same-position
  // inserts, reverse the original order so that
  // sequential application at the same offset
  // preserves the intended sequence (the first
  // original insert ends up first in the output).
  const indexed = changes.map((c, i) => ({
    c,
    i,
  }));
  indexed.sort(
    (a, b) =>
      b.c.span.start - a.c.span.start ||
      b.i - a.i,
  );
  const sorted = indexed.map((x) => x.c);

  let result = text;
  for (const change of sorted) {
    const start = change.span.start;
    const end = start + change.span.length;
    result =
      result.slice(0, start) + change.newText + result.slice(end);
  }
  return result;
}

export function applyFileTextChanges(
  fileChanges: readonly ts.FileTextChanges[],
  readFile: (path: string) => string,
): Map<string, string> {
  // Group all text changes by file name
  const changesByFile = new Map<string, ts.TextChange[]>();
  for (const fc of fileChanges) {
    const existing = changesByFile.get(fc.fileName) ?? [];
    existing.push(...fc.textChanges);
    changesByFile.set(fc.fileName, existing);
  }

  const result = new Map<string, string>();
  for (const [fileName, changes] of changesByFile) {
    const original = readFile(fileName);
    result.set(fileName, applyTextChanges(original, changes));
  }
  return result;
}
