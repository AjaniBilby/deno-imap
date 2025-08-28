import { getMultipartBoundary, parseMultipart } from '@mjackson/multipart-parser';

import { ExtractFirstParameterValue, GetParameterListStr, ParameterString, ParenthesizedList, ParenthesizedValue, ParseImapAddressList, ParseParenthesized } from './parameters.ts';
import { ImapAttachment, ImapBodyStructure, ImapEnvelope, ImapMessage } from '../types/mod.ts';
import { ChunkArray } from '../utils/internal.ts';
import { CutString } from '../utils/string.ts';

export function ParseFetch(str: string): ImapMessage {
	const seqMatch = str.match(/^\* (\d+) FETCH/i);
	if (!seqMatch) throw new Error("Invalid fetch prefix");

	let offset = str.indexOf("FETCH");
	if (offset === -1) throw new Error("unreachable");

	offset += "FETCH".length;

	const results = ParseParenthesized(str, offset);
	if (!results) throw new Error("Unexpected token during fetch");

	const list = results.val;
	if (!Array.isArray(list)) throw new Error("Expected a list, but got an atom as fetch");

	let bodyStructure: ImapBodyStructure[] = [];
	let internalDate: Date | undefined = undefined;
	let envelope: ImapEnvelope | undefined = undefined;
	let uid: number | undefined = undefined;
	let size = -1;

	const flags = new Set<string>();
	const seq = parseInt(seqMatch[1], 10);
	const headers = new Headers();
	const body = {
		headers: new Headers(),
		attachments: new Array<ImapAttachment>()
	};

	offset += results.reached;
	for (const [key, value] of ChunkArray(list, 2)) {
		if (typeof key !== "string") throw new Error("Expected a key, got an array");

		switch (key) {
			case "UID": {
				console.log(value);
				const v = ExtractFirstParameterValue(value);
				if (v) uid = parseInt(v, 10);
				break;
			}
			case "FLAGS": {
				if (typeof value === "string") {
					flags.add(value);
					break;
				}

				for (const v of value) {
					if (typeof v !== "string") continue;

					const flag = v.startsWith("\\") ? v.slice(1) : v;
					if (flag === "") continue;

					flags.add(flag);
				}
				break;
			}
			case "RFC822.SIZE": {
				const v = ExtractFirstParameterValue(value);
				if (v) size = parseInt(v, 10);
				break;
			}
			case "INTERNALDATE": {
				const v = ExtractFirstParameterValue(value);
				if (v) internalDate = new Date(v);
				break;
			}
			case "ENVELOPE": {
				if (Array.isArray(value)) envelope = ParseEnvelope(value);
				break;
			}
			case "BODY[HEADER]": {
				if (typeof value !== "string") throw new Error('Expected literal for BODY[HEADER]')
				const raw = (value.startsWith('"') && value.endsWith('"'))
					? value.slice(1, -1)
					: value;

				ParseFetchHeaders(headers, raw);
				break;
			}
			case "BODYSTRUCTURE": {
				if (!Array.isArray(value)) break;
				bodyStructure = value.map(x => ParseBodyStructure(x));
				break;
			}
			case "BODY[]": {
				const [ h, b ] = CutString(ParameterString(value) || "", "\r\n\r\n");

				ParseFetchHeaders(body.headers, h);

				const contentType = headers!.get("Content-Type") || headers!.get("Content-Type");
				if (!contentType) break;

				const boundary = getMultipartBoundary(contentType);
				if (!boundary) break;

				const buff = new TextEncoder().encode(ParameterString(b));
				let i = 0;
				for (const data of parseMultipart(buff, { boundary })) {
					const shape = bodyStructure[i];
					if (!shape) break;

					body.attachments.push({
						...shape,
						data
					})
					i++;
				}

				break;
			}
			default: {
				console.warn("Unparsed", key);
			}
		}
	}

	return {
		seq, uid, size, flags,
		internalDate,

		envelope: envelope || {
			date: internalDate,
			subject: "",
			from: [],
			sender: [],
			replyTo: [],
			to: [],
			cc: [],
			bcc: []
		},

		headers, body
	}
}




export function ParseFetchHeaders(into: Headers, str: string) {
	let i=0;
	while (i<str.length) {
		const m = str.indexOf(":", i);

		if (m === -1) break;

		const key = str.slice(i, m).trim();
		i = m + 1;

		if (key.length === 0) break;


		let val = "";
		while (true) {
			let e = str.indexOf("\r\n", i);
			if (e === -1) e = str.length;

			const chunk = str.slice(i, e).trim();
			val += chunk;
			i = e + 2;

			if (str[i] !== "\t" && str[i] !== " ") break; // no more values
			val += " ";
			i++;
		}
		into.set(key, val);
	}
}



export function ParseEnvelope(value: ParenthesizedList): ImapEnvelope {
	const date = GetParameterListStr(value, 0);

	// Format: (date subject (from) (sender) (reply-to) (to) (cc) (bcc) in-reply-to message-id)
	return {
		date:      date ? new Date(date) : undefined,
		subject:   GetParameterListStr(value, 1) || "",
		from:      ParseImapAddressList(value[2]),
		sender:    ParseImapAddressList(value[3]),
		replyTo:   ParseImapAddressList(value[4]),
		to:        ParseImapAddressList(value[5]),
		cc:        ParseImapAddressList(value[6]),
		bcc:       ParseImapAddressList(value[7]),
		inReplyTo: GetParameterListStr(value, 8),
		messageId: GetParameterListStr(value, 9),
	}
}

export function ParseBodyStructure(value: ParenthesizedValue): ImapBodyStructure {
	// Format: (type subtype (parameters) id description encoding size md5 (disposition) language location)

	return {
		type:        GetParameterListStr(value, 0) || "",
		subtype:     GetParameterListStr(value, 1) || "",
		parameters: Array.isArray(value[2])
			? Object.fromEntries(ChunkArray(value[2], 2).map(x => x.map(ParameterString)))
			: {},
		id:          GetParameterListStr(value, 3),
		description: GetParameterListStr(value, 4),
		encoding:    GetParameterListStr(value, 5) || "7BIT",
		size: Number(GetParameterListStr(value, 6) || 0),
		md5:         GetParameterListStr(value, 7),
		disposition: ParseContentDisposition(value[8]),
		language:                         value[9] as string | string[],
		location:   GetParameterListStr(value, 10),
	}
}

export function ParseContentDisposition(value: ParenthesizedValue) {
	if (!value || value === "NIL" || !Array.isArray(value)) return { type: "ATTACHMENT", parameters: {} };

	const type = GetParameterListStr(value, 0)?.toUpperCase() || "ATTACHMENT";

	const parameters: Record<string, string> = {};

	if (Array.isArray(value[1])) for (const [ k, v ] of ChunkArray(value[1], 2)) {
		const key = ParameterString(k);
		if (!key) continue;

		const value = ParameterString(v) || "";

		parameters[key.toUpperCase()] = value;
	}

	return { type, parameters };
}