export function SkipWhiteSpace(str: string, offset: number, inline = true) {
  for (; offset < str.length; offset++) {
    if (str[offset] === ' ') continue;
    if (str[offset] === '\t') continue;
    if (str[offset] === '\r') continue;

    if (str[offset] === '\n' && !inline) continue;

    break;
  }

  return offset;
}
