import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createProject } from "./project.js";
import { fix } from "./fixer.js";

interface CliOptions {
  project: string;
  dryRun: boolean;
  verbose: boolean;
  write: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {
    project: "./tsconfig.json",
    dryRun: false,
    verbose: false,
    write: true,
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
    } else if (arg === "--no-write") {
      opts.write = false;
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
  --verbose             Show detailed progress
  --no-write            Don't write files to disk
  -h, --help            Show this help message
`);
}

export function main(): void {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);
  const tsconfigPath = resolve(opts.project);

  if (opts.verbose) {
    console.log(`Using tsconfig: ${tsconfigPath}`);
  }

  const project = createProject(tsconfigPath);

  if (opts.verbose) {
    console.log(
      `Found ${project.getFileNames().length} source files`,
    );
  }

  const result = fix(project, { verbose: opts.verbose });

  if (result.totalChanges === 0) {
    console.log("No isolated declarations fixes needed.");
    return;
  }

  console.log(
    `Applied fixes to ${result.filesChanged.size} file(s)` +
      ` in ${result.passes} pass(es).`,
  );

  if (opts.write && !opts.dryRun) {
    for (const fileName of result.filesChanged) {
      const content = project.getFileContent(fileName);
      writeFileSync(fileName, content, "utf-8");
    }
    console.log("Files written to disk.");
  } else {
    console.log("Dry run — no files written.");
    for (const fileName of result.filesChanged) {
      console.log(`  Would update: ${fileName}`);
    }
  }
}
