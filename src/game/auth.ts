/**
 * Player identity layer for SECTOR 09.
 *
 * - Always works: guest/callsign profiles persisted in localStorage.
 * - Optional live backends driven purely by env vars (no SDK required):
 *     Supabase : VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
 *     Firebase : VITE_FIREBASE_API_KEY (+ optional VITE_FIREBASE_DATABASE_URL
 *                or VITE_FIREBASE_PROJECT_ID for Realtime Database)
 * Email/password auth uses each provider's REST API directly; Google sign-in
 * uses the Supabase OAuth redirect when Supabase is configured.
 *
 * Persistence goes through CrazyGames SDK.data when running on the portal
 * (with automatic localStorage fallback — see crazygames.ts).
 */

import { cgSetItem } from './crazygames';
import type { MapId, WeaponId } from './types';

export type AuthMethod = 'guest' | 'email' | 'google' | 'firebase' | 'supabase';
export type BackendKind = 'none' | 'supabase' | 'firebase';
export type PlaystyleId = 'rusher' | 'marksman' | 'medic' | 'vehicle';

export interface PlayerProfile {
  /** Unique player id — provider uid when signed in, local id for guests. */
  id: string;
  callsign: string;
  /** 6-character code friends use to find/invite this player. */
  friendCode: string;
  method: AuthMethod;
  email?: string;
  /** Bearer/id token used to authenticate presence writes. */
  accessToken?: string;
  refreshToken?: string;
  backend: BackendKind;
  /** Manual cloud status — 'inactive' hides the player from matchmaking. */
  status?: 'active' | 'inactive';
  // ---- Operator profile details (mirrored to the cloud profile doc) ----
  fullName?: string;
  bio?: string;
  country?: string;
  avatarPreset?: string;
  favoriteWeapon?: WeaponId | 'any';
  favoriteMap?: MapId | 'any';
  playstyle?: PlaystyleId;
  level: number;
  kills: number;
  deaths: number;
  wins: number;
  matchesPlayed: number;
  createdAt: number;
}

export interface FriendEntry {
  friendCode: string;
  callsign: string;
  addedAt: number;
}

const PROFILE_KEY = 'strikegrid:profile';
const FRIENDS_KEY = 'strikegrid:friends';
const FRIEND_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateFriendCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += FRIEND_CODE_CHARS[Math.floor(Math.random() * FRIEND_CODE_CHARS.length)];
  }
  return code;
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Backend configuration
// ---------------------------------------------------------------------------

function env(key: string): string {
  try {
    return String((import.meta as unknown as { env?: Record<string, string> }).env?.[key] ?? '').trim();
  } catch {
    return '';
  }
}

export function getSupabaseConfig(): { url: string; anonKey: string } | null {
  const url = env('VITE_SUPABASE_URL').replace(/\/+$/, '');
  const anonKey = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function getFirebaseConfig(): {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  databaseURL: string;
} | null {
  const apiKey = env('VITE_FIREBASE_API_KEY');
  if (!apiKey) return null;
  const explicit = env('VITE_FIREBASE_DATABASE_URL');
  const projectId = env('VITE_FIREBASE_PROJECT_ID');
  const databaseURL = explicit || (projectId ? `https://${projectId}.firebaseio.com` : '');
  return {
    apiKey,
    authDomain: env('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId,
    appId: env('VITE_FIREBASE_APP_ID'),
    databaseURL,
  };
}

export function getBackendKind(): BackendKind {
  if (getSupabaseConfig()) return 'supabase';
  if (getFirebaseConfig()) return 'firebase';
  return 'none';
}

// ---------------------------------------------------------------------------
// Profile persistence
// ---------------------------------------------------------------------------

function readProfile(): PlayerProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PlayerProfile;
    if (!p || !p.id || !p.callsign) return null;
    return p;
  } catch {
    return null;
  }
}

function writeProfile(p: PlayerProfile): void {
  try {
    const raw = JSON.stringify(p);
    localStorage.setItem(PROFILE_KEY, raw);
    cgSetItem(PROFILE_KEY, raw);
  } catch {
    // storage unavailable — session-only profile
  }
}

export function sanitizeCallsign(input: string): string {
  const cleaned = input
    .toUpperCase()
    .replace(/[^A-Z0-9 _-]/g, '')
    .trim()
    .slice(0, 12);
  return cleaned || 'OPERATOR';
}

/** Returns the stored profile, lazily creating a guest profile on first run. */
export function getOrCreateProfile(callsign?: string): PlayerProfile {
  const existing = readProfile();
  if (existing) {
    if (callsign && sanitizeCallsign(callsign) !== existing.callsign && existing.method === 'guest') {
      existing.callsign = sanitizeCallsign(callsign);
      writeProfile(existing);
    }
    return existing;
  }
  const profile: PlayerProfile = {
    id: randomId('GUEST'),
    callsign: sanitizeCallsign(callsign ?? `OP-${Math.floor(1000 + Math.random() * 9000)}`),
    friendCode: generateFriendCode(),
    method: 'guest',
    backend: getBackendKind(),
    status: 'active',
    level: 1,
    kills: 0,
    deaths: 0,
    wins: 0,
    matchesPlayed: 0,
    createdAt: Date.now(),
  };
  writeProfile(profile);
  return profile;
}

export function updateProfile(patch: Partial<PlayerProfile>): PlayerProfile {
  const p = getOrCreateProfile();
  const next = { ...p, ...patch };
  writeProfile(next);
  return next;
}

export function regenerateFriendCode(): PlayerProfile {
  return updateProfile({ friendCode: generateFriendCode() });
}

/** Persist end-of-match career stats for the signed-in player. */
export function recordMatchResult(kills: number, won: boolean, deaths = 0): PlayerProfile {
  const p = getOrCreateProfile();
  const xp = kills * 25 + (won ? 150 : 40);
  const nextLevel = Math.min(60, p.level + Math.floor(xp / 400));
  return updateProfile({
    kills: p.kills + kills,
    deaths: (p.deaths ?? 0) + deaths,
    wins: p.wins + (won ? 1 : 0),
    matchesPlayed: (p.matchesPlayed ?? 0) + 1,
    level: nextLevel,
  });
}

export function signOut(): PlayerProfile {
  const p = getOrCreateProfile();
  const guest: PlayerProfile = {
    ...p,
    method: 'guest',
    email: undefined,
    accessToken: undefined,
    refreshToken: undefined,
    backend: 'none',
  };
  writeProfile(guest);
  return guest;
}

// ---------------------------------------------------------------------------
// Friend list (local book — presence resolves who is online)
// ---------------------------------------------------------------------------

export function getFriends(): FriendEntry[] {
  try {
    const raw = localStorage.getItem(FRIENDS_KEY);
    const list = raw ? (JSON.parse(raw) as FriendEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function addFriend(friendCode: string, callsign: string): FriendEntry[] {
  const code = friendCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (code.length !== 6) return getFriends();
  const friends = getFriends().filter((f) => f.friendCode !== code);
  friends.push({ friendCode: code, callsign: callsign || code, addedAt: Date.now() });
  try {
    const raw = JSON.stringify(friends.slice(-50));
    localStorage.setItem(FRIENDS_KEY, raw);
    cgSetItem(FRIENDS_KEY, raw);
  } catch {
    // ignore
  }
  return friends;
}

export function removeFriend(friendCode: string): FriendEntry[] {
  const friends = getFriends().filter((f) => f.friendCode !== friendCode);
  try {
    const raw = JSON.stringify(friends);
    localStorage.setItem(FRIENDS_KEY, raw);
    cgSetItem(FRIENDS_KEY, raw);
  } catch {
    // ignore
  }
  return friends;
}

// ---------------------------------------------------------------------------
// Email / password sign-in via provider REST APIs
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  localId?: string;
  user?: { id?: string };
  email?: string;
}

async function supabaseAuth(path: string, body: unknown, anonKey: string): Promise<TokenResponse> {
  const cfg = getSupabaseConfig();
  if (!cfg) throw new Error('Supabase is not configured');
  const res = await fetch(`${cfg.url}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse & { msg?: string; error_description?: string };
  if (!res.ok) {
    throw new Error(data.msg || data.error_description || `Supabase auth failed (${res.status})`);
  }
  return data;
}

async function supabaseSignIn(email: string, password: string): Promise<TokenResponse> {
  const cfg = getSupabaseConfig();
  if (!cfg) throw new Error('Supabase is not configured');
  try {
    return await supabaseAuth('token?grant_type=password', { email, password }, cfg.anonKey);
  } catch {
    // Account may not exist yet — register then retry the grant.
    await supabaseAuth('signup', { email, password }, cfg.anonKey);
    return supabaseAuth('token?grant_type=password', { email, password }, cfg.anonKey);
  }
}

async function firebaseAuthCall(action: string, payload: Record<string, unknown>): Promise<TokenResponse> {
  const cfg = getFirebaseConfig();
  if (!cfg) throw new Error('Firebase is not configured');
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${encodeURIComponent(cfg.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  const data = (await res.json().catch(() => ({}))) as TokenResponse & { error?: { message?: string } };
  if (!res.ok) {
    const code = data.error?.message || `Firebase auth failed (${res.status})`;
    const err = new Error(code) as Error & { code?: string };
    err.code = code;
    throw err;
  }
  return data;
}

async function firebaseSignIn(email: string, password: string): Promise<TokenResponse> {
  const payload = { email, password, returnSecureToken: true };
  try {
    return await firebaseAuthCall('signInWithPassword', payload);
  } catch (e) {
    const code = (e as { code?: string }).code || '';
    if (code.includes('EMAIL_NOT_FOUND') || code.includes('INVALID_PASSWORD') || code.includes('INVALID_LOGIN_CREDENTIALS')) {
      return await firebaseAuthCall('signUp', payload);
    }
    throw e;
  }
}

/** Refresh a stored Firebase session via the securetoken endpoint. */
async function firebaseRefreshSession(refreshToken: string): Promise<TokenResponse | null> {
  const cfg = getFirebaseConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(cfg.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { id_token?: string; refresh_token?: string; user_id?: string };
    return {
      id_token: data.id_token,
      refresh_token: data.refresh_token,
      localId: data.user_id,
    };
  } catch {
    return null;
  }
}

/** Refresh a stored Supabase session via the token endpoint. */
async function supabaseRefreshSession(refreshToken: string): Promise<TokenResponse | null> {
  const cfg = getSupabaseConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${cfg.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    return (await res.json()) as TokenResponse;
  } catch {
    return null;
  }
}

/**
 * Restore a persisted cloud session on reload. Refreshes provider tokens when
 * possible; falls back to the stored local profile otherwise.
 */
export async function restoreSession(): Promise<PlayerProfile> {
  const p = getOrCreateProfile();
  if (p.method === 'guest' || !p.refreshToken) return p;
  const refreshed =
    p.backend === 'supabase'
      ? await supabaseRefreshSession(p.refreshToken)
      : p.backend === 'firebase'
        ? await firebaseRefreshSession(p.refreshToken)
        : null;
  if (!refreshed) return p;
  const accessToken =
    p.backend === 'supabase' ? refreshed.access_token : refreshed.id_token;
  if (!accessToken) return p;
  return updateProfile({
    accessToken,
    refreshToken: refreshed.refresh_token ?? p.refreshToken,
  });
}

/** Build (or update) the local profile from a successful auth token response. */
function profileFromTokens(
  kind: Exclude<BackendKind, 'none'>,
  tokens: TokenResponse,
  email: string,
  details?: Partial<PlayerProfile>,
): PlayerProfile {
  const prior = readProfile();
  const uid =
    kind === 'supabase'
      ? tokens.user?.id || tokens.localId || prior?.id || randomId('SB')
      : tokens.localId || prior?.id || randomId('FB');
  const accessToken = kind === 'supabase' ? tokens.access_token : tokens.id_token;

  const profile: PlayerProfile = {
    ...(prior ?? getOrCreateProfile()),
    ...details,
    id: uid,
    callsign:
      details?.callsign ??
      (prior?.callsign && prior.method !== 'guest' ? prior.callsign : sanitizeCallsign(email.split('@')[0])),
    friendCode: prior?.friendCode ?? generateFriendCode(),
    method: kind === 'supabase' ? 'supabase' : 'firebase',
    email,
    accessToken,
    refreshToken: tokens.refresh_token,
    backend: kind,
    status: details?.status ?? prior?.status ?? 'active',
  };
  writeProfile(profile);
  return profile;
}

export interface RegistrationDetails {
  callsign: string;
  fullName?: string;
  bio?: string;
  country?: string;
  avatarPreset?: string;
  favoriteWeapon?: WeaponId | 'any';
  favoriteMap?: MapId | 'any';
  playstyle?: PlaystyleId;
}

/**
 * Register a brand-new account. Unlike signInEmail this NEVER falls back to
 * sign-in — a taken email surfaces as an error so the UI can prompt sign-in.
 */
export async function registerAccount(
  email: string,
  password: string,
  details: RegistrationDetails,
): Promise<PlayerProfile> {
  const kind = getBackendKind();
  if (kind === 'none') {
    throw new Error('Registration requires a backend — set VITE_SUPABASE_* or VITE_FIREBASE_* env vars');
  }
  let tokens: TokenResponse;
  if (kind === 'supabase') {
    tokens = await supabaseAuth('signup', { email, password }, getSupabaseConfig()!.anonKey);
    // Supabase may require email confirmation before a session exists.
    if (!tokens.access_token) {
      tokens = await supabaseAuth('token?grant_type=password', { email, password }, getSupabaseConfig()!.anonKey);
    }
  } else {
    tokens = await firebaseAuthCall('signUp', { email, password, returnSecureToken: true });
  }
  return profileFromTokens(kind, tokens, email, {
    callsign: sanitizeCallsign(details.callsign),
    fullName: details.fullName,
    bio: details.bio,
    country: details.country,
    avatarPreset: details.avatarPreset,
    favoriteWeapon: details.favoriteWeapon,
    favoriteMap: details.favoriteMap,
    playstyle: details.playstyle,
    status: 'active',
  });
}

/** Email/password sign-in. Creates the account on first use (both providers). */
export async function signInEmail(email: string, password: string): Promise<PlayerProfile> {
  const kind = getBackendKind();
  if (kind === 'none') {
    throw new Error('No backend configured — use Quick Callsign or set VITE_SUPABASE_* / VITE_FIREBASE_* env vars');
  }
  const tokens =
    kind === 'supabase' ? await supabaseSignIn(email, password) : await firebaseSignIn(email, password);
  return profileFromTokens(kind, tokens, email);
}

/**
 * Google sign-in. Supabase exposes a hosted OAuth redirect; Firebase requires
 * the JS SDK for the Google popup, so when only Firebase is configured this
 * falls back to instructing the user to use email sign-in.
 */
export function signInGoogle(redirectTo?: string): void {
  const cfg = getSupabaseConfig();
  if (!cfg) {
    throw new Error('Google sign-in requires VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  }
  const target = redirectTo || `${window.location.origin}${window.location.pathname}`;
  const url =
    `${cfg.url}/auth/v1/authorize?provider=google` +
    `&redirect_to=${encodeURIComponent(target)}`;
  window.location.assign(url);
}

/** Adopt a Supabase session returned via OAuth redirect (hash fragment). */
export function consumeOAuthSession(): PlayerProfile | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken) return null;
  const prior = readProfile();
  const profile: PlayerProfile = {
    ...(prior ?? getOrCreateProfile()),
    method: 'google',
    backend: 'supabase',
    accessToken,
    refreshToken: refreshToken ?? prior?.refreshToken,
    callsign: prior?.callsign ?? 'OPERATOR',
    status: prior?.status ?? 'active',
  };
  writeProfile(profile);
  // Clean the fragment so tokens do not linger in the URL.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return profile;
}
