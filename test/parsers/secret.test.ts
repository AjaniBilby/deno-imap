import { ParseFetch } from '../../src/parsers/fetch.ts';

Deno.test("Secret", () => {
	const raw = Deno.readTextFileSync("./data.txt");
	const fetch = ParseFetch(raw);

	console.log(fetch);
})