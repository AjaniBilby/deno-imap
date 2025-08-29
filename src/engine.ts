import { ImapAddress, ImapMessage } from './types/mod.ts';
import { CutString } from './utils/string.ts';

type Flag = 'Answered'
	| 'Flagged'
	| 'Draft'
	| 'Deleted'
	| 'Seen'
	| string;

type WhereValue<T> = T | { in?: T[], notIn?: T[], gte?: T, lte?: T, gt?: T, lt?: T, eq?: T };
type WhereScalar<T> = {
	has?:      T,
	hasEvery?: T[],
	hasSome?:  T[],
	hasNone?:  T[]
}

type WhereText = string | {
	contains?:   string,
	startsWith?: string,
	endsWith?:   string,
	equals?:     string,
	mode?: "insensitive",
}

type AddressCriteria = string | Partial<ImapAddress>;

type ImapMessageWhere = {
	seq?:          WhereValue<number>,
	uid?:          WhereValue<number>,
	size?:         WhereValue<number>,
	receivedDate?: WhereValue<Date>,
	flags?:        WhereScalar<Flag>,

	envelope?: {
		date?:      WhereValue<Date>,
		subject?:   WhereText,
		from?:      WhereScalar<AddressCriteria>,
		sender?:    WhereScalar<AddressCriteria>,
		replyTo?:   WhereScalar<AddressCriteria>,
		to?:        WhereScalar<AddressCriteria>,
		cc?:        WhereScalar<AddressCriteria>,
		bcc?:       WhereScalar<AddressCriteria>,
		inReplyTo?: WhereText,
		messageId?: WhereText,
	}

	// not implemented
	// AND?: ImapMessageWhere[],
	// OR?:  ImapMessageWhere[],
	// NOT?: ImapMessageWhere,
}

export type SortBy<T extends string> = Record<T, 'asc' | 'desc'> & { nulls?: 'first' | 'last' };
type SortKey = SortBy<"receivedDate">
	| SortBy<"seq">
	| SortBy<"uid">;

type ImapMessageOrderBy = SortKey | Array<SortKey>;

type ImapMessageInclude = {
	seq?:          boolean,
	uid?:          boolean,
	flags?:        boolean,
	receivedDate?: boolean,
	envelope?:     boolean,
	headers?:      boolean,
	body?:         boolean,
	size?:         boolean
};

export type FindManyImapMessageArgs = {
	where?:   ImapMessageWhere,
	include?: ImapMessageInclude,

	orderBy?: ImapMessageOrderBy,
	take?: number,
	skip?: number,
}

type GetIncludeResult<T extends ImapMessageInclude> = {
	[K in keyof T as T[K] extends true ? K : never]:
		K extends keyof ImapMessage ? ImapMessage[K] : never
};

export type FindManyResult<T extends FindManyImapMessageArgs> =
	T['include'] extends ImapMessageInclude
		? GetIncludeResult<T['include']>[]
		: ImapMessage[];





/* ======================================================
	Search Query Generation
====================================================== */

export function MakeWhereQuery(where: ImapMessageWhere) {
	let query = "";

	if (where.seq) query += ` ${RangeId(where.seq)}`;
	if (where.uid) query += ` UID ${RangeId(where.uid)}`;

	if (where.flags) {
		const inclusive = new Set<string>();
		const exclusive = new Set<string>();

		if (where.flags.has) AddSafeFlag(inclusive, where.flags.has);
		if (where.flags.hasEvery) for (const f of where.flags.hasEvery) AddSafeFlag(inclusive, f);
		// where.flags.hasSome: can't be implemented since flag tags is hasEvery
		if (where.flags.hasNone)  for (const f of where.flags.hasNone)  AddSafeFlag(exclusive, f);

		for (const f of inclusive) query += ` ${f}`;
		for (const f of exclusive) query += ` NOT ${f}`;
	}

	if (where.receivedDate) {
		if (where.receivedDate instanceof Date) query += ` ON ${DateShort(where.receivedDate)}`;
		else if (where.receivedDate.gt) {
			query += ` SINCE ${DateShort(where.receivedDate.gt)}`;
		} else if (where.receivedDate.gte) {
			query += ` SINCE ${DateShort(new Date(where.receivedDate.gte.getTime() - FULL_DAY))}`;
		} else if (where.receivedDate.lt) {
			query += ` BEFORE ${DateShort(where.receivedDate.lt)}`;
		} else if (where.receivedDate.lte) {
			query += ` SINCE ${DateShort(new Date(where.receivedDate.lte.getTime() + FULL_DAY))}`;
		}
	}

	if (where.envelope) {
		if (where.envelope.date) {
			if (where.envelope.date instanceof Date) query += ` ON ${DateShort(where.envelope.date)}`;
			else if (where.envelope.date.gt) {
				query += ` SENTSINCE ${DateShort(where.envelope.date.gt)}`;
			} else if (where.envelope.date.gte) {
				query += ` SENTSINCE ${DateShort(new Date(where.envelope.date.gte.getTime() - FULL_DAY))}`;
			} else if (where.envelope.date.lt) {
				query += ` SENTSINCE ${DateShort(where.envelope.date.lt)}`;
			} else if (where.envelope.date.lte) {
				query += ` SENTSINCE ${DateShort(new Date(where.envelope.date.lte.getTime() + FULL_DAY))}`;
			}
		}

		if (where.envelope.subject) {
			const term = GetTextSearchTerm(where.envelope.subject);
			if (term) query += ` SUBJECT ${term}`;
		}

		if (where.envelope.from) {
			const set = MakeAddressSet(where.envelope.from);
			for (const a of set) query += ` FROM "${a}"`;
		}

		if (where.envelope.to) {
			const set = MakeAddressSet(where.envelope.to);
			for (const a of set) query += ` TO "${a}"`;
		}

		if (where.envelope.cc) {
			const set = MakeAddressSet(where.envelope.cc);
			for (const a of set) query += ` CC "${a}"`;
		}

		if (where.envelope.bcc) {
			const set = MakeAddressSet(where.envelope.bcc);
			for (const a of set) query += ` BCC "${a}"`;
		}

		if (where.envelope.sender) {
			const set = MakeAddressSet(where.envelope.sender);
			for (const a of set) query += ` SENDER "${a}"`;
		}

		if (where.envelope.replyTo) {
			const set = MakeAddressSet(where.envelope.replyTo);
			for (const a of set) query += ` REPLY-TO "${a}"`;
		}

		if (where.envelope.messageId) {
			const msgIdTerm = GetTextSearchTerm(where.envelope.messageId);
			if (msgIdTerm) query += ` HEADER MESSAGE-ID ${msgIdTerm}`;
		}

		if (where.envelope.inReplyTo) {
			const inReplyToTerm = GetTextSearchTerm(where.envelope.inReplyTo);
			if (inReplyToTerm) query += ` HEADER IN-REPLY-TO ${inReplyToTerm}`;
		}
	}

	return query.trim();
}


function RangeId(where: WhereValue<number>) {
	if (typeof where === "number") return String(where);

	if (where.in) return where.in.join(",");

	const min = where.gte ? String(where.gte)
		: where.gt ? String(where.gt+1)
		: "1";

	const max = where.lte ? String(where.lte)
		: where.lt ? String(where.lt+1)
		: "*";

	return `${min}:${max}`;
}

export const INCLUDE_ALL: Record<keyof ImapMessageInclude, true> = {
	seq:          true,
	uid:          true,
	flags:        true,
	receivedDate: true,
	envelope:     true,
	headers:      true,
	body:         true,
	size:         true
}


const FULL_DAY = 24*60*60*1000;
const MONTHS = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ];
function DateShort(date: Date): string {
	const day = date.getDate().toString().padStart(2, '0');
	const month = MONTHS[date.getMonth()];
	const year = date.getFullYear();

	return `${day}-${month}-${year}`;
}

function GetTextSearchTerm(textWhere: WhereText): string | null {
	if (typeof textWhere === "string") {
		return QuoteString(textWhere);
	}

	// For complex text searches, we can only use the contains field for IMAP
	// startsWith, endsWith would need post-processing
	if (textWhere.contains) {
		return QuoteString(textWhere.contains);
	}

	return null;
}

// function GetScalarSearchTerms(scalarWhere: WhereScalar<string>): string[] {
// 	const terms: string[] = [];
//
// 	if (scalarWhere.has) terms.push(scalarWhere.has);
// 	if (scalarWhere.hasEvery) terms.push(...scalarWhere.hasEvery);
// 	if (scalarWhere.hasSome)  terms.push(...scalarWhere.hasSome);
// 	// hasNone would need NOT logic, which is complex for scalar fields
//
// 	return terms;
// }

function QuoteString(str: string): string {
	// IMAP strings need to be quoted if they contain spaces or special chars
	if (/[\s"\\]/.test(str)) {
		return `"${str.replace(/[\\\"]/g, '\\$&')}"`;
	}
	return str;
}


const SAFE_FLAG_PATTERN = new RegExp("^[A-Z\\$\\+\\-\\_\\.]+$", "m");
function AddSafeFlag(into: Set<string>, raw: string) {
	raw = raw.toUpperCase();
	if (!SAFE_FLAG_PATTERN.test(raw)) {
		console.warn(`Unsafe imap flag ${raw} omitted`);
		return;
	}

	into.add(raw);
}

const SAFE_ADDRESS_PATTERN = new RegExp("^[a-z\\-\\_\\.]+$", "i");
function AddSafeAddress(into: Set<string>, val: ImapAddress | string) {
	if (typeof val === "string") {
		const [ mailbox, host ] = CutString(val, "@");
		val = { host, mailbox };
	}

	if (!val.host) return;
	if (!val.mailbox) return;

	if (!SAFE_ADDRESS_PATTERN.test(val.mailbox)) return undefined;
	if (!SAFE_ADDRESS_PATTERN.test(val.host)) return undefined;

	into.add(`${val.mailbox}@${val.host}`);
}

function MakeAddressSet(criteria: WhereScalar<AddressCriteria>) {
	const into = new Set<string>();

	if (criteria.has) AddSafeAddress(into, criteria.has);
	if (criteria.hasEvery) for (const a of criteria.hasEvery) AddSafeAddress(into, a);
	if (criteria.hasSome?.length === 1) AddSafeAddress(into, criteria.hasSome[0]);

	return into;
}





/* ======================================================
	Where Clause evaluation
====================================================== */
export function MatchesWhere(where: ImapMessageWhere, mail: ImapMessage) {

	if (!MatchWhereValue(where.seq,  mail.seq)) return false;
	if (!MatchWhereValue(where.uid,  mail.seq)) return false;
	if (!MatchWhereValue(where.size, mail.seq)) return false;

	if (!MatchWhereValue(where.receivedDate, mail.receivedDate)) return false;

	if (where.flags) {
		if (where.flags.has && !mail.flags.has(where.flags.has)) return false;

		if (where.flags.hasEvery) for (const f of where.flags.hasEvery) {
			if (!mail.flags.has(f)) return false;
		}

		if (where.flags.hasNone) for (const f of where.flags.hasNone) {
			if (mail.flags.has(f)) return false;
		}

		if (where.flags.hasSome) {
			let some = false;
			for (const f of where.flags.hasSome) {
				if (mail.flags.has(f)) {
					some = true;
					break;
				}
			}

			if (!some) return false
		}
	}

	if (where.envelope) {
		if (!mail.envelope) return false;

		if (!MatchWhereValue(where.envelope.date, mail.envelope.date)) return false;
		if (!MatchWhereText(where.envelope.subject, mail.envelope.subject)) return false;
		if (!MatchWhereScalar(where.envelope.from, mail.envelope.from, AddressComparator)) return false;
		if (!MatchWhereScalar(where.envelope.sender, mail.envelope.sender, AddressComparator)) return false;
		if (!MatchWhereScalar(where.envelope.replyTo, mail.envelope.replyTo, AddressComparator)) return false;
		if (!MatchWhereScalar(where.envelope.to, mail.envelope.to, AddressComparator)) return false;
		if (!MatchWhereScalar(where.envelope.cc, mail.envelope.cc, AddressComparator)) return false;
		if (!MatchWhereScalar(where.envelope.bcc, mail.envelope.bcc, AddressComparator)) return false;
		if (!MatchWhereText(where.envelope.inReplyTo, mail.envelope.inReplyTo)) return false;
		if (!MatchWhereText(where.envelope.messageId, mail.envelope.messageId)) return false;
	}

	return true;
}

function MatchWhereValue<T extends string | number | Date>(where: WhereValue<T> | undefined, val?: T): boolean {
	if (where === undefined) return true;
	if (val === undefined)   return false;

	if (val instanceof Date) {
		const rule = (where as WhereValue<Date>);
		if (rule instanceof Date) return rule === val;

		if (rule.notIn) console.warn("where.notIn not supported with dates");
		if (rule.in)    console.warn("where.in not supported with dates");

		if (rule.gte && rule.gte.getTime() <  val.getTime()) return false;
		if (rule.gt  && rule.gt.getTime()  <= val.getTime()) return false;
		if (rule.lte && rule.lte.getTime() >  val.getTime()) return false;
		if (rule.lt  && rule.lt.getTime()  >= val.getTime()) return false;
		if (rule.eq  && rule.eq.getTime()  != val.getTime()) return false;

		return true;
	}

	if (typeof val === "string") {
		const rule = (where as WhereValue<string>);
		if (typeof rule === "string") return rule === val;

		if (rule.notIn &&  rule.notIn.includes(val)) return false;
		if (rule.in    && !rule.in.includes(val)) return false;

		if (rule.gte) console.warn("where.gte not supported with strings");
		if (rule.gt ) console.warn("where.gte not supported with strings");
		if (rule.lte) console.warn("where.gte not supported with strings");
		if (rule.lt ) console.warn("where.gte not supported with strings");
		if (rule.eq  && rule.eq  != val) return false;

		return true;
	}

	if (typeof val === "number") {
		const rule = (where as WhereValue<number>);
		if (typeof rule === "number") return rule === val;

		if (rule.notIn &&  rule.notIn.includes(val)) return false;
		if (rule.in    && !rule.in.includes(val)) return false;

		if (rule.gte && rule.gte <  val) return false;
		if (rule.gt  && rule.gt  <= val) return false;
		if (rule.lte && rule.lte >  val) return false;
		if (rule.lt  && rule.lt  >= val) return false;
		if (rule.eq  && rule.eq  != val) return false;
		if (rule.eq  && rule.eq  != val) return false;

		return true;
	}

	throw new Error(`Unexpected type ${typeof val}`);
}

function MatchWhereText(where?: WhereText | undefined, txt?: string) {
	if (where === undefined) return true;
	if (txt === undefined) return false;

	if (typeof where === "string") return txt === where;

	if (where.mode === "insensitive") txt = txt.toLowerCase();

	if (where.startsWith && !txt.startsWith(where.startsWith)) return false;
	if (where.endsWith   && !txt.endsWith(where.endsWith))     return false;
	if (where.contains   && !txt.includes(where.contains))     return false;
	if (where.endsWith   && txt !== where.endsWith)            return false;

	return true;
}

function MatchWhereScalar<T, X>(where: WhereScalar<T> | undefined, value: X[], comparator: (v: X, r: T) => boolean) {
	if (where === undefined) return true;

	if (where.has && !value.some(x => comparator(x, where.has!))) return false;

	if (where.hasEvery) for (const r of where.hasEvery) {
		if (!value.some(x => comparator(x, r))) return false;
	}

	if (where.hasNone) for (const r of where.hasNone) {
		if (value.some(x => comparator(x, r))) return false;
	}

	if (where.hasSome) {
		let hit = false;
		for (const r of where.hasSome) {
			if (value.some(x => comparator(x, r))) {
				hit = true;
				break;
			}
		}

		if (!hit) return false;
	}

	return true;
}


function AddressComparator(address: ImapAddress, rule: AddressCriteria) {
	if (typeof rule === "string") return `${address.mailbox}@${address.host}` === rule;

	if (rule.sourceRoute && address.sourceRoute !== rule.sourceRoute) return false;
	if (rule.mailbox     && address.mailbox     !== rule.mailbox    ) return false;
	if (rule.name        && address.name        !== rule.name       ) return false;
	if (rule.host        && address.host        !== rule.host       ) return false;

	return true;
}

function NumberComparator(a: number, b: number) {
	return a === b;
}




/* ======================================================
	Sort Factor Generation
====================================================== */

type ComparatorInstruction = {
	fieldName: string;
	direction: 1 | -1; // 1 for asc, -1 for desc
	nullsFirst: boolean;
};

type Data = Partial<ImapMessage>;

export function MakeOrderBy(orderBy?: ImapMessageOrderBy): {
	fetch?: (a: number, b: number) => number,
	sort ?: (a: Data,   b: Data  ) => number,
	limited: boolean
} {
	if (!orderBy) return {
		fetch: undefined,
		sort: undefined,
		limited: false
	}

	if (!Array.isArray(orderBy)) orderBy = [ orderBy ];

	// Pre-process all sort keys into efficient comparison instructions
	const instructions: ComparatorInstruction[] = [];

	let fetchOrder: "asc" | "desc" | undefined = undefined;

	for (const sortKey of orderBy) {
		const nullsFirst = (sortKey.nulls || 'last') === "first";
		for (const [ key, value ] of Object.entries(sortKey)) {
			if (value === "asc") instructions.push({
				fieldName: key,
				direction: 1,
				nullsFirst
			});
			else if (value === "desc") instructions.push({
				fieldName: key,
				direction: -1,
				nullsFirst
			});

			if (key === "seq") fetchOrder = value as "asc" | "desc";
		}
	}

	const sequenceBy = fetchOrder === "asc" ? (a: number, b: number) => a - b
		: fetchOrder === "desc" ? (a: number, b: number) => b - a
		: undefined;
	const limited = !instructions.some(i => i.fieldName != "seq");

	if (instructions.length < 1) return { sort: undefined, fetch: sequenceBy, limited };

	// Return optimized comparator that just executes pre-computed instructions
	const compare = (a: Data, b: Data): number => {
		for (let i = 0; i < instructions.length; i++) {
			const { fieldName, direction, nullsFirst } = instructions[i];
			const aValue = a[fieldName as keyof Data];
			const bValue = b[fieldName as keyof Data];

			// Handle null/undefined values
			if (aValue == null && bValue == null) continue;
			if (aValue == null) return nullsFirst ? -1 :  1;
			if (bValue == null) return nullsFirst ?  1 : -1;

			// Compare values and apply direction in one step
			if (aValue < bValue) return -direction;
			if (aValue > bValue) return direction;
		}

		return 0;
	}


	return { sort: compare, fetch: sequenceBy, limited };
}