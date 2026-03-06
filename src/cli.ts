import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fix } from "./fixer.ts";
import { createProject } from "./project.ts";
import { createPlainRenderer, createTtyRenderer } from "./renderer.ts";

interface CliOptions {
  project: string;
  dryRun: boolean;
  verbose: boolean;
  plain: boolean;
  write: boolean;
  rewriteInlineImports: boolean;
  typeofIntersection: boolean;
  tupleSpreadCollapse: boolean;
  extractTypes: boolean;
  extractThreshold: number;
  collapseUnions: boolean;
  genericAlias: boolean;
  stripInnerReturnTypes: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {
    project: "./tsconfig.json",
    dryRun: false,
    verbose: false,
    plain: false,
    write: true,
    rewriteInlineImports: true,
    typeofIntersection: true,
    tupleSpreadCollapse: true,
    extractTypes: true,
    extractThreshold: 5,
    collapseUnions: true,
    genericAlias: true,
    stripInnerReturnTypes: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-p" || arg === "--project") {
      opts.project = args[++i];
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
      opts.write = false;
    } else if (arg === "--verbose") {
      opts.verbose = true;
    } else if (arg === "--plain") {
      opts.plain = true;
    } else if (arg === "--no-write") {
      opts.write = false;
    } else if (arg === "--no-rewrite-inline-imports") {
      opts.rewriteInlineImports = false;
    } else if (arg === "--no-typeof-intersection") {
      opts.typeofIntersection = false;
    } else if (arg === "--no-tuple-spread-collapse") {
      opts.tupleSpreadCollapse = false;
    } else if (arg === "--no-extract-types") {
      opts.extractTypes = false;
    } else if (arg === "--no-collapse-unions") {
      opts.collapseUnions = false;
    } else if (arg === "--no-generic-alias") {
      opts.genericAlias = false;
    } else if (arg === "--no-strip-inner-return-types") {
      opts.stripInnerReturnTypes = false;
    } else if (arg === "--extract-threshold") {
      opts.extractThreshold = parseInt(args[++i], 10);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown option: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`
Usage: isolated-declarations-codefix [options]

Options:
  -p, --project <path>  Path to tsconfig.json
                         (default: ./tsconfig.json)
  --dry-run             Show changes without writing
  --verbose             Show per-file details
  --plain               Disable colors and progress bar
  --no-write            Don't write files to disk
  --no-rewrite-inline-imports
                        Keep typeof import() as-is
  --no-typeof-intersection
                        Skip typeof X & {...} rewrite
  --no-tuple-spread-collapse
                        Skip [...typeof X] rewrite
  --no-extract-types    Skip large type extraction
  --no-collapse-unions  Skip keyof typeof rewrite
  --no-generic-alias    Skip generic alias simplification
  --no-strip-inner-return-types
                        Keep inner callback return types
  --extract-threshold <n>
                        Extract inline types with more than
                        n members to interfaces (default: 5)
  -h, --help            Show this help message
`);
}

export function main(): void {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);
  const tsconfigPath = resolve(opts.project);

  const project = createProject(tsconfigPath);

  const isTty = process.stdout.isTTY && !opts.plain;
  const renderer = isTty
    ? createTtyRenderer(project.getRootDir(), opts.verbose, tsconfigPath)
    : createPlainRenderer(project.getRootDir());

  const fileNames = project.getFileNames();
  renderer.start(fileNames.length);

  const startTime = Date.now();
  const result = fix(project, {
    rewriteInlineImports: opts.rewriteInlineImports,
    typeofIntersection: opts.typeofIntersection,
    tupleSpreadCollapse: opts.tupleSpreadCollapse,
    extractTypes: opts.extractTypes,
    extractThreshold: opts.extractThreshold,
    collapseUnions: opts.collapseUnions,
    genericAlias: opts.genericAlias,
    stripInnerReturnTypes: opts.stripInnerReturnTypes,
    onProgress: (e) => {
      if (e.type === "file-scanned") {
        renderer.onFileScanned(e.fileName);
      } else if (e.type === "file") {
        renderer.onFileFixed(e.fileName, e.edits);
      } else if (e.type === "file-error") {
        renderer.onFileError(e.fileName, e.message);
      } else if (e.type === "file-warning") {
        renderer.onFileError(e.fileName, e.message);
      } else if (e.type === "pass-complete") {
        renderer.onPassComplete(e.pass, e.filesFixed);
      }
    },
  });
  const elapsed = Date.now() - startTime;

  renderer.finish(result, elapsed);

  if (result.totalChanges === 0) return;

  if (opts.write && !opts.dryRun) {
    for (const fileName of result.filesChanged) {
      const content = project.getFileContent(fileName);
      writeFileSync(fileName, content, "utf-8");
    }
    const n = result.filesChanged.size;
    if (isTty) {
      console.log(`  Wrote ${n}` + ` file${n !== 1 ? "s" : ""}` + ` to disk.`);
    } else {
      console.log(`Wrote ${n}` + ` file${n !== 1 ? "s" : ""}` + ` to disk.`);
    }
  } else {
    if (isTty) {
      console.log("  Dry run \u2014 no files written.");
    } else {
      console.log("Dry run \u2014 no files written.");
    }
    for (const fileName of result.filesChanged) {
      console.log(`  Would update: ${fileName}`);
    }
  }
}

// Run when executed directly
const isDirectRun =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isDirectRun) {
  main();
}
