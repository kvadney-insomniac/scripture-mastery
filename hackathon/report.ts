/**
 * The trust surface: one self-contained HTML page that shows what was
 * checked, what passed, and what was thrown away.
 *
 * The entry's whole argument is that nobody checks whether generated study
 * material is true, and a demo never surfaces it. A terminal report does not
 * fix that: the person who needs convincing is looking at a screen for two
 * minutes, and "trust me, there is a verifier" is exactly the claim being
 * disputed. So this renders the verifier's own output, per item, per check,
 * with the failing ones open by default. The interesting screen is not the
 * green one.
 *
 * Reads `out/verify-report.json` and, when the LLM generator produced one,
 * `out/generate-trace.json` for the round-by-round history. The trace is
 * optional: a plan verified from the stub generator renders fine without it.
 *
 * Writes a single HTML file with no external assets, no fonts, no scripts
 * from anywhere. It has to open from a USB stick on a borrowed laptop with
 * conference wifi down, which is the same reason the model client defaults
 * to replay.
 *
 * Run: npm run hackathon:report
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { StudyPlan } from './schema';
import type { CheckResult, ItemReport, VerifyReport } from './verify';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');

interface RoundRecord {
  round: number;
  label: string;
  source: string;
  itemsReturned: number;
  passed: number;
  failed: number;
  failures: { id: string; reference: string; reasons: string[] }[];
}

interface Trace {
  goal: string;
  book: string;
  weeks: number;
  model: string;
  mode: string;
  generatedAt: string;
  rounds: RoundRecord[];
  shipped: number;
  dropped: { id: string; reference: string; title: string }[];
}

function readJson<T>(file: string): T | null {
  const p = path.join(OUT_DIR, file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}

/** Escape for HTML text and attribute contexts. */
function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A check's verdict, as three states rather than two. `unverifiable` is its
 * own outcome on purpose: the data genuinely cannot answer (a book with no
 * era assignment, say), and collapsing that into "pass" would be the exact
 * dishonesty the verifier exists to prevent.
 */
function verdict(c: CheckResult): 'pass' | 'fail' | 'unknown' {
  if (c.kind === 'unverifiable') return 'unknown';
  return c.ok ? 'pass' : 'fail';
}

function renderChecks(checks: CheckResult[]): string {
  return checks
    .map((c) => {
      const v = verdict(c);
      const mark = v === 'pass' ? '&#10003;' : v === 'fail' ? '&#10007;' : '?';
      return `<li class="check ${v}"><span class="mark" aria-hidden="true">${mark}</span>
        <span class="kind">${esc(c.kind)}</span>
        <span class="subject">${esc(c.subject)}</span>
        <span class="detail">${esc(c.detail)}</span></li>`;
    })
    .join('\n');
}

function renderItem(item: ItemReport, plan: StudyPlan | null): string {
  const planItem = plan?.items.find((i) => i.id === item.id);
  const title = planItem?.title ?? item.id;
  const failed = item.checks.filter((c) => verdict(c) === 'fail').length;
  const unknown = item.checks.filter((c) => verdict(c) === 'unknown').length;
  const status = item.pass ? (unknown ? 'partial' : 'pass') : 'fail';
  const summary =
    status === 'fail'
      ? `${failed} check${failed === 1 ? '' : 's'} failed`
      : unknown
        ? `${item.checks.length - unknown} verified, ${unknown} unverifiable`
        : `${item.checks.length} check${item.checks.length === 1 ? '' : 's'} passed`;
  // Failures open by default. A reader should land on the problems.
  const open = status === 'fail' ? ' open' : '';
  return `<details class="item ${status}"${open}>
  <summary>
    <span class="badge">${status}</span>
    <span class="title">${esc(title)}</span>
    <code class="ref">${esc(item.reference)}</code>
    <span class="type">${esc(item.type)}</span>
    <span class="summary-count">${esc(summary)}</span>
  </summary>
  <ul class="checks">
${renderChecks(item.checks)}
  </ul>
</details>`;
}

function renderRounds(trace: Trace): string {
  const rows = trace.rounds
    .map(
      (r) => `<tr>
      <td><code>${esc(r.label)}</code></td>
      <td class="num">${r.itemsReturned}</td>
      <td class="num good">${r.passed}</td>
      <td class="num ${r.failed ? 'bad' : ''}">${r.failed}</td>
      <td>${r.failures.length ? esc(r.failures.map((f) => f.id).join(', ')) : '<span class="muted">none</span>'}</td>
    </tr>`,
    )
    .join('\n');
  return `<section>
  <h2>What it took to get here</h2>
  <p class="lede">Each round is one call to the model. The verifier decides what survives it, and the rejected items go back with the exact check that failed.</p>
  <table class="rounds">
    <thead><tr><th>round</th><th>items back</th><th>verified</th><th>rejected</th><th>rejected ids</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  ${
    trace.dropped.length
      ? `<div class="dropped"><h3>Dropped rather than shipped</h3>
      <p>These never verified, so they are not in the plan. A shorter true plan beats a longer plausible one.</p>
      <ul>${trace.dropped.map((d) => `<li><code>${esc(d.id)}</code> ${esc(d.title)} <code>${esc(d.reference)}</code></li>`).join('')}</ul></div>`
      : `<p class="muted">Nothing had to be dropped: every item verified within the repair budget.</p>`
  }
</section>`;
}

export function renderHtml(
  report: VerifyReport,
  plan: StudyPlan | null,
  trace: Trace | null,
): string {
  const pct = report.itemCount ? Math.round((report.passCount / report.itemCount) * 100) : 0;
  const provenance = trace
    ? `${esc(trace.model)} <span class="muted">(${esc(trace.mode)})</span>, ${esc(trace.book)}, ${trace.weeks} weeks`
    : esc(plan?.generatedBy ?? 'unknown generator');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verified study plan</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfbfa; --fg: #1c1b19; --muted: #6b6862; --line: #e2e0db;
    --card: #ffffff; --pass: #1f7a4d; --fail: #a8321f; --unknown: #8a6d1f;
    --pass-bg: #eaf5ef; --fail-bg: #fbeeeb; --unknown-bg: #faf3e2;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16150f; --fg: #ece9e2; --muted: #9a958b; --line: #302e27;
      --card: #1e1c16; --pass: #6fce9b; --fail: #f0907c; --unknown: #dcbc65;
      --pass-bg: #16281f; --fail-bg: #2c1a16; --unknown-bg: #2a2317;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
         font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 40px 20px 72px; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 17px; margin: 40px 0 6px; }
  h3 { font-size: 14px; margin: 18px 0 4px; }
  .goal { color: var(--muted); margin: 0 0 28px; }
  .lede { color: var(--muted); margin: 0 0 14px; }
  .muted { color: var(--muted); }
  code { font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; }

  .headline { display: flex; gap: 20px; align-items: baseline; flex-wrap: wrap;
              background: var(--card); border: 1px solid var(--line);
              border-radius: 10px; padding: 20px 22px; }
  .score { font-size: 40px; font-weight: 650; letter-spacing: -0.02em; line-height: 1; }
  .score.ok { color: var(--pass); } .score.bad { color: var(--fail); }
  .score-note { flex: 1 1 260px; color: var(--muted); }

  .bar { display: flex; height: 8px; border-radius: 999px; overflow: hidden;
         margin: 18px 0 0; background: var(--line); }
  .bar span { display: block; }
  .bar .p { background: var(--pass); } .bar .f { background: var(--fail); }

  table.rounds { border-collapse: collapse; width: 100%; margin-top: 8px; }
  table.rounds th, table.rounds td { text-align: left; padding: 7px 10px;
        border-bottom: 1px solid var(--line); }
  table.rounds th { font-weight: 600; font-size: 12px; text-transform: uppercase;
        letter-spacing: 0.04em; color: var(--muted); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.good { color: var(--pass); } td.bad { color: var(--fail); }

  .item { background: var(--card); border: 1px solid var(--line);
          border-radius: 9px; margin: 8px 0; overflow: hidden; }
  .item > summary { cursor: pointer; padding: 11px 14px; display: flex;
          gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .item > summary::-webkit-details-marker { display: none; }
  .badge { font-size: 11px; font-weight: 650; text-transform: uppercase;
           letter-spacing: 0.05em; padding: 2px 7px; border-radius: 5px; }
  .item.pass .badge { background: var(--pass-bg); color: var(--pass); }
  .item.fail .badge { background: var(--fail-bg); color: var(--fail); }
  .item.partial .badge { background: var(--unknown-bg); color: var(--unknown); }
  .item.fail { border-color: color-mix(in srgb, var(--fail) 40%, var(--line)); }
  .title { font-weight: 550; }
  .ref { color: var(--muted); }
  .type { font-size: 12px; color: var(--muted); }
  .summary-count { margin-left: auto; font-size: 12.5px; color: var(--muted); }

  ul.checks { list-style: none; margin: 0; padding: 0 14px 12px; }
  .check { display: grid; grid-template-columns: 16px 150px 1fr; gap: 4px 10px;
           padding: 6px 0; border-top: 1px solid var(--line); align-items: baseline; }
  .check .mark { font-weight: 700; }
  .check.pass .mark { color: var(--pass); }
  .check.fail .mark { color: var(--fail); }
  .check.unknown .mark { color: var(--unknown); }
  .check .kind { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); }
  .check .subject { grid-column: 3; font-weight: 550; }
  .check .detail { grid-column: 3; color: var(--muted); font-size: 13.5px; }

  .dropped ul { margin: 6px 0 0; padding-left: 20px; }
  footer { margin-top: 44px; padding-top: 16px; border-top: 1px solid var(--line);
           color: var(--muted); font-size: 13px; }
  @media (max-width: 560px) {
    .check { grid-template-columns: 16px 1fr; }
    .check .subject, .check .detail { grid-column: 2; }
    .summary-count { margin-left: 0; flex-basis: 100%; }
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>Verified study plan</h1>
  <p class="goal">${esc(report.goal)}</p>

  <div class="headline">
    <div class="score ${report.failCount === 0 ? 'ok' : 'bad'}">${report.passCount}/${report.itemCount}</div>
    <div class="score-note">
      items passed every check that could be run against the app's own
      structured data. ${report.failCount === 0
        ? 'Nothing in this plan makes a claim the data does not support.'
        : `${report.failCount} item${report.failCount === 1 ? '' : 's'} below make a claim the data contradicts.`}
      <div class="bar">
        <span class="p" style="width:${pct}%"></span><span class="f" style="width:${100 - pct}%"></span>
      </div>
    </div>
  </div>

${trace ? renderRounds(trace) : ''}

  <h2>Every item, and every check that ran on it</h2>
  <p class="lede">A reference is checked against the 66 books and their chapter counts; people, events and key terms against the indexed entries for that book; an era claim against the event's own era. Failures are open below.</p>
${report.items.map((i) => renderItem(i, plan)).join('\n')}

  <footer>
    Generated by ${provenance}.
    Checks run by <code>hackathon/verify.ts</code> against
    <code>hackathon/out/index.json</code>, built from the app's own data files.
    ${trace ? `Plan produced ${esc(trace.generatedAt)}.` : ''}
  </footer>
</div>
</body>
</html>
`;
}

function main() {
  const report = readJson<VerifyReport>('verify-report.json');
  if (!report) {
    console.error(
      'No hackathon/out/verify-report.json. Run "npm run hackathon:verify" (or hackathon:demo) first.',
    );
    process.exit(1);
  }
  // Written by verify-cli.ts: exactly the plan this report is about. Falls
  // back to plan.json for a report produced before that existed.
  const plan = readJson<StudyPlan>('verified-plan.json') ?? readJson<StudyPlan>('plan.json');
  const trace = readJson<Trace>('generate-trace.json');

  const html = renderHtml(report, plan, trace);
  const out = path.join(OUT_DIR, 'report.html');
  fs.writeFileSync(out, html);
  console.log(
    `${report.passCount}/${report.itemCount} items verified` +
      (trace ? `, ${trace.rounds.length} generation round(s)` : '') +
      `\nwrote ${out}`,
  );
}

main();
