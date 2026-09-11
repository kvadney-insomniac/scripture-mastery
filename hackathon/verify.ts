/**
 * Checks a JSON study plan against `hackathon/out/index.json` and prints a
 * structured pass/fail report, one line per check, per item.
 *
 * This is the verifier agent from the hackathon plan, minus the "agent" part:
 * it is a deterministic pass over the index today, which is exactly what a
 * trust surface needs to be able to explain a failure. Wiring an LLM around
 * this (to phrase the failure for a learner, or to decide whether to
 * regenerate) is future work; the checks themselves should not need an LLM.
 *
 * This module is a library with no side effects on import: `generate.ts`
 * calls `verifyPlan` on every repair round. The command line front end lives
 * in `verify-cli.ts` (`npm run hackathon:verify`).
 */
import type { PlanItem, StudyPlan } from './schema';
import type { BuiltIndex, EpisodeEvent, IndexBook } from './index-types';

export type CheckKind =
  | 'reference-not-found'
  | 'chapter-out-of-range'
  | 'person-unknown'
  | 'person-not-in-book'
  | 'person-not-in-chapter'
  | 'event-unknown'
  | 'event-not-in-era'
  | 'event-not-in-chapter'
  | 'term-unknown'
  | 'term-not-in-book';

export interface CheckResult {
  kind: CheckKind | 'unverifiable';
  subject: string;
  ok: boolean;
  detail: string;
}

export interface ItemReport {
  id: string;
  type: PlanItem['type'];
  reference: string;
  pass: boolean;
  checks: CheckResult[];
}

export interface VerifyReport {
  goal: string;
  itemCount: number;
  passCount: number;
  failCount: number;
  items: ItemReport[];
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parsed pieces of a scripture reference string. */
interface ParsedRef {
  bookRaw: string;
  chapterStart?: number;
  chapterEnd?: number;
  /** True when the reference named a verse. The number itself cannot be
   *  bounded, because nothing in src/data records verse counts, but knowing
   *  one was claimed is what lets the report say so out loud instead of
   *  passing in silence. */
  hasVerse?: boolean;
}

/**
 * Parses "Book", "Book N", "Book N-M", "Book N:V", "Book N:V-W" and
 * "Book N:V-M:W". Verse numbers are parsed but not checked (no verse-count
 * data exists in the index): only the chapter number(s) are validated.
 */
function parseReference(ref: string): ParsedRef | null {
  const trimmed = ref.trim();
  // Book name is everything before the last run of digits/ranges/colons.
  const m = trimmed.match(/^(.*?)(\d+(?::\d+)?(?:-\d+(?::\d+)?)?)?$/);
  if (!m) return null;
  const bookRaw = m[1].trim();
  const rest = m[2];
  if (!bookRaw) return null;
  if (!rest) return { bookRaw };

  // "N", "N-M", "N:V", "N:V-W" (same chapter, verse range) or "N:V-M:W"
  // (chapter range). A dash after a colon with no colon on its own side is a
  // verse range, not a chapter range: "Ephesians 2:8-9" is chapter 2 only.
  const parts = rest.match(/^(\d+)(:(\d+))?(?:-(\d+)(:(\d+))?)?$/);
  if (!parts) return { bookRaw };
  const chapterStart = Number(parts[1]);
  const hasStartVerse = parts[2] !== undefined;
  const secondNumber = parts[4] !== undefined ? Number(parts[4]) : undefined;
  const secondHasColon = parts[5] !== undefined;
  let chapterEnd = chapterStart;
  if (secondNumber !== undefined) {
    if (secondHasColon) chapterEnd = secondNumber; // "N:V-M:W"
    else if (hasStartVerse) chapterEnd = chapterStart; // "N:V-W" (verse range within one chapter)
    else chapterEnd = secondNumber; // "N-M"
  }
  if (!Number.isFinite(chapterStart) || !Number.isFinite(chapterEnd)) return { bookRaw };
  const hasVerse = hasStartVerse || secondHasColon;
  return { bookRaw, chapterStart, chapterEnd, hasVerse };
}

function findBook(index: BuiltIndex, bookRaw: string): IndexBook | undefined {
  const key = normalize(bookRaw);
  return index.books.find((b) => b.aliases.includes(key));
}

function checkReference(index: BuiltIndex, reference: string): { checks: CheckResult[]; book?: IndexBook } {
  const checks: CheckResult[] = [];
  const parsed = parseReference(reference);
  if (!parsed) {
    checks.push({ kind: 'reference-not-found', subject: reference, ok: false, detail: `could not parse "${reference}" as a scripture reference` });
    return { checks };
  }
  const book = findBook(index, parsed.bookRaw);
  if (!book) {
    checks.push({ kind: 'reference-not-found', subject: reference, ok: false, detail: `"${parsed.bookRaw}" does not match any of the 66 books` });
    return { checks };
  }
  checks.push({ kind: 'reference-not-found', subject: reference, ok: true, detail: `"${parsed.bookRaw}" matches ${book.name}` });

  if (parsed.chapterStart !== undefined) {
    const inRange = (n: number) => n >= 1 && n <= book.chapters;
    const ok = inRange(parsed.chapterStart) && inRange(parsed.chapterEnd ?? parsed.chapterStart);
    checks.push({
      kind: 'chapter-out-of-range',
      subject: reference,
      ok,
      detail: ok
        ? `chapter ${parsed.chapterStart}${parsed.chapterEnd !== parsed.chapterStart ? `-${parsed.chapterEnd}` : ''} is within ${book.name}'s ${book.chapters} chapters`
        : `${book.name} has ${book.chapters} chapters; "${reference}" asks for ${parsed.chapterStart}${parsed.chapterEnd !== parsed.chapterStart ? `-${parsed.chapterEnd}` : ''}`,
    });
  }

  // A verse number is the one part of a reference this data cannot judge:
  // src/data records chapter counts per book and nothing finer, so
  // "Romans 8:999" is indistinguishable from "Romans 8:28" here. Before, that
  // meant a made-up verse passed in silence, which is worse than the gap
  // itself: the report said "verified" about something it had not looked at.
  // It is reported as unverifiable instead, so the item shows as partial and
  // the reader knows exactly which claim went unchecked.
  if (parsed.chapterStart !== undefined && parsed.hasVerse) {
    const landmark = index.verses.some(
      (v) => book && v.book === book.id && normalize(v.ref) === normalize(reference),
    );
    checks.push({
      kind: 'unverifiable',
      subject: reference,
      ok: true,
      detail: landmark
        ? `the verse in "${reference}" is a landmark verse in the index, so it exists; verse numbers in general are not bounded (no verse-count data)`
        : `the chapter in "${reference}" is checked, the verse number is not: nothing in src/data records how many verses a chapter has`,
    });
  }
  return { checks, book };
}

function checkPeople(
  index: BuiltIndex,
  names: string[],
  book: IndexBook | undefined,
  ref: ParsedRef | null,
): CheckResult[] {
  return names.flatMap((raw): CheckResult[] => {
    const person = index.people.find((p) => p.aliases.some((a) => normalize(a) === normalize(raw)));
    if (!person) {
      return [{ kind: 'person-unknown', subject: raw, ok: false, detail: `"${raw}" is not in the 257-person index` }];
    }
    if (!book) {
      return [{ kind: 'person-unknown', subject: raw, ok: true, detail: `"${raw}" is known (no book to check against)` }];
    }
    const inBook = person.booksAppearing.includes(book.id);
    const bookCheck: CheckResult = {
      kind: 'person-not-in-book',
      subject: raw,
      ok: inBook,
      detail: inBook
        ? `${person.name} appears in ${book.name}`
        : `${person.name}'s known books are [${person.booksAppearing.join(', ')}], not ${book.name}`,
    };
    if (!inBook || ref?.chapterStart === undefined) return [bookCheck];

    // Chapter grain, as far as the data goes. `booksAppearing` is the finest
    // the people index has, so "Adam, in Romans 16" passed while being wrong
    // (Adam is Romans 5). Episodes carry a `who` list and a chapter, which
    // gives a narrower reading: where this person is actually placed in this
    // book. It is reported as unverifiable rather than failed, because
    // episodes are not an exhaustive concordance and a person can be
    // mentioned in a chapter that has no episode. Saying "we could not place
    // them there, here is where we can" gives a generator something to act
    // on without inventing a failure.
    const itemStart = ref.chapterStart;
    const itemEnd = ref.chapterEnd ?? ref.chapterStart;
    const placements = index.events.episodes
      .filter((e) => e.book === book.id && e.who.some((w) => normalize(w) === normalize(raw)))
      .map((e) => ({ e, span: episodeChapters(e.ref) }))
      .filter((x) => x.span !== null) as { e: EpisodeEvent; span: { start: number; end: number } }[];
    if (!placements.length) return [bookCheck];

    const here = placements.some(({ span }) => span.start <= itemEnd && span.end >= itemStart);
    return [bookCheck, {
      kind: here ? 'person-not-in-chapter' : 'unverifiable',
      subject: raw,
      ok: true,
      detail: here
        ? `${person.name} is placed in ${book.name} ${placements.map((x) => x.e.ref).join(', ')}, which the reference covers`
        : `${person.name} appears in ${book.name}, but the episodes that name them are chapters ${placements.map((x) => x.e.ref).join(', ')}, not ${itemStart}${itemEnd !== itemStart ? `-${itemEnd}` : ''}; episodes are not exhaustive, so this is not proof of an error`,
    }];
  });
}

/** An episode's `ref` is a chapter or a chapter range, e.g. "22" or "6-9". */
function episodeChapters(ref: string): { start: number; end: number } | null {
  const m = ref.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}


function checkEvents(
  index: BuiltIndex,
  names: string[],
  era: string | undefined,
  ref: ParsedRef | null,
  book: IndexBook | undefined,
): CheckResult[] {
  return names.flatMap((raw) => {
    const key = normalize(raw);
    const datedMatch = index.events.dated.find((e) => normalize(e.label) === key || normalize(e.label).includes(key));
    const episodeMatches = index.events.episodes.filter((e) => normalize(e.name) === key);

    if (!datedMatch && episodeMatches.length === 0) {
      return [{ kind: 'event-unknown', subject: raw, ok: false, detail: `"${raw}" does not match any dated event or narrative episode` }];
    }

    // Chapter agreement, checked before the era and independently of it.
    // An episode is anchored to a chapter in the index, so "Romans 12,
    // event: Abraham justified by faith" is checkable and false: that
    // episode is Romans 4. Previously only the name and the era were
    // compared, so a real episode filed under any chapter of the right book
    // passed. When the item names no chapter, or the episode's ref is not a
    // plain chapter range, there is nothing to compare and no check is added.
    const chapterChecks: CheckResult[] = [];
    if (book && ref?.chapterStart !== undefined) {
      const itemStart = ref.chapterStart;
      const itemEnd = ref.chapterEnd ?? ref.chapterStart;
      const sameBook = episodeMatches.filter((e) => e.book === book.id);
      if (sameBook.length) {
        const spans = sameBook
          .map((e) => ({ e, span: episodeChapters(e.ref) }))
          .filter((x) => x.span !== null) as { e: EpisodeEvent; span: { start: number; end: number } }[];
        if (spans.length) {
          const overlaps = spans.some(
            ({ span }) => span.start <= itemEnd && span.end >= itemStart,
          );
          chapterChecks.push({
            kind: 'event-not-in-chapter',
            subject: raw,
            ok: overlaps,
            detail: overlaps
              ? `"${raw}" is anchored to ${book.name} ${spans.map((x) => x.e.ref).join(', ')}, which the reference covers`
              : `"${raw}" is ${book.name} ${spans.map((x) => x.e.ref).join(', ')}, not chapter ${itemStart}${itemEnd !== itemStart ? `-${itemEnd}` : ''}`,
          });
        }
      }
    }

    if (!era) {
      return [
        { kind: 'event-unknown', subject: raw, ok: true, detail: `"${raw}" is known (no era claimed to check)` },
        ...chapterChecks,
      ];
    }

    const eraKey = normalize(era);
    const eraMatches = (id: string) => normalize(id) === eraKey || normalize(index.eras.find((e) => e.id === id)?.name ?? '') === eraKey;

    if (datedMatch) {
      const ok = eraMatches(datedMatch.era);
      return [{
        kind: 'event-not-in-era',
        subject: raw,
        ok,
        detail: ok ? `"${datedMatch.label}" belongs to era "${datedMatch.era}"` : `"${datedMatch.label}" belongs to era "${datedMatch.era}", not "${era}"`,
      }, ...chapterChecks];
    }

    // Episode event: no direct era on the event, so check via its book's
    // candidate eras (ERAS[].books membership). A book with zero candidate
    // eras cannot be judged either way.
    return [...chapterChecks, ...episodeMatches.map((ev): CheckResult => {
      if (ev.candidateEras.length === 0) {
        return {
          kind: 'unverifiable',
          subject: raw,
          ok: true,
          detail: `"${ev.name}" (${ev.book} ${ev.ref}): its book has no era assignment in timeline.ts, so the "${era}" claim cannot be checked`,
        };
      }
      const ok = ev.candidateEras.some(eraMatches);
      return {
        kind: 'event-not-in-era',
        subject: raw,
        ok,
        detail: ok
          ? `"${ev.name}" (${ev.book} ${ev.ref}) is consistent with era "${era}"`
          : `"${ev.name}" (${ev.book} ${ev.ref})'s book belongs to era(s) [${ev.candidateEras.join(', ')}], not "${era}"`,
      };
    })];
  });
}

function checkTerms(
  index: BuiltIndex, names: string[], book: IndexBook | undefined,
): CheckResult[] {
  return names.flatMap((raw): CheckResult[] => {
    const match = index.terms.find((t) => t.key === normalize(raw));
    if (!match) {
      return [{
        kind: 'term-unknown',
        subject: raw,
        ok: false,
        detail: `"${raw}" does not match any indexed term`,
      }];
    }
    const known: CheckResult = {
      kind: 'term-unknown',
      subject: raw,
      ok: true,
      detail: `"${raw}" is a known term (in ${match.books.join(', ')})`,
    };
    if (!book) return [known];

    // Existing somewhere is not the claim the item makes. An item saying
    // "Romans 5, key term: the I AM sayings" is wrong even though that term
    // is real, because it is indexed under John. Checking only global
    // existence let a true-looking term sit under any book at all, which was
    // one of six ways a plan of entirely false claims passed clean.
    const inBook = match.books.includes(book.id);
    return [known, {
      kind: 'term-not-in-book',
      subject: raw,
      ok: inBook,
      detail: inBook
        ? `"${match.term}" is a key term of ${book.name}`
        : `"${match.term}" is indexed under [${match.books.join(', ')}], not ${book.name}`,
    }];
  });
}

export function verifyItem(index: BuiltIndex, item: PlanItem): ItemReport {
  const { checks: refChecks, book } = checkReference(index, item.reference);
  const ref = parseReference(item.reference);
  const checks: CheckResult[] = [
    ...refChecks,
    ...checkPeople(index, item.people ?? [], book, ref),
    ...checkEvents(index, item.events ?? [], item.era, ref, book),
    ...checkTerms(index, item.terms ?? [], book),
  ];
  const pass = checks.every((c) => c.ok);
  return { id: item.id, type: item.type, reference: item.reference, pass, checks };
}

export function verifyPlan(index: BuiltIndex, plan: StudyPlan): VerifyReport {
  const items = plan.items.map((item) => verifyItem(index, item));
  const passCount = items.filter((i) => i.pass).length;
  return {
    goal: plan.goal,
    itemCount: items.length,
    passCount,
    failCount: items.length - passCount,
    items,
  };
}

export function printReport(report: VerifyReport) {
  console.log(`\nVerifying plan: "${report.goal}"`);
  console.log(`${report.passCount}/${report.itemCount} items passed all checks\n`);
  for (const item of report.items) {
    const mark = item.pass ? 'PASS' : 'FAIL';
    console.log(`  ${mark}  ${item.id}  [${item.type}]  ${item.reference}`);
    for (const c of item.checks) {
      if (c.ok && c.kind !== 'unverifiable') continue; // only show failures and unverifiable notes
      const tag = c.kind === 'unverifiable' ? 'note' : 'fail';
      console.log(`          ${tag}: ${c.kind}: ${c.detail}`);
    }
  }
  console.log('');
}
