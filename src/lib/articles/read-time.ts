/** Words a minute for an article's read time (spec N9). */
export const WORDS_PER_MINUTE = 150;

/**
 * Minutes to read a Markdown body: words ÷ 150, rounded, at least 1. The
 * same rule as the generated column articles.read_minutes (migration
 * articles), so A11's live count matches what Tips shows after saving.
 */
export function readMinutes(body: string): number {
  const words = body.match(/\S+/g)?.length ?? 0;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
