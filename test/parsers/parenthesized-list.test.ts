import { assertEquals, assertThrows } from '@std/assert';

import { ParseParenthesizedList } from '~/parsers/parenthesized-list.ts';

Deno.test('ParseParenthesizedList - Basic functionality', () => {
  // Simple case
  assertEquals(ParseParenthesizedList('(a b c)')?.tree, ['a', 'b', 'c']);

  // Empty parentheses
  assertEquals(ParseParenthesizedList('()')?.tree, []);

  // Single item
  assertEquals(ParseParenthesizedList('(hello)')?.tree, ['hello']);

  // No opening parenthesis
  assertEquals(ParseParenthesizedList('hello world'), null);
});

Deno.test('ParseParenthesizedList - Nested structures', () => {
  // Simple nesting
  assertEquals(
    ParseParenthesizedList('(a (b c) d)')?.tree,
    ['a', ['b', 'c'], 'd'],
  );

  // Deep nesting
  assertEquals(
    ParseParenthesizedList('(a (b (c d) e) f)')?.tree,
    ['a', ['b', ['c', 'd'], 'e'], 'f'],
  );

  // Multiple nested groups
  assertEquals(
    ParseParenthesizedList('((a b) (c d))')?.tree,
    [['a', 'b'], ['c', 'd']],
  );
});

Deno.test('ParseParenthesizedList - Quoted strings', () => {
  // Basic quoted string
  assertEquals(
    ParseParenthesizedList('("hello world" test)')?.tree,
    ['"hello world"', 'test'],
  );

  // Quoted string with escaped quotes
  assertEquals(
    ParseParenthesizedList('("hello \\"world\\"" test)')?.tree,
    ['"hello \\"world\\""', 'test'],
  );

  // Mixed quoted and unquoted
  assertEquals(
    ParseParenthesizedList('(unquoted "quoted string" more)')?.tree,
    ['unquoted', '"quoted string"', 'more'],
  );
});

Deno.test('ParseParenthesizedList - IMAP literals', () => {
  // Basic literal
  assertEquals(
    ParseParenthesizedList('({11}\r\nhello world)')?.tree,
    ['"hello world"'],
  );

  // Literal with LF only
  assertEquals(
    ParseParenthesizedList('({5}\nhello world)')?.tree,
    ['"hello"', 'world'],
  );

  // Multiple literals
  assertEquals(
    ParseParenthesizedList('({3}\r\nabc {2}\r\nxy)')?.tree,
    ['"abc"', '"xy"'],
  );

  // Literal with special characters
  assertEquals(
    ParseParenthesizedList('({10}\r\nhello (world)')?.tree,
    ['"hello (wor"', 'ld'],
  );
});

Deno.test('ParseParenthesizedList - IMAP ENVELOPE example', () => {
  const envelope = '(NIL "Subject Line" ((NIL NIL "user" "example.com") NIL) NIL NIL NIL)';
  const result = ParseParenthesizedList(envelope)?.tree;

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
  const result = ParseParenthesizedList(complex)?.tree;

  assertEquals(result, [
    '"Wed, 17 Jul 1996"',
    '"Subject with ()"',
    [['"John"', 'NIL', '"john"', '"example.com"']],
  ]);
});

Deno.test('ParseParenthesizedList - Offset parameter', () => {
  const str = 'prefix (a b c) suffix';
  const result = ParseParenthesizedList(str, 7)?.tree;
  assertEquals(result, ['a', 'b', 'c']);

  // Invalid offset
  assertEquals(ParseParenthesizedList(str, 0), null);
});

Deno.test('ParseParenthesizedList - Whitespace handling', () => {
  // Extra whitespace
  assertEquals(
    ParseParenthesizedList('(  a   b    c  )')?.tree,
    ['a', 'b', 'c'],
  );

  // Tabs and mixed whitespace
  assertEquals(
    ParseParenthesizedList('(\ta\t\tb\n\nc\r\n)')?.tree,
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
  assertEquals(ParseParenthesizedList('(   )')?.tree, []);

  // Empty string
  assertEquals(ParseParenthesizedList(''), null);

  // Just opening parenthesis
  assertEquals(ParseParenthesizedList(')'), null);

  // Literal at end of string
  assertEquals(
    ParseParenthesizedList('({3}\r\nabc)')?.tree,
    ['"abc"'],
  );
});
