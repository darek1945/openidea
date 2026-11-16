import type { Text } from "@codemirror/state";
import { registerLanguageSemantics, type LanguageSemantics } from "../languages";

/**
 * C# semantics for csharp-ls, which maps Roslyn classifications onto its own token legend
 * (Handlers/SemanticTokens.fs): `class` (also delegates and records), `struct` (also record
 * structs), `interface`, `enum`, `typeParameter`, `field`, `event`, `constant`, `method`
 * (also extension methods), and a single `static` modifier. It sends no `declaration`
 * modifier, so method declarations are told apart from calls by the text before the name.
 */

/** Words after which `Name(` is a call, not a declaration with that word as its return type. */
const CALL_KEYWORDS = new Set([
  "and",
  "as",
  "await",
  "case",
  "else",
  "in",
  "is",
  "nameof",
  "not",
  "or",
  "out",
  "ref",
  "return",
  "throw",
  "when",
  "yield",
]);

/** Words that may precede a tuple return type: `public static (int, int) Split(`. */
const MODIFIERS = new Set([
  "abstract",
  "async",
  "extern",
  "internal",
  "new",
  "override",
  "partial",
  "private",
  "protected",
  "public",
  "readonly",
  "sealed",
  "static",
  "unsafe",
  "virtual",
]);

// A name, optional type arguments (one nesting level), then `(`.
const CALL_SHAPE = /([A-Za-z_]\w*)\s*(?:<(?:[^<>();{}]|<[^<>();{}]*>)*>)?\s*\(/g;
const WORD_BEFORE = /([A-Za-z_]\w*)$/;

function skipSpaceBack(text: string, at: number): number {
  while (at > 0 && /\s/.test(text[at - 1]!)) at--;
  return at;
}

/** Whether the parenthesised group ending at `close` (exclusive) is a tuple type after modifiers or at a member start. */
function isTupleReturnType(text: string, close: number): boolean {
  let depth = 0;
  let open = -1;
  for (let i = close - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ")") depth++;
    else if (ch === "(" && --depth === 0) {
      open = i;
      break;
    }
  }
  if (open < 0 || !text.slice(open, close).includes(",")) return false;
  const before = skipSpaceBack(text, open);
  const word = WORD_BEFORE.exec(text.slice(Math.max(0, before - 32), before))?.[1];
  if (word) return MODIFIERS.has(word);
  return before === 0 || /[;{}\]]/.test(text[before - 1]!);
}

/** Whether the name at `from` is declared (a return type precedes it) rather than called. */
function isDeclaration(text: string, from: number): boolean {
  const end = skipSpaceBack(text, from);
  if (end === 0) return false;
  const prev = text[end - 1]!;
  if (/\w/.test(prev)) {
    const word = WORD_BEFORE.exec(text.slice(Math.max(0, end - 32), end))?.[1];
    return !!word && !CALL_KEYWORDS.has(word);
  }
  // `Task<int> Get(`, `int? Get(`, `byte* Get(`; not `a > Get(` or `x => Get(`.
  if (prev === ">" || prev === "?" || prev === "*") return end >= 2 && /[\w>\]?)]/.test(text[end - 2]!);
  // `int[] Get(`, `int[,] Get(`: an array rank specifier right after a type.
  if (prev === "]") {
    const open = text.lastIndexOf("[", end - 1);
    return open > 0 && /^[\s,]*$/.test(text.slice(open + 1, end - 1)) && /[\w>?\]]/.test(text[open - 1]!);
  }
  if (prev === ")") return end < from && isTupleReturnType(text, end);
  return false;
}

/** Method names in declaration position, as `"from:to"`  `"methodDeclaration"`. */
export function methodDeclarations(doc: Text): Map<string, string> {
  const out = new Map<string, string>();
  const text = doc.toString();
  for (const m of text.matchAll(CALL_SHAPE)) {
    const from = m.index;
    if (isDeclaration(text, from)) out.set(`${from}:${from + m[1]!.length}`, "methodDeclaration");
  }
  return out;
}

/** Extra classes per csharp-ls token type; the generic mapping leaves `field`, `event` and `constant` unstyled. */
const TYPE_CLASSES: Record<string, readonly string[]> = {
  class: ["cm-sem-csharp-class"],
  interface: ["cm-sem-csharp-interface"],
  struct: ["cm-sem-csharp-struct"],
  enum: ["cm-sem-csharp-enum"],
  typeParameter: ["cm-sem-csharp-type-parameter"],
  field: ["cm-sem-property"],
  event: ["cm-sem-property", "cm-sem-csharp-event"],
  constant: ["cm-sem-constant"],
};

const csharpSemantics: LanguageSemantics = {
  symbolKinds: (_tree, doc) => methodDeclarations(doc),
  tokenClasses({ type, kind, classes }) {
    for (const cls of TYPE_CLASSES[type] ?? []) if (!classes.includes(cls)) classes.push(cls);
    if (type === "method" && kind === "methodDeclaration" && !classes.includes("cm-sem-declaration"))
      classes.push("cm-sem-declaration");
  },
};

registerLanguageSemantics("csharp", csharpSemantics);
