export interface TextReplacement {
  start: number;
  end: number;
  text: string;
}

/**
 * Sort replacements descending by position and apply
 * bottom-to-top so earlier edits don't shift later
 * ones. Mutates the replacements array (sorts in
 * place).
 */
export function applyReplacements(
  content: string,
  replacements: TextReplacement[]
): string {
  if (replacements.length === 0) return content;
  replacements.sort((a, b) => b.start - a.start);
  let result = content;
  for (const r of replacements) {
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }
  return result;
}
