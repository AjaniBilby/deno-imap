import { ImapMessage } from './types/mod.ts';

type Flag = 'Answered'
	| 'Flagged'
	| 'Draft'
	| 'Deleted'
	| 'Seen'
	| string;

type WhereValue<T> = T | { in?: T[], notIn?: T[], gte?: T, lte?: T, gt?: T, lt?: T };
type WhereScalar<T> = {
	has?:      T,
	hasEvery?: T[],
	hasSome?:  T[],
	hasNone?:  T[]
}

type WhereText = string | {
	contains?:   string,
	startsWith?: string,
	endsWith?:   string
	mode?: "insensitive",
}

type ImapMessageWhere = {
	seq?:          WhereValue<number>,
	uid?:          WhereValue<number>,
	size?:         WhereValue<number>,
	receivedDate?: WhereValue<Date>,
	flags?:        WhereScalar<Flag>,

	envelope?: {
		date?:      WhereValue<Date>,
		subject?:   WhereText,
		from?:      WhereText,
		sender?:    WhereText,
		replyTo?:   WhereText,
		to?:        WhereScalar<string>,
		cc?:        WhereScalar<string>,
		bcc?:       WhereScalar<string>,
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
			const term = GetTextSearchTerm(where.envelope.from);
			if (term) query += ` FROM ${term}`;
		}

		if (where.envelope.to) {
			const terms = GetScalarSearchTerms(where.envelope.to);
			for (const term of terms) query += ` TO ${QuoteString(term)}`;
		}

		if (where.envelope.cc) {
			const terms = GetScalarSearchTerms(where.envelope.cc);
			for (const term of terms) query += ` CC ${QuoteString(term)}`;
		}

		if (where.envelope.bcc) {
			const terms = GetScalarSearchTerms(where.envelope.bcc);
			for (const term of terms) query += ` BCC ${QuoteString(term)}`;
		}

		if (where.envelope.sender) {
			const term = GetTextSearchTerm(where.envelope.sender);
			if (term) query += ` HEADER SENDER ${term}`;
		}

		if (where.envelope.replyTo) {
			const term = GetTextSearchTerm(where.envelope.replyTo);
			if (term) query += ` REPLY-TO ${term}`;
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

function GetScalarSearchTerms(scalarWhere: WhereScalar<string>): string[] {
	const terms: string[] = [];

	if (scalarWhere.has) terms.push(scalarWhere.has);
	if (scalarWhere.hasEvery) terms.push(...scalarWhere.hasEvery);
	if (scalarWhere.hasSome) terms.push(...scalarWhere.hasSome);
	// hasNone would need NOT logic, which is complex for scalar fields

	return terms;
}

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