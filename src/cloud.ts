// Cloud backup of a project — Firebase (anonymous Auth + Firestore) behind a
// tiny save/load/list API.
//
// The Firebase SDK is loaded with dynamic import() so it lands in its own
// chunk: the main bundle stays small and unit tests never load it or touch the
// network (only the pure helpers below are tested).
//
// apiKey / authDomain / projectId are PUBLIC identifiers — every Firebase web
// app ships them in its bundle. They are not credentials. What protects the
// data is the Firestore security rules (CLOUD_RULES), which scope every
// document to the signed-in uid; they must be pasted into the Firebase
// console before the first save.

import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
}

export interface CloudEntry {
  id: string;
  name: string;
  /** epoch ms of the save */
  savedAtMs: number;
  bytes: number;
  tags: number;
}

export interface CloudSaved {
  id: string;
  bytes: number;
}

/** Firestore doc size limit is 1 MB; stay under it with headroom. */
export const MAX_PAYLOAD_BYTES = 900_000;

const COL = 'staticsuite_projects';

/** One document per signed-in uid holding the API settings a device needs. */
const PREFS_COL = 'staticsuite_prefs';

/**
 * Firestore rules for both collections: a user may only ever read, write and
 * delete their own documents. Paste into Firebase console → Firestore
 * Database → Rules.
 */
export const CLOUD_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /${COL}/{docId} {
      allow read, delete: if request.auth != null
                          && resource.data.userId == request.auth.uid;
      allow create: if request.auth != null
                    && request.resource.data.userId == request.auth.uid;
      allow update: if request.auth != null
                    && resource.data.userId == request.auth.uid
                    && request.resource.data.userId == request.auth.uid;
    }
    // API settings (Gemini key + Firebase config) — one document per user,
    // its id IS the uid, so ownership needs no field check.
    match /${PREFS_COL}/{docId} {
      allow read, create, update, delete: if request.auth != null
                                          && request.auth.uid == docId;
    }
  }
}`;

/** The credentials a device needs: the Gemini key and the Firebase config. */
export interface ApiSettings {
  geminiKey?: string;
  firebaseConfig?: FirebaseConfig;
}

/** settings → Firestore document; only non-empty strings are written. */
export function buildApiSettingsDoc(api: ApiSettings, userId: string): Record<string, unknown> {
  const cfg = api.firebaseConfig;
  return {
    userId,
    updatedAtMs: Date.now(),
    ...(api.geminiKey ? { geminiKey: api.geminiKey } : {}),
    ...(cfg?.apiKey ? { apiKey: cfg.apiKey } : {}),
    ...(cfg?.authDomain ? { authDomain: cfg.authDomain } : {}),
    ...(cfg?.projectId ? { projectId: cfg.projectId } : {}),
  };
}

/** document → settings, ignoring anything malformed or empty. */
export function readApiSettingsDoc(data: unknown): ApiSettings {
  const o = (data ?? {}) as Record<string, unknown>;
  const s = (k: string): string | undefined => (typeof o[k] === 'string' && o[k] ? (o[k] as string) : undefined);
  const out: ApiSettings = {};
  const geminiKey = s('geminiKey');
  if (geminiKey) out.geminiKey = geminiKey;
  const apiKey = s('apiKey');
  const authDomain = s('authDomain');
  const projectId = s('projectId');
  if (apiKey && authDomain && projectId) out.firebaseConfig = { apiKey, authDomain, projectId };
  return out;
}

/**
 * Extract a Firebase web config from whatever the user pastes — the
 * `const firebaseConfig = {…}` snippet from the console, a bare JSON object,
 * or newline-separated `key: value` pairs.
 */
export function parseFirebaseConfig(text: string): FirebaseConfig | null {
  const src = (text ?? '').trim();
  if (!src) return null;
  const grab = (key: string): string | undefined => {
    const re = new RegExp(`${key}["']?\\s*[:=]\\s*["'\`]([^"'\`]+)["'\`]`);
    const m = src.match(re);
    const v = m?.[1]?.trim();
    return v && v.length > 0 ? v : undefined;
  };
  const apiKey = grab('apiKey');
  const authDomain = grab('authDomain');
  const projectId = grab('projectId');
  if (apiKey && authDomain && projectId) return { apiKey, authDomain, projectId };
  // bare JSON without quoted keys is rare, but a plain JSON object should work
  try {
    const o = JSON.parse(src) as Record<string, unknown>;
    const s = (k: string) => (typeof o[k] === 'string' && o[k] ? (o[k] as string) : undefined);
    const a = s('apiKey');
    const d = s('authDomain');
    const p = s('projectId');
    if (a && d && p) return { apiKey: a, authDomain: d, projectId: p };
  } catch {
    /* not JSON — the regex path already had its chance */
  }
  return null;
}

/** True when all three required values are present. */
export function isConfigured(cfg?: Partial<FirebaseConfig> | null): boolean {
  return Boolean(cfg?.apiKey && cfg?.authDomain && cfg?.projectId);
}

/** Firestore codes → a message a non-cloud user can act on. */
export function describeCloudError(code: string, message = ''): string {
  switch (code) {
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid':
      return 'That Firebase API key was rejected — check the apiKey value in Settings.';
    case 'auth/operation-not-allowed':
      return 'Anonymous sign-in is disabled for this project. Firebase console → Authentication → Sign-in method → enable Anonymous.';
    case 'auth/network-request-failed':
      return 'No network reaching Firebase — check the connection and try again.';
    case 'permission-denied':
      return 'Firestore denied the operation. Paste the security rules from Settings → Cloud into the Firebase console (Firestore → Rules) so each user can read and write only their own documents.';
    case 'failed-precondition':
      return 'This Firestore database does not exist yet — create it in the Firebase console (Firestore → Create database), then try again.';
    case 'unavailable':
      return 'Firebase is unreachable right now — try again in a moment.';
    case 'resource-exhausted':
      return 'Firebase quota exceeded — try again later.';
    case 'unauthenticated':
      return 'Not signed in to Firebase — press Connect again.';
    case 'payload-too-large':
      return `This project is larger than ${Math.round(MAX_PAYLOAD_BYTES / 1000)} KB, which exceeds a Firestore document. Export a project JSON instead (Settings → Data).`;
    default:
      if (!code) return message || 'Unknown cloud error.';
      return `${code}: ${message}`;
  }
}

// ---------------------------------------------------------------- runtime ---

interface CloudCtx {
  key: string;
  auth: Auth;
  db: Firestore;
}

let ctx: CloudCtx | null = null;

/** Initialise the SDK (once per config) and sign in anonymously. */
export async function connectCloud(cfg: FirebaseConfig): Promise<string> {
  const key = `${cfg.apiKey}|${cfg.authDomain}|${cfg.projectId}`;
  if (ctx && ctx.key === key && ctx.auth.currentUser) return ctx.auth.currentUser.uid;

  if (ctx && ctx.key !== key) {
    const { deleteApp } = await import('firebase/app');
    await deleteApp(ctx.auth.app).catch(() => undefined);
    ctx = null;
  }

  try {
    const { initializeApp } = await import('firebase/app');
    const { getAuth, signInAnonymously } = await import('firebase/auth');
    const { getFirestore } = await import('firebase/firestore');

    const app = initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId });
    const auth = getAuth(app);
    if (!auth.currentUser) await signInAnonymously(auth);
    ctx = { key, auth, db: getFirestore(app) };
    return auth.currentUser?.uid ?? '';
  } catch (e) {
    throw wrap(e);
  }
}

function errCode(e: unknown): string {
  return typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
}
/**
 * Turn a caught Firebase/Fetch error into a message the user can act on,
 * without losing the original error (it keeps its stack and cause chain).
 */
function wrap(e: unknown): Error {
  const err = e instanceof Error ? e : new Error(String(e));
  err.message = describeCloudError(errCode(e), err.message);
  return err;
}

function requireCtx(): CloudCtx {
  if (!ctx) throw new Error('Not connected to Firebase yet — press Connect in Settings → Cloud.');
  return ctx;
}

/** Save the project JSON under a name. Returns the generated document id. */
export async function cloudSave(opts: {
  name: string;
  payload: string;
  tags: number;
}): Promise<CloudSaved> {
  const { db, auth } = requireCtx();
  const bytes = new TextEncoder().encode(opts.payload).length;
  if (bytes > MAX_PAYLOAD_BYTES) throw new Error(describeCloudError('payload-too-large'));
  try {
    const { collection, addDoc } = await import('firebase/firestore');
    const ref = await addDoc(collection(db, COL), {
      userId: auth.currentUser?.uid ?? '',
      name: opts.name,
      savedAtMs: Date.now(),
      bytes,
      tags: opts.tags,
      payload: opts.payload,
    });
    return { id: ref.id, bytes };
  } catch (e) {
    throw wrap(e);
  }
}

/** List this user's saved projects, newest first. */
export async function cloudList(): Promise<CloudEntry[]> {
  const { db, auth } = requireCtx();
  try {
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    const uid = auth.currentUser?.uid ?? '';
    const snap = await getDocs(query(collection(db, COL), where('userId', '==', uid)));
    return snap.docs
      .map((d) => {
        const v = d.data() as { name?: string; savedAtMs?: number; bytes?: number; tags?: number };
        return {
          id: d.id,
          name: typeof v.name === 'string' ? v.name : 'Untitled',
          savedAtMs: typeof v.savedAtMs === 'number' ? v.savedAtMs : 0,
          bytes: typeof v.bytes === 'number' ? v.bytes : 0,
          tags: typeof v.tags === 'number' ? v.tags : 0,
        };
      })
      .sort((a, b) => b.savedAtMs - a.savedAtMs);
  } catch (e) {
    throw wrap(e);
  }
}

/** Read a saved project's JSON payload. */
export async function cloudLoad(id: string): Promise<string> {
  const { db } = requireCtx();
  try {
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, COL, id));
    const payload = snap.data()?.payload;
    if (typeof payload !== 'string') throw new Error('That saved project no longer exists.');
    return payload;
  } catch (e) {
    throw wrap(e);
  }
}

/** Delete a saved project. */
export async function cloudDelete(id: string): Promise<void> {
  const { db } = requireCtx();
  try {
    const { doc, deleteDoc } = await import('firebase/firestore');
    await deleteDoc(doc(db, COL, id));
  } catch (e) {
    throw wrap(e);
  }
}

/** Save the API settings under the signed-in uid (overwrites the previous copy). */
export async function cloudSaveApiSettings(api: ApiSettings): Promise<void> {
  const { db, auth } = requireCtx();
  try {
    const { doc, setDoc } = await import('firebase/firestore');
    const uid = auth.currentUser?.uid ?? '';
    await setDoc(doc(db, PREFS_COL, uid), buildApiSettingsDoc(api, uid));
  } catch (e) {
    throw wrap(e);
  }
}

/** Read this user's saved API settings — null when none were saved yet. */
export async function cloudLoadApiSettings(): Promise<ApiSettings | null> {
  const { db, auth } = requireCtx();
  try {
    const { doc, getDoc } = await import('firebase/firestore');
    const uid = auth.currentUser?.uid ?? '';
    const snap = await getDoc(doc(db, PREFS_COL, uid));
    if (!snap.exists()) return null;
    return readApiSettingsDoc(snap.data());
  } catch (e) {
    throw wrap(e);
  }
}
