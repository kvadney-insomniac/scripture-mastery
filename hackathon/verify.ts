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
 * Run with `npm run hackathon:verify` (verifies the fixture plan) or
 * `vite-node hackathon/verify.ts <path-to-plan.json>` for any other plan.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import type { PlanItem, StudyPlan } from './schema';
import type { BuiltIndex, IndexBook } from './index-types';

export type CheckKind =
  | 'reference-not-found'
  | 'chapter-out-of-range'
  | 'person-unknown'
  | 'person-not-in-book'
  | 'event-unknown'
  | 'event-not-in-era'
  | 'term-unknown';

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
  return { bookRaw, chapterStart, chapterEnd };
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
  return { checks, book };
}

function checkPeople(index: BuiltIndex, names: string[], book: IndexBook | undefined): CheckResult[] {
  return names.map((raw) => {
    const person = index.people.find((p) => p.aliases.some((a) => normalize(a) === normalize(raw)));
    if (!person) {
      return { kind: 'person-unknown', subject: raw, ok: false, detail: `"${raw}" is not in the 257-person index` };
    }
    if (!book) {
      return { kind: 'person-unknown', subject: raw, ok: true, detail: `"${raw}" is known (no book to check against)` };
    }
    const inBook = person.booksAppearing.includes(book.id);
    return {
      kind: 'person-not-in-book',
      subject: raw,
      ok: inBook,
      detail: inBook
        ? `${person.name} appears in ${book.name}`
        : `${person.name}'s known books are [${person.booksAppearing.join(', ')}], not ${book.name}`,
    };
  });
}

function checkEvents(index: BuiltIndex, names: string[], era?: string): CheckResult[] {
  return names.flatMap((raw) => {
    const key = normalize(raw);
    const datedMatch = index.events.dated.find((e) => normalize(e.label) === key || normalize(e.label).includes(key));
    const episodeMatches = index.events.episodes.filter((e) => normalize(e.name) === key);

    if (!datedMatch && episodeMatches.length === 0) {
      return [{ kind: 'event-unknown', subject: raw, ok: false, detail: `"${raw}" does not match any dated event or narrative episode` }];
    }
    if (!era) {
      return [{ kind: 'event-unknown', subject: raw, ok: true, detail: `"${raw}" is known (no era claimed to check)` }];
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
      }];
    }

    // Episode event: no direct era on the event, so check via its book's
    // candidate eras (ERAS[].books membership). A book with zero candidate
    // eras cannot be judged either way.
    return episodeMatches.map((ev): CheckResult => {
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
    });
  });
}

function checkTerms(index: BuiltIndex, names: string[]): CheckResult[] {
  return names.map((raw) => {
    const match = index.terms.find((t) => t.key === normalize(raw));
    return {
      kind: 'term-unknown',
      subject: raw,
      ok: !!match,
      detail: match ? `"${raw}" is a known term (in ${match.books.join(', ')})` : `"${raw}" does not match any indexed term`,
    };
  });
}

export function verifyItem(index: BuiltIndex, item: PlanItem): ItemReport {
  const { checks: refChecks, book } = checkReference(index, item.reference);
  const checks: CheckResult[] = [
    ...refChecks,
    ...checkPeople(index, item.people ?? [], book),
    ...checkEvents(index, item.events ?? [], item.era),
    ...checkTerms(index, item.terms ?? []),
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

function printReport(report: VerifyReport) {
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

// ------------------------------------------------------------------ runner

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const indexPath = path.join(__dirname, 'out', 'index.json');
  if (!fs.existsSync(indexPath)) {
    console.error(`No index found at ${indexPath}. Run "npm run hackathon:index" first.`);
    process.exit(1);
  }
  const index: BuiltIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

  const planArg = process.argv[2];
  const planPath = planArg ? path.resolve(planArg) : path.join(__dirname, 'fixtures', 'plan-with-errors.json');
  const plan: StudyPlan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

  const report = verifyPlan(index, plan);
  printReport(report);

  const reportPath = path.join(__dirname, 'out', 'verify-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Wrote ${reportPath}`);

  if (report.failCount > 0 && !planArg) {
    // The fixture plan is expected to fail: that is the demo. Exit 0 so
    // `npm run hackathon:demo` doesn't look broken.
    console.log(`\n(${report.failCount} failure(s) on the fixture plan are expected; see hackathon/fixtures/plan-with-errors.json)\n`);
  }
}

main();
