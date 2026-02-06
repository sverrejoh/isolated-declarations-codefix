import { describe, it, expect } from "vitest";
import { applyTextChanges } from "../../src/changes.ts";

function makeChange(
  start: number,
  length: number,
  newText: string,
) {
  return { span: { start, length }, newText };
}

describe("applyTextChanges", () => {
  it("single replacement", () => {
    const result = applyTextChanges(
      "hello there",
      [makeChange(0, 5, "world")],
    );
    expect(result).toBe("world there");
  });

  it("multiple non-overlapping changes (ascending order)", () => {
    const text = "aaa bbb ccc";
    const changes = [
      makeChange(0, 3, "AAA"),
      makeChange(8, 3, "CCC"),
    ];
    expect(applyTextChanges(text, changes)).toBe("AAA bbb CCC");
  });

  it("multiple non-overlapping changes (descending order)", () => {
    const text = "aaa bbb ccc";
    const changes = [
      makeChange(8, 3, "CCC"),
      makeChange(0, 3, "AAA"),
    ];
    expect(applyTextChanges(text, changes)).toBe("AAA bbb CCC");
  });

  it("multiple non-overlapping changes (random order)", () => {
    const text = "aaa bbb ccc ddd";
    const changes = [
      makeChange(8, 3, "CCC"),
      makeChange(0, 3, "AAA"),
      makeChange(12, 3, "DDD"),
      makeChange(4, 3, "BBB"),
    ];
    expect(applyTextChanges(text, changes)).toBe(
      "AAA BBB CCC DDD",
    );
  });

  it("change at start of file", () => {
    const result = applyTextChanges(
      "abc def",
      [makeChange(0, 3, "XYZ")],
    );
    expect(result).toBe("XYZ def");
  });

  it("change at end of file", () => {
    const result = applyTextChanges(
      "abc def",
      [makeChange(4, 3, "XYZ")],
    );
    expect(result).toBe("abc XYZ");
  });

  it("insertion (empty span)", () => {
    const result = applyTextChanges(
      "hello world",
      [makeChange(5, 0, " beautiful")],
    );
    expect(result).toBe("hello beautiful world");
  });

  it("deletion (empty newText)", () => {
    const result = applyTextChanges(
      "hello beautiful world",
      [makeChange(5, 10, "")],
    );
    expect(result).toBe("hello world");
  });

  it("replace with longer text", () => {
    const result = applyTextChanges(
      "say hi to them",
      [makeChange(4, 2, "hello world")],
    );
    expect(result).toBe("say hello world to them");
  });

  it("replace with shorter text", () => {
    const result = applyTextChanges(
      "say hello world to them",
      [makeChange(4, 11, "hi")],
    );
    expect(result).toBe("say hi to them");
  });

  it("adjacent changes", () => {
    // "aabbcc" -> replace "aa" with "AA", "bb" with "BB"
    const result = applyTextChanges("aabbcc", [
      makeChange(0, 2, "AA"),
      makeChange(2, 2, "BB"),
    ]);
    expect(result).toBe("AABBcc");
  });

  it("many changes in a large file", () => {
    const lines = Array.from(
      { length: 100 },
      (_, i) => `line ${i}`,
    );
    const text = lines.join("\n");
    // Replace "line" with "LINE" on every line
    const changes: ReturnType<typeof makeChange>[] = [];
    let offset = 0;
    for (let i = 0; i < 100; i++) {
      changes.push(makeChange(offset, 4, "LINE"));
      // +1 for the newline between lines
      offset += lines[i].length + 1;
    }
    const result = applyTextChanges(text, changes);
    const expected = lines
      .map((l) => l.replace("line", "LINE"))
      .join("\n");
    expect(result).toBe(expected);
  });

  it("empty changes array", () => {
    const text = "unchanged text";
    expect(applyTextChanges(text, [])).toBe(text);
  });

  it("unicode content", () => {
    // TS uses UTF-16 offsets. "café" is 4 chars in UTF-16.
    // The emoji "😀" is 2 UTF-16 code units (surrogate pair).
    const text = "café 😀 end";
    // Replace "😀" (2 UTF-16 code units at offset 5)
    const result = applyTextChanges(
      text,
      [makeChange(5, 2, "🎉")],
    );
    expect(result).toBe("café 🎉 end");
  });

  it("inserting multiline text", () => {
    // "function foo() {}" - insert body after "{" at pos 16
    const result = applyTextChanges(
      "function foo() {}",
      [makeChange(16, 0, "\n  return 42;\n")],
    );
    expect(result).toBe(
      "function foo() {\n  return 42;\n}",
    );
  });
});
