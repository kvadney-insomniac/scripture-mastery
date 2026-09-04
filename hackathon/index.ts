/**
 * Builds a normalized, queryable JSON index from Scripture Mastery's
 * structured data and writes it to `hackathon/out/index.json`.
 *
 * This is the hackathon-plan's step-4 prerequisite: get the structured data
 * into a shape a generator agent (or a verifier) can query without importing
 * TypeScript modules from `src/data` directly. Everything downstream in
 * `hackathon/` (the verifier, the stub generator) reads only this JSON file:
 * that is the point of building it.
 *
 * Run with `npm run hackathon:index` (vite-node, same style as
 * `scripts/validate.ts`).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import { BOOKS, TOTAL_CHAPTERS } from '../src/data/books';
import { PEOPLE, PLACES } from '../src/data/people';
import type { Person } from '../src/data/people';
import { DETAILS, DETAIL_TOTALS } from '../src/data/details';
import { ERAS, EVENTS } from '../src/data/timeline';
import { ESSENTIALS, ESSENTIAL_ENTRY_COUNT } from '../src/data/essentials';
import { LISTS } from '../src/data/extras';
import { allItems } from '../src/lib/generate';

import type {
  BuiltIndex,
  IndexBook,
  IndexEra,
  IndexPerson,
  IndexTerm,
  DatedEvent,
  EpisodeEvent,
  LandmarkVerse,
} from './index-types';

// ------------------------------------------------------------- name matching

/** Lowercase, strip parentheticals and punctuation, collapse whitespace. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split a compound figure name like "Priscilla and Aquila" into parts. */
function splitNames(raw: string): string[] {
  return raw.split(/,| and /i).map((s) => s.trim()).filter(Boolean);
}

// ------------------------------------------------------------------- books

const bookAliases = (id: string, name: string, abbr: string): string[] => {
  const set = new Set<string>([normalize(id), normalize(name), normalize(abbr)]);
  // "1 Corinthians" / "I Corinthians" / "First Corinthians" style numbering.
  const numberWord: Record<string, string> = { '1': 'first', '2': 'second', '3': 'third' };
  const m = name.match(/^(\d) (.+)$/);
  if (m) {
    set.add(normalize(`${numberWord[m[1]]} ${m[2]}`));
    set.add(normalize(`i${'i'.repeat(Number(m[1]) - 1)} ${m[2]}`));
  }
  if (id === 'song-of-solomon') {
    set.add(normalize('Song of Songs'));
    set.add(normalize('Canticles'));
  }
  if (id === 'psalms') set.add(normalize('Psalm'));
  return [...set];
};

const books: IndexBook[] = BOOKS.map((b) => ({
  id: b.id,
  name: b.name,
  abbr: b.abbr,
  order: b.order,
  testament: b.testament,
  division: b.division,
  chapters: b.chapters,
  era: b.era,
  aliases: bookAliases(b.id, b.name, b.abbr),
}));

const bookIds = new Set(BOOKS.map((b) => b.id));

// -------------------------------------------------------------------- eras

const eras: IndexEra[] = ERAS.map((e) => ({
  id: e.id,
  name: e.name,
  span: e.span,
  seq: e.seq,
  books: e.books,
}));

/** Which era ids a book belongs to, per ERAS[].books membership. */
const erasByBook = new Map<string, string[]>();
for (const b of BOOKS) erasByBook.set(b.id, ERAS.filter((e) => e.books.includes(b.id)).map((e) => e.id));

// ------------------------------------------------------------------ people

const personNameIndex = new Map<string, string>(); // normalized name -> person id
for (const p of PEOPLE) {
  personNameIndex.set(normalize(p.name), p.id);
  for (const a of p.alsoKnownAs ?? []) personNameIndex.set(normalize(a), p.id);
}

const appearsInBooks = new Map<string, Set<string>>(); // person id -> book ids
for (const p of PEOPLE) appearsInBooks.set(p.id, new Set([p.book]));

function creditAppearance(rawName: string, bookId: string) {
  for (const part of splitNames(rawName)) {
    const id = personNameIndex.get(normalize(part));
    if (id) appearsInBooks.get(id)?.add(bookId);
  }
}

for (const d of DETAILS) {
  for (const f of d.figures) creditAppearance(f.name, d.book);
  for (const ev of d.events) for (const who of ev.who) creditAppearance(who, d.book);
}
// A fourth source: BOOKS[b].keyPeople names a book's headline figures
// directly, and catches people (e.g. Paul in every epistle he wrote) whose
// PEOPLE entry has one primary book but who legitimately appear in many.
for (const b of BOOKS) for (const name of b.keyPeople) creditAppearance(name, b.id);

const people: IndexPerson[] = PEOPLE.map((p: Person) => ({
  id: p.id,
  name: p.name,
  aliases: [p.name, ...(p.alsoKnownAs ?? [])],
  primaryBook: p.book,
  era: p.era,
  booksAppearing: [...(appearsInBooks.get(p.id) ?? [p.book])].sort(),
}));

// ------------------------------------------------------------------ events

const dated: DatedEvent[] = EVENTS.map((e) => ({
  id: e.id,
  label: e.label,
  year: e.year,
  when: e.when,
  era: e.era,
}));

const episodes: EpisodeEvent[] = DETAILS.flatMap((d) =>
  d.events.map((ev) => ({
    book: d.book,
    ref: ev.ref,
    name: ev.name,
    who: ev.who,
    candidateEras: erasByBook.get(d.book) ?? [],
  })),
);

// ------------------------------------------------------------------- terms

const termMap = new Map<string, { term: string; books: Set<string> }>();
for (const d of DETAILS) {
  for (const t of d.terms ?? []) {
    const key = normalize(t.term);
    const entry = termMap.get(key) ?? { term: t.term, books: new Set<string>() };
    entry.books.add(d.book);
    termMap.set(key, entry);
  }
}
const terms: IndexTerm[] = [...termMap.entries()]
  .map(([key, v]) => ({ key, term: v.term, books: [...v.books].sort() }))
  .sort((a, b) => a.term.localeCompare(b.term));

// ----------------------------------------------------------------- verses

const versesByBook = new Map<string, LandmarkVerse[]>();
for (const b of BOOKS) {
  if (b.keyVerse) versesByBook.set(b.id, [{ book: b.id, ref: b.keyVerse.ref, text: b.keyVerse.text }]);
}
for (const d of DETAILS) {
  const existing = versesByBook.get(d.book) ?? [];
  const extra = (d.verses ?? []).map((v) => ({ book: d.book, ref: v.ref, text: v.text }));
  versesByBook.set(d.book, [...existing, ...extra]);
}
// Dedupe by ref within a book: Book.keyVerse and a BookDetail verse sometimes name the same reference.
const verses: LandmarkVerse[] = [...versesByBook.values()].flat().filter((v, i, arr) => arr.findIndex((o) => o.book === v.book && o.ref === v.ref) === i);

// -------------------------------------------------------------------- meta

const questions = allItems();

// Books with zero era assignment in ERAS[].books: an era claim tied to an
// event in one of these can be neither confirmed nor denied from this data.
// Computed rather than hand-listed, so it can't drift from the actual data.
const booksWithoutEra = BOOKS.filter((b) => (erasByBook.get(b.id) ?? []).length === 0).map((b) => b.id);

// What the hackathon entry plan (2026-08-31) said, versus what the data
// actually holds. Both the plan and the earlier README numbers were
// approximate; these are the counts as read from src/data on generation.
const notes: string[] = [
  `plan said "233 people" (src/data/people.ts PEOPLE has ${PEOPLE.length}).`,
  `plan said "246 key terms" (src/data/details/*.ts terms total ${DETAIL_TOTALS.terms}; ${terms.length} distinct term names, some repeat across books).`,
  `plan said "595 dated events": this does not match either event concept in the data. src/data/timeline.ts EVENTS (the only entries with an actual year) has ${EVENTS.length}. src/data/details/*.ts DetailEvent entries (book-scoped narrative episodes anchored to a chapter, not a date) total ${DETAIL_TOTALS.events}. Both are indexed below, kept separate, and neither is silently relabeled as the other.`,
  `plan said "6,581 questions" (allItems() currently generates ${questions.length}).`,
  'No cross-reference data exists anywhere in src/data (verified by grep); the index does not invent any. "reference" checks below validate book + chapter only; verse numbers are unverifiable (no verse-count data) and are not checked.',
  `${booksWithoutEra.length} books have no entry in any ERAS[].books list, so an event claimed against one of them cannot be confirmed or denied: [${booksWithoutEra.join(', ')}]. The verifier reports "unverifiable" for these, not a pass or a fail.`,
];

const index: BuiltIndex = {
  meta: {
    generatedAt: new Date().toISOString(),
    counts: {
      books: BOOKS.length,
      totalChapters: TOTAL_CHAPTERS,
      people: PEOPLE.length,
      places: PLACES.length,
      eras: ERAS.length,
      datedEvents: EVENTS.length,
      episodeEvents: DETAIL_TOTALS.events,
      distinctTerms: terms.length,
      termOccurrences: DETAIL_TOTALS.terms,
      outlineSections: DETAIL_TOTALS.sections,
      figures: DETAIL_TOTALS.figures,
      numberFacts: DETAIL_TOTALS.numbers,
      bookDetailVerseEntries: DETAIL_TOTALS.verses,
      indexedLandmarkVerses: verses.length,
      essentialsLists: ESSENTIALS.length,
      essentialsEntries: ESSENTIAL_ENTRY_COUNT,
      extrasLists: LISTS.length,
      questions: questions.length,
    },
    booksWithoutEra,
    notes,
  },
  books,
  eras,
  people,
  events: { dated, episodes },
  terms,
  verses,
};

// Sanity: every book in the index resolves, and every era's books resolve.
const badEraBooks = ERAS.flatMap((e) => e.books.filter((b) => !bookIds.has(b)));
if (badEraBooks.length > 0) {
  throw new Error(`ERAS reference unknown book ids: ${badEraBooks.join(', ')}`);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'out');
const outFile = path.join(outDir, 'index.json');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(index, null, 2));

console.log(`\nWrote ${outFile}\n`);
console.log('  Source counts');
for (const [k, v] of Object.entries(index.meta.counts)) {
  console.log(`    ${k.padEnd(18)} ${v}`);
}
console.log('\n  Notes (plan vs. actual data)');
for (const n of notes) console.log(`    - ${n}`);
console.log('');
