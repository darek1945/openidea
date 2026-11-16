import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { Tree } from "@lezer/common";
import { semanticRanges } from "../index";
import { methodDeclarations } from "./index";

// csharp-ls's legend (Handlers/SemanticTokens.fs), in a fixed order for the tests.
const TYPES = ["class", "interface", "struct", "enum", "typeParameter", "field", "event", "constant", "method"];
const MODIFIERS = ["static"];

function classOf(type: string, modifiers = 0, language = "csharp") {
  const tokens = { tokenTypes: TYPES, tokenModifiers: MODIFIERS, data: [0, 0, 4, TYPES.indexOf(type), modifiers] };
  return semanticRanges(Text.of(["Name"]), tokens, false, language)[0]?.className.split(" ");
}

describe("C# semantic tokens", () => {
  it.each([
    ["class", ["cm-sem-type", "cm-sem-csharp-class"]],
    ["interface", ["cm-sem-type", "cm-sem-csharp-interface"]],
    ["struct", ["cm-sem-type", "cm-sem-csharp-struct"]],
    ["enum", ["cm-sem-type", "cm-sem-csharp-enum"]],
    ["typeParameter", ["cm-sem-typeParameter", "cm-sem-csharp-type-parameter"]],
    ["field", ["cm-sem-property"]],
    ["event", ["cm-sem-property", "cm-sem-csharp-event"]],
    ["constant", ["cm-sem-constant"]],
  ])("styles %s tokens by kind", (type, expected) => {
    expect(classOf(type)).toEqual(expected);
  });

  it("keeps static fields static and leaves other languages alone", () => {
    expect(classOf("field", 1)).toEqual(["cm-sem-static", "cm-sem-property"]);
    expect(classOf("interface", 0, "typescript")).toEqual(["cm-sem-type"]);
    expect(classOf("field", 0, "typescript")).toBeUndefined();
  });

  it("colours method declarations as declarations and calls as calls", () => {
    const lines = [
      "public async Task<int> LoadAsync(CancellationToken ct)",
      "{",
      "    var n = await FetchAsync(ct);",
      "    return Compute(n) + list.Count(x => Check(x));",
      "}",
      "private static (int, int) Split(int v) => (v, v);",
      "int[] Values() => [];",
      "if (ready) Run();",
    ];
    const doc = Text.of(lines);
    const methods = ["LoadAsync", "FetchAsync", "Compute", "Count", "Check", "Split", "Values", "Run"];
    const data = methods.flatMap((name) => {
      const line = lines.findIndex((l) => new RegExp(`\\b${name}\\b`).test(l));
      return [line, lines[line]!.search(new RegExp(`\\b${name}\\b`)), name.length, TYPES.indexOf("method"), 0];
    });
    const ranges = semanticRanges(
      doc,
      { tokenTypes: TYPES, tokenModifiers: MODIFIERS, data },
      false,
      "csharp",
      Tree.empty,
    );
    const declared = ranges
      .filter((r) => r.className.split(" ").includes("cm-sem-declaration"))
      .map((r) => doc.sliceString(r.from, r.to));
    expect(declared).toEqual(["LoadAsync", "Split", "Values"]);
  });

  it.each([
    ["void Run()", true],
    ["public IEnumerable<KeyValuePair<string, int>> Pairs()", true],
    ["string? Find(int id)", true],
    ["int[,] Find()", true],
    ["var y = items[0]?.Find();", false],
    ["obj.Run()", false],
    ["x => Run()", false],
    ["a > Run()", false],
    ["return Run();", false],
    ["throw Fail();", false],
    ["Run();", false],
  ])("treats `%s` as a declaration: %s", (code, expected) => {
    const doc = Text.of([code]);
    const at = code.search(/\b(Run|Pairs|Find|Fail)\b/);
    expect([...methodDeclarations(doc).keys()].some((k) => k.startsWith(`${at}:`))).toBe(expected);
  });
});
