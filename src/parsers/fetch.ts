import { getMultipartBoundary, parseMultipart } from '@mjackson/multipart-parser';
import { decodeBase64 } from 'jsr:@std/encoding/base64';

import {
  ExtractFirstParameterValue,
  GetParameterListStr,
  ParameterString,
  ParenthesizedList,
  ParenthesizedValue,
  ParseImapAddressList,
  ParseParenthesized,
} from './parameters.ts';
import { ImapAttachment, ImapBodyStructure, ImapEnvelope, ImapMessage } from '../types/mod.ts';
import { ChunkArray } from '../utils/internal.ts';
import { CutString } from '../utils/string.ts';
import { ParseHeaders } from './header.ts';

export function ParseFetch(str: string): ImapMessage {
  const seqMatch = str.match(/^\* (\d+) FETCH/i);
  if (!seqMatch) throw new Error('Invalid fetch prefix');

  let offset = str.indexOf('FETCH');
  if (offset === -1) throw new Error('unreachable');

  offset += 'FETCH'.length;

  const results = ParseParenthesized(str, offset);
  if (!results) throw new Error('Unexpected token during fetch');

  const list = results.val;
  if (!Array.isArray(list)) throw new Error('Expected a list, but got an atom as fetch');

  let bodyStructure: ImapBodyStructure[] = [];
  let receivedDate: Date | undefined = undefined;
  let envelope: ImapEnvelope | undefined = undefined;
  let uid: number | undefined = undefined;
  let size = -1;

  const flags = new Set<string>();
  const seq = parseInt(seqMatch[1], 10);
  const headers = new Headers();
  const body = {
    headers: new Headers(),
    attachments: new Array<ImapAttachment>(),
  };

  offset += results.reached;
  for (const [key, value] of ChunkArray(list, 2)) {
    if (typeof key !== 'string') throw new Error('Expected a key, got an array');

    switch (key) {
      case 'UID': {
        const v = ExtractFirstParameterValue(value);
        if (v) uid = parseInt(v, 10);
        break;
      }
      case 'FLAGS': {
        if (typeof value === 'string') {
          flags.add(value);
          break;
        }

        for (const v of value) {
          if (typeof v !== 'string') continue;

          const flag = v.startsWith('\\') ? v.slice(1) : v;
          if (flag === '') continue;

          flags.add(flag);
        }
        break;
      }
      case 'RFC822.SIZE': {
        const v = ExtractFirstParameterValue(value);
        if (v) size = parseInt(v, 10);
        break;
      }
      case 'INTERNALDATE': {
        const v = ExtractFirstParameterValue(value);
        if (v) receivedDate = new Date(v);
        break;
      }
      case 'ENVELOPE': {
        if (Array.isArray(value)) envelope = ParseEnvelope(value);
        break;
      }
      case 'BODY[HEADER]': {
        if (typeof value !== 'string') throw new Error('Expected literal for BODY[HEADER]');
        const raw = (value.startsWith('"') && value.endsWith('"')) ? value.slice(1, -1) : value;

        ParseHeaders(raw, headers);
        break;
      }
      case 'BODYSTRUCTURE': {
        if (!Array.isArray(value)) break;
        bodyStructure = value.map((x) => ParseBodyStructure(x));
        break;
      }
      case 'BODY[]': {
        const [h, b] = CutString(ParameterString(value) || '', '\r\n\r\n');

        ParseHeaders(h, body.headers);

        const contentType = headers!.get('Content-Type') || body.headers!.get('Content-Type');
        if (!contentType) {
          console.warn('Warn: attempting to decode imap body without content type');
          break;
        }

        const boundary = getMultipartBoundary(contentType);
        if (!boundary) {
          console.warn('Warn: attempting to decode imap body without boundary');
          break;
        }

        const buff = new TextEncoder().encode(ParameterString(b));
        let i = 0;
        for (const part of parseMultipart(buff, { boundary })) {
          if (!part.isFile) continue;

          const shape = bodyStructure[i];
          if (!shape) break;

          const data = (shape.encoding === 'base64' ||
              part.headers.get('Content-Transfer-Encoding') === 'base64')
            ? decodeBase64(part.text.replaceAll(/\s/g, ''))
            : part.bytes;

          body.attachments.push({
            mimetype: `${shape.type}/${shape.subtype}`,
            filename: part.filename || '',
            data,
          });
          i++;
        }

        break;
      }
      default: {
        console.warn('Warn: Imap unparsed segment', key);
      }
    }
  }

  return {
    seq,
    uid,
    size,
    flags,
    receivedDate,

    envelope: envelope || {
      date: receivedDate,
      subject: '',
      from: [],
      sender: [],
      replyTo: [],
      to: [],
      cc: [],
      bcc: [],
    },

    headers,
    body,
  };
}

export function ParseEnvelope(value: ParenthesizedList): ImapEnvelope {
  const date = GetParameterListStr(value, 0);

  // Format: (date subject (from) (sender) (reply-to) (to) (cc) (bcc) in-reply-to message-id)
  return {
    date: date ? new Date(date) : undefined,
    subject: GetParameterListStr(value, 1) || '',
    from: ParseImapAddressList(value[2]),
    sender: ParseImapAddressList(value[3]),
    replyTo: ParseImapAddressList(value[4]),
    to: ParseImapAddressList(value[5]),
    cc: ParseImapAddressList(value[6]),
    bcc: ParseImapAddressList(value[7]),
    inReplyTo: GetParameterListStr(value, 8),
    messageId: GetParameterListStr(value, 9),
  };
}

export function ParseBodyStructure(value: ParenthesizedValue): ImapBodyStructure {
  // Format: (type subtype (parameters) id description encoding size md5 (disposition) language location)

  return {
    type: GetParameterListStr(value, 0) || '',
    subtype: GetParameterListStr(value, 1) || '',
    parameters: Array.isArray(value[2])
      ? Object.fromEntries(ChunkArray(value[2], 2).map((x) => x.map(ParameterString)))
      : {},
    id: GetParameterListStr(value, 3),
    description: GetParameterListStr(value, 4),
    encoding: GetParameterListStr(value, 5) || '7BIT',
    size: Number(GetParameterListStr(value, 6) || 0),
    md5: GetParameterListStr(value, 7),
    disposition: ParseContentDisposition(value[8]),
    language: value[9] as string | string[],
    location: GetParameterListStr(value, 10),
  };
}

export function ParseContentDisposition(value: ParenthesizedValue) {
  if (!value || value === 'NIL' || !Array.isArray(value)) {
    return { type: 'ATTACHMENT', parameters: {} };
  }

  const type = GetParameterListStr(value, 0)?.toUpperCase() || 'ATTACHMENT';

  const parameters: Record<string, string> = {};

  if (Array.isArray(value[1])) {
    for (const [k, v] of ChunkArray(value[1], 2)) {
      const key = ParameterString(k);
      if (!key) continue;

      const value = ParameterString(v) || '';

      parameters[key.toUpperCase()] = value;
    }
  }

  return { type, parameters };
}
