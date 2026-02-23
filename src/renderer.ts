import { relative } from "node:path";
import type { FixResult } from "./fixer.ts";

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
};

const icon = {
  ts: "\u{f06e6}",
  check: "\u{f012c}",
  dot: "\u{f444}",
  warn: "\u{f071}",
};

const FIX_ID = "fixMissingTypeAnnotationOnExports";

const frames = [
  "\u28cb",
  "\u2819",
  "\u2839",
  "\u2838",
  "\u283c",
  "\u2834",
  "\u2826",
  "\u2827",
  "\u2807",
  "\u280f",
];

export interface Renderer {
  start(totalFiles: number): void;
  onFileScanned(fileName: string): void;
  onFileFixed(fileName: string, edits: number): void;
  onFileError(fileName: string, message: string): void;
  onPassComplete(pass: number, filesFixed: number): void;
  finish(result: FixResult, elapsed: number): void;
}

export function createTtyRenderer(
  rootDir: string,
  verbose: boolean,
  tsconfigPath?: string
): Renderer {
  let total = 0;
  let scanned = 0;
  let spinIdx = 0;
  let lastFile = "";
  let linesUp = 0;
  const barW = 24;
  let fixed: { name: string; edits: number }[] = [];

  function rel(p: string): string {
    return relative(rootDir, p);
  }

  function trunc(s: string, max: number): string {
    if (s.length <= max) return s;
    return "\u2026" + s.slice(s.length - max + 1);
  }

  function erase(): void {
    for (let i = 0; i < linesUp; i++) {
      if (i === 0) {
        process.stdout.write("\r\x1b[K");
      } else {
        process.stdout.write("\x1b[A\r\x1b[K");
      }
    }
    linesUp = 0;
  }

  function draw(): void {
    erase();
    const pct = total > 0 ? scanned / total : 0;
    const filled = Math.round(pct * barW);
    const bar = "\u2501".repeat(filled) + "\u2500".repeat(barW - filled);
    const cols = process.stdout.columns || 80;
    const maxPath = cols - 6;
    const f = frames[spinIdx % frames.length];
    const file = lastFile ? trunc(lastFile, maxPath) : "";
    process.stdout.write(
      `  ${c.cyan}${bar}${c.reset}` +
        ` ${c.dim}${scanned}/${total}${c.reset}\n` +
        `  ${c.dim}${f} ${file}${c.reset}`
    );
    linesUp = 2;
  }

  function above(line: string): void {
    erase();
    process.stdout.write(line + "\n");
    draw();
  }

  return {
    start(totalFiles: number): void {
      total = totalFiles;
      scanned = 0;
      const cfg = tsconfigPath ? rel(tsconfigPath) : "tsconfig.json";
      console.log(
        `  ${c.cyan}${icon.ts}${c.reset}` +
          ` ${c.bold}isolated-declarations` +
          `-codefix${c.reset}`
      );
      console.log(
        `  ${c.dim}${cfg}` +
          ` \u00b7 ${total} files` +
          ` \u00b7 ${FIX_ID}${c.reset}`
      );
      console.log();
      draw();
    },

    onFileScanned(fileName: string): void {
      scanned++;
      spinIdx++;
      lastFile = rel(fileName);
      draw();
    },

    onFileFixed(fileName: string, edits: number): void {
      const n = rel(fileName);
      fixed.push({ name: n, edits });
      if (verbose) {
        const label = edits === 1 ? "edit" : "edits";
        above(
          `  ${c.green}${icon.check}${c.reset}` +
            ` ${c.dim}${n}${c.reset}` +
            `  ${c.cyan}${edits}${c.reset}` +
            ` ${label}`
        );
      }
    },

    onFileError(fileName: string, message: string): void {
      const short = message.includes("Changes overlap")
        ? "overlapping changes (TS bug)"
        : message.slice(0, 60);
      above(
        `  ${c.yellow}${icon.warn}${c.reset}` +
          ` ${c.dim}${rel(fileName)}${c.reset}` +
          `  ${c.yellow}${short}${c.reset}`
      );
    },

    onPassComplete(pass: number, filesFixed: number): void {
      erase();
      console.log(
        `  ${c.green}${icon.dot}${c.reset}` +
          ` pass ${pass}` +
          ` \u00b7 ${c.cyan}${filesFixed}` +
          `${c.reset} fixed`
      );

      if (!verbose && fixed.length > 0) {
        const show = fixed.slice(0, 5);
        const rest = fixed.length - show.length;
        for (const f of show) {
          const label = f.edits === 1 ? "edit" : "edits";
          console.log(
            `    ${c.green}${icon.check}` +
              `${c.reset}` +
              ` ${c.dim}${f.name}${c.reset}` +
              `  ${c.cyan}${f.edits}${c.reset}` +
              ` ${label}`
          );
        }
        if (rest > 0) {
          console.log(`    ${c.dim}\u2026 ${rest} more` + `${c.reset}`);
        }
      }

      fixed = [];
      scanned = 0;
    },

    finish(result: FixResult, elapsed: number): void {
      const secs = (elapsed / 1000).toFixed(1);
      const ns = result.filesSkipped.size;
      const nr = result.remainingErrors.size;
      const totalRemaining = [...result.remainingErrors.values()].reduce(
        (a, b) => a + b,
        0
      );
      console.log();
      if (result.totalChanges === 0 && ns === 0 && nr === 0) {
        console.log(`  ${c.green}${icon.check}${c.reset}` + ` no fixes needed`);
      } else {
        const nf = result.filesChanged.size;
        const np = result.passes;
        let line =
          `  ${c.green}${icon.check}${c.reset}` +
          ` ${c.cyan}${nf}${c.reset}` +
          ` file${nf !== 1 ? "s" : ""} fixed` +
          ` \u00b7 ${c.cyan}${secs}s${c.reset}` +
          ` \u00b7 ${c.cyan}${np}${c.reset}` +
          ` pass${np !== 1 ? "es" : ""}`;
        if (ns > 0) {
          line += ` \u00b7 ${c.yellow}${ns}` + `${c.reset} skipped`;
        }
        console.log(line);
      }

      if (totalRemaining > 0) {
        console.log(
          `  ${c.yellow}${icon.warn}${c.reset}` +
            ` ${c.yellow}${totalRemaining}` +
            `${c.reset}` +
            ` error${totalRemaining !== 1 ? "s" : ""}` +
            ` remaining in` +
            ` ${c.yellow}${nr}${c.reset}` +
            ` file${nr !== 1 ? "s" : ""}` +
            ` ${c.dim}(no auto-fix available)` +
            `${c.reset}`
        );
        const entries = [...result.remainingErrors.entries()];
        const show = entries.slice(0, 5);
        const rest = entries.length - show.length;
        for (const [f, n] of show) {
          console.log(
            `    ${c.yellow}${icon.warn}` +
              `${c.reset}` +
              ` ${c.dim}${rel(f)}${c.reset}` +
              `  ${c.yellow}${n}${c.reset}`
          );
        }
        if (rest > 0) {
          console.log(`    ${c.dim}\u2026 ${rest} more` + `${c.reset}`);
        }
      }
    },
  };
}

export function createPlainRenderer(rootDir: string): Renderer {
  let currentPass = 1;

  function rel(p: string): string {
    return relative(rootDir, p);
  }

  return {
    start(): void {},

    onFileScanned(): void {},

    onFileFixed(fileName: string, edits: number): void {
      const label = edits === 1 ? "edit" : "edits";
      console.log(
        `Pass ${currentPass}: ${rel(fileName)}` + ` (${edits} ${label})`
      );
    },

    onFileError(fileName: string, message: string): void {
      const short = message.includes("Changes overlap")
        ? "overlapping changes (TS bug)"
        : message.slice(0, 60);
      console.log(`SKIP ${rel(fileName)}: ${short}`);
    },

    onPassComplete(pass: number): void {
      currentPass = pass + 1;
    },

    finish(result: FixResult): void {
      const ns = result.filesSkipped.size;
      const totalRemaining = [...result.remainingErrors.values()].reduce(
        (a, b) => a + b,
        0
      );
      if (result.totalChanges === 0 && ns === 0 && totalRemaining === 0) {
        console.log("No isolated declarations fixes needed.");
      } else {
        const nf = result.filesChanged.size;
        const np = result.passes;
        let line =
          `${nf}` +
          ` file${nf !== 1 ? "s" : ""}` +
          ` fixed in ${np}` +
          ` pass${np !== 1 ? "es" : ""}.`;
        if (ns > 0) {
          line += ` ${ns} skipped.`;
        }
        console.log(line);
      }
      if (totalRemaining > 0) {
        const nr = result.remainingErrors.size;
        console.log(
          `${totalRemaining} errors remaining` +
            ` in ${nr}` +
            ` file${nr !== 1 ? "s" : ""}` +
            ` (no auto-fix available):`
        );
        for (const [f, n] of result.remainingErrors) {
          console.log(`  ${rel(f)}: ${n}`);
        }
      }
    },
  };
}
