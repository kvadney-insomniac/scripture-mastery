/**
 * Every phrase the item bank puts in double quotes (straight or curly),
 * gathered from every string in the source data. Used by cite-bsb.ts to
 * record where each one comes from and by validate.ts to check it.
 */
import { BOOKS } from '../src/data/books';
import { DETAILS } from '../src/data/details';
import { ESSENTIALS, ESSENTIAL_ALIASES } from '../src/data/essentials';
import { AUTHORED, LISTS, LIST_DECOYS } from '../src/data/extras';
import { PEOPLE, PLACES } from '../src/data/people';
import { PHASES } from '../src/data/plan';
import { ERAS, EVENTS } from '../src/data/timeline';
import { TRACKS } from '../src/data/tracks';

const SOURCES: Record<string, unknown> = {
  BOOKS, DETAILS, ESSENTIALS, ESSENTIAL_ALIASES, AUTHORED, LISTS, LIST_DECOYS,
  PEOPLE, PLACES, PHASES, ERAS, EVENTS, TRACKS,
};

const QUOTED = /"([^"]{3,}?)"|“([^”]{3,}?)”/g;

export interface QuotedPhrase {
  phrase: string;
  /** Where it was found, as a path into the data: BOOKS[3].hook */
  where: string;
}

export function quotedPhrases(): QuotedPhrase[] {
  const out: QuotedPhrase[] = [];
  const walk = (v: unknown, where: string, key: string) => {
    if (typeof v === 'string') {
      // The structured key and landmark verses are checked at their reference.
      if (key === 'text' || key === 'ref') return;
      for (const m of v.matchAll(QUOTED)) out.push({ phrase: m[1] ?? m[2], where });
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${where}[${i}]`, key));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`, k);
    }
  };
  for (const [name, v] of Object.entries(SOURCES)) walk(v, name, '');
  return out;
}
