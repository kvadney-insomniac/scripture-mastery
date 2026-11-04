/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  /** Footer links; empty or unset hides each one. */
  readonly VITE_FEEDBACK_URL?: string;
  readonly VITE_HELP_CONTACT?: string;
  readonly VITE_ABOUT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** True in a `build:solo` bundle — no backend, store in localStorage. */
declare const __SOLO__: boolean;
