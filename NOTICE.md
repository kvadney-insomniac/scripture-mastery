# Provenance and licensing

This repository is a fork of
[godwinlaw/scripture-mastery](https://github.com/godwinlaw/scripture-mastery),
maintained by Kentaro Vadney. The public build is deployed at
<https://kvadney-insomniac.github.io/scripture-mastery/>.

## The code

The upstream author added an MIT License on 2026-08-28 (Copyright (c) 2026
Godwin Law). [LICENSE](LICENSE) in this repository is that license, copied
unchanged, and its notice must stay with any copy of this code.

An earlier version of this file, written on 2026-08-27, said the upstream work
carried no license. That was true the day it was written and stopped being true
the next day.

## Contributions made in this fork

The following were written for this fork and are offered by their author under
the same MIT License:

- the difficulty system: scoped option pools, per-tier option counts, the
  ordering guarantee that stops a harder tier rendering fewer choices, and the
  free-recall dial for name answers
- the study-plan integration: phase-scoped queues, the persisted plan anchor,
  and the rule that new material is rationed by phase while due cards are not
- the focus-track feature, including the 1 and 2 Samuel track and its content
- the solo build (`SOLO=1`): a no-backend variant storing progress in the
  browser, and the GitHub Pages workflow that publishes it
- the switch of every quotation to the Berean Standard Bible, and the
  `npm run validate` check that holds each one to the BSB's own words
- the correctness fixes recorded in CHANGELOG.md, and the tests covering all of
  the above

## Scripture text

Verse quotations are from the **Berean Standard Bible (BSB)**, which was
dedicated to the public domain on 2023-04-30 (berean.bible/terms.htm: "All uses
are freely permitted"). The BSB text of each cited verse is recorded in
`scripts/bsb-cited-verses.json`, taken from
[scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases),
with the SHA-256 of the file it was read from.

Quotations keep the BSB's words exactly. Where the BSB sets a phrase off with a
dash, the dash is shown as a comma (Numbers 14:34); the words are unchanged.

Earlier versions of this fork quoted the ESV, which is copyright Crossway and
needs Crossway's written permission for use in an application. No ESV text
remains in the key verses or landmark verses of this fork. Some short phrases
inside the summaries (events, terms, explanations) still follow ESV wording;
moving them to the BSB is the next change. Which text the upstream repository uses
is the upstream author's decision.

The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible
Hub, Discovery Bible, OpenBible.com, and the Berean Bible Translation Committee.
This text of God's Word has been dedicated to the public domain.
