/**
 * Parses IMAP/email headers from a string format into a Headers object.
 *
 * This function handles RFC 2822 compliant header parsing, including:
 * - Basic "Key: Value" pairs
 * - Header folding (continuation lines that start with whitespace)
 * - Multiple headers with the same name (last one wins)
 *
 * @param str - The raw header string to parse, typically containing CRLF line endings
 * @param into - Optional existing Headers object to add parsed headers to
 * @returns The Headers object containing all parsed key-value pairs
 *
 * @example
 * ```ts
 * const headerStr = "Subject: Hello World\r\nFrom: user@example.com\r\n";
 * const headers = ParseHeaders(headerStr);
 * console.log(headers.get("Subject")); // "Hello World"
 * ```
 *
 * @example
 * // Header folding example
 * ```ts
 * const foldedHeader = "Content-Type: text/html;\r\n charset=utf-8\r\n";
 * const headers = ParseHeaders(foldedHeader);
 * console.log(headers.get("Content-Type")); // "text/html; charset=utf-8"
 * ```
 */
export function ParseHeaders(str: string, into?: Headers) {
  into ||= new Headers();

  let i = 0;
  while (i < str.length) {
    const m = str.indexOf(':', i);

    if (m === -1) break;

    const key = str.slice(i, m).trim();
    i = m + 1;

    if (key.length === 0) break;

    let val = '';
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let e = str.indexOf('\r\n', i);
      if (e === -1) e = str.length;

      const chunk = str.slice(i, e).trim();
      val += chunk;
      i = e + 2;

      if (str[i] !== '\t' && str[i] !== ' ') break; // no more values
      val += ' ';
      i++;
    }
    into.set(key, val);
  }

  return into;
}
