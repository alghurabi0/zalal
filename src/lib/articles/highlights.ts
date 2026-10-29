/**
 * What Tips' top card shows under the title (Tips.dc.html): the body's first
 * numbered list (up to 5 items, as the canvas's five signs), otherwise its
 * first paragraph. Plain text: Markdown marks are removed, links keep their
 * words. The admin fills nothing extra (settled Oct 28, 2026).
 */
export type ArticleHighlights =
  { kind: "list"; items: string[] } | { kind: "text"; text: string } | null;

export const MAX_HIGHLIGHTS = 5;

const orderedItem = /^\s{0,3}\d{1,9}[.)]\s+(.+)$/;
const blockStart = /^\s{0,3}(#{1,6}\s|>|[-*+]\s|\d{1,9}[.)]\s|([-*_])\s*\2\s*\2|```|~~~)/;

export function articleHighlights(body: string): ArticleHighlights {
  const lines = body.split(/\r?\n/);

  const start = lines.findIndex((line) => orderedItem.test(line));
  if (start !== -1) {
    const items: string[] = [];
    for (const line of lines.slice(start)) {
      const match = orderedItem.exec(line);
      if (match) {
        if (items.length === MAX_HIGHLIGHTS) break;
        items.push(match[1] ?? "");
      } else if (!line.trim()) {
        // A loose list: blank lines between items.
        continue;
      } else if (/^\s{2,}\S/.test(line) && items.length > 0) {
        // An item's wrapped line.
        items[items.length - 1] += ` ${line.trim()}`;
      } else {
        break;
      }
    }
    const texts = items.map(plainText).filter(Boolean);
    if (texts.length > 0) return { kind: "list", items: texts };
  }

  const text = firstParagraph(lines);
  return text ? { kind: "text", text } : null;
}

/** The body's first paragraph as plain text ("" when there is none). */
function firstParagraph(lines: string[]): string {
  const paragraph: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (blockStart.test(line)) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line.trim());
  }
  return plainText(paragraph.join(" "));
}

export const MAX_DESCRIPTION = 160;

/**
 * Article's meta description (N9): the body's first paragraph, cut at a
 * word to 160 characters. Null when the body has no paragraph.
 */
export function articleDescription(body: string): string | null {
  const text = firstParagraph(body.split(/\r?\n/));
  if (!text) return null;
  if (text.length <= MAX_DESCRIPTION) return text;
  const cut = text.slice(0, MAX_DESCRIPTION - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 80 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Inline Markdown to plain text: links keep their words, emphasis and code
 * marks go, HTML tags go, escaped characters keep only the character. A
 * lone "<", ">" or an "_" inside a word stays.
 */
export function plainText(markdown: string): string {
  const escaped: string[] = [];
  return markdown
    .replace(/\\([!-/:-@[-`{-~])/g, (_, char: string) => `\u0000${escaped.push(char) - 1}\u0000`)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[a-zA-Z][^<>]*>/g, "")
    .replace(/(\*\*|__|\*|~~|`)/g, "")
    .replace(/(^|[\s(])_+|_+(?=$|[\s).,\u060C:;!?\u061F])/g, "$1")
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => escaped[Number(i)] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
