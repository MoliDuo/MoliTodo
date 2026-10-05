// Tags are written into a task's text: "R 21-1-3#阅读". A tag starts at "#" and runs until a space, another
// "#" or punctuation, so Chinese and English names both work and no space is needed before the "#".

const TAG_PATTERN = /#([^\s#.,;:!?，。、；：！？（）()[\]【】{}"'“”‘’<>《》]+)/gu;

export interface TextPart {
  text: string;
  /** The tag's name (without "#") when this part is a tag. */
  tag?: string;
}

/** The text cut into plain parts and tag parts, in order. */
export function splitTags(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(TAG_PATTERN)) {
    const start = match.index;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: match[0], tag: match[1] as string });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** A tag's key: names that differ only in case are the same tag. */
export const tagKey = (name: string): string => name.toLowerCase();

/** The tags in a text, each once, as first written. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of splitTags(text)) {
    if (part.tag === undefined || seen.has(tagKey(part.tag))) continue;
    seen.add(tagKey(part.tag));
    tags.push(part.tag);
  }
  return tags;
}

export const hasTag = (text: string, name: string): boolean =>
  parseTags(text).some((tag) => tagKey(tag) === tagKey(name));

/** The text with every `#from` (any case) written as `#to`. */
export function renameTag(text: string, from: string, to: string): string {
  return splitTags(text)
    .map((part) =>
      part.tag !== undefined && tagKey(part.tag) === tagKey(from) ? `#${to}` : part.text
    )
    .join("");
}

/** True when `name` can be a tag: it would be read back as exactly one whole tag. */
export function isValidTagName(name: string): boolean {
  const parts = splitTags(`#${name}`);
  return name.length > 0 && name.length <= 50 && parts.length === 1 && parts[0]?.tag === name;
}

const TAG_BEFORE_CARET = /#([^\s#.,;:!?，。、；：！？（）()[\]【】{}"'“”‘’<>《》]*)$/u;

/** The tag being typed where the caret is: where its "#" starts and what is written after it so far. */
export function tagBeforeCaret(
  text: string,
  caret: number
): { start: number; query: string } | null {
  const match = TAG_BEFORE_CARET.exec(text.slice(0, caret));
  if (!match) return null;
  // Only while the caret is at the end of the tag, not in the middle of one.
  const after = text.slice(caret, caret + 1);
  if (after && !/[\s#.,;:!?，。、；：！？（）()[\]【】{}"'“”‘’<>《》]/u.test(after)) return null;
  return { start: match.index, query: match[1] ?? "" };
}
