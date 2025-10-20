import { assertEquals } from '@std/assert';

import * as commands from '../src/commands/mod.ts';

Deno.test('search command', async (t) => {
  await t.step('formats correctly with empty reference', () => {
    const result = commands.list('', '*');
    assertEquals(result, 'LIST "" *');
  });

  await t.step('formats correctly with non-empty reference', () => {
    const result = commands.list('INBOX', '*');
    assertEquals(result, 'LIST INBOX *');
  });

  await t.step('formats flags correctly', () => {
    const result = commands.search({ flags: { has: ['\\Unseen'] } });
    assertEquals(result, 'SEARCH UNSEEN');
  });
});
