/**
 * buildQueue does two separable jobs, and #11 changed only the second.
 *
 * Selecting *which* cards a session holds must stay deterministic and
 * priority-ordered — most overdue first, capped by the limits — because that
 * is what makes a truncated session the right session. Presenting them is now
 * shuffled, so you stop learning the sequence instead of the answers.
 *
 * These run in Node against the real scheduler, so a regression in either half
 * says so directly rather than as a puzzling UI failure.
 */
import { expect, test } from '@playwright/test';
import { allItems, ITEMS_BY_ID } from '../../src/lib/generate';
import { buildQueue, grade, newCard, strength, type CardState, type ItemMeta } from '../../src/lib/srs';

const DAY = 86_400_000;

/** A card in rotation, `overdueDays` past its due date. */
function seen(id: string, overdueDays: number): CardState {
  return {
    id,
    ease: 2.5,
    interval: 1,
    reps: 2,
    lapses: 0,
    due: Date.now() - overdueDays * DAY,
    lastSeen: Date.now() - (overdueDays + 1) * DAY,
    recent: [2, 2],
  };
}

function deck(n: number, from = 0): { ids: string[]; cards: Record<string, CardState> } {
  const ids = Array.from({ length: n }, (_, i) => `card-${from + i}`);
  const cards: Record<string, CardState> = {};
  // Descending overdue-ness, so card-0 is the most urgent.
  ids.forEach((id, i) => { cards[id] = seen(id, n - i); });
  return { ids, cards };
}

const NO_NEW = { newLimit: 0, sessionLimit: 100 };

test.describe('review queue', () => {
  test('presentation order is shuffled between sessions', () => {
    const { ids, cards } = deck(30);
    const runs = Array.from({ length: 8 }, () => buildQueue(ids, cards, NO_NEW).join(','));

    // With 30 cards the odds of two honest shuffles matching are 1/30!, so a
    // single repeat across eight runs means the order is not being shuffled.
    expect(new Set(runs).size, 'buildQueue returned the same order twice').toBe(runs.length);
  });

  test('shuffling does not lose, duplicate, or invent a card', () => {
    const { ids, cards } = deck(30);
    const q = buildQueue(ids, cards, NO_NEW);

    expect(q).toHaveLength(ids.length);
    expect(new Set(q).size).toBe(ids.length);
    expect([...q].sort()).toEqual([...ids].sort());
  });

  test('a truncated session still takes the most overdue cards', () => {
    // The selection half must survive the shuffle: cutting to 5 has to keep
    // the five most urgent cards, whatever order they are then asked in.
    const { ids, cards } = deck(20);
    const q = buildQueue(ids, cards, { newLimit: 0, sessionLimit: 5 });

    expect(q).toHaveLength(5);
    expect([...q].sort()).toEqual(['card-0', 'card-1', 'card-2', 'card-3', 'card-4']);
  });

  /**
   * The same rule, against the shape the real bank actually has (#41).
   *
   * The synthetic deck above cannot catch the bug this guards: its ids are
   * `card-0`, `card-1`… and the spreading step keys on the first two
   * id segments, so every card became its own bucket and round-robin trivially
   * preserved the urgency order. The real bank is the opposite shape — 6,098
   * items across a few dozen id families like `gen-position` and `det-ev`,
   * each spanning the whole canon — so the round-robin gave a family holding
   * two due cards the same share as one holding nine hundred. Because the
   * session cut ran *after* that, the spreading step was silently deciding
   * which cards survived it, and the most overdue routinely lost.
   */
  test('a real backlog still yields the most overdue cards, spread across books', () => {
    const items = allItems();
    const meta: Record<string, ItemMeta> = {};
    for (const i of items) meta[i.id] = { tier: i.tier, book: i.book };

    // 3,000 cards in rotation, overdue by amounts that do not follow bank order.
    const now = Date.now();
    const cards: Record<string, CardState> = {};
    items.slice(0, 3000).forEach((it, n) => {
      cards[it.id] = {
        id: it.id, ease: 2.5, interval: 1, reps: 3, lapses: 0,
        due: now - ((n * 7919) % 600) * DAY, lastSeen: now - DAY, recent: [2, 2],
      };
    });

    const limit = 60;
    const q = buildQueue(items.map((i) => i.id), cards, {
      newLimit: 0, sessionLimit: limit, difficulty: 'medium', meta, seed: 'fixed',
    }, now);

    const mostOverdue = new Set(
      Object.values(cards).sort((a, b) => a.due - b.due).slice(0, limit).map((c) => c.id),
    );
    expect(q).toHaveLength(limit);
    expect(q.filter((id) => mostOverdue.has(id))).toHaveLength(limit);

    // And still spread: taking the most urgent must not mean taking one book.
    const books = new Set(q.map((id) => ITEMS_BY_ID.get(id)!.book ?? '-'));
    expect(books.size).toBeGreaterThan(5);
  });

  test('new cards are still capped by the new-card limit', () => {
    const { ids: dueIds, cards } = deck(3);
    const freshIds = Array.from({ length: 10 }, (_, i) => `fresh-${i}`);

    const q = buildQueue([...dueIds, ...freshIds], cards, { newLimit: 2, sessionLimit: 100 });

    expect(q.filter((id) => id.startsWith('fresh-'))).toHaveLength(2);
    expect(q.filter((id) => id.startsWith('card-'))).toHaveLength(3);
  });

  /**
   * Mastery must not fall as the quiz approaches (#42).
   *
   * A quarter of the score rides on interval length, because surviving a long
   * gap is evidence you know something. But `grade` clamps every interval to
   * half the time remaining, so nothing is scheduled past the quiz unreviewed —
   * and inside the last four weeks that clamp sits below the fourteen days a
   * full durability score wanted. The two rules fought and the clamp won, so a
   * card answered perfectly every time read 100% at thirty days out and 79% at
   * three, having got no worse — only closer. Exactly when someone is most
   * likely to look, and least in need of being told their work is decaying.
   */
  test('a perfectly known card does not lose mastery as the quiz nears', () => {
    const now = Date.now();
    const readings = [90, 30, 14, 7, 3, 1].map((daysLeft) => {
      const exam = now + daysLeft * DAY;
      let card = newCard('x');
      // Ten flawless reviews, all in the past, so `now` never passes the exam.
      for (let i = 0; i < 10; i++) card = grade(card, 3, exam, now - (10 - i) * DAY);
      return strength(card, { examTime: exam, now });
    });

    // Full marks throughout, and — the part that regressed — never declining.
    for (const s of readings) expect(s).toBeCloseTo(1, 5);
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i], `mastery fell between readings ${i - 1} and ${i}`)
        .toBeGreaterThanOrEqual(readings[i - 1]! - 1e-9);
    }
  });

  test('a shaky card still scores below a solid one', () => {
    // The fix must not flatten the scale into "everything is 100%".
    const now = Date.now();
    const exam = now + 3 * DAY;
    let solid = newCard('good');
    let shaky = newCard('bad');
    for (let i = 0; i < 6; i++) {
      solid = grade(solid, 3, exam, now - (6 - i) * DAY);
      shaky = grade(shaky, i % 2 === 0 ? 0 : 1, exam, now - (6 - i) * DAY);
    }
    expect(strength(shaky, { examTime: exam, now }))
      .toBeLessThan(strength(solid, { examTime: exam, now }));
  });

  test('a card that is not yet due stays out of the queue', () => {
    const cards: Record<string, CardState> = {
      early: { ...seen('early', 1), due: Date.now() + 5 * DAY },
      ready: seen('ready', 1),
    };

    expect(buildQueue(['early', 'ready'], cards, NO_NEW)).toEqual(['ready']);
  });
});
