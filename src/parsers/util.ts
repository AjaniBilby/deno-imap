export function SkipInlineWhiteSpace(str: string, offset: number) {
	for (; offset<str.length; offset++) {
		if (str[offset] === " ") continue;
		if (str[offset] === "\t") continue;
		if (str[offset] === "\r") continue;

		break;
	}

	return offset;
}