import ts from "typescript";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface Project {
  languageService: ts.LanguageService;
  getFileContent(fileName: string): string;
  updateFile(fileName: string, content: string): void;
  getFileNames(): string[];
  getRootDir(): string;
}

export function createProject(tsconfigPath: string): Project {
  const resolvedPath = resolve(tsconfigPath);
  const rootDir = dirname(resolvedPath);

  const configFile = ts.readConfigFile(
    resolvedPath,
    (p) => readFileSync(p, "utf-8"),
  );
  if (configFile.error) {
    throw new Error(
      `Failed to read ${resolvedPath}: ` +
        ts.flattenDiagnosticMessageText(
          configFile.error.messageText,
          "\n",
        ),
    );
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    rootDir,
  );
  if (parsed.errors.length > 0) {
    const msgs = parsed.errors
      .map((e) =>
        ts.flattenDiagnosticMessageText(e.messageText, "\n"),
      )
      .join("\n");
    throw new Error(`Config errors in ${resolvedPath}:\n${msgs}`);
  }

  const fileVersions = new Map<string, number>();
  const fileContents = new Map<string, string>();

  function getVersion(fileName: string): string {
    return String(fileVersions.get(fileName) ?? 0);
  }

  function getFileContent(fileName: string): string {
    const cached = fileContents.get(fileName);
    if (cached !== undefined) return cached;
    if (existsSync(fileName)) {
      return readFileSync(fileName, "utf-8");
    }
    return "";
  }

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: (fileName) => getVersion(fileName),
    getScriptSnapshot: (fileName) => {
      const content = getFileContent(fileName);
      if (content === "" && !existsSync(fileName)) return undefined;
      return ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => rootDir,
    getCompilationSettings: () => parsed.options,
    getDefaultLibFileName: (options) =>
      ts.getDefaultLibFilePath(options),
    fileExists: (fileName) =>
      fileContents.has(fileName) || ts.sys.fileExists(fileName),
    readFile: (fileName) => getFileContent(fileName),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  };

  const languageService = ts.createLanguageService(
    host,
    ts.createDocumentRegistry(),
  );

  function updateFile(fileName: string, content: string): void {
    const currentVersion = fileVersions.get(fileName) ?? 0;
    fileVersions.set(fileName, currentVersion + 1);
    fileContents.set(fileName, content);
  }

  return {
    languageService,
    getFileContent,
    updateFile,
    getFileNames: () => [...parsed.fileNames],
    getRootDir: () => rootDir,
  };
}
