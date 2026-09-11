/**
 * Builds the evidence pack the generator agent is allowed to draw on.
 *
 * The agent never sees `index.json` whole. It sees one book's slice of it:
 * that book's chapters, landmark verses, narrative episodes, key terms, the
 * people the data says appear in it, and the eras the book belongs to. Every
 * name and reference in the pack is copied verbatim out of the index, so a
 * plan that only uses what it was given will verify clean.
 *
 * That last sentence is a claim, not a guarantee, and the distinction is the
 * whole point of the entry. Handing a model a list of true facts does not
 * stop it inventing a plausible-looking extra one, and nothing in the prompt
 * can make it stop. `verify.ts` is what actually decides whether an item
 * survives, and `hackathon/fixtures/plan-with-errors.json` is the fixture
 * that proves the verifier catches the invented case.
 */
import type {
  BuiltIndex,
  EpisodeEvent,
  IndexBook,
  IndexPerson,
  IndexTerm,
  LandmarkVerse,
} from './index-types';

export interface EvidencePack {
  book: IndexBook;
  weeks: number;
  /** Era names this book belongs to, for the optional `era` field on an item. */
  eras: { id: string; name: string; span: string }[];
  verses: LandmarkVerse[];
  episodes: EpisodeEvent[];
  terms: IndexTerm[];
  people: IndexPerson[];
  /** Dated events whose era matches one of this book's eras. */
  datedEvents: { label: string; when: string; era: string }[];
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pulls a book and a week count out of a free-text goal.
 *
 * Deliberately not an LLM call. Resolving "Romans" to the book id `romans`
 * is a lookup, and a lookup that can fail loudly is better than a model
 * guess that cannot. If the goal names no book we say so and stop, rather
 * than picking something and producing a confidently wrong plan.
 */
export function parseGoal(index: BuiltIndex, goal: string): { book: IndexBook; weeks: number } {
  const weekMatch = goal.match(/(\d+)\s*week/i);
  const weeks = weekMatch ? Math.max(1, Math.min(12, Number(weekMatch[1]))) : 4;

  const haystack = normalize(goal);
  // Longest alias first so "1 corinthians" wins over "corinthians", and a
  // two-letter abbreviation never wins by accident.
  const byAliasLength = [...index.books].sort(
    (a, b) =>
      Math.max(...b.aliases.map((x) => x.length)) - Math.max(...a.aliases.map((x) => x.length)),
  );
  const book = byAliasLength.find((b) =>
    b.aliases.some((alias) => alias.length > 2 && haystack.includes(alias)),
  );

  if (!book) {
    throw new Error(
      `The goal "${goal}" does not name a book this data set knows about.\n` +
        'Name one, e.g. "understand Romans in 6 weeks" or "learn Genesis by Christmas".',
    );
  }
  return { book, weeks };
}

/** Caps, so one very large book cannot blow the prompt out. */
const LIMITS = { verses: 40, episodes: 60, terms: 40, people: 40, datedEvents: 25 };

export function buildEvidence(index: BuiltIndex, goal: string): EvidencePack {
  const { book, weeks } = parseGoal(index, goal);

  const eras = index.eras
    .filter((e) => e.books.includes(book.id))
    .map((e) => ({ id: e.id, name: e.name, span: e.span }));
  const eraIds = new Set(eras.map((e) => e.id));

  return {
    book,
    weeks,
    eras,
    verses: index.verses.filter((v) => v.book === book.id).slice(0, LIMITS.verses),
    episodes: index.events.episodes.filter((e) => e.book === book.id).slice(0, LIMITS.episodes),
    terms: index.terms.filter((t) => t.books.includes(book.id)).slice(0, LIMITS.terms),
    people: index.people
      .filter((p) => p.booksAppearing.includes(book.id))
      .slice(0, LIMITS.people),
    datedEvents: index.events.dated
      .filter((e) => eraIds.has(e.era))
      .slice(0, LIMITS.datedEvents)
      .map((e) => ({ label: e.label, when: e.when, era: e.era })),
  };
}

/** The evidence pack as the prompt sees it: compact, and verbatim from the index. */
export function renderEvidence(pack: EvidencePack): string {
  const lines: string[] = [];
  lines.push(`BOOK: ${pack.book.name} (id ${pack.book.id}), ${pack.book.chapters} chapters,`);
  lines.push(`  ${pack.book.testament}, ${pack.book.division}, dated ${pack.book.era}.`);
  lines.push(`  Valid chapter numbers for a reference: 1 to ${pack.book.chapters}.`);
  lines.push('');

  lines.push(`ERAS this book belongs to (${pack.eras.length}):`);
  if (pack.eras.length === 0) {
    lines.push('  none. Do not set the "era" field on any item for this book.');
  } else {
    for (const e of pack.eras) lines.push(`  ${e.name} (id ${e.id}), ${e.span}`);
  }
  lines.push('');

  lines.push(`LANDMARK VERSES (${pack.verses.length}) - use these exact reference strings:`);
  for (const v of pack.verses) lines.push(`  ${v.ref}  ${v.text.slice(0, 110)}`);
  lines.push('');

  lines.push(`NARRATIVE EPISODES (${pack.episodes.length}) - name, chapter ref, participants:`);
  for (const e of pack.episodes) {
    lines.push(`  "${e.name}"  ${pack.book.name} ${e.ref}${e.who.length ? `  who: ${e.who.join(', ')}` : ''}`);
  }
  lines.push('');

  lines.push(`KEY TERMS (${pack.terms.length}):`);
  lines.push(`  ${pack.terms.map((t) => t.term).join(', ')}`);
  lines.push('');

  lines.push(`PEOPLE the data places in this book (${pack.people.length}):`);
  lines.push(`  ${pack.people.map((p) => p.name).join(', ')}`);
  lines.push('');

  if (pack.datedEvents.length) {
    lines.push(`DATED EVENTS in this book's era(s) (${pack.datedEvents.length}):`);
    for (const e of pack.datedEvents) lines.push(`  "${e.label}"  ${e.when}  era ${e.era}`);
  }

  return lines.join('\n');
}
