/**
 * Records the Berean Standard Bible text of every verse the item bank quotes,
 * so `npm run validate` can hold each quotation to the BSB's own words.
 *
 * It also records, for every phrase the data puts in quotation marks, the verse
 * span where that phrase is a run of BSB words (or, failing that, KJV words; the
 * KJV is public domain in the United States). A phrase found in neither, and not
 * listed in quoted-not-scripture.json, stops the run.
 *
 * The BSB is public domain (berean.bible/terms.htm, dedicated 2023-04-30), so
 * the verses can be committed. Only the cited verses are kept, not the Bible.
 *
 * Run: npx vite-node scripts/cite-bsb.ts <path to BSB.json> <path to KJV.json>
 * Both are scrollmapper/bible_databases formats/json/; BSB.json is the same file
 * VadneyK/chapter-and-verse commits under sources/.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { BOOKS } from '../src/data/books';
import { DETAILS } from '../src/data/details';
import { locateQuote, resolveRef, type BsbFile } from './bsb-ref';
import notScripture from './quoted-not-scripture.json';
import { quotedPhrases } from './quoted-phrases';

const src = process.argv[2];
const kjvSrc = process.argv[3];
if (!src || !kjvSrc) {
  console.error('usage: vite-node scripts/cite-bsb.ts <BSB.json> <KJV.json>');
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

// ------------------------------------------------------------ quoted phrases
const kjvRaw = readFileSync(kjvSrc);
const kjv: BsbFile = JSON.parse(kjvRaw.toString('utf8'));
const allowed = (notScripture as { phrases: Record<string, string> }).phrases;
const phrases: Record<string, { translation: 'BSB' | 'KJV'; ref: string; text: string }> = {};
const unknown = new Set<string>();
for (const { phrase } of quotedPhrases()) {
  if (phrase in allowed || phrase in phrases) continue;
  const inBsb = locateQuote(bsb, phrase);
  const hit = inBsb ? { translation: 'BSB' as const, ...inBsb } : (() => {
    const inKjv = locateQuote(kjv, phrase);
    return inKjv ? { translation: 'KJV' as const, ...inKjv } : null;
  })();
  if (hit) phrases[phrase] = hit;
  else unknown.add(phrase);
}
if (unknown.size) {
  console.error(`quoted phrases in neither the BSB nor the KJV:\n  ${[...unknown].join('\n  ')}`);
  process.exit(1);
}
const sorted = Object.fromEntries(Object.entries(phrases).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(
  new URL('./bsb-cited-phrases.json', import.meta.url),
  JSON.stringify(
    {
      translations: 'BSB (public domain since 2023-04-30) first; KJV (public domain in the US) where the phrase is KJV wording',
      sha256: {
        BSB: createHash('sha256').update(raw).digest('hex'),
        KJV: createHash('sha256').update(kjvRaw).digest('hex'),
      },
      phrases: sorted,
    },
    null,
    1,
  ) + '\n',
);
console.log(`wrote scripts/bsb-cited-phrases.json: ${Object.keys(sorted).length} phrases`);
