/**
 * A deterministic stand-in for the generator agent described in the
 * hackathon plan. This is NOT an LLM call: it builds a study plan for a
 * goal like "understand Romans in 6 weeks" purely by walking
 * `hackathon/out/index.json`: one reading item per narrative episode, one
 * memory item per landmark verse, one question item per key term, spread
 * across the requested number of weeks.
 *
 * Because every item is built directly from index entries (a real book id,
 * a real episode name and ref, a real term), the plan this produces should
 * pass `verify.ts` cleanly, and that is the point. It demonstrates that
 * grounding generation in the index is enough to avoid the failure modes
 * the verifier checks for. The fixture at `hackathon/fixtures/plan-with-errors.json`
 * demonstrates the opposite case (a plan that free-invents details) so the
 * verifier has something to actually catch.
 *
 * --------------------------------------------------------------------
 * LLM HOOK: a real generator agent replaces the body of `buildPlan()`
 * below. It would still receive the same `BuiltIndex` (so it can only
 * reference things that exist), and it would still hand its output to
 * `verifyPlan()` from `hackathon/verify.ts` before anything ships. Nothing
 * else in this file needs to change to make that swap.
 * --------------------------------------------------------------------
 *
 * Run with `npm run hackathon:demo` (chains index -> stub -> verify), or
 * `vite-node hackathon/generate-stub.ts "<goal>"` directly. Writes the plan
 * to `hackathon/out/plan.json`.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import type { StudyPlan, PlanItem } from './schema';
import type { BuiltIndex, IndexBook } from './index-types';

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Pulls a book and a week count out of a free-text goal string. */
function parseGoal(index: BuiltIndex, goal: string): { book: IndexBook; weeks: number } {
  const weekMatch = goal.match(/(\d+)\s*week/i);
  const weeks = weekMatch ? Math.max(1, Math.min(12, Number(weekMatch[1]))) : 4;

  const words = normalize(goal).split(' ');
  let book: IndexBook | undefined;
  // Try longest alias match first so "1 corinthians" beats "corinthians" beats "co".
  const sortedBooks = [...index.books].sort((a, b) => Math.max(...b.aliases.map((x) => x.length)) - Math.max(...a.aliases.map((x) => x.length)));
  for (const b of sortedBooks) {
    if (b.aliases.some((alias) => alias.length > 2 && words.join(' ').includes(alias))) {
      book = b;
      break;
    }
  }
  if (!book) {
    // No book named in the goal: default to Romans, since it is the plan's
    // own worked example, rather than guessing at something less legible.
    book = index.books.find((b) => b.id === 'romans')!;
  }
  return { book, weeks };
}

/** Sorts refs like "9-11" and "1" by their leading chapter number. */
function refSort(ref: string): number {
  return Number(ref.split(/[-:]/)[0]) || 0;
}

function buildPlan(index: BuiltIndex, goal: string): StudyPlan {
  const { book, weeks } = parseGoal(index, goal);

  const episodes = index.events.episodes.filter((e) => e.book === book.id).sort((a, b) => refSort(a.ref) - refSort(b.ref));
  const bookVerses = index.verses.filter((v) => v.book === book.id);
  const bookTerms = index.terms.filter((t) => t.books.includes(book.id));
  const candidateEra = episodes[0]?.candidateEras.length === 1 ? episodes[0].candidateEras[0] : undefined;

  const items: PlanItem[] = [];
  let n = 0;

  episodes.forEach((ev, i) => {
    const week = 1 + Math.floor((i / Math.max(episodes.length, 1)) * weeks);
    items.push({
      id: `${book.id}-r${++n}`,
      type: 'reading',
      week: Math.min(week, weeks),
      title: ev.name,
      reference: `${book.name} ${ev.ref}`,
      people: ev.who.length > 0 ? ev.who : undefined,
      events: [ev.name],
      era: candidateEra,
    });
  });

  bookVerses.forEach((v, i) => {
    const week = 1 + Math.floor((i / Math.max(bookVerses.length, 1)) * weeks);
    items.push({
      id: `${book.id}-m${i + 1}`,
      type: 'memory',
      week: Math.min(week, weeks),
      title: `Memorize ${v.ref}`,
      reference: v.ref,
    });
  });

  bookTerms.forEach((t, i) => {
    const week = 1 + Math.floor((i / Math.max(bookTerms.length, 1)) * weeks);
    items.push({
      id: `${book.id}-q${i + 1}`,
      type: 'question',
      week: Math.min(week, weeks),
      title: `What does ${t.term} mean in ${book.name}?`,
      reference: book.name,
      terms: [t.term],
    });
  });

  items.sort((a, b) => a.week - b.week);

  return {
    goal,
    weeks,
    generatedBy: 'hackathon/generate-stub.ts (deterministic, index-grounded, not an LLM)',
    items,
  };
}

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const indexPath = path.join(__dirname, 'out', 'index.json');
  if (!fs.existsSync(indexPath)) {
    console.error(`No index found at ${indexPath}. Run "npm run hackathon:index" first.`);
    process.exit(1);
  }
  const index: BuiltIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

  const goal = process.argv.slice(2).join(' ') || 'understand Romans in 6 weeks';
  const plan = buildPlan(index, goal);

  const outPath = path.join(__dirname, 'out', 'plan.json');
  fs.writeFileSync(outPath, JSON.stringify(plan, null, 2));

  console.log(`\nGenerated plan for: "${goal}"`);
  console.log(`${plan.items.length} items across ${plan.weeks} weeks -> ${outPath}\n`);
  const byType = new Map<string, number>();
  for (const i of plan.items) byType.set(i.type, (byType.get(i.type) ?? 0) + 1);
  for (const [t, c] of byType) console.log(`  ${t.padEnd(10)} ${c}`);
  console.log('');
}

main();
