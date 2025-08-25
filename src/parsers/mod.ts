import type { ImapEnvelope, ImapMailbox } from '../types/mod.ts';
import { ImapParseError } from '../errors.ts';
import { ParseFetch } from './fetch.ts';

// Export bodystructure parser functions directly
export { findAttachments, hasAttachments, parseBodyStructure } from './bodystructure.ts';
import { ParseParenthesized } from './parameters.ts';
import { ParseEnvelope } from './fetch.ts';


/**
 * Parses a capability response
 * @param line Capability response line
 * @returns Array of capabilities
 */
export function parseCapabilities(line: string): string[] {
  // Format: * CAPABILITY IMAP4rev1 STARTTLS AUTH=PLAIN ...
  const match = line.match(/^\* CAPABILITY (.+)$/i);

  if (!match) {
    throw new ImapParseError('Invalid capability response', line);
  }

  return match[1].split(' ');
}

/**
 * Parses a list response
 * @param line List response line
 * @returns Mailbox information
 */
export function parseListResponse(line: string): ImapMailbox {
  // Format: * LIST (\HasNoChildren) "/" "INBOX"
  const match = line.match(/^\* LIST \((.*?)\) "(.+?)" (.+)$/i);

  if (!match) {
    throw new ImapParseError('Invalid list response', line);
  }

  const flags = match[1]
    .split(' ')
    .filter(Boolean)
    .map((flag) => {
      // Remove backslashes and quotes
      return flag.replace(/^\\/, '').replace(/^"(.*)"$/, '$1');
    });

  const delimiter = match[2];
  let name = match[3];

  // If name is quoted, remove quotes
  if (name.startsWith('"') && name.endsWith('"')) {
    name = name.substring(1, name.length - 1);
  }

  return {
    name,
    flags,
    delimiter,
  };
}

/**
 * Parses a status response
 * @param line Status response line
 * @returns Mailbox status
 */
export function parseStatus(line: string): Partial<ImapMailbox> {
  // Format: * STATUS "INBOX" (MESSAGES 231 UNSEEN 5 UIDNEXT 44292 UIDVALIDITY 1)
  const match = line.match(/^\* STATUS "?([^"]+)"? \((.*)\)$/i);

  if (!match) {
    throw new ImapParseError('Invalid status response', line);
  }

  const name = match[1];
  const statusItems = match[2].split(' ');
  const result: Partial<ImapMailbox> = { name };

  for (let i = 0; i < statusItems.length; i += 2) {
    const key = statusItems[i].toLowerCase();
    const value = parseInt(statusItems[i + 1], 10);

    switch (key) {
      case 'messages':
        result.exists = value;
        break;
      case 'recent':
        result.recent = value;
        break;
      case 'unseen':
        result.unseen = value;
        break;
      case 'uidnext':
        result.uidNext = value;
        break;
      case 'uidvalidity':
        result.uidValidity = value;
        break;
    }
  }

  return result;
}

/**
 * Parses a select response
 * @param lines Select response lines
 * @returns Mailbox information
 */
export function parseSelect(lines: string[]): Partial<ImapMailbox> {
  const result: Partial<ImapMailbox> = {};

  for (const line of lines) {
    // EXISTS response
    let match = line.match(/^\* (\d+) EXISTS$/i);
    if (match) {
      result.exists = parseInt(match[1], 10);
      continue;
    }

    // RECENT response
    match = line.match(/^\* (\d+) RECENT$/i);
    if (match) {
      result.recent = parseInt(match[1], 10);
      continue;
    }

    // UNSEEN response - this is the first unseen message number, not the count
    match = line.match(/^\* OK \[UNSEEN (\d+)\]/i);
    if (match) {
      // We'll set this temporarily, but it's not the actual unseen count
      // The actual unseen count should be determined by a STATUS command or a SEARCH for unseen messages
      result.firstUnseen = parseInt(match[1], 10);
      continue;
    }

    // UIDNEXT response
    match = line.match(/^\* OK \[UIDNEXT (\d+)\]/i);
    if (match) {
      result.uidNext = parseInt(match[1], 10);
      continue;
    }

    // UIDVALIDITY response
    match = line.match(/^\* OK \[UIDVALIDITY (\d+)\]/i);
    if (match) {
      result.uidValidity = parseInt(match[1], 10);
      continue;
    }

    // FLAGS response
    match = line.match(/^\* FLAGS \((.*)\)$/i);
    if (match) {
      result.flags = match[1].split(' ').filter(Boolean);
      continue;
    }
  }

  return result;
}

/**
 * Parses a search response
 * @param line Search response line
 * @returns Array of message numbers
 */
export function parseSearch(line: string): number[] {
  // Format: * SEARCH 1 2 3 4 5
  const match = line.match(/^\* SEARCH(.*)$/i);

  if (!match) {
    throw new ImapParseError('Invalid search response', line);
  }

  return match[1]
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((num) => parseInt(num, 10));
}

export function parseEnvelope(str: string): ImapEnvelope {
  const params = ParseParenthesized(str);
  if (!params || !Array.isArray(params)) return {};

  return ParseEnvelope(params);
}

/**
 * Parses a fetch response
 * @param lines Fetch response lines
 * @returns Fetch data
 */
export function parseFetch(lines: string[]) {
  try {
    return ParseFetch(lines.join("\r\n"));
  } catch (e) {
    console.warn('Error parsing fetch response:', e);
  }

  return {};

  // const result: FetchData = {};

  // try {
  //   let currentSection: string | null = null;
  //   let sectionSize = 0;
  //   let sectionData: string[] = [];
  //   let inSection = false;

  //   // First, extract the sequence number from the first line
  //   const firstLine = lines[0];
  //   const seqMatch = firstLine.match(/^\* (\d+) FETCH/i);
  //   if (seqMatch) result.seq = parseInt(seqMatch[1], 10);

  //   // Process each line for section data
  //   for (const line of lines) {
  //     // If we're collecting section data
  //     if (inSection) {
  //       sectionData.push(line);

  //       // Check if we've collected all the data for this section
  //       const collectedData = sectionData.join('\r\n');
  //       if (collectedData.length >= sectionSize) {
  //         // Process the collected data
  //         if (currentSection) {
  //           if (currentSection === 'HEADER') result.headers = parseHeaders(sectionData);
  //           else if (currentSection === 'FULL') {
  //             // Store the full message as raw
  //             const textData = sectionData.join('\r\n');
  //             const encoder = new TextEncoder();
  //             result.raw = encoder.encode(textData);

  //             // Also try to extract the body
  //             result.parts ||= {};

  //             // Simple parsing to extract body from raw message
  //             const parts = textData.split('\r\n\r\n');
  //             if (parts.length > 1) {
  //               // Everything after the first empty line is the body
  //               const bodyText = parts.slice(1).join('\r\n\r\n');
  //               const encoder = new TextEncoder();
  //               result.parts['TEXT'] = {
  //                 data: encoder.encode(bodyText),
  //                 size: bodyText.length,
  //                 type: 'text/plain', // Default type
  //               };
  //             }
  //           } else {
  //             // Store other section data
  //             result.parts ||= {};

  //             // Convert the array of strings to a Uint8Array
  //             const textData = sectionData.join('\r\n');
  //             const encoder = new TextEncoder();
  //             result.parts[currentSection] = {
  //               data: encoder.encode(textData),
  //               size: textData.length,
  //               type: 'text/plain', // Default type
  //             };
  //           }
  //         }

  //         // Reset section collection
  //         inSection = false;
  //         currentSection = null;
  //         sectionData = [];
  //       }

  //       continue;
  //     }

  //     // Parse BODY[...] sections
  //     const bodyContentMatch = line.match(/BODY\[([^\]]+)\] \{(\d+)\}/i);
  //     if (bodyContentMatch) {
  //       currentSection = bodyContentMatch[1];
  //       sectionSize = parseInt(bodyContentMatch[2], 10);
  //       inSection = true;
  //       sectionData = [];
  //       continue;
  //     }

  //     // Handle the case where the body content is on the same line (for small content)
  //     const inlineBodyMatch = line.match(/BODY\[([^\]]+)\] "([^"]*)"/i);
  //     if (inlineBodyMatch) {
  //       const section = inlineBodyMatch[1];
  //       const content = inlineBodyMatch[2];

  //       if (section === 'HEADER') result.headers = parseHeaders([content]);
  //       else {
  //         result.parts ||= {};

  //         // Convert the string to a Uint8Array
  //         const encoder = new TextEncoder();
  //         result.parts[section] = {
  //           data: encoder.encode(content),
  //           size: content.length,
  //           type: 'text/plain', // Default type
  //         };
  //       }
  //     }

  //     // Handle full message content
  //     const fullBodyMatch = line.match(/BODY\[\] \{(\d+)\}/i);
  //     if (fullBodyMatch) {
  //       sectionSize = parseInt(fullBodyMatch[1], 10);
  //       currentSection = 'FULL';
  //       inSection = true;
  //       sectionData = [];
  //       continue;
  //     }
  //   }

  //   // Process any remaining section data
  //   if (inSection && currentSection && sectionData.length > 0) {
  //     if (currentSection === 'HEADER') result.headers = parseHeaders(sectionData);
  //     else if (currentSection === 'FULL') {
  //       // Store the full message as raw
  //       const textData = sectionData.join('\r\n');
  //       const encoder = new TextEncoder();
  //       result.raw = encoder.encode(textData);

  //       result.parts ||= {};

  //       // Simple parsing to extract body from raw message
  //       const parts = textData.split('\r\n\r\n');
  //       if (parts.length > 1) {
  //         // Everything after the first empty line is the body
  //         const bodyText = parts.slice(1).join('\r\n\r\n');
  //         const encoder = new TextEncoder();
  //         result.parts['TEXT'] = {
  //           data: encoder.encode(bodyText),
  //           size: bodyText.length,
  //           type: 'text/plain', // Default type
  //         };
  //       }
  //     } else {
  //       result.parts ||= {};

  //       // Convert the array of strings to a Uint8Array
  //       const textData = sectionData.join('\r\n');
  //       const encoder = new TextEncoder();
  //       result.parts[currentSection] = {
  //         data: encoder.encode(textData),
  //         size: textData.length,
  //         type: 'text/plain', // Default type
  //       };
  //     }
  //   }
  // } catch (error) {
  //   console.warn('Error parsing fetch response:', error);
  // }

  // return result;
}
