import { assertEquals, assertInstanceOf } from '@std/assert';

import { ParseHeaders } from '../../src/parsers/header.ts';

Deno.test('ParseHeaders', async (t) => {
  await t.step('basic header parsing', () => {
    const headerStr =
      'Subject: Hello World\r\nFrom: user@example.com\r\nTo: recipient@example.com\r\n';
    const headers = ParseHeaders(headerStr);

    assertEquals(headers.get('Subject'), 'Hello World');
    assertEquals(headers.get('From'), 'user@example.com');
    assertEquals(headers.get('To'), 'recipient@example.com');
  });

  await t.step('header folding with tabs', () => {
    const headerStr = 'Content-Type: text/html;\r\n\tcharset=utf-8;\r\n\tboundary=something\r\n';
    const headers = ParseHeaders(headerStr);

    assertEquals(headers.get('Content-Type'), 'text/html; charset=utf-8; boundary=something');
  });

  await t.step('header folding with spaces', () => {
    const headerStr =
      'Received: from server1.example.com\r\n by server2.example.com\r\n with ESMTP\r\n';
    const headers = ParseHeaders(headerStr);

    assertEquals(
      headers.get('Received'),
      'from server1.example.com by server2.example.com with ESMTP',
    );
  });

  await t.step('empty string', () => {
    const headers = ParseHeaders('');
    assertInstanceOf(headers, Headers);
    assertEquals([...headers.keys()].length, 0);
  });

  await t.step('no colon separator', () => {
    const headerStr = 'InvalidHeaderWithoutColon\r\n';
    const headers = ParseHeaders(headerStr);
    assertEquals([...headers.keys()].length, 0);
  });

  await t.step('empty header name', () => {
    const headerStr = ': value without name\r\n';
    const headers = ParseHeaders(headerStr);
    assertEquals([...headers.keys()].length, 0);
  });

  await t.step('header without CRLF ending', () => {
    const headerStr = 'Subject: Test without CRLF';
    const headers = ParseHeaders(headerStr);
    assertEquals(headers.get('Subject'), 'Test without CRLF');
  });

  await t.step('multiple headers with same name', () => {
    const headerStr = 'Received: first\r\nReceived: second\r\n';
    const headers = ParseHeaders(headerStr);
    // Headers.set() replaces previous values
    assertEquals(headers.get('Received'), 'second');
  });

  await t.step('using existing Headers object', () => {
    const existing = new Headers({ 'X-Custom': 'existing-value' });
    const headerStr = 'Subject: New Header\r\n';

    const result = ParseHeaders(headerStr, existing);

    assertEquals(result, existing); // Should return the same object
    assertEquals(result.get('X-Custom'), 'existing-value');
    assertEquals(result.get('Subject'), 'New Header');
  });

  await t.step('headers with extra whitespace', () => {
    const headerStr = 'Subject  :   Hello World   \r\nFrom  :  user@example.com  \r\n';
    const headers = ParseHeaders(headerStr);

    assertEquals(headers.get('Subject'), 'Hello World');
    assertEquals(headers.get('From'), 'user@example.com');
  });

  await t.step('complex real-world example', () => {
    const headerStr = [
      'Date: Thu, 30 Aug 2025 12:00:00 +1000\r\n',
      'From: sender@example.com\r\n',
      'To: recipient@example.com\r\n',
      'Subject: Meeting Tomorrow\r\n',
      'Message-ID: <12345@example.com>\r\n',
      'MIME-Version: 1.0\r\n',
      'Content-Type: multipart/alternative;\r\n',
      '\tboundary="boundary123"\r\n',
      'X-Mailer: Custom Mailer 1.0\r\n',
    ].join('');

    const headers = ParseHeaders(headerStr);

    assertEquals(headers.get('Date'), 'Thu, 30 Aug 2025 12:00:00 +1000');
    assertEquals(headers.get('From'), 'sender@example.com');
    assertEquals(headers.get('To'), 'recipient@example.com');
    assertEquals(headers.get('Subject'), 'Meeting Tomorrow');
    assertEquals(headers.get('Message-ID'), '<12345@example.com>');
    assertEquals(headers.get('MIME-Version'), '1.0');
    assertEquals(headers.get('Content-Type'), 'multipart/alternative; boundary="boundary123"');
    assertEquals(headers.get('X-Mailer'), 'Custom Mailer 1.0');
  });

  await t.step('mixed line endings edge case', () => {
    // Test with missing \r\n at very end
    const headerStr = 'Subject: Test\r\nFrom: user@example.com';
    const headers = ParseHeaders(headerStr);

    assertEquals(headers.get('Subject'), 'Test');
    assertEquals(headers.get('From'), 'user@example.com');
  });
});
