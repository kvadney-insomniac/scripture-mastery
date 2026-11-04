/**
 * Records the Berean Standard Bible text of every verse the item bank quotes,
 * so `npm run validate` can hold each quotation to the BSB's own words.
 *
 * The BSB is public domain (berean.bible/terms.htm, dedicated 2023-04-30), so
 * the verses can be committed. Only the cited verses are kept, not the Bible.
 *
 * Run: npx vite-node scripts/cite-bsb.ts <path to BSB.json>
 * BSB.json is scrollmapper/bible_databases formats/json/BSB.json, the same file
 * VadneyK/chapter-and-verse commits under sources/.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { BOOKS } from '../src/data/books';
import { DETAILS } from '../src/data/details';
import { resolveRef, type BsbFile } from './bsb-ref';

const src = process.argv[2];
if (!src) {
  console.error('usage: vite-node scripts/cite-bsb.ts <BSB.json>');
  process.exit(1);
}
const raw = readFileSync(src);
const bsb: BsbFile = JSON.parse(raw.toString('utf8'));

const refs = new Set<string>();
for (const b of BOOKS) if (b.keyVerse) refs.add(b.keyVerse.ref);
for (const d of DETAILS) for (const v of d.verses ?? []) refs.add(v.ref);

const verses: Record<string, string> = {};
const missing: string[] = [];
for (const ref of [...refs].sort()) {
  const text = resolveRef(bsb, ref);
  if (text == null) missing.push(ref);
  else verses[ref] = text;
}
if (missing.length) {
  console.error(`cannot resolve: ${missing.join(', ')}`);
  process.exit(1);
}

const out = {
  translation: 'Berean Standard Bible (BSB), public domain since 2023-04-30',
  source: 'https://github.com/scrollmapper/bible_databases (formats/json/BSB.json)',
  sha256: createHash('sha256').update(raw).digest('hex'),
  verses,
};
writeFileSync(new URL('./bsb-cited-verses.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`wrote scripts/bsb-cited-verses.json: ${Object.keys(verses).length} references`);
