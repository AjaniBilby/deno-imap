import { assertEquals, assertThrows } from '@std/assert';

import { ParseParenthesizedList } from '../../src/parsers/parameters.ts';

Deno.test('ParseParenthesizedList - Basic functionality', () => {
  // Simple case
  assertEquals(ParseParenthesizedList('(a b c)')?.val, ['a', 'b', 'c']);

  // Empty parentheses
  assertEquals(ParseParenthesizedList('()')?.val, []);

  // Single item
  assertEquals(ParseParenthesizedList('(hello)')?.val, ['hello']);

  // No opening parenthesis
  assertEquals(ParseParenthesizedList('hello world')?.val, "hello");
});

Deno.test('ParseParenthesizedList - Nested structures', () => {
  // Simple nesting
  assertEquals(
    ParseParenthesizedList('(a (b c) d)')?.val,
    ['a', ['b', 'c'], 'd'],
  );

  // Deep nesting
  assertEquals(
    ParseParenthesizedList('(a (b (c d) e) f)')?.val,
    ['a', ['b', ['c', 'd'], 'e'], 'f'],
  );

  // Multiple nested groups
  assertEquals(
    ParseParenthesizedList('((a b) (c d))')?.val,
    [['a', 'b'], ['c', 'd']],
  );
});

Deno.test('ParseParenthesizedList - Quoted strings', () => {
  // Basic quoted string
  assertEquals(
    ParseParenthesizedList('("hello world" test)')?.val,
    ['"hello world"', 'test'],
  );

  // Quoted string with escaped quotes
  assertEquals(
    ParseParenthesizedList('("hello \\"world\\"" test)')?.val,
    ['"hello \\"world\\""', 'test'],
  );

  // Mixed quoted and unquoted
  assertEquals(
    ParseParenthesizedList('(unquoted "quoted string" more)')?.val,
    ['unquoted', '"quoted string"', 'more'],
  );
});

Deno.test('ParseParenthesizedList - IMAP literals', () => {
  // Basic literal
  assertEquals(
    ParseParenthesizedList('({11}\r\nhello world)')?.val,
    ['"hello world"'],
  );

  // Literal with LF only
  assertEquals(
    ParseParenthesizedList('({5}\nhello world)')?.val,
    ['"hello"', 'world'],
  );

  // Multiple literals
  assertEquals(
    ParseParenthesizedList('({3}\r\nabc {2}\r\nxy)')?.val,
    ['"abc"', '"xy"'],
  );

  // Literal with special characters
  assertEquals(
    ParseParenthesizedList('({10}\r\nhello (world)')?.val,
    ['"hello (wor"', 'ld'],
  );
});

Deno.test('ParseParenthesizedList - IMAP ENVELOPE example', () => {
  const envelope = '(NIL "Subject Line" ((NIL NIL "user" "example.com") NIL) NIL NIL NIL)';
  const result = ParseParenthesizedList(envelope)?.val;

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
  const result = ParseParenthesizedList(complex)?.val;

  assertEquals(result, [
    '"Wed, 17 Jul 1996"',
    '"Subject with ()"',
    [['"John"', 'NIL', '"john"', '"example.com"']],
  ]);
});

Deno.test('ParseParenthesizedList - Offset parameter', () => {
  const str = 'prefix (a b c) suffix';
  const result = ParseParenthesizedList(str, 7)?.val;
  assertEquals(result, ['a', 'b', 'c']);

  // Invalid offset
  assertEquals(ParseParenthesizedList(str, 0)?.val, "prefix");
});

Deno.test('ParseParenthesizedList - Whitespace handling', () => {
  // Extra whitespace
  assertEquals(
    ParseParenthesizedList('(  a   b    c  )')?.val,
    ['a', 'b', 'c'],
  );

  // Tabs and mixed whitespace
  assertEquals(
    ParseParenthesizedList('(\ta\t\tb  c\t )')?.val,
    ['a', 'b', 'c'],
  );
});

Deno.test('ParseParenthesizedList - Error cases', () => {
  // Unbalanced parentheses - missing closing
  assertThrows(
    () => ParseParenthesizedList('(a b c'),
    Error,
    'Parenthesis are unbalanced',
  );

  // Unterminated quoted string
  assertThrows(
    () => ParseParenthesizedList('("hello world'),
    Error,
    'Unterminated string in parenthesis',
  );

  // Unterminated quoted string with escape
  assertThrows(
    () => ParseParenthesizedList('("hello \\"world'),
    Error,
    'Unterminated string in parenthesis',
  );
});

Deno.test('ParseParenthesizedList - Edge cases', () => {
  // Only whitespace
  assertEquals(ParseParenthesizedList('(   )')?.val, []);

  // Empty string
  assertEquals(ParseParenthesizedList(''), undefined);

  // Just opening parenthesis
  assertEquals(ParseParenthesizedList(')'), undefined);

  // Literal at end of string
  assertEquals(
    ParseParenthesizedList('({3}\r\nabc)')?.val,
    ['"abc"'],
  );
});
