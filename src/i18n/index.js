/**
 * The studio's language, English or Chinese. The choice is kept in this
 * browser; a first visit follows the browser's own language. Switching reloads
 * the page, so everything drawn at start-up is drawn again in the new language
 * - the scene and the chosen preset survive it, in the saved workspace and the
 * address.
 */
import { createTranslator } from "./translator.js";

export const LANGUAGE_KEY = "poseforge.language.v1";
export const LANGUAGES = ["en", "zh"];

export const chooseLanguage = (saved, browser) =>
  LANGUAGES.includes(saved) ? saved : /^zh\b/i.test(browser ?? "") ? "zh" : "en";

// A link may name the language (`?lang=zh`); that choice is then kept too.
function savedLanguage() {
  const asked = new URLSearchParams(location.search).get("lang");
  try {
    if (LANGUAGES.includes(asked)) localStorage.setItem(LANGUAGE_KEY, asked);
    return asked ?? localStorage.getItem(LANGUAGE_KEY);
  } catch {
    return asked;
  }
}

// Only a page chooses. A worker, or a script run in Node, writes English, and
// the page translates what it shows.
export const language =
  typeof document === "undefined"
    ? "en"
    : chooseLanguage(savedLanguage(), globalThis.navigator?.language);

export const translator = createTranslator(
  language === "zh" ? (await import("./zh.js")).default : null,
);
export const { t, term, number, list, name, message } = translator;

export function setLanguage(next) {
  if (!LANGUAGES.includes(next) || next === language) return;
  const url = new URL(location.href);
  try {
    localStorage.setItem(LANGUAGE_KEY, next);
    url.searchParams.delete("lang");
  } catch {
    // Without storage the address carries the choice.
    url.searchParams.set("lang", next);
  }
  location.replace(url);
}

const ATTRIBUTES = ["aria-label", "title", "placeholder"];
const words = (text) => text.replace(/\s+/g, " ").trim();

/** The page's own markup: every text and label the dictionary knows. */
export function localizeDocument(root = document) {
  root.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  if (language === "en") return;
  root.title = t(root.title);
  const meta = root.querySelector('meta[name="description"]');
  if (meta) meta.content = t(words(meta.content));
  const walker = root.createTreeWalker(root.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = words(node.nodeValue);
    const translated = text && t(text);
    if (translated && translated !== text)
      node.nodeValue = node.nodeValue.replace(/\S[\s\S]*\S|\S/, translated);
  }
  for (const node of root.body.querySelectorAll(ATTRIBUTES.map((a) => `[${a}]`).join(",")))
    for (const attribute of ATTRIBUTES)
      if (node.hasAttribute(attribute))
        node.setAttribute(attribute, t(words(node.getAttribute(attribute))));
}
