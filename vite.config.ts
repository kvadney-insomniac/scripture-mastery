import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Set by `npm run dev:e2e`, which is all Playwright ever starts. */
const isE2E = process.env.E2E === '1';

/**
 * Set by `npm run build:solo` — a self-hosted build with no backend.
 *
 * The app normally needs a Firebase project: Google sign-in restricted to two
 * domains, and Firestore for the store. That is right for the shared
 * deployment and wrong for a personal copy, which would otherwise need its own
 * cloud project, its own credentials in CI, and a billing account to keep them.
 *
 * Solo reuses the stand-ins Playwright already drives, because they are not a
 * mock: the transport changes from Firestore to localStorage and nothing else
 * does. Every transition still runs through store-ops, which is the same code
 * the Firestore hook runs, so grading, logging and the exam clamp behave
 * identically. What it costs is sync — progress lives in one browser, which is
 * why the Progress tab's export exists and why the banner says so.
 */
const isSolo = process.env.SOLO === '1';

/**
 * Swaps the Firestore-backed store and the Firebase entry point for their
 * localStorage stand-ins, so Playwright can drive the whole app without an
 * auth popup or an emulator.
 *
 * It matches on the *resolved* file rather than the import specifier, so it
 * catches './lib/useStore' and '../lib/useStore' alike and cannot be defeated
 * by a future file moving a directory. Active under E2E=1 and SOLO=1; the
 * shared Firestore build loads neither, so the stand-ins cannot reach the
 * members of that deployment.
 */
function e2eStandIns(): Plugin {
  const standIn = (name: string) =>
    fileURLToPath(new URL(`./src/lib/${name}.e2e.ts`, import.meta.url));
  const swaps: Record<string, string> = {
    '/src/lib/useStore.ts': standIn('useStore'),
    '/src/lib/firebase.ts': standIn('firebase'),
  };

  return {
    name: 'e2e-stand-ins',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || source.includes('.e2e')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      const hit = Object.keys(swaps).find((suffix) => resolved.id.endsWith(suffix));
      return hit ? swaps[hit] : null;
    },
  };
}

export default defineConfig({
  plugins: [react(), ...(isE2E || isSolo ? [e2eStandIns()] : [])],
  // Relative, so the same build works at a domain root and under the
  // /<repo>/ path GitHub Pages serves a project site from.
  base: './',
  define: { __SOLO__: JSON.stringify(isSolo) },
  server: { port: 5173, open: !isE2E },
});
