/**
 * Translation for one language. English text is its own key and its own
 * fallback, so a string with no translation still reads, in English.
 *
 * The dictionary has four parts: `ui` for the studio's own words, `terms` for
 * vocabulary values (postures, surfaces, garments and the like), `names` for
 * position names, and `messages` for the notes the solver and the catalog
 * write, matched whole or by pattern.
 */
const TITLE = /^(.+?)(?: \(([^)]+)\))?(?: ([IVX]+))?$/;
const VARIANT = / · (Artistic interpretation|Generated approximation)$/;
const has = (table, key) => table != null && Object.hasOwn(table, key);
// A word that means two things carries its sense ahead of it -
// "clothing|Top" is the garment, "Top" the camera view - and reads without it.
const CONTEXT = /^[a-z]+\|/;

export function createTranslator(dictionary = null) {
  const locale = dictionary?.locale ?? "en";
  const ui = dictionary?.ui ?? {};
  const terms = dictionary?.terms ?? {};
  const names = dictionary?.names ?? {};
  const qualifiers = dictionary?.qualifiers ?? {};
  const messages = dictionary?.messages ?? {};
  const patterns = dictionary?.patterns ?? [];

  const fill = (text, values) =>
    values
      ? text.replace(/\{(\w+)\}/g, (match, key) =>
          has(values, key) ? String(values[key]) : match,
        )
      : text;
  /** The studio's own words, with `{name}` placeholders filled from `values`. */
  const t = (text, values) =>
    fill(has(ui, text) ? ui[text] : text.replace(CONTEXT, ""), values);
  /** A vocabulary value as a reader sees it; unknown values keep their own words. */
  const term = (value, fallback = String(value).replace(/_/g, " ")) =>
    has(terms, value) ? terms[value] : fallback;
  const number = (value, options) =>
    Number(value).toLocaleString(locale === "zh" ? "zh-CN" : "en", options);
  const list = (items) => items.join(dictionary?.listSeparator ?? ", ");

  /**
   * A position's name: "Anvil (Legs on Shoulders) II" is a name, its
   * qualifiers and a numeral, and each part is translated on its own.
   */
  function name(title) {
    if (!dictionary || typeof title !== "string") return title;
    const variant = VARIANT.exec(title);
    if (variant)
      return `${name(title.slice(0, variant.index))} · ${t(variant[1])}`;
    const match = TITLE.exec(title);
    if (!match || !has(names, match[1])) return has(names, title) ? names[title] : title;
    const [, base, extra, numeral] = match;
    const parts = extra?.split(", ").map((part) => (has(qualifiers, part) ? qualifiers[part] : part));
    return `${names[base]}${parts ? dictionary.qualify(parts) : ""}${numeral ? ` ${numeral}` : ""}`;
  }

  /**
   * A note written in English elsewhere: whole, then by the first pattern that
   * fits, then as one of the studio's own words (an archetype's label, say).
   */
  function message(text) {
    if (!dictionary || typeof text !== "string") return text;
    if (has(messages, text)) return messages[text];
    for (const [pattern, write] of patterns) {
      const match = pattern.exec(text);
      if (match) return write(match, api);
    }
    return has(ui, text) ? ui[text] : text;
  }

  const api = { locale, t, term, number, list, name, message };
  return api;
}
