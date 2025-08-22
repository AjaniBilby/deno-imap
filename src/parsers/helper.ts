import { assertEquals, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";


type ParenthesisTree = Array<string | ParenthesisTree>;

/**
 * Parses IMAP parenthesized structures into a nested tree structure.
 *
 * This function handles:
 * - Nested parentheses: `(a (b c) d)` → `["a", ["b", "c"], "d"]`
 * - Quoted strings with escapes: `("hello \"world\"")` → `["hello \"world\""]`
 * - IMAP literals: `({5}\r\nhello)` → `["hello"]`
 * - Mixed whitespace-separated values
 *
 * @param str - The input string containing IMAP parenthesized data
 * @param offset - Starting position in the string (default: 0)
 *
 * @returns An object containing the parsed tree structure and the final position reached,
 *          or null if no opening parenthesis is found at the offset
 *
 * @throws {Error} When parentheses are unbalanced
 * @throws {Error} When quoted strings are unterminated
 *
 * @example
 * ```ts
 * // Basic parsing
 * ExtractBalancedParenthesis("(a b c)")
 * // Returns: ["a", "b", "c"]
 *
 * // Nested structures
 * ExtractBalancedParenthesis("(a (b c) d)")
 * // Returns: ["a", ["b", "c"], "d"]
 *
 * // Quoted strings
 * ExtractBalancedParenthesis('("hello world" test)')
 * // Returns: ["hello world", "test"]
 *
 * // IMAP literals
 * ExtractBalancedParenthesis("({5}\r\nhello world)")
 * // Returns: ["hello"]
 * ```
 */
export function ExtractBalancedParenthesis(str: string, offset: number = 0): { tree: ParenthesisTree, reached: number } | null {
  if (str[offset] !== "(") return null;

  const tree = [] as ParenthesisTree;
  const stack: [ParenthesisTree] = [tree];

  function tail() {
    return stack[stack.length-1];
  }

  let i = offset+1;
  outer: while (i<str.length) switch (str[i]) {
    case "(": {
      const branch = [] as ParenthesisTree;
      tail().push(branch);
      stack.push(branch);
      i++;
      continue outer;
    }
    case ")": {
      stack.pop();
      i++;

      if (stack.length < 1) break outer;
      continue outer;
    }
    case '"': {
      const cursor = i;
      i++; // Skip opening quote
      for (; i<str.length; i++) {
        if (str[i] === "\\" ) {
          i++; // skip next due to escape
          continue;
        }
        if (str[i] === '"') break;
      }
      if (i === str.length) throw new Error("Unterminated string in parenthesis");

      i++; // move over closing quote
      tail().push(str.slice(cursor, i));

      continue outer;
    }
    case "{": {
      const literalMatch = str.slice(i).match(/^{(\d+)}\r?\n/);
      if (!literalMatch) continue;

      // this is not 100% accurate since it should be the number of bytes while still in utf7 form
      const literalLength = parseInt(literalMatch[1], 10);

      const cursor = str.indexOf("\n", i) + 1; // will never be -1 thanks to the regex guard
      i = cursor + literalLength;

      // treat them just like a string in later parsing
      tail().push('"' + str.slice(cursor, i) + '"');

      continue outer;
    }
    default: {
      const cursor = i;

      if (WHITE_SPACE.includes(str[i])) {
        i++;
        continue outer;
      }

      i++; // already checked

      // progress to next item
      for (; i<str.length; i++) {
        if (BREAK_ON.includes(str[i])) break;
      }

      const val = str.slice(cursor, i).trim();
      if (val.length > 0) tail().push(val);
    }
  }

  if (stack.length > 0) throw new Error("Parenthesis are unbalanced");

  return { tree, reached: i };
}

const WHITE_SPACE = [ " ", "\t", "\r", "\n"         ] as readonly string[];
const BREAK_ON    = [ "(", ")", "{", ...WHITE_SPACE ] as readonly string[];


Deno.test("ExtractBalancedParenthesis - Basic functionality", () => {
  // Simple case
  assertEquals(ExtractBalancedParenthesis("(a b c)")?.tree, ["a", "b", "c"]);

  // Empty parentheses
  assertEquals(ExtractBalancedParenthesis("()")?.tree, []);

  // Single item
  assertEquals(ExtractBalancedParenthesis("(hello)")?.tree, ["hello"]);

  // No opening parenthesis
  assertEquals(ExtractBalancedParenthesis("hello world"), null);
});

Deno.test("ExtractBalancedParenthesis - Nested structures", () => {
  // Simple nesting
  assertEquals(
    ExtractBalancedParenthesis("(a (b c) d)")?.tree,
    ["a", ["b", "c"], "d"]
  );

  // Deep nesting
  assertEquals(
    ExtractBalancedParenthesis("(a (b (c d) e) f)")?.tree,
    ["a", ["b", ["c", "d"], "e"], "f"]
  );

  // Multiple nested groups
  assertEquals(
    ExtractBalancedParenthesis("((a b) (c d))")?.tree,
    [["a", "b"], ["c", "d"]]
  );
});

Deno.test("ExtractBalancedParenthesis - Quoted strings", () => {
  // Basic quoted string
  assertEquals(
    ExtractBalancedParenthesis('("hello world" test)')?.tree,
    ['"hello world"', "test"]
  );

  // Quoted string with escaped quotes
  assertEquals(
    ExtractBalancedParenthesis('("hello \\"world\\"" test)')?.tree,
    ['"hello \\"world\\""', "test"]
  );

  // Mixed quoted and unquoted
  assertEquals(
    ExtractBalancedParenthesis('(unquoted "quoted string" more)')?.tree,
    ["unquoted", '"quoted string"', "more"]
  );
});

Deno.test("ExtractBalancedParenthesis - IMAP literals", () => {
  // Basic literal
  assertEquals(
    ExtractBalancedParenthesis("({11}\r\nhello world)")?.tree,
    ['"hello world"']
  );

  // Literal with LF only
  assertEquals(
    ExtractBalancedParenthesis("({5}\nhello world)")?.tree,
    ['"hello"', "world"]
  );

  // Multiple literals
  assertEquals(
    ExtractBalancedParenthesis("({3}\r\nabc {2}\r\nxy)")?.tree,
    ['"abc"', '"xy"']
  );

  // Literal with special characters
  assertEquals(
    ExtractBalancedParenthesis("({10}\r\nhello (world)")?.tree,
    ['"hello (wor"', "ld"]
  );
});

Deno.test("ExtractBalancedParenthesis - IMAP ENVELOPE example", () => {
  const envelope = '(NIL "Subject Line" ((NIL NIL "user" "example.com") NIL) NIL NIL NIL)';
  const result = ExtractBalancedParenthesis(envelope)?.tree;

  assertEquals(result, [
    "NIL",
    '"Subject Line"',
    [["NIL", "NIL", '"user"', '"example.com"'], "NIL"],
    "NIL",
    "NIL",
    "NIL"
  ]);
});

Deno.test("ExtractBalancedParenthesis - Complex IMAP example", () => {
  const complex = '("Wed, 17 Jul 1996" {15}\r\nSubject with () (("John" NIL "john" "example.com")))';
  const result = ExtractBalancedParenthesis(complex)?.tree;

  assertEquals(result, [
    '"Wed, 17 Jul 1996"',
    '"Subject with ()"',
    [['"John"', "NIL", '"john"', '"example.com"']]
  ]);
});

Deno.test("ExtractBalancedParenthesis - Offset parameter", () => {
  const str = "prefix (a b c) suffix";
  const result = ExtractBalancedParenthesis(str, 7)?.tree;
  assertEquals(result, ["a", "b", "c"]);

  // Invalid offset
  assertEquals(ExtractBalancedParenthesis(str, 0), null);
});

Deno.test("ExtractBalancedParenthesis - Whitespace handling", () => {
  // Extra whitespace
  assertEquals(
    ExtractBalancedParenthesis("(  a   b    c  )")?.tree,
    ["a", "b", "c"]
  );

  // Tabs and mixed whitespace
  assertEquals(
    ExtractBalancedParenthesis("(\ta\t\tb\n\nc\r\n)")?.tree,
    ["a", "b", "c"]
  );
});

Deno.test("ExtractBalancedParenthesis - Error cases", () => {
  // Unbalanced parentheses - missing closing
  assertThrows(
    () => ExtractBalancedParenthesis("(a b c"),
    Error,
    "Parenthesis are unbalanced"
  );

  // Unterminated quoted string
  assertThrows(
    () => ExtractBalancedParenthesis('("hello world'),
    Error,
    "Unterminated string in parenthesis"
  );

  // Unterminated quoted string with escape
  assertThrows(
    () => ExtractBalancedParenthesis('("hello \\"world'),
    Error,
    "Unterminated string in parenthesis"
  );
});

Deno.test("ExtractBalancedParenthesis - Edge cases", () => {
  // Only whitespace
  assertEquals(ExtractBalancedParenthesis("(   )")?.tree, []);

  // Empty string
  assertEquals(ExtractBalancedParenthesis(""), null);

  // Just opening parenthesis
  assertEquals(ExtractBalancedParenthesis(")"), null);

  // Literal at end of string
  assertEquals(
    ExtractBalancedParenthesis("({3}\r\nabc)")?.tree,
    ['"abc"']
  );
});