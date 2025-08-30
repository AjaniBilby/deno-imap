/**
 * IMAP BODYSTRUCTURE Parser
 *
 * This module provides an improved parser for IMAP BODYSTRUCTURE responses,
 * with better handling of complex multipart structures and attachments.
 */

import type { ImapBodyStructure } from '../types/mod.ts';
import { ParseParenthesized } from './parameters.ts';
import { ParseBodyStructure } from './fetch.ts';

export function parseBodyStructure(data: string): ImapBodyStructure {
  const syntax = ParseParenthesized(data);
  if (!syntax) throw new Error('Failed to parse body structure syntax');

  return ParseBodyStructure(syntax.val);
}
