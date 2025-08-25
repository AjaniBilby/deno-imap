type ParenthesizedList = Array<string | ParenthesizedList>;

/**
 * Parses IMAP parenthesized structures into a nested tree structure.
 *
 * This function handles:
 * - Nested parentheses: `(a (b c) d)` → `['a', ['b', 'c'], 'd']`
 * - Quoted strings with escapes: `('hello "world"')` → `['hello "world"']`
 * - IMAP literals: `({5}\r\nhello)` → `['"hello"']`
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
 * ExtractBalancedParenthesis('(a b c)')
 * // Returns: ['a', 'b', 'c']
 *
 * // Nested structures
 * ExtractBalancedParenthesis('(a (b c) d)')
 * // Returns: ['a', ['b', 'c'], 'd']
 *
 * // Quoted strings
 * ExtractBalancedParenthesis('("hello world" test)')
 * // Returns: ['"hello world"', 'test']
 *
 * // IMAP literals
 * ExtractBalancedParenthesis('({5}\r\nhello world)')
 * // Returns: ['"hello"']
 * ```
 */
export function ParseParenthesizedList(
  str: string,
  offset: number = 0,
): { tree: ParenthesizedList; reached: number } | null {
  if (str[offset] !== '(') return null;

  const tree = [] as ParenthesizedList;
  const stack: [ParenthesizedList] = [tree];

  function tail() {
    return stack[stack.length - 1];
  }

  let i = offset + 1;
  outer: while (i < str.length) {
    switch (str[i]) {
      case '(': {
        const branch = [] as ParenthesizedList;
        tail().push(branch);
        stack.push(branch);
        i++;
        continue outer;
      }
      case ')': {
        stack.pop();
        i++;

        if (stack.length < 1) break outer;
        continue outer;
      }
      case '"': {
        const cursor = i;
        i++; // Skip opening quote
        for (; i < str.length; i++) {
          if (str[i] === '\\') {
            i++; // skip next due to escape
            continue;
          }
          if (str[i] === '"') break;
        }
        if (i === str.length) throw new Error('Unterminated string in parenthesis');

        i++; // move over closing quote
        tail().push(str.slice(cursor, i));

        continue outer;
      }
      case '{': {
        const literalMatch = str.slice(i).match(/^{(\d+)}\r?\n/);
        if (!literalMatch) continue;

        // this is not 100% accurate since it should be the number of bytes while still in utf7 form
        const literalLength = parseInt(literalMatch[1], 10);

        const cursor = str.indexOf('\n', i) + 1; // will never be -1 thanks to the regex guard
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
        for (; i < str.length; i++) {
          if (BREAK_ON.includes(str[i])) break;
        }

        const val = str.slice(cursor, i).trim();
        if (val.length > 0) tail().push(val);
      }
    }
  }

  if (stack.length > 0) throw new Error('Parenthesis are unbalanced');

  return { tree, reached: i };
}

const WHITE_SPACE = [' ', '\t', '\r', '\n'] as readonly string[];
const BREAK_ON = ['(', ')', '{', ...WHITE_SPACE] as readonly string[];
