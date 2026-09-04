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
- `hackathon/verify.ts`: loads `index.json` and a plan JSON file, checks
  every item, prints and writes a structured report. Run with
  `npm run hackathon:verify` (verifies the fixture) or
  `vite-node hackathon/verify.ts <path-to-plan.json>` for any other plan.
- `hackathon/generate-stub.ts`: a **deterministic, non-LLM** stand-in for
  the generator agent. Builds a plan for a goal string (e.g. "understand
  Romans in 6 weeks") straight out of the index. Run with
  `vite-node hackathon/generate-stub.ts "<goal>"`.
- `hackathon/fixtures/plan-with-errors.json`: a hand-authored plan with one
  deliberate error per check kind, plus two clean items, so the verifier's
  output is legible on its own.
- `hackathon/out/`: generated, gitignored. `index.json`, `plan.json`,
  `verify-report.json`.

## What `verify.ts` checks, and what it reports

Seven check kinds, covering the five failure categories the entry plan
named (a couple of the plan's categories split into a "does this exist at
all" check and a "does this exist here" check):

| Check | Fires when |
|---|---|
| `reference-not-found` | the reference's book text doesn't match any of the 66 books (by id, name, or abbreviation, including "1 Corinthians" / "I Corinthians" / "First Corinthians" style numbering) |
| `chapter-out-of-range` | the book matched, but the chapter number is outside `1..Book.chapters` |
| `person-unknown` | a named person isn't in the 257-person roster at all |
| `person-not-in-book` | the person is known, but not in this book (checked against the reconciled `booksAppearing` set, not just the primary book) |
| `event-unknown` | a named event doesn't match a dated `TimelineEvent` or a narrative `DetailEvent` |
| `event-not-in-era` | the event is known, but its era doesn't match the item's claimed era |
| `term-unknown` | a named term doesn't match any indexed term |

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

## Run it

From the repo root, in this worktree:

```
npm run hackathon:index      # build hackathon/out/index.json from src/data
npm run hackathon:verify     # verify hackathon/fixtures/plan-with-errors.json
npm run hackathon:demo       # index -> stub generator -> verify, end to end
npm run hackathon:check      # tsc --noEmit over hackathon/, strict
```

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

1. **An actual LLM generator agent.** `generate-stub.ts` has a marked hook
   where it plugs in: the function it currently fills in
   (`buildPlan()`) would be replaced by a call that still only cites what
   `index.json` contains, and whose output still goes through
   `verifyPlan()` from `verify.ts` before it ships. No SDK dependency has
   been added; that's a deliberate scope boundary for this prototype, not an
   oversight.
2. **The visible trust surface.** A UI that shows the pass rate, lets a
   judge click an item, and shows exactly which of the checks above ran and
   what each one found. `verify-report.json`'s shape
   (`VerifyReport` / `ItemReport` / `CheckResult` in `verify.ts`) is already
   structured for that; nothing about it assumes a terminal as the
   renderer.
3. **A regeneration loop.** The entry plan calls for failed items to be
   regenerated, not shipped. `verifyItem()` is already per-item, so a loop
   that re-prompts on `pass: false` and re-checks the new item is a small
   addition once (1) exists; it isn't built here.
4. **Deciding whether Verse Mastery's spaced-repetition/Speak mode plugs
   into the memory-work items**, per the plan's "if you have time on day
   two" note. Not started.
