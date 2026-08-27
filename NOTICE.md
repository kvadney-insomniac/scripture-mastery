# Provenance and licensing

This repository is a fork of
[godwinlaw/scripture-mastery](https://github.com/godwinlaw/scripture-mastery),
maintained by Kentaro Vadney and deployed for personal study at
<https://kvadney-insomniac.github.io/scripture-mastery/> with the upstream
author's agreement.

## The upstream work is not licensed

The original repository carries no LICENSE file, which under copyright means
**all rights reserved** — not public domain, and not open source. Forking within
GitHub is permitted by their Terms of Service; redistributing, relicensing or
publishing derivatives is not, absent permission from the copyright holder.

That holder is the upstream author. This fork does not and cannot change it, and
no file here should be read as granting rights over their work.

**If you want to use this code, ask them.** A LICENSE file added upstream would
settle it for everyone, this fork included.

## Contributions made in this fork

The following were written for this fork and are offered by their author under
the MIT License, to the extent they are separable from the work they modify:

- the difficulty system — scoped option pools, per-tier option counts, the
  ordering guarantee that stops a harder tier rendering fewer choices, and the
  free-recall dial for name answers
- the study-plan integration — phase-scoped queues, the persisted plan anchor,
  and the rule that new material is rationed by phase while due cards are not
- the focus-track feature, including the 1 & 2 Samuel track and its content
- the solo build (`SOLO=1`) — a no-backend variant storing progress in the
  browser, and the GitHub Pages workflow that publishes it
- the correctness fixes recorded in CHANGELOG.md, and the tests covering all of
  the above

This offer covers those contributions alone. It does not extend to the
surrounding application, its structure, or the question bank it was built on,
none of which are this author's to license.

## Scripture text

Verse quotations throughout are **ESV**. The ESV is copyright Crossway and its
permissions policy limits how much may be quoted and requires written permission
for use in an application. That question is unresolved here and is not affected
by anything above — it is Crossway's to answer, not the upstream author's and
not this fork's.

A build using a public-domain translation would remove that constraint. It has
not been done.
