# isolated-declarations-codefix

CLI tool that automatically applies TypeScript `isolatedDeclarations` code fixes using the language service API. It adds missing return types, type annotations, and other declarations required by `isolatedDeclarations: true`.

## Usage

```bash
# Fix all files in a project (uses ./tsconfig.json)
npx tsx src/cli.ts

# Specify a tsconfig
npx tsx src/cli.ts -p path/to/tsconfig.json

# Preview what would change without writing
npx tsx src/cli.ts --dry-run

# See per-file progress
npx tsx src/cli.ts --verbose
```

## Options

| Flag | Description |
|---|---|
| `-p, --project <path>` | Path to tsconfig.json (default: `./tsconfig.json`) |
| `--dry-run` | Show which files would change without writing |
| `--verbose` | Print per-file diagnostic counts and pass info |
| `--no-write` | Run fixes in memory but don't write to disk |
| `--no-rewrite-inline-imports` | Keep `typeof import()` as-is |
| `--no-typeof-intersection` | Skip `typeof X & {...}` rewrite |
| `--no-tuple-spread-collapse` | Skip `[...typeof X]` rewrite |
| `--no-extract-types` | Skip large type extraction to interfaces |
| `--no-collapse-unions` | Skip `keyof typeof` rewrite |
| `--no-generic-alias` | Skip generic alias simplification |
| `--no-strip-inner-return-types` | Keep inner callback return types |
| `--extract-threshold <n>` | Member count for type extraction (default: 5) |

## Programmatic API

```typescript
import { createProject, fix } from "isolated-declarations-codefix";

const project = createProject("./tsconfig.json");
const result = fix(project);

console.log(result.filesChanged); // Set of modified file paths
console.log(result.totalChanges); // Number of file change operations
console.log(result.passes);       // Number of fix passes needed
```

## How it works

1. Reads your tsconfig and creates a TypeScript language service
2. For each source file, checks for `isolatedDeclarations` diagnostics (TS9007-9029)
3. Calls `getCombinedCodeFix` with fix ID `fixMissingTypeAnnotationOnExports` to get all fixes for the file at once
4. Applies text edits bottom-to-top (descending position order) so earlier positions stay valid
5. Repeats up to 5 passes since some fixes can expose new errors
6. Runs readability transforms to clean up verbose annotations
7. Writes fixed files to disk

File versions are properly tracked so the language service invalidates its caches between passes — this avoids the stale-offset bug found in similar tools.

## Readability transforms

The TypeScript codefix produces correct but verbose type annotations — fully expanded structural types, inlined spread properties, exhaustive literal unions. After fixing, a pipeline of transforms collapses these back into idiomatic forms:

| Transform | What it does |
|---|---|
| **typeof-intersection** | `{ a: number; b: number; debug: boolean }` → `typeof defaults & { debug: boolean }` for spread objects |
| **tuple-spread-collapse** | `readonly ["+", "-", "*", "/"]` → `readonly [...typeof ops1, ...typeof ops2]` for spread arrays |
| **extract-types** | Large inline type literals (5+ members) → named `interface` declarations, with cross-file dedup |
| **inline-imports** | `typeof import("./mod")` → `typeof ModModule` with namespace import |
| **collapse-unions** | `"Up" \| "Down" \| "Left" \| "Right"` → `keyof typeof Direction` when keys match |
| **generic-alias** | Expanded structural return types → `Store<State>` when an alias symbol exists |
| **strip-inner-return-types** | Removes redundant return types on inner callbacks nested inside already-typed exports |

See [docs/transforms.md](docs/transforms.md) for detailed before/after examples.
