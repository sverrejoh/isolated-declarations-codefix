import {
  readdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { resolve, relative } from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";

interface PkgResult {
  name: string;
  status: "success" | "fail" | "skip";
  remaining: number;
  changed: number;
  rewrites: number;
  error?: string;
}

if (!isMainThread) {
  // Worker thread
  const { dirs, packagesDir, rewrite, write } =
    workerData as {
      dirs: string[];
      packagesDir: string;
      rewrite: boolean;
      write: boolean;
    };

  // Dynamic import to avoid loading TS in main
  const { createProject } = await import(
    "../src/project.ts"
  );
  const { fix } = await import("../src/fixer.ts");

  const results: PkgResult[] = [];
  for (const dir of dirs) {
    const tsconfigPath = resolve(
      dir,
      "tsconfig.json",
    );
    const name = relative(packagesDir, dir);

    try {
      const project = createProject(tsconfigPath);
      let rewriteCount = 0;
      const result = fix(project, {
        rewriteInlineImports: rewrite,
      });

      if (rewrite) {
        for (const f of result.filesChanged) {
          const content =
            project.getFileContent(f);
          const matches = content.match(
            /import type \* as \w+Module from/g,
          );
          if (matches) {
            rewriteCount += matches.length;
          }
        }
      }

      const totalRemaining = [
        ...result.remainingErrors.values(),
      ].reduce((a, b) => a + b, 0);

      if (write) {
        for (const f of result.filesChanged) {
          writeFileSync(
            f,
            project.getFileContent(f),
            "utf-8",
          );
        }
      }

      results.push({
        name,
        status:
          totalRemaining === 0
            ? "success"
            : "fail",
        remaining: totalRemaining,
        changed: result.filesChanged.size,
        rewrites: rewriteCount,
      });
    } catch (err) {
      results.push({
        name,
        status: "skip",
        remaining: -1,
        changed: 0,
        rewrites: 0,
        error:
          err instanceof Error
            ? err.message.slice(0, 120)
            : String(err).slice(0, 120),
      });
    }
  }
  parentPort!.postMessage(results);
} else {
  // Main thread
  const midgardDir = process.argv[2];
  if (!midgardDir) {
    console.error(
      "Usage: node scripts/run-1js.ts" +
        " <midgard-dir> [--no-rewrite] [--write]",
    );
    process.exit(1);
  }

  const rewrite = !process.argv.includes(
    "--no-rewrite",
  );
  const write = process.argv.includes("--write");
  const packagesDir = resolve(
    midgardDir,
    "packages",
  );

  // Find eligible packages
  const eligible: string[] = [];
  const allDirs = readdirSync(packagesDir, {
    withFileTypes: true,
  })
    .filter((d) => d.isDirectory())
    .map((d) => resolve(packagesDir, d.name));

  for (const dir of allDirs) {
    const tc = resolve(dir, "tsconfig.json");
    if (!existsSync(tc)) continue;
    try {
      const content = readFileSync(tc, "utf-8");
      if (content.includes('"isolatedDeclarations"'))
        eligible.push(dir);
    } catch {
      continue;
    }
  }

  console.log(
    `Found ${eligible.length} packages` +
      ` with isolatedDeclarations`,
  );
  console.log(
    `Rewrite: ${rewrite ? "ON" : "OFF"}`,
  );

  const numWorkers = Math.min(
    cpus().length,
    8,
  );
  console.log(
    `Using ${numWorkers} workers`,
  );

  // Distribute packages across workers
  const chunks: string[][] = Array.from(
    { length: numWorkers },
    () => [],
  );
  eligible.forEach((dir, i) => {
    chunks[i % numWorkers].push(dir);
  });

  const scriptPath = fileURLToPath(
    import.meta.url,
  );
  const startTime = Date.now();

  const allResults: PkgResult[] = [];
  let done = 0;

  const promises = chunks.map(
    (chunk) =>
      new Promise<PkgResult[]>((res, rej) => {
        const worker = new Worker(scriptPath, {
          workerData: {
            dirs: chunk,
            packagesDir,
            rewrite,
            write,
          },
        });
        worker.on("message", (results) => {
          done += results.length;
          process.stderr.write(
            `\r  ${done}/${eligible.length}` +
              ` packages processed`,
          );
          res(results);
        });
        worker.on("error", rej);
        worker.on("exit", (code) => {
          if (code !== 0) {
            rej(
              new Error(
                `Worker exited ${code}`,
              ),
            );
          }
        });
      }),
  );

  const resultArrays = await Promise.all(promises);
  for (const arr of resultArrays) {
    allResults.push(...arr);
  }

  const elapsed = (
    (Date.now() - startTime) /
    1000
  ).toFixed(1);
  process.stderr.write("\n");

  const success = allResults.filter(
    (r) => r.status === "success",
  );
  const fail = allResults.filter(
    (r) => r.status === "fail",
  );
  const skip = allResults.filter(
    (r) => r.status === "skip",
  );
  const totalRewrites = allResults.reduce(
    (a, r) => a + r.rewrites,
    0,
  );

  console.log(`\n=== Results (${elapsed}s) ===`);
  console.log(
    `Packages processed: ${allResults.length}`,
  );
  console.log(
    `Success (0 remaining): ${success.length}`,
  );
  console.log(
    `Fail (errors remain): ${fail.length}`,
  );
  console.log(
    `Skipped (crash): ${skip.length}`,
  );
  console.log(
    `Rewrite: ${rewrite ? "ON" : "OFF"}`,
  );
  if (rewrite) {
    console.log(
      `Namespace imports added: ` +
        `${totalRewrites}`,
    );
  }

  if (fail.length > 0) {
    console.log(`\n--- Failed packages ---`);
    const sorted = [...fail].sort(
      (a, b) => b.remaining - a.remaining,
    );
    for (const r of sorted.slice(0, 30)) {
      console.log(
        `  ${r.name}: ${r.remaining} errors`,
      );
    }
    if (sorted.length > 30) {
      console.log(
        `  ... ${sorted.length - 30} more`,
      );
    }
  }

  if (skip.length > 0) {
    console.log(`\n--- Skipped packages ---`);
    for (const r of skip.slice(0, 10)) {
      console.log(`  ${r.name}: ${r.error}`);
    }
    if (skip.length > 10) {
      console.log(
        `  ... ${skip.length - 10} more`,
      );
    }
  }

  // Write full results to JSON
  const outPath = resolve(
    midgardDir,
    rewrite
      ? "iso-decl-results-rewrite.json"
      : "iso-decl-results-baseline.json",
  );
  writeFileSync(
    outPath,
    JSON.stringify(allResults, null, 2),
    "utf-8",
  );
  console.log(`\nFull results: ${outPath}`);
}
