/**
 * Shape of `hackathon/out/index.json`. Shared by the index builder, the
 * verifier, and the stub generator so all three agree on the file without
 * any of them (other than `index.ts`) importing from `src/data`.
 */

export interface IndexBook {
  id: string;
  name: string;
  abbr: string;
  order: number;
  testament: 'OT' | 'NT';
  division: string;
  chapters: number;
  era: string;
  /** Normalized forms ("romans", "rom", "1 corinthians", "i corinthians", ...) for matching a reference string's book. */
  aliases: string[];
}

export interface IndexEra {
  id: string;
  name: string;
  span: string;
  seq: number;
  books: string[];
}

export interface IndexPerson {
  id: string;
  name: string;
  aliases: string[];
  /** Primary book, from PEOPLE. */
  primaryBook: string;
  era: string;
  /** Primary book plus every book whose detail entry names this person as a figure or a participant in an episode. */
  booksAppearing: string[];
}

export interface DatedEvent {
  id: string;
  label: string;
  /** Negative = BC. */
  year: number;
  when: string;
  era: string;
}

export interface EpisodeEvent {
  book: string;
  /** Chapter or chapter range within `book`, e.g. "22" or "6-9". Not a calendar date. */
  ref: string;
  name: string;
  who: string[];
  /** Era ids this episode's book belongs to, per ERAS[].books. Empty when the book has no era assignment. */
  candidateEras: string[];
}

export interface IndexTerm {
  key: string;
  term: string;
  books: string[];
}

export interface LandmarkVerse {
  book: string;
  /** Full reference string, e.g. "Romans 8:28" (already in the form verify.ts parses). */
  ref: string;
  text: string;
}

export interface BuiltIndex {
  meta: {
    generatedAt: string;
    counts: Record<string, number>;
    /** Book ids with no entry in any ERAS[].books list; era claims against these are unverifiable. */
    booksWithoutEra: string[];
    notes: string[];
  };
  books: IndexBook[];
  eras: IndexEra[];
  people: IndexPerson[];
  events: {
    dated: DatedEvent[];
    episodes: EpisodeEvent[];
  };
  terms: IndexTerm[];
  verses: LandmarkVerse[];
}
