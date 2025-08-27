export function CutString(str: string, pivot: string, offset = 1): [string, string] {
	const idx = CutStringIndex(str, pivot, offset);
	return [str.slice(0, idx), str.slice(idx+pivot.length)]
}

export function CutStringIndex(str: string, pivot: string, offset = 1): number {
	if (offset === 0) return str.length;

	if (offset > 0) {
		let cursor = 0;
		while (offset !== 0) {
			const i = str.indexOf(pivot, cursor);
			if (i === -1) return str.length;
			cursor = i+1;
			offset--;
		}
		cursor--;

		return cursor;
	}

	if (offset < 0) {
		let cursor = str.length;
		while (offset !== 0) {
			const i = str.lastIndexOf(pivot, cursor);
			if (i === -1) return str.length;
			cursor = i-1;
			offset++;
		}
		cursor++;

		return cursor;
	}

	return str.length;
}