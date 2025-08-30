import { assertEquals } from '@std/assert/equals';

import { ParseFetchHeaders } from '../../src/parsers/fetch.ts';

Deno.test('ParseHeaders - Simple', () => {
  assertEquals(ParseFetchHeaders('test: line'), { test: 'line' });
  assertEquals(ParseFetchHeaders('test: line\r\n\tbroken'), { test: 'line broken' });
});
