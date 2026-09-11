# Gloo AI Hackathon prototype: queryable index + verifier

This directory is the pre-build-window prerequisite from
`gloo-hackathon-entry-plan-2026-08-31.md`, step 4: get Scripture Mastery's
structured data into a shape a generator agent can query, plus a working
verifier agent that checks generated plan items against that data. Nothing
outside this directory changes: the app, its data files, and its build are
untouched.

## What the data model actually contains

The entry plan's numbers were approximate. These are the real counts, read
by `hackathon/index.ts` directly from the files below and confirmed by
running it (see "Run it" for the exact command):

| What | Count | Source |
|---|---|---|
| Books | 66 | `src/data/books.ts` (`BOOKS`) |
| Total chapters | 1,189 | `src/data/books.ts` (`TOTAL_CHAPTERS`) |
| People | 257 | `src/data/people.ts` (`PEOPLE`) |
| Places | 62 | `src/data/people.ts` (`PLACES`) |
| Eras | 14 | `src/data/timeline.ts` (`ERAS`) |
| Dated events (have a `year`) | 29 | `src/data/timeline.ts` (`EVENTS`) |
| Narrative episodes (chapter-anchored, no date) | 607 | `src/data/details/*.ts` (`DetailEvent[]` inside each `BookDetail`) |
| Key terms (occurrences) | 255 | same, `Term[]` |
| Key terms (distinct names) | 242 | computed by the index builder |
| Outline sections | 268 | same, `Section[]` |
| Per-book figures | 389 | same, `Figure[]` |
| Landmark verses indexed | 151 | `Book.keyVerse` + `BookDetail.verses[]`, deduped by book+ref |
| Must-know lists / cue-content pairs | 13 / 145 | `src/data/essentials.ts` |
| Standing ordered lists | 11 | `src/data/extras.ts` |
| Generated questions | 6,282 | `src/lib/generate.ts` (`allItems()`) |

**Where the plan's description didn't match what's actually there**, stated
plainly rather than papered over:

- The plan said "233 people" and "246 key terms." The real numbers are 257
  and 255 (242 distinct term names; some terms, like "Covenant," show up
  under more than one book). Close, but not exact; use the numbers above.
- The plan said "595 dated events." Nothing in the data matches that number.
  There are two different things that could be called "events," and they are
  kept separate rather than merged into one number that would misrepresent
  either:
  - `TimelineEvent` (`src/data/timeline.ts`): 29 entries, each with an
    actual `year` and an `era`. These are the only genuinely *dated* events.
  - `DetailEvent` (`src/data/details/*.ts`): 607 entries, one per narrative
    episode inside a book (e.g. "The binding of Isaac" at Genesis 22). Each
    has a chapter `ref`, not a date, and no `era` field at all.
- The plan said "6,581 questions." `allItems()` currently generates 6,282.
- **No cross-reference data exists anywhere in `src/data`** (confirmed by
  grep for `crossRef`/`cross-ref` across `src/`). The plan asked for
  cross-references "if present"; they are not present, so the index does
  not invent any, and `verify.ts` does not check for them.
- Chapter counts exist (`Book.chapters`), but there is no verse-count data
  anywhere, so a reference like `Romans 8:28` can be checked down to the
  chapter and no further.

All of this is also written into `hackathon/out/index.json` itself, under
`meta.notes`, so it travels with the data rather than living only here.

## The four-layer person/event picture

There isn't one flat "people in this book" list; there are four data
sources at different granularities, and the index reconciles them rather
than picking one and silently dropping the others:

1. `PEOPLE[i].book`: a person's single *primary* book (257 people).
2. `BookDetail.figures[].name`: who has a speaking role in a specific book,
   independent of their primary book (389 entries, not 389 distinct people;
   Paul alone accounts for roughly a dozen of them, one per epistle).
3. `DetailEvent.who[]`: who's present in a specific narrative episode.
4. `Book.keyPeople[]`: the book's own headline-figure list.

`hackathon/index.ts` builds each `PEOPLE` entry's `booksAppearing` from all
four, so "is Paul in Colossians" resolves correctly even though Paul's
primary book is Acts (his first pass, using only sources 2 and 3, still
missed Colossians and Titus; adding source 4 closed both gaps). It does
**not** add new people to the roster from (2), (3), or (4): a name that only
ever shows up as a `Figure`, in `who[]`, or in `keyPeople` and never has its
own entry in `PEOPLE` stays unindexed as a person. That distinction produced
a real, unforced finding during testing (see "A genuine catch" below), not a
hypothetical one.

## Files

- `hackathon/index-types.ts`: the shape of the built index (`BuiltIndex`
  and friends). Shared by the three scripts below; only `index.ts` imports
  from `src/data`.
- `hackathon/index.ts`: reads `src/data/*`, builds the index, writes
  `hackathon/out/index.json`. Run with `npm run hackathon:index`.
- `hackathon/schema.ts`: the study-plan schema (`StudyPlan`, `PlanItem`):
  `type: 'reading' | 'memory' | 'question'`, a `reference` string, optional
  `people` / `events` / `terms` / `era` claims.
- `hackathon/verify.ts`: the checks, as a library with no side effects on
  import. `generate.ts` calls `verifyPlan` on every repair round.
- `hackathon/verify-cli.ts`: the command line front end for the above. Run
  with `npm run hackathon:verify` (verifies the fixture) or
  `npm run hackathon:verify -- <path-to-plan.json>` for any other plan.
- `hackathon/evidence.ts`: builds the slice of the index a generator is
  allowed to draw on for one goal: that book's chapters, landmark verses,
  episodes, terms, people and eras, copied verbatim.
- `hackathon/llm.ts`: the model client, behind an interface, with a
  record/replay mode. `AnthropicLlm` calls Claude and writes every response
  to `fixtures/llm/`; `ReplayLlm` serves those back with no key and no
  network. Replay is the default.
- `hackathon/generate.ts`: the generator agent. Evidence pack in, plan out,
  verified every round, failing items sent back for repair, and anything
  still failing dropped rather than shipped.
- `hackathon/generate-cli.ts`: the command line front end for the above.
  `npm run hackathon:generate -- "<goal>"`.
- `hackathon/report.ts`: renders `out/verify-report.json` (plus the
  generator's trace, when there is one) into a single self-contained
  `out/report.html`. The demo surface: a judge sees the pass rate, then opens
  an item and reads the exact check that rejected it. No external assets, no
  network.
- `hackathon/selftest.ts`: drives the whole loop with a scripted stand-in
  for the model, so the repair-and-drop behaviour is proved without a key.
  `npm run hackathon:selftest`.
- `hackathon/generate-stub.ts`: a **deterministic, non-LLM** plan builder,
  kept as the zero-dependency demo path. Builds a plan for a goal string
  straight out of the index. Run with
  `vite-node hackathon/generate-stub.ts "<goal>"`.
- `hackathon/fixtures/plan-with-errors.json`: a hand-authored plan with one
  deliberate error per check kind, plus two clean items, so the verifier's
  output is legible on its own.
- `hackathon/out/`: generated, gitignored. `index.json`, `plan.json`,
  `verify-report.json`.

## What `verify.ts` checks, and what it reports

Ten check kinds. Each category splits into "does this exist at all" and
"does it exist *here*", because the second question is the one a plausible
invention fails:

| Check | Fires when |
|---|---|
| `reference-not-found` | the reference's book text doesn't match any of the 66 books (by id, name, or abbreviation, including "1 Corinthians" / "I Corinthians" / "First Corinthians" style numbering) |
| `chapter-out-of-range` | the book matched, but the chapter number is outside `1..Book.chapters` |
| `person-unknown` | a named person isn't in the 257-person roster at all |
| `person-not-in-book` | the person is known, but not in this book (checked against the reconciled `booksAppearing` set, not just the primary book) |
| `person-not-in-chapter` | the person is in the book, and an episode places them in the chapter the reference names |
| `event-unknown` | a named event doesn't match a dated `TimelineEvent` or a narrative `DetailEvent` |
| `event-not-in-era` | the event is known, but its era doesn't match the item's claimed era |
| `event-not-in-chapter` | the episode is real and in the right book, but anchored to a different chapter than the reference |
| `term-unknown` | a named term doesn't match any indexed term |
| `term-not-in-book` | the term is real, but indexed under other books than the one in the reference |

The last four arrived after an audit described below, which is the
honest order of events: the first six were what the entry plan asked for,
and they were not enough.

There's an eighth outcome that is neither pass nor fail: **`unverifiable`**.
16 books have no entry in any `ERAS[].books` list (computed by
`hackathon/index.ts`, not hand-typed, and written to
`meta.booksWithoutEra`): `1-chronicles`, `2-corinthians`, `ephesians`,
`philippians`, `colossians`, `1-thessalonians`, `2-thessalonians`,
`1-timothy`, `2-timothy`, `titus`, `philemon`, `2-peter`, `1-john`,
`2-john`, `3-john`, `jude`. An era claim tied to an event in one of these
books can't be confirmed *or* denied from this data, and the verifier says
so explicitly instead of guessing either way. That distinction ("I can't
check this" vs. "this is wrong") is part of the trust surface the entry
plan asks for, not an edge case to hide.

## We tried to fool it, and did

A verifier nobody has attacked is a claim, not a guarantee. So before
saying any of this works, here is a plan of seven items where six make a
false claim, written to target the specific shape of each check rather
than to be obviously wrong:
`hackathon/fixtures/plan-that-slips-through.json`, run with
`npm run hackathon:audit`.

**All seven passed.** That is what the first version of this verifier did
with a plan that was almost entirely false, and it is exactly what a judge
would have found in two minutes:

| The claim | Why it slipped | Now |
|---|---|---|
| `Romans 8:999` | verse numbers were parsed and thrown away; only the chapter was bounded | reported `unverifiable`, with the reason |
| `Romans 3:23-400` | same | reported `unverifiable` |
| Romans 5, key term "I AM sayings" | the term is real, indexed under John; the check asked only whether it existed | **fails**, `term-not-in-book` |
| Romans 12, event "Abraham justified by faith" | the episode is real and in Romans; nothing compared its chapter (4) to the reference | **fails**, `event-not-in-chapter` |
| Romans 16, person "Adam" | `booksAppearing` is the finest grain the people index has | `unverifiable`, naming the chapter Adam *is* placed in |
| A title saying Romans 9 is Paul's shipwreck on Malta | titles are free text and nothing reads them | still passes, see below |

Two of the six are now hard failures. Two are reported as unverifiable
with the specific reason, which is worth more than it sounds: a silent
pass tells a reader "checked, fine" about something never looked at, and
that is the failure mode the whole entry exists to attack. One names
where the person actually appears, which is enough for a generator to fix
itself.

### The limit, stated rather than hidden

**Prose is not checked, and cannot be from this data.** `title` and `note`
are free text. An item can carry a perfectly true reference, a real
person, a real term, and a sentence claiming Romans 9 covers a shipwreck,
and every check will pass. Verse numbers have the same shape of problem
for a different reason: `src/data` records chapter counts per book and
nothing finer, so no verse number can be bounded, which is why those
report as unverifiable rather than pass.

What the verifier actually guarantees is narrower than "this plan is
true", and saying so precisely is the point: **every structured claim an
item makes is one the app's own data supports, and anything that could
not be checked is named.** Closing the prose gap needs either verse-level
data or a second model pass judging the sentence against the item's
own structured fields. Neither is built.

## Run it

From the repo root, in this worktree:

```
npm run hackathon:index      # build hackathon/out/index.json from src/data
npm run hackathon:verify     # verify hackathon/fixtures/plan-with-errors.json
npm run hackathon:demo       # index -> stub generator -> verify, end to end
npm run hackathon:selftest   # prove the generate/verify/repair loop, no key needed
npm run hackathon:report     # render out/report.html from the last verify run
npm run hackathon:audit      # run the adversarial fixture (see "We tried to fool it")
npm run hackathon:generate -- "understand Romans in 6 weeks"   # the real agent
npm run hackathon:check      # tsc --noEmit over hackathon/, strict
```

### The generator agent, and what it needs

`hackathon:generate` runs the loop the entry is about: build an evidence
pack for the goal, ask Claude for a plan with the schema enforced by the
API, verify every item against the index, hand the failures back with the
exact check that broke, and drop anything that still fails after two
repairs. It writes `out/plan.json` and `out/generate-trace.json`, the second
of which is the round-by-round record a judge can read.

It needs one of two things to run:

- **Credentials.** `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`, or an
  `ant auth login` profile) plus `npm i @anthropic-ai/sdk`. The SDK is
  imported dynamically and is deliberately not a dependency of this fork,
  so the app's own build is untouched. A live run records every response
  into `fixtures/llm/`.
- **A recording.** With no credentials the client defaults to replay and
  serves those recordings. There are none committed yet, because this
  machine has no key: the first person with one records them by running
  `LLM_MODE=live npm run hackathon:generate -- "<goal>"` once.

Replay is the default on purpose. A demo that depends on conference wifi
and a key being present is a demo that fails in the room, and replay also
makes the run deterministic, so the plan shown on stage is the plan that was
rehearsed.

`npm run hackathon:selftest` needs neither, and is the honest answer to "does
the loop actually do anything". It drives `generatePlan` with a scripted
stand-in that returns two true items and two invented ones, corrects one of
the invented pair on the first repair, and leaves the other wrong forever.
It asserts that exactly the three verifiable items ship, that the one that
never verified is dropped and listed, and that a repaired item replaces its
failed version rather than joining it. That stand-in is a test double, not a
recorded model response, and is not presented as one.

### Verifying the fixture (deliberate errors)

`npm run hackathon:verify` checks `hackathon/fixtures/plan-with-errors.json`:
ten items, one deliberate error of each kind plus two clean items and one
deliberately unverifiable claim. Real output:

```
Verifying plan: "understand Romans in 6 weeks (fixture with deliberate errors)"
3/10 items passed all checks

  PASS  w1-r1  [reading]  Romans 1
  FAIL  w1-r2  [reading]  Hezekiah's Diary 3
          fail: reference-not-found: "Hezekiah's Diary" does not match any of the 66 books
  FAIL  w1-r3  [reading]  Romans 20
          fail: chapter-out-of-range: Romans has 16 chapters; "Romans 20" asks for 20
  FAIL  w2-m1  [memory]  Romans 8:28
          fail: person-unknown: "Jonah the Prophet" is not in the 257-person index
  FAIL  w2-q1  [question]  Romans 5
          fail: person-not-in-book: Hezekiah's known books are [2-chronicles, 2-kings, isaiah, micah], not Romans
  FAIL  w3-r1  [reading]  Romans 9
          fail: event-unknown: "Council of Trent" does not match any dated event or narrative episode
  FAIL  w3-q1  [question]  Acts 7
          fail: event-not-in-era: "Stephen martyred" belongs to era "church", not "patriarchs"
  PASS  w4-m1  [memory]  Ephesians 2:8-9
          note: unverifiable: "By grace through faith" (ephesians 2): its book has no era assignment in timeline.ts, so the "church" claim cannot be checked
  FAIL  w4-q1  [question]  Romans 8
          fail: term-unknown: "Sanctification via Osmosis" does not match any indexed term
  PASS  w5-r1  [reading]  Genesis 22
```

Every deliberate error is caught with the specific check that failed. The
`unverifiable` item passes (it isn't wrong, it's just unconfirmable) but
still surfaces a note: exactly the "click an item, see what was checked"
behavior the entry plan's trust surface calls for.

### A genuine catch, not a scripted one

`npm run hackathon:demo` runs the deterministic stub generator against
"understand Romans in 6 weeks" (no hand-authored errors, every item built
straight from index entries) and then verifies the result. 19 of 20 items
pass. The one failure is real, not staged:

```
  FAIL  romans-r11  [reading]  Romans 16
          fail: person-unknown: "Phoebe" is not in the 257-person index
          fail: person-unknown: "Priscilla" is not in the 257-person index
          fail: person-unknown: "Aquila" is not in the 257-person index
          fail: person-unknown: "Tertius" is not in the 257-person index
```

The Romans 16 episode's `who[]` (from `src/data/details/pauline.ts`) names
four people who are genuinely mentioned in that chapter, but none of them
have their own entry in `PEOPLE`. `PEOPLE` has 257 entries; the per-book
figures list has 389 entries that are not 389 distinct people (Paul alone
accounts for roughly a dozen), and Phoebe, Priscilla, Aquila, and Tertius
simply never made it into `PEOPLE` at all. Grounding a generator in the
index does not automatically mean every
detail it touches is fully checkable; it means the verifier can tell you
precisely which detail isn't, instead of the whole item silently reading as
fine. That is the actual argument for building the verifier as an
independent pass over structured data rather than folding it into
generation.

## What remains for the real hackathon entry

This directory is the prerequisite, not the entry. Still open, per the entry
plan:

1. **Recording the generator's fixtures.** The agent itself is built
   (`generate.ts`), type-checks, and its loop is proved by
   `npm run hackathon:selftest`. What is missing is a single live run: this
   machine has no Anthropic credentials, so no real model response has ever
   been recorded and `hackathon:generate` in its default replay mode has
   nothing to serve. One run with a key fills `fixtures/llm/` and the demo
   becomes self-contained.
2. **Wiring the trust surface into the app itself.** The standalone page is
   built (`npm run hackathon:report` writes `out/report.html`): pass rate,
   the round-by-round history when the LLM generator produced one, and every
   item expandable to the checks that ran on it, failures open by default.
   It is one file with no external assets, so it opens from a USB stick with
   the wifi down. What is not done is showing any of it *inside* Scripture
   Mastery next to a real plan, which is a decision about the fork's UI
   rather than about this directory.
3. **Judgement about what to do with a dropped item.** The loop currently
   drops anything that fails twice, which is the safe default but not always
   the right one: sometimes the honest move is a narrower item rather than
   no item. Deciding that per failure kind is open.
4. **Deciding whether Verse Mastery's spaced-repetition/Speak mode plugs
   into the memory-work items**, per the plan's "if you have time on day
   two" note. Not started.
