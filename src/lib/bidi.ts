// Direction for a piece of text inside Arabic copy. A size like
// "1,000–2,000" has no letters, so in an RTL line its numbers swap places
// ("2,000–1,000"); <bdi dir={textDir(…)}> keeps it in order, while a label
// with Arabic letters stays RTL.

const ARABIC = /\p{Script=Arabic}/u;

export function textDir(text: string): "rtl" | "ltr" {
  return ARABIC.test(text) ? "rtl" : "ltr";
}
