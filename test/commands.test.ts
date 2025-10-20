import { assertEquals } from '@std/assert';

import * as commands from '../src/commands/mod.ts';

Deno.test('commands', async (t) => {
  await t.step('list', async (t) => {
    await t.step('formats correctly with empty reference', () => {
      const result = commands.list('', '*');
      assertEquals(result, 'LIST "" *');
    });
    await t.step('formats correctly with non-empty reference', () => {
      const result = commands.list('INBOX', '*');
      assertEquals(result, 'LIST INBOX *');
    });
    await t.step('quotes mailbox with spaces', () => {
      const result = commands.list('', 'Sent Items');
      assertEquals(result, 'LIST "" "Sent Items"');
    });
  });

  await t.step('select', async (t) => {
    await t.step('formats correctly', () => {
      const result = commands.select('INBOX');
      assertEquals(result, 'SELECT INBOX');
    });
    await t.step('quotes mailbox with spaces', () => {
      const result = commands.select('Sent Items');
      assertEquals(result, 'SELECT "Sent Items"');
    });
  });

  await t.step('search', async (t) => {
    await t.step('formats flags correctly', () => {
      const result = commands.search({ flags: { has: ['\\Unseen'] } });
      assertEquals(result, 'SEARCH UNSEEN');
    });
    await t.step('formats multiple flags correctly', () => {
      const result = commands.search({
        flags: {
          has: ['\\Unseen', '\\Flagged'],
          not: ['\\Deleted'],
        },
      });
      assertEquals(result, 'SEARCH UNSEEN FLAGGED NOT DELETED');
    });
    await t.step('formats date criteria correctly', () => {
      const date = new Date('2023-01-15');
      const result = commands.search({
        date: {
          internal: { since: date },
        },
      });

      // The exact format might vary depending on timezone, so we'll just check for the basic structure
      const hasCorrectFormat = result.startsWith('SEARCH SINCE ');
      assertEquals(hasCorrectFormat, true);
    });
  });

  await t.step('fetch', async (t) => {
    await t.step('formats basic options correctly', () => {
      const result = commands.fetch('1:10', { envelope: true, flags: true });
      assertEquals(result, 'FETCH 1:10 (FLAGS ENVELOPE)');
    });
    await t.step('formats UID fetch correctly', () => {
      const result = commands.fetch('1:10', { envelope: true, flags: true, byUid: true });
      assertEquals(result, 'UID FETCH 1:10 (FLAGS ENVELOPE)');
    });
    await t.step('formats headers correctly', () => {
      const result = commands.fetch('1', { headers: ['Subject', 'From'] });
      assertEquals(result, 'FETCH 1 (BODY.PEEK[HEADER.FIELDS (Subject From)])');
    });
  });

  await t.step('store', async (t) => {
    await t.step('formats flag setting correctly', () => {
      const result = commands.store('1:5', ['\\Seen'], 'set');
      assertEquals(result, 'STORE 1:5 FLAGS (\\Seen)');
    });
    await t.step('formats flag adding correctly', () => {
      const result = commands.store('1:5', ['\\Seen'], 'add');
      assertEquals(result, 'STORE 1:5 +FLAGS (\\Seen)');
    });
    await t.step('formats flag removing correctly', () => {
      const result = commands.store('1:5', ['\\Seen'], 'remove');
      assertEquals(result, 'STORE 1:5 -FLAGS (\\Seen)');
    });
  });

  await t.step('login', async (t) => {
    await t.step('command formats correctly', () => {
      const result = commands.login('user@example.com', 'password');
      assertEquals(result, 'LOGIN user@example.com password');
    });
  });

  await t.step('create', async (t) => {
    await t.step('command formats correctly', () => {
      const result = commands.create('New Folder');
      assertEquals(result, 'CREATE "New Folder"');
    });
  });

  await t.step('delete', async (t) => {
    await t.step('command formats correctly', () => {
      const result = commands.deleteMailbox('Old Folder');
      assertEquals(result, 'DELETE "Old Folder"');
    });
  });

  await t.step('copy', async (t) => {
    await t.step('command formats correctly', () => {
      const result = commands.copy('1:5', 'Archive');
      assertEquals(result, 'COPY 1:5 Archive');
    });
  });

  await t.step('move', async (t) => {
    await t.step('command formats correctly', () => {
      const result = commands.move('1:5', 'Archive');
      assertEquals(result, 'MOVE 1:5 Archive');
    });
  });

  await t.step('append', async (t) => {
    await t.step('formats correctly with ASCII message', () => {
      const result = commands.append('INBOX', 'Hello, World!');
      assertEquals(result, 'APPEND INBOX {13}');
    });

    await t.step('correctly calculates length for UTF-8 characters', () => {
      // Test with various multi-byte UTF-8 characters:
      // - '🌟' (star emoji) is 4 bytes
      // - '中' (Chinese character) is 3 bytes
      // - 'é' (Latin e with acute) is 2 bytes
      // - 'a' (ASCII) is 1 byte
      // Total: 10 bytes
      const result = commands.append('INBOX', '🌟中éa');
      assertEquals(result, 'APPEND INBOX {10}');
    });

    await t.step('formats correctly with flags and date', () => {
      const date = new Date('2024-03-13T12:00:00Z');
      const message = '🌟 Important message'; // '🌟' is 4 bytes
      const result = commands.append('INBOX', message, ['\\Seen', '\\Flagged'], date);
      // 4 bytes for 🌟 + 18 bytes for " Important message" = 22 bytes total
      assertEquals(result.startsWith('APPEND INBOX (\\Seen \\Flagged) "13-Mar-2024 '), true);
      assertEquals(result.endsWith('" {22}'), true);
    });
  });
});
