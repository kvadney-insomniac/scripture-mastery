/**
 * Seeded selection, re-exported from `quiz-difficulty`.
 *
 * These four functions were written here and then extracted into a library,
 * because the reasoning behind them -- deterministic options so a regenerated
 * bank does not detach the review history keyed to it -- is not about scripture
 * and was worth stating once. They are re-exported rather than imported
 * directly at each call site so the swap stayed a one-file change, and so this
 * file remains the answer to "where does randomness come from here".
 *
 * `shuffle` below is deliberately NOT from the library: it is the one place the
 * app wants real randomness rather than reproducibility.
 */
export { hashString, mulberry32, seededShuffle, pickDistractors } from 'quiz-difficulty';

export function shuffle<T>(arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
