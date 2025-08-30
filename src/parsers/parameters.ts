import { SkipWhiteSpace } from './util.ts';
import { ImapAddress } from '../types/mod.ts';

export type ParenthesizedValue = string | Array<ParenthesizedValue>;
export type ParenthesizedList = Array<ParenthesizedValue>;

/**
 * Parses IMAP parameters from either a parenthesized list or a single token.
 *
 * This parser accepts:
 * - A full parenthesized structure: `(a (b c) d)` → `['a', ['b', 'c'], 'd']`
 * - A standalone token without parentheses (e.g., atoms like `NIL`, numbers, flags),
 *   quoted strings, or IMAP literals:
 *   - `NIL` → `'NIL'`
 *   - `"hello world"` → `'"hello world"'`
 *   - `{5}\r\nhello` → `'"hello"'`
 *
 * It handles:
 * - Nested parentheses
 * - Quoted strings with escapes
 * - IMAP literals
 * - Mixed, whitespace-separated values
 *
 * Parsing starts at `offset` (skips whitespace).
 *
 * @param str - The input string containing IMAP data
 * @param offset - Starting position in the string (default: 0)
 *
 * @returns An object containing the parsed value and the final position reached:
 *   - `val` is a `ParenthesizedValue` (either a list or a single token)
 *   - `reached` is the index just after the parsed value
 *   Returns `undefined` if there is no parsable value at the offset
 *   (e.g., end of string, newline, or non-token character).
 *
 * @throws {Error} When parentheses are unbalanced
 * @throws {Error} When quoted strings (or literals) are unterminated
 *
 * @example
 * ```ts
 * // Standalone atom
 * ParseParenthesized('NIL')
 * // Returns: 'NIL'
 *
 * // Standalone quoted string
 * ParseParenthesized('"hello world"')
 * // Returns: '"hello world"'
 *
 * // Standalone IMAP literal
 * ParseParenthesized('{5}\r\nhello')
 * // Returns: '"hello"'
 *
 * // Basic parenthesized list
 * ParseParenthesized('(a b c)')
 * // Returns: ['a', 'b', 'c']
 *
 * // Nested structures
 * ParseParenthesized('(a (b c) d)')
 * // Returns: ['a', ['b', 'c'], 'd']
 *
 * // Mixed tokens
 * ParseParenthesized('(NIL "x" {3}\r\nabc)')
 * // Returns: ['NIL', '"x"', '"abc"']
 * ```
 */
export function ParseParenthesized(
  str: string,
  offset: number = 0,
): { val: ParenthesizedValue; reached: number } | undefined {
  offset = SkipWhiteSpace(str, offset, false);

  // reached the end
  if (str.length <= offset) return undefined;

  // single token resolution
  if (str[offset] !== '(') {
    const token = TryAtom(str, offset);
    if (token) return token;
    return undefined;
  }

  offset++; // consume '('

  const tree = [] as ParenthesizedList;
  const stack: ParenthesizedList[] = [tree];

  function tail() {
    return stack[stack.length - 1];
  }

  outer: while (offset < str.length) {
    offset = SkipWhiteSpace(str, offset);

    switch (str[offset]) {
      case '(': {
        offset++;

        const branch = [] as ParenthesizedList;
        tail().push(branch);
        stack.push(branch);

        continue outer;
      }
      case ')': {
        stack.pop();
        offset++;

        if (stack.length < 1) break outer;
        continue outer;
      }
      default: {
        const token = TryAtom(str, offset);
        if (!token) throw new Error(`Unexpected token '${str[offset]}' at ${offset}`);
        tail().push(token.val);
        offset = token.reached;
        continue outer;
      }
    }
  }

  if (stack.length > 0) throw new Error('Parenthesis are unbalanced');

  return { val: tree, reached: offset };
}

function TryAtom(str: string, offset: number = 0) {
  return TryString(str, offset) ||
    TryLiteral(str, offset) ||
    TryKeyword(str, offset);
}

function TryLiteral(str: string, offset: number = 0) {
  if (str[offset] !== '{') return undefined;
  offset++;

  const s = offset;
  for (; offset < str.length; offset++) {
    if (str[offset] === '}') break;

    const char = str.charCodeAt(offset);
    if (char < '0'.charCodeAt(0)) return undefined;
    if (char > '9'.charCodeAt(0)) return undefined;
  }

  const bytes = parseInt(str.slice(s, offset), 10);

  if (str[offset] !== '}') return undefined;
  offset++;

  if (str[offset] === '\r') offset++;

  if (str[offset] !== '\n') return undefined;
  offset++;

  const e = offset + bytes;
  if (e > str.length) throw new Error('Not enough bytes present for string literal');

  return { val: '"' + str.slice(offset, e) + '"', reached: e };
}

function TryString(str: string, offset: number = 0) {
  if (str[offset] !== '"') return undefined;

  let i = offset;
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

  return {
    val: str.slice(offset, i),
    reached: i,
  };
}

const BREAK_ON = ['(', ')', '{', ' ', '\t', '\r', '\n'] as readonly string[];
function TryKeyword(str: string, offset: number = 0) {
  // progress to next item
  let i = offset;
  for (; i < str.length; i++) {
    if (BREAK_ON.includes(str[i])) break;
  }

  const val = str.slice(offset, i).trim();
  if (val.length < 1) return undefined;

  return { val, reached: i };
}

/*============================
 * Helpers
=============================*/

export function ExtractFirstParameterValue(val: ParenthesizedValue) {
  if (typeof val === 'string') return val;
  return ExtractFirstParameterValue(val[0] || '');
}

export function GetParameterListStr(list: ParenthesizedValue, index: number): string | undefined {
  if (!Array.isArray(list)) return undefined;
  return ParameterString(list[index]);
}

export function ParameterString(val: ParenthesizedValue) {
  if (!val) return undefined;
  if (Array.isArray(val)) return undefined;
  if (val === 'NIL') return undefined;
  if (val.startsWith('"') && val.endsWith('"')) return val.slice(1, -1);
  return val;
}

export function ParseImapAddressList(value: ParenthesizedValue) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => ParseImapAddress(x));
}

export function ParseImapAddress(value: ParenthesizedValue): ImapAddress {
  if (!Array.isArray(value)) {
    return {
      name: undefined,
      sourceRoute: undefined,
      mailbox: undefined,
      host: undefined,
    };
  }

  return {
    name: GetParameterListStr(value, 0),
    sourceRoute: GetParameterListStr(value, 1),
    mailbox: GetParameterListStr(value, 2),
    host: GetParameterListStr(value, 3),
  };
}
