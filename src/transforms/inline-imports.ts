import ts from "typescript";
import type { ProgressEvent } from "../fixer.ts";
import {
  applyReplacements,
  type TextReplacement,
} from "../utils/replacements.ts";
import { findImportInsertPos } from "../utils/import-inserter.ts";
import type {
  ReadabilityTransform,
  TransformContext,
  TransformOptions,
} from "./types.ts";

function moduleSpecifierToAlias(
  specifier: string
): string {
  let name = specifier.split("/").pop() ?? specifier;
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    name = parts[parts.length - 1] ?? name;
  }
  name = name.replace(/\.\w+$/, "");
  const pascal = name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join("");
  return pascal + "Module";
}

function collectIdentifiers(
  node: ts.Node,
  ids: Set<string>
): void {
  if (ts.isIdentifier(node)) {
    ids.add(node.text);
  }
  ts.forEachChild(node, (child) =>
    collectIdentifiers(child, ids)
  );
}

export function rewriteInlineImportTypes(
  content: string,
  fileName: string,
  original?: string,
  onProgress?: (event: ProgressEvent) => void
): string {
  const src = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true
  );

  const nodes: ts.ImportTypeNode[] = [];
  function isInsideTypeLiteral(
    node: ts.Node
  ): boolean {
    let cur = node.parent;
    while (cur) {
      if (ts.isTypeLiteralNode(cur)) return true;
      cur = cur.parent;
    }
    return false;
  }
  function visit(node: ts.Node): void {
    if (
      ts.isImportTypeNode(node) &&
      node.isTypeOf &&
      !isInsideTypeLiteral(node)
    ) {
      nodes.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(src);

  if (nodes.length === 0) return content;

  const bySpec = new Map<string, ts.ImportTypeNode[]>();
  for (const node of nodes) {
    if (!ts.isLiteralTypeNode(node.argument)) {
      continue;
    }
    const lit = node.argument.literal;
    if (!ts.isStringLiteral(lit)) continue;
    const spec = lit.text;
    let arr = bySpec.get(spec);
    if (!arr) {
      arr = [];
      bySpec.set(spec, arr);
    }
    arr.push(node);
  }

  if (bySpec.size === 0) return content;

  const existingNs = new Map<string, string>();
  for (const stmt of src.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.importClause?.namedBindings &&
      ts.isNamespaceImport(
        stmt.importClause.namedBindings
      )
    ) {
      existingNs.set(
        stmt.moduleSpecifier.text,
        stmt.importClause.namedBindings.name.text
      );
    }
  }

  const allIds = new Set<string>();
  collectIdentifiers(src, allIds);

  const aliasMap = new Map<string, string>();
  for (const spec of bySpec.keys()) {
    const existing = existingNs.get(spec);
    if (existing) {
      aliasMap.set(spec, existing);
      continue;
    }
    let base = moduleSpecifierToAlias(spec);
    let alias = base;
    let counter = 2;
    while (allIds.has(alias)) {
      alias =
        base.replace(/Module$/, "") +
        "Module" +
        counter;
      counter++;
    }
    aliasMap.set(spec, alias);
    allIds.add(alias);
  }

  if (original && onProgress) {
    for (const [_spec, nodeList] of bySpec) {
      for (const node of nodeList) {
        const nodeText = node.getText(src);
        if (original.includes(nodeText)) {
          onProgress({
            type: "file-warning",
            fileName,
            message:
              "pre-existing typeof import() " +
              "rewritten: " +
              nodeText,
          });
        }
      }
    }
  }

  const replacements: TextReplacement[] = [];
  for (const [spec, nodeList] of bySpec) {
    const alias = aliasMap.get(spec)!;
    for (const node of nodeList) {
      let replacement = "typeof " + alias;
      if (node.qualifier) {
        replacement += "." + node.qualifier.getText(src);
      }
      if (
        node.typeArguments &&
        node.typeArguments.length > 0
      ) {
        const args = node.typeArguments
          .map((a) => a.getText(src))
          .join(", ");
        replacement += "<" + args + ">";
      }
      replacements.push({
        start: node.getStart(src),
        end: node.getEnd(),
        text: replacement,
      });
    }
  }

  let result = applyReplacements(content, replacements);

  const newImports: string[] = [];
  for (const [spec, alias] of aliasMap) {
    if (existingNs.has(spec)) continue;
    newImports.push(
      `import type * as ${alias} from "${spec}";`
    );
  }

  if (newImports.length > 0) {
    const resultSrc = ts.createSourceFile(
      fileName,
      result,
      ts.ScriptTarget.Latest,
      true
    );
    const insertPos = findImportInsertPos(resultSrc);

    const importBlock = "\n" + newImports.join("\n");
    if (insertPos > 0) {
      result =
        result.slice(0, insertPos) +
        importBlock +
        result.slice(insertPos);
    } else {
      result = newImports.join("\n") + "\n" + result;
    }
  }

  return result;
}

export const inlineImportsTransform: ReadabilityTransform =
  {
    name: "inline-imports",
    scope: "all",
    isEnabled(options: TransformOptions) {
      return options.rewriteInlineImports;
    },
    transformFile(
      fileName: string,
      ctx: TransformContext
    ): boolean {
      const content = ctx.project.getFileContent(fileName);
      const orig = ctx.snapshots.get(fileName);
      const rewritten = rewriteInlineImportTypes(
        content,
        fileName,
        orig,
        ctx.onProgress
      );
      if (rewritten !== content) {
        ctx.project.updateFile(fileName, rewritten);
        return true;
      }
      return false;
    },
  };
