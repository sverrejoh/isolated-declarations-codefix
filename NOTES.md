# Technical Notes

## How TypeScript Code Fix Alternatives Work

Our tool uses `getCombinedCodeFix` with fix ID `fixMissingTypeAnnotationOnExports`.
This is the "Fix All" API — it picks one strategy and applies it to every matching
diagnostic in a file at once.

VSCode's lightbulb uses a different API: `getCodeFixesAtPosition(fileName, start,
end, errorCodes, ...)` which returns `CodeFixAction[]` per diagnostic. Each action
represents a different approach, e.g.:

- Add return type annotation
- Add `satisfies X as X` inline assertion
- Extract expression to const with type annotation

Each `CodeFixAction` has a `fixId`. Multiple actions can share the same `fixId`
(same strategy at different locations). `getCombinedCodeFix` applies all instances
of one chosen `fixId`.

For most cases (return types, variable types, parameter types), there's only one
fix. Alternatives mainly appear for:

- Object literals with shorthand/spread (`satisfies`+`as` vs extract)
- Default exports (extract to const vs inline)
- Some edge cases

Since our `getCombinedCodeFix` call picks the same strategy as VSCode's "Fix All",
results should be identical in most cases.

**Future idea:** Add a `--prefer` flag or per-diagnostic strategy selection to
choose between alternatives when multiple are available.

## The `realpath` Fix (pnpm/yarn Symlink Resolution)

`LanguageServiceHost` must have `realpath: ts.sys.realpath` for pnpm/yarn store
layouts. Without it:

1. Package `@fluentui/react-components` is symlinked from
   `project/node_modules/` into `.store/@fluentui-react-components@.../`
2. Its `.d.ts` re-exports `makeStyles` from `@griffel/react`
3. TS resolves `@griffel/react` relative to the **symlink path**, not the
   **real path** in the store
4. `@griffel/react` is a transitive dep — it exists in the store alongside
   fluent, but not in `project/node_modules/`
5. Resolution silently fails, type degrades to `any`

Adding `realpath` tells TS to resolve symlinks first, so transitive deps are
found in the correct store location.

This is the same bug that causes `ts-fix` to produce `any` — it also doesn't
provide `realpath`. VSCode gets it right because `tsserver` always provides
`realpath` via `ts.sys.realpath`.
