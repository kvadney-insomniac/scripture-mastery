/**
 * Study-plan schema, shared by the stub generator and the verifier.
 *
 * This is intentionally small. A real generator agent will produce items in
 * this shape (or something the caller adapts into it); the verifier's job is
 * to check the claims an item makes against `hackathon/out/index.json`, not
 * to understand a plan's prose.
 */

export type PlanItemType = 'reading' | 'memory' | 'question';

export interface PlanItem {
  /** Stable id within the plan, e.g. "w1-r1". */
  id: string;
  type: PlanItemType;
  /** Which week of the plan this falls in, 1-based. */
  week: number;
  /** Short label shown to the learner. */
  title: string;
  /**
   * A scripture reference string, e.g. "Romans 8", "Romans 8:28",
   * "Genesis 22:1-19", or "1 Corinthians 13:1-13". Chapter and verse ranges
   * are optional; a bare book name is a valid reference.
   */
  reference: string;
  /** Names of people the item claims are relevant, checked against PEOPLE. */
  people?: string[];
  /**
   * Names of events the item claims are relevant, checked against both the
   * dated timeline and the per-book narrative episodes.
   */
  events?: string[];
  /** Key terms the item claims are relevant, checked against book terms. */
  terms?: string[];
  /**
   * An era id or name the item claims the reference belongs to
   * (e.g. "church", "The Early Church"). Only checked when at least one
   * event is also named, since era membership is verified per event.
   */
  era?: string;
  /** Free-text note, not verified. */
  note?: string;
}

export interface StudyPlan {
  goal: string;
  weeks: number;
  generatedBy: string;
  items: PlanItem[];
}
