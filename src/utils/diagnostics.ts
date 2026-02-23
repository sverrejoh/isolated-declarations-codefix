import type { Project } from "../project.ts";

export function isIsolatedDeclarationsError(code: number): boolean {
  return (code >= 9007 && code <= 9025) || (code >= 9035 && code <= 9039);
}

export function getNonIsoErrorCount(
  project: Project,
  fileName: string
): number {
  return project.languageService
    .getSemanticDiagnostics(fileName)
    .filter(
      (d) => !isIsolatedDeclarationsError(d.code)
    ).length;
}
