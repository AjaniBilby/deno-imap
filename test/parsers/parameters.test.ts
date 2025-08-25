import { assertEquals, assertThrows } from '@std/assert';

import { ParseParenthesized } from '../../src/parsers/parameters.ts';

Deno.test('ParseParenthesizedList - Basic functionality', () => {
  // Simple case
  assertEquals(ParseParenthesized('(a b c)')?.val, ['a', 'b', 'c']);

  // Empty parentheses
  assertEquals(ParseParenthesized('()')?.val, []);

  // Single item
  assertEquals(ParseParenthesized('(hello)')?.val, ['hello']);

  // No opening parenthesis
  assertEquals(ParseParenthesized('hello world')?.val, "hello");
});

Deno.test('ParseParenthesizedList - Nested structures', () => {
  // Simple nesting
  assertEquals(
    ParseParenthesized('(a (b c) d)')?.val,
    ['a', ['b', 'c'], 'd'],
  );

  // Deep nesting
  assertEquals(
    ParseParenthesized('(a (b (c d) e) f)')?.val,
    ['a', ['b', ['c', 'd'], 'e'], 'f'],
  );

  // Multiple nested groups
  assertEquals(
    ParseParenthesized('((a b) (c d))')?.val,
    [['a', 'b'], ['c', 'd']],
  );
});

Deno.test('ParseParenthesizedList - Quoted strings', () => {
  // Basic quoted string
  assertEquals(
    ParseParenthesized('("hello world" test)')?.val,
    ['"hello world"', 'test'],
  );

  // Quoted string with escaped quotes
  assertEquals(
    ParseParenthesized('("hello \\"world\\"" test)')?.val,
    ['"hello \\"world\\""', 'test'],
  );

  // Mixed quoted and unquoted
  assertEquals(
    ParseParenthesized('(unquoted "quoted string" more)')?.val,
    ['unquoted', '"quoted string"', 'more'],
  );
});

Deno.test('ParseParenthesizedList - IMAP literals', () => {
  // Basic literal
  assertEquals(
    ParseParenthesized('({11}\r\nhello world)')?.val,
    ['"hello world"'],
  );

  // Literal with LF only
  assertEquals(
    ParseParenthesized('({5}\nhello world)')?.val,
    ['"hello"', 'world'],
  );

  // Multiple literals
  assertEquals(
    ParseParenthesized('({3}\r\nabc {2}\r\nxy)')?.val,
    ['"abc"', '"xy"'],
  );

  // Literal with special characters
  assertEquals(
    ParseParenthesized('({10}\r\nhello (world)')?.val,
    ['"hello (wor"', 'ld'],
  );
});

Deno.test('ParseParenthesizedList - IMAP ENVELOPE example', () => {
  const envelope = '(NIL "Subject Line" ((NIL NIL "user" "example.com") NIL) NIL NIL NIL)';
  const result = ParseParenthesized(envelope)?.val;

  assertEquals(result, [
    'NIL',
    '"Subject Line"',
    [['NIL', 'NIL', '"user"', '"example.com"'], 'NIL'],
    'NIL',
    'NIL',
    'NIL',
  ]);
});

Deno.test('ParseParenthesizedList - Complex IMAP example', () => {
  const complex =
    '("Wed, 17 Jul 1996" {15}\r\nSubject with () (("John" NIL "john" "example.com")))';
  const result = ParseParenthesized(complex)?.val;

  assertEquals(result, [
    '"Wed, 17 Jul 1996"',
    '"Subject with ()"',
    [['"John"', 'NIL', '"john"', '"example.com"']],
  ]);
});

Deno.test('ParseParenthesizedList - Offset parameter', () => {
  const str = 'prefix (a b c) suffix';
  const result = ParseParenthesized(str, 7)?.val;
  assertEquals(result, ['a', 'b', 'c']);

  // Invalid offset
  assertEquals(ParseParenthesized(str, 0)?.val, "prefix");
});

Deno.test('ParseParenthesizedList - Whitespace handling', () => {
  // Extra whitespace
  assertEquals(
    ParseParenthesized('(  a   b    c  )')?.val,
    ['a', 'b', 'c'],
  );

  // Tabs and mixed whitespace
  assertEquals(
    ParseParenthesized('(\ta\t\tb  c\t )')?.val,
    ['a', 'b', 'c'],
  );
});

Deno.test('ParseParenthesizedList - Error cases', () => {
  // Unbalanced parentheses - missing closing
  assertThrows(
    () => ParseParenthesized('(a b c'),
    Error,
    'Parenthesis are unbalanced',
  );

  // Unterminated quoted string
  assertThrows(
    () => ParseParenthesized('("hello world'),
    Error,
    'Unterminated string in parenthesis',
  );

  // Unterminated quoted string with escape
  assertThrows(
    () => ParseParenthesized('("hello \\"world'),
    Error,
    'Unterminated string in parenthesis',
  );
});

Deno.test('ParseParenthesizedList - Edge cases', () => {
  // Only whitespace
  assertEquals(ParseParenthesized('(   )')?.val, []);

  // Empty string
  assertEquals(ParseParenthesized(''), undefined);

  // Just opening parenthesis
  assertEquals(ParseParenthesized(')'), undefined);

  // Literal at end of string
  assertEquals(
    ParseParenthesized('({3}\r\nabc)')?.val,
    ['"abc"'],
  );
});
