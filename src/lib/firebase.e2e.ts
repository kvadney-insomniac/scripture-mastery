/**
 * The E2E stand-in for ./firebase.
 *
 * Aliased over the real module only when vite runs with E2E=1 (see
 * vite.config.ts) — it is never part of a production bundle. Keeping Firebase
 * out of the E2E graph entirely means no SDK init, no IndexedDB cache, and no
 * network: sign-in is a localStorage write and a synchronous event.
 */
import { E2E_AUTH_KEY, e2eNotifyAuth } from './e2e-keys';

/** Kept in sync by hand with the copy enforced in firestore.rules. */
export const ALLOWED_DOMAINS = ['acts2.network', 'gpmail.org'];

/**
 * The identity a solo build studies as.
 *
 * A solo build has no Firebase project behind it, so there is no account to
 * belong to and nothing for a domain rule to protect — the store is this
 * browser's localStorage and nobody else can reach it. Gating it would be
 * theatre: a lock on a door with no room behind it.
 */
const SOLO_IDENTITY = 'you@localhost';

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (__SOLO__) return !!email;
  const domain = email?.split('@')[1]?.toLowerCase();
  return !!domain && ALLOWED_DOMAINS.includes(domain);
}

/**
 * Sign in without a popup, for solo builds only.
 *
 * Returns the identity so the caller can seed it on first load, which is what
 * removes the sign-in screen from a deployment that has nothing to sign in to.
 */
export function soloSignIn(): string {
  localStorage.setItem(E2E_AUTH_KEY, SOLO_IDENTITY);
  e2eNotifyAuth();
  return SOLO_IDENTITY;
}

/**
 * Stands in for the Google popup. A test decides the outcome up front by
 * seeding `e2e:next-sign-in` — an email to accept, or the literal `cancel` to
 * make the button reject the way a dismissed popup does.
 */
export async function signIn(): Promise<void> {
  if (__SOLO__) {
    soloSignIn();
    return;
  }
  const next = localStorage.getItem('e2e:next-sign-in') ?? 'member@acts2.network';
  if (next === 'cancel') {
    throw new Error('The sign-in popup was closed before completing.');
  }
  if (!isAllowedEmail(next)) {
    throw new Error(`Sign-in is restricted to ${ALLOWED_DOMAINS.join(' and ')} accounts.`);
  }
  localStorage.setItem(E2E_AUTH_KEY, next);
  e2eNotifyAuth();
}

export async function signOutUser(): Promise<void> {
  localStorage.removeItem(E2E_AUTH_KEY);
  e2eNotifyAuth();
}
