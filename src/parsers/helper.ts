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
 * @returns The parsed tree structure, or null if no opening parenthesis at offset
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
export function ExtractBalancedParenthesis(str: string, offset: number = 0) {
  if (str[offset] !== "(") return null;

  const head = [] as ParenthesisTree;
  const stack: [ParenthesisTree] = [head];
  let cursor = offset+1;

  function tail() {
    return stack[stack.length-1];
  }

  for (let i=cursor; i<str.length; i++) {

    switch (str[i]) {
      case "(": {
        const branch = [] as ParenthesisTree;
        tail().push(branch);
        stack.push(branch);
        cursor = i+1;
        break;
      }
      case ")": {
        const value = str.slice(cursor, i).trim();
        if (value.length > 0) tail().push(value);

        stack.pop();
        cursor = i+1;
        break;
      }
      case " ": {
        const value = str.slice(cursor, i).trim();
        if (value.length > 0) tail().push(value);
        cursor = i;
        break;
      }
      case '"': {
        cursor = i;
        i++; // Skip opening quote
        for (; i<str.length; i++) {
          if (str[i] === "\\" ) i++; // skip next due to escape
          if (str[i] === '"') break;
        }

        if (i === str.length) throw new Error("Unterminated string in parenthesis");

        tail().push(str.slice(cursor, i));
        cursor = i+1;

        break;
      }
      case "{": {
        const literalMatch = str.slice(i).match(/^{(\d+)}\r?\n/);
        if (!literalMatch) continue;

        const literalLength = parseInt(literalMatch[1], 10);

        cursor = str.indexOf("\n", i) + 1;
        i += literalLength;

        tail().push(str.slice(cursor, i));
        i = cursor;

        if (literalMatch) {
          const literalLength = parseInt(literalMatch[1], 10);
          i += literalMatch[0].length + literalLength;
        }
        break;
      }
    }

  }

  if (stack.length > 0) throw new Error("Parenthesis are unbalanced");

  return head;
}


Deno.test("ExtractBalancedParenthesis - Basic functionality", () => {
  // Simple case
  assertEquals(ExtractBalancedParenthesis("(a b c)"), ["a", "b", "c"]);

  // Empty parentheses
  assertEquals(ExtractBalancedParenthesis("()"), []);

  // Single item
  assertEquals(ExtractBalancedParenthesis("(hello)"), ["hello"]);

  // No opening parenthesis
  assertEquals(ExtractBalancedParenthesis("hello world"), null);
});

Deno.test("ExtractBalancedParenthesis - Nested structures", () => {
  // Simple nesting
  assertEquals(
    ExtractBalancedParenthesis("(a (b c) d)"),
    ["a", ["b", "c"], "d"]
  );

  // Deep nesting
  assertEquals(
    ExtractBalancedParenthesis("(a (b (c d) e) f)"),
    ["a", ["b", ["c", "d"], "e"], "f"]
  );

  // Multiple nested groups
  assertEquals(
    ExtractBalancedParenthesis("((a b) (c d))"),
    [["a", "b"], ["c", "d"]]
  );
});

Deno.test("ExtractBalancedParenthesis - Quoted strings", () => {
  // Basic quoted string
  assertEquals(
    ExtractBalancedParenthesis('("hello world" test)'),
    ['"hello world"', "test"]
  );

  // Quoted string with escaped quotes
  assertEquals(
    ExtractBalancedParenthesis('("hello \\"world\\"" test)'),
    ['"hello \\"world\\""', "test"]
  );

  // Mixed quoted and unquoted
  assertEquals(
    ExtractBalancedParenthesis('(unquoted "quoted string" more)'),
    ["unquoted", '"quoted string"', "more"]
  );
});

Deno.test("ExtractBalancedParenthesis - IMAP literals", () => {
  // Basic literal
  assertEquals(
    ExtractBalancedParenthesis("({5}\r\nhello world)"),
    ["hello"]
  );

  // Literal with LF only
  assertEquals(
    ExtractBalancedParenthesis("({5}\nhello world)"),
    ["hello"]
  );

  // Multiple literals
  assertEquals(
    ExtractBalancedParenthesis("({3}\r\nabc {2}\r\nxy)"),
    ["abc", "xy"]
  );

  // Literal with special characters
  assertEquals(
    ExtractBalancedParenthesis("({10}\r\nhello (world)"),
    ["hello (wor"]
  );
});

Deno.test("ExtractBalancedParenthesis - IMAP ENVELOPE example", () => {
  const envelope = '(NIL "Subject Line" ((NIL NIL "user" "example.com")) NIL NIL NIL)';
  const result = ExtractBalancedParenthesis(envelope);

  assertEquals(result, [
    "NIL",
    '"Subject Line"',
    [["NIL", "NIL", '"user"', '"example.com"']],
    "NIL",
    "NIL",
    "NIL"
  ]);
});

Deno.test("ExtractBalancedParenthesis - Complex IMAP example", () => {
  const complex = '("Wed, 17 Jul 1996" {15}\r\nSubject with () (("John" NIL "john" "example.com")))';
  const result = ExtractBalancedParenthesis(complex);

  assertEquals(result, [
    '"Wed, 17 Jul 1996"',
    "Subject with ()",
    [["\"John\"", "NIL", "\"john\"", "\"example.com\""]]
  ]);
});

Deno.test("ExtractBalancedParenthesis - Offset parameter", () => {
  const str = "prefix (a b c) suffix";
  const result = ExtractBalancedParenthesis(str, 7);
  assertEquals(result, ["a", "b", "c"]);

  // Invalid offset
  assertEquals(ExtractBalancedParenthesis(str, 0), null);
});

Deno.test("ExtractBalancedParenthesis - Whitespace handling", () => {
  // Extra whitespace
  assertEquals(
    ExtractBalancedParenthesis("(  a   b    c  )"),
    ["a", "b", "c"]
  );

  // Tabs and mixed whitespace
  assertEquals(
    ExtractBalancedParenthesis("(\ta\t\tb\n\nc\r\n)"),
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

  // Unbalanced parentheses - extra closing
  assertThrows(
    () => ExtractBalancedParenthesis("(a b) c)"),
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
  assertEquals(ExtractBalancedParenthesis("(   )"), []);

  // Empty string
  assertEquals(ExtractBalancedParenthesis(""), null);

  // Just opening parenthesis
  assertEquals(ExtractBalancedParenthesis("("), null);

  // Literal at end of string
  assertEquals(
    ExtractBalancedParenthesis("({3}\r\nabc)"),
    ["abc"]
  );
});