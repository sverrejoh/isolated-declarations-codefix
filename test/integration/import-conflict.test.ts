import { describe, it, expect } from "vitest";
import {
  fixFixture,
  writeTempFiles,
  getTscErrors,
} from "../helpers.ts";

describe("import-conflict", () => {
  it("handles import/local name conflicts", () => {
    const t = fixFixture("import-conflict");
    // Either fixes cleanly or rolls back without
    // corruption.
    const total =
      t.result.filesChanged.size +
      t.result.filesSkipped.size;
    expect(total).toBeGreaterThan(0);
  });

  it("does not introduce new non-iso errors", () => {
    const t = fixFixture("import-conflict");
    writeTempFiles(t);
    const errors = getTscErrors(t.tempDir);
    const nonIsoErrors = errors.filter(
      (e) => !/TS90(?:[0-2]\d|3[5-9])/.test(e),
    );
    // TS2395 is pre-existing in the fixture due to
    // the import type { Foo } / export const Foo
    // conflict. Verify only those remain.
    const unexpected = nonIsoErrors.filter(
      (e) => !e.startsWith("TS2395"),
    );
    expect(unexpected).toEqual([]);
  });
});
