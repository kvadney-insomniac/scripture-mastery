/**
 * The generator agent: writes a study plan, checks it against the data, and
 * rewrites the parts that fail.
 *
 * This is the piece the entry is actually about. Generating a plausible
 * study plan is easy and every AI Bible tool already does it. The question
 * nobody answers is whether the plan is true: does that verse reference
 * exist, did that person appear in that book, is that episode in the
 * chapter the plan says it is. A model will produce a confident, well
 * formatted, subtly wrong answer to all three, and a demo will never show
 * it.
 *
 * So the loop here is:
 *
 *   1. build an evidence pack for the goal, straight out of the index
 *   2. ask the model for a plan, with the schema enforced by the API so
 *      shape is free and the only open question is truth
 *   3. run the independent verifier over every item
 *   4. hand the failing items back with the exact check that failed and ask
 *      for a repair, up to MAX_REPAIR_ROUNDS
 *   5. ship only what passes, and drop what never does
 *
 * Step 5 matters as much as step 4. A plan that quietly keeps an unverified
 * item is the thing this is supposed to prevent, so items that still fail
 * after the last repair round are removed from the plan and listed in the
 * trace. A short true plan beats a long plausible one.
 *
 * Run:  npm run hackathon:generate -- "understand Romans in 6 weeks"
 * Writes hackathon/out/plan.json and hackathon/out/generate-trace.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEvidence, renderEvidence } from './evidence';
import type { BuiltIndex } from './index-types';
import { MODEL, selectLlm, type Llm } from './llm';
import type { PlanItem, StudyPlan } from './schema';
import { verifyPlan, type ItemReport, type VerifyReport } from './verify';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
const INDEX_PATH = path.join(OUT_DIR, 'index.json');

/** Two repairs is enough to fix careless mistakes without papering over a bad plan. */
const MAX_REPAIR_ROUNDS = 2;

/**
 * The schema the API enforces on every reply. Shape is guaranteed by this;
 * truth is not, which is the division of labour the whole entry rests on.
 */
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'week', 'title', 'reference'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['reading', 'memory', 'question'] },
          week: { type: 'integer', minimum: 1 },
          title: { type: 'string' },
          reference: { type: 'string' },
          people: { type: 'array', items: { type: 'string' } },
          events: { type: 'array', items: { type: 'string' } },
          terms: { type: 'array', items: { type: 'string' } },
          era: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
  },
} as const;

const SYSTEM = `You write study plans for a scripture study app, and every factual claim you make is checked against the app's own structured data by a separate verifier before anything reaches a learner.

You will be given an evidence pack: one book's chapters, landmark verses, narrative episodes, key terms, people and eras, copied verbatim from that data.

Rules that decide whether an item survives verification:

- A reference must name the book in the evidence pack and a chapter within its chapter count. Verse references must be ones the pack lists.
- Every name in "people" must appear verbatim in the pack's people list.
- Every name in "events" must be an episode name or a dated event label from the pack, spelled the same way.
- Every name in "terms" must appear in the pack's key terms list.
- Set "era" only when you also name an event, and only to an era the pack lists for this book.
- Leave a field out rather than guessing at it. An item with fewer claims that are all true is worth more than a rich item with one invented detail, because the invented one gets the whole item dropped.

Write for a learner, not a database: titles should read like something a person would put on a study plan. Spread the items across the requested number of weeks, roughly evenly, and give each week a mix of reading, memory and question items.`;

interface RoundRecord {
  round: number;
  label: string;
  source: 'live' | 'replay';
  itemsReturned: number;
  passed: number;
  failed: number;
  failures: { id: string; reference: string; reasons: string[] }[];
}

function readIndex(): BuiltIndex {
  if (!fs.existsSync(INDEX_PATH)) {
    throw new Error(`No index at ${INDEX_PATH}. Run "npm run hackathon:index" first.`);
  }
  return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) as BuiltIndex;
}

/** The failing checks on one item, as short sentences the model can act on. */
function reasonsFor(report: ItemReport): string[] {
  return report.checks.filter((c) => !c.ok).map((c) => `${c.kind} "${c.subject}": ${c.detail}`);
}

function summarize(report: VerifyReport): RoundRecord['failures'] {
  return report.items
    .filter((i) => !i.pass)
    .map((i) => ({ id: i.id, reference: i.reference, reasons: reasonsFor(i) }));
}

/** The repair turn: only the broken items, with the exact reason each broke. */
function repairPrompt(failures: RoundRecord['failures']): string {
  const lines = [
    `The verifier rejected ${failures.length} item(s). Each one is listed with the check that failed.`,
    '',
  ];
  for (const f of failures) {
    lines.push(`item ${f.id} (${f.reference}):`);
    for (const r of f.reasons) lines.push(`  - ${r}`);
  }
  lines.push('');
  lines.push(
    'Return a corrected version of ONLY these items, keeping each id. Fix the claim that failed, or drop the offending field. Do not add new items and do not restate the items that passed.',
  );
  return lines.join('\n');
}

function asItems(output: unknown): PlanItem[] {
  const items = (output as { items?: unknown })?.items;
  if (!Array.isArray(items)) throw new Error('Model reply had no items array.');
  return items as PlanItem[];
}

export async function generatePlan(goal: string, llm: Llm = selectLlm()) {
  const index = readIndex();
  const pack = buildEvidence(index, goal);

  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    {
      role: 'user',
      content: `Goal: ${goal}
Weeks: ${pack.weeks}

EVIDENCE PACK
${renderEvidence(pack)}

Write the study plan. Aim for roughly ${pack.weeks * 4} items.`,
    },
  ];

  const rounds: RoundRecord[] = [];
  let accepted: PlanItem[] = [];
  let outstanding: PlanItem[] = [];

  for (let round = 1; round <= MAX_REPAIR_ROUNDS + 1; round += 1) {
    const label = round === 1 ? 'round-1' : `repair-${round - 1}`;
    const reply = await llm.complete({ system: SYSTEM, messages, schema: PLAN_SCHEMA, label });
    const returned = asItems(reply.output);

    // Verify this round's items on their own, then fold the survivors in.
    const trial: StudyPlan = {
      goal,
      weeks: pack.weeks,
      generatedBy: `${MODEL} (${llm.mode})`,
      items: returned,
    };
    const report = verifyPlan(index, trial);
    const failures = summarize(report);
    const failedIds = new Set(failures.map((f) => f.id));

    // A repair round replaces the items it was asked to fix, so drop any
    // earlier copy of the same id before folding the new ones in.
    const returnedIds = new Set(returned.map((i) => i.id));
    accepted = accepted.filter((i) => !returnedIds.has(i.id));
    accepted.push(...returned.filter((i) => !failedIds.has(i.id)));
    outstanding = returned.filter((i) => failedIds.has(i.id));

    rounds.push({
      round,
      label,
      source: reply.source,
      itemsReturned: returned.length,
      passed: report.passCount,
      failed: report.failCount,
      failures,
    });

    console.log(
      `${label}: ${returned.length} item(s) back, ${report.passCount} verified, ${report.failCount} rejected (${reply.source})`,
    );

    if (failures.length === 0) break;
    if (round === MAX_REPAIR_ROUNDS + 1) break;

    messages.push({ role: 'assistant', content: JSON.stringify({ items: returned }) });
    messages.push({ role: 'user', content: repairPrompt(failures) });
  }

  // Anything still failing after the last repair is dropped, not shipped.
  const dropped = outstanding.map((i) => ({ id: i.id, reference: i.reference, title: i.title }));

  accepted.sort((a, b) => a.week - b.week || a.id.localeCompare(b.id));
  const plan: StudyPlan = {
    goal,
    weeks: pack.weeks,
    generatedBy: `${MODEL} (${llm.mode}), verified against index.json`,
    items: accepted,
  };

  const finalReport = verifyPlan(index, plan);
  const trace = {
    goal,
    book: pack.book.name,
    weeks: pack.weeks,
    model: MODEL,
    mode: llm.mode,
    generatedAt: new Date().toISOString(),
    rounds,
    shipped: accepted.length,
    dropped,
    finalVerification: {
      itemCount: finalReport.itemCount,
      passCount: finalReport.passCount,
      failCount: finalReport.failCount,
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(
    path.join(OUT_DIR, 'generate-trace.json'),
    `${JSON.stringify(trace, null, 2)}\n`,
  );

  return { plan, trace, finalReport };
}
