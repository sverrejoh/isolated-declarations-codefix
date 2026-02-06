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
6. Writes fixed files to disk

File versions are properly tracked so the language service invalidates its caches between passes — this avoids the stale-offset bug found in similar tools.
