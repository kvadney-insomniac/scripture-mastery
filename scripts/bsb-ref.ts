/**
 * Reference parsing for the BSB check: "Psalm 23:1", "1 Samuel 16:7",
 * "Romans 3:23-24", and the one-chapter books cited by verse alone
 * ("Jude 3" is Jude 1:3, not chapter 3).
 */
export interface BsbFile {
  books: { name: string; chapters: { chapter: number; verses: { verse: number; text: string }[] }[] }[];
}

/** The book names in the source file, keyed by how the item bank writes them. */
const RENAME: Record<string, string> = {
  Psalm: 'Psalms',
  Revelation: 'Revelation of John',
};
const ROMAN: Record<string, string> = { '1': 'I', '2': 'II', '3': 'III' };

const REF = /^((?:[123] )?[A-Za-z][A-Za-z ]*?) (\d+)(?::(\d+)(?:-(\d+))?)?$/;

export function resolveRef(bsb: BsbFile, ref: string): string | null {
  const m = REF.exec(ref.trim());
  if (!m) return null;
  let name = RENAME[m[1]] ?? m[1];
  const num = /^([123]) (.+)$/.exec(name);
  if (num) name = `${ROMAN[num[1]]} ${num[2]}`;
  const book = bsb.books.find((b) => b.name === name);
  if (!book) return null;

  let chapter = Number(m[2]);
  let from = m[3] ? Number(m[3]) : null;
  let to = m[4] ? Number(m[4]) : from;
  if (book.chapters.length === 1 && from == null) {
    from = to = chapter;
    chapter = 1;
  }
  if (from == null || to == null) return null; // a whole chapter is not a quotation
  const ch = book.chapters.find((c) => c.chapter === chapter);
  if (!ch) return null;
  const out: string[] = [];
  for (let v = from; v <= to; v++) {
    const verse = ch.verses.find((x) => x.verse === v);
    if (!verse) return null;
    out.push(verse.text);
  }
  return out.join(' ');
}

/** Lower-case words only, so a capital, a moved comma or a curly quote is not a difference. */
export function words(s: string): string[] {
  return s.toLowerCase().replace(/[‘’]/g, "'").match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
}

/**
 * True when every part of `quote` (parts split on an ellipsis) is a run of
 * the passage's own words, and the parts come in the passage's order.
 */
export function quotesPassage(quote: string, passage: string): boolean {
  const p = words(passage);
  let at = 0;
  for (const part of quote.split(/\s*(?:…|\.\.\.)\s*/)) {
    const w = words(part);
    if (!w.length) continue;
    let found = -1;
    for (let i = at; i + w.length <= p.length; i++) {
      if (w.every((x, k) => p[i + k] === x)) {
        found = i;
        break;
      }
    }
    if (found < 0) return false;
    at = found + w.length;
  }
  return true;
}
