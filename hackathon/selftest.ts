/**
 * Proves the generate-verify-repair loop does what the entry claims, with a
 * scripted stand-in for the model so it needs no API key and no network.
 *
 * This is not a recorded model response and is not presented as one. It is a
 * test double that returns a fixed script, chosen so the loop has to handle
 * all three outcomes in one run:
 *
 *   round-1    four items: two true, two invented
 *   repair-1   one of the invented pair is corrected, one is corrected badly
 *   repair-2   the remaining item is still wrong
 *
 * The loop passes if it ships exactly the three items that verify, drops the
 * one that never does, and records every round in the trace. Those are the
 * two behaviours a demo audience should not have to take on trust: that the
 * verifier is load-bearing rather than decorative, and that a plan never
 * ships an item the verifier rejected.
 *
 * Run: npm run hackathon:selftest
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generatePlan } from './generate';
import type { Llm, LlmRequest, LlmResponse } from './llm';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Items keyed by round. Real book, real chapters, real Romans people and terms. */
const SCRIPT: Record<string, unknown>[] = [
  // round-1
  {
    items: [
      {
        id: 'w1-r1',
        type: 'reading',
        week: 1,
        title: "Paul's gospel, stated up front",
        reference: 'Romans 1',
        people: ['Paul'],
        terms: ['Justification'],
      },
      {
        id: 'w2-m1',
        type: 'memory',
        week: 2,
        title: 'All things work together for good',
        reference: 'Romans 8:28',
      },
      {
        // Invented: Romans has 16 chapters.
        id: 'w3-r1',
        type: 'reading',
        week: 3,
        title: 'A chapter past the end of the book',
        reference: 'Romans 20',
      },
      {
        // Invented: not a person the data places in Romans.
        id: 'w4-q1',
        type: 'question',
        week: 4,
        title: 'Who is addressed here',
        reference: 'Romans 4',
        people: ['Jonah the Prophet'],
      },
    ],
  },
  // repair-1: one fixed properly, one fixed into a different wrong answer.
  {
    items: [
      {
        id: 'w3-r1',
        type: 'reading',
        week: 3,
        title: 'The closing doxology',
        reference: 'Romans 16',
      },
      {
        id: 'w4-q1',
        type: 'question',
        week: 4,
        title: 'Who is addressed here',
        reference: 'Romans 4',
        people: ['Melchizedek the Priest'],
      },
    ],
  },
  // repair-2: still wrong. The loop should give up on it and drop it.
  {
    items: [
      {
        id: 'w4-q1',
        type: 'question',
        week: 4,
        title: 'Who is addressed here',
        reference: 'Romans 4',
        people: ['Melchizedek the Priest'],
      },
    ],
  },
];

class ScriptedLlm implements Llm {
  readonly mode = 'replay' as const;
  private calls = 0;
  readonly seen: string[] = [];

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.seen.push(req.label);
    const output = SCRIPT[Math.min(this.calls, SCRIPT.length - 1)];
    this.calls += 1;
    return { output, source: 'replay' };
  }
}

function check(label: string, ok: boolean, detail: string): boolean {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${label}${ok ? '' : `  (${detail})`}`);
  return ok;
}

async function main() {
  // Keep the real demo outputs intact: stash and restore anything we overwrite.
  const outDir = path.join(HERE, 'out');
  const saved: Record<string, string | null> = {};
  for (const f of ['plan.json', 'generate-trace.json']) {
    const p = path.join(outDir, f);
    saved[p] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }

  const llm = new ScriptedLlm();
  const { plan, trace, finalReport } = await generatePlan('understand Romans in 6 weeks', llm);

  for (const [p, content] of Object.entries(saved)) {
    if (content === null) fs.rmSync(p, { force: true });
    else fs.writeFileSync(p, content);
  }

  const shippedIds = plan.items.map((i) => i.id).sort();
  let ok = true;
  ok = check('three rounds ran', trace.rounds.length === 3, `got ${trace.rounds.length}`) && ok;
  ok =
    check(
      'rounds are labelled round-1, repair-1, repair-2',
      llm.seen.join(',') === 'round-1,repair-1,repair-2',
      llm.seen.join(','),
    ) && ok;
  ok =
    check(
      'ships the three items that verify',
      shippedIds.join(',') === 'w1-r1,w2-m1,w3-r1',
      shippedIds.join(','),
    ) && ok;
  ok =
    check(
      'drops the item that never verified',
      trace.dropped.length === 1 && trace.dropped[0].id === 'w4-q1',
      JSON.stringify(trace.dropped),
    ) && ok;
  ok =
    check(
      'a repaired item replaces its failed version, not duplicates it',
      plan.items.filter((i) => i.id === 'w3-r1').length === 1 &&
        plan.items.find((i) => i.id === 'w3-r1')?.reference === 'Romans 16',
      JSON.stringify(plan.items.filter((i) => i.id === 'w3-r1')),
    ) && ok;
  ok =
    check(
      'everything shipped passes final verification',
      finalReport.failCount === 0 && finalReport.itemCount === 3,
      `${finalReport.passCount}/${finalReport.itemCount} passed`,
    ) && ok;
  ok =
    check(
      'round 1 recorded both invented items as failures',
      trace.rounds[0].failed === 2,
      `failed=${trace.rounds[0].failed}`,
    ) && ok;

  console.log('');
  if (!ok) {
    console.error('self-test failed');
    process.exit(1);
  }
  console.log('self-test passed: the verifier is load-bearing and nothing unverified ships.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
