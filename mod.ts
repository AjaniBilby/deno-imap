/**
 * @workingdevshero/deno-imap - A heroic IMAP client for Deno
 *
 * This module provides a complete implementation of the IMAP protocol
 * (Internet Message Access Protocol) for Deno, allowing developers to
 * interact with email servers that support IMAP.
 *
 * @module
 */
export { ImapConnection } from './src/connection.ts';
export { ImapClient } from './src/client.ts';

// Export parsers
export {
  parseCapabilities,
  parseEnvelope,
  parseFetch,
  parseListResponse,
  parseSearch,
  parseSelect,
  parseStatus,
} from './src/parsers/mod.ts';

// Re-export types
export type {
  ImapAuthMechanism,
  ImapCapability,
  ImapConnectionOptions,
  ImapFetchOptions,
  ImapMailbox,
  ImapMessage,
  ImapMessagePart,
  ImapOptions,
  ImapSearchCriteria,
} from './src/types/mod.ts';
