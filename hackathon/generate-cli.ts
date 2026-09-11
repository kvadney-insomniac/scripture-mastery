/**
 * Command line front end for the generator agent.
 *
 * Separate from `generate.ts` for the same reason `verify-cli.ts` is
 * separate from `verify.ts`: the library must be importable (the self-test
 * drives `generatePlan` with a scripted model) without the CLI firing, and
 * an argv-based entry-point guard does not survive vite-node.
 *
 * Run: npm run hackathon:generate -- "understand Romans in 6 weeks"
 */
import { generatePlan } from './generate';

const goal = process.argv.slice(2).join(' ').trim() || 'understand Romans in 6 weeks';

generatePlan(goal)
  .then(({ trace, finalReport }) => {
    console.log('');
    console.log(`goal      ${trace.goal}`);
    console.log(`book      ${trace.book}, ${trace.weeks} weeks`);
    console.log(`rounds    ${trace.rounds.length}`);
    console.log(`shipped   ${trace.shipped} item(s), all verified: ${finalReport.failCount === 0}`);
    if (trace.dropped.length) {
      console.log(`dropped   ${trace.dropped.length} item(s) that never verified:`);
      for (const d of trace.dropped) console.log(`            ${d.id}  ${d.reference}  ${d.title}`);
    }
    console.log('');
    console.log('wrote hackathon/out/plan.json and hackathon/out/generate-trace.json');
    if (finalReport.failCount !== 0) {
      console.error('A shipped item failed final verification. That is a bug in the loop, not the plan.');
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
