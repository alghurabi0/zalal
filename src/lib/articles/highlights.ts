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
      if (!match) break;
      const text = plainText(match[1] ?? "");
      if (text) items.push(text);
      if (items.length === MAX_HIGHLIGHTS) break;
    }
    if (items.length > 0) return { kind: "list", items };
  }

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
  const text = plainText(paragraph.join(" "));
  return text ? { kind: "text", text } : null;
}

/** Inline Markdown to plain text: links keep their words, marks go. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/(\*\*|__|\*|_|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
