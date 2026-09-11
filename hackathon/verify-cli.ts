/**
 * Command line front end for the verifier.
 *
 * The checks live in `verify.ts`, which is now a library with no side
 * effects on import. That split matters: `generate.ts` imports `verifyPlan`
 * on every repair round, and while the CLI lived in the same module every
 * one of those imports re-ran the fixture demo and overwrote
 * `out/verify-report.json`. A guard on `process.argv[1]` does not fix it
 * either, because vite-node replaces argv[1] with its own binary path, so
 * the entry point is a separate file instead.
 *
 * Run with `npm run hackathon:verify` (verifies the fixture plan) or
 * `npm run hackathon:verify -- <path-to-plan.json>` for any other plan.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BuiltIndex } from './index-types';
import type { StudyPlan } from './schema';
import { printReport, verifyPlan } from './verify';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function main() {
  const indexPath = path.join(HERE, 'out', 'index.json');
  if (!fs.existsSync(indexPath)) {
    console.error(`No index found at ${indexPath}. Run "npm run hackathon:index" first.`);
    process.exit(1);
  }
  const index: BuiltIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

  const planArg = process.argv[2];
  const planPath = planArg
    ? path.resolve(planArg)
    : path.join(HERE, 'fixtures', 'plan-with-errors.json');
  const plan: StudyPlan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

  const report = verifyPlan(index, plan);
  printReport(report);

  const reportPath = path.join(HERE, 'out', 'verify-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Wrote ${reportPath}`);

  if (report.failCount > 0 && !planArg) {
    // The fixture plan is expected to fail: that is the demo. Exit 0 so
    // `npm run hackathon:demo` doesn't look broken.
    console.log(
      `\n(${report.failCount} failure(s) on the fixture plan are expected; see hackathon/fixtures/plan-with-errors.json)\n`,
    );
  }
}

main();
