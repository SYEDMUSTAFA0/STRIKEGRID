/**
 * Cloud-backed operator profile document.
 *
 * `PlayerProfile` (auth.ts) is the local identity/session record. This module
 * defines the richer `UserProfileDoc` that is persisted to the cloud —
 * `/users/{uid}` in Firebase RTDB or the `profiles` table in Supabase — and the
 * helpers used to push/pull it. Everything degrades silently when no backend
 * is configured.
 */

import {
  getBackendKind,
  getFirebaseConfig,
  getOrCreateProfile,
  getSupabaseConfig,
  updateProfile,
  type PlaystyleId,
  type PlayerProfile,
} from './auth';
import type { MapId, WeaponId } from './types';

export type { PlaystyleId };
export type UserStatus = 'active' | 'inactive';

export interface UserProfileDoc {
  uid: string;
  callsign: string;
  email?: string;
  fullName: string;
  bio: string;
  country: string;
  avatarPreset: string;
  favoriteWeapon: WeaponId | 'any';
  favoriteMap: MapId | 'any';
  playstyle: PlaystyleId;
  status: UserStatus;
  friendCode?: string;
  level: number;
  kills: number;
  deaths: number;
  wins: number;
  matchesPlayed: number;
  createdAt: number;
  lastSeen: number;
}

/** Editable subset used by the registration + profile editor forms. */
export interface ProfileDetails {
  callsign: string;
  fullName: string;
  bio: string;
  country: string;
  avatarPreset: string;
  favoriteWeapon: WeaponId | 'any';
  favoriteMap: MapId | 'any';
  playstyle: PlaystyleId;
}

export const PLAYSTYLES: ReadonlyArray<{ id: PlaystyleId; label: string; hint: string }> = [
  { id: 'rusher', label: 'Rusher', hint: 'Close-quarters aggression' },
  { id: 'marksman', label: 'Marksman', hint: 'Long sightlines & precision' },
  { id: 'medic', label: 'Medic', hint: 'Support & sustain' },
  { id: 'vehicle', label: 'Vehicle Specialist', hint: 'Wheeled warfare' },
];

export const COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'BR', name: 'Brazil' },
  { code: 'JP', name: 'Japan' },
  { code: 'IN', name: 'India' },
  { code: 'KR', name: 'South Korea' },
  { code: 'PL', name: 'Poland' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'FI', name: 'Finland' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'OTHER', name: 'Other' },
];

/** Tactical emblem presets — rendered as a colored chevron + glyph. */
export const AVATAR_PRESETS: ReadonlyArray<{ id: string; label: string; color: string; glyph: string }> = [
  { id: 'viper', label: 'Viper', color: '#34d399', glyph: 'V' },
  { id: 'ghost', label: 'Ghost', color: '#94a3b8', glyph: 'G' },
  { id: 'talon', label: 'Talon', color: '#f59e0b', glyph: 'T' },
  { id: 'havoc', label: 'Havoc', color: '#ef4444', glyph: 'H' },
  { id: 'nomad', label: 'Nomad', color: '#38bdf8', glyph: 'N' },
  { id: 'oxide', label: 'Oxide', color: '#a78bfa', glyph: 'O' },
  { id: 'jackal', label: 'Jackal', color: '#facc15', glyph: 'J' },
  { id: 'warden', label: 'Warden', color: '#fb923c', glyph: 'W' },
];

export function avatarPreset(id: string | undefined): { label: string; color: string; glyph: string } {
  return AVATAR_PRESETS.find((a) => a.id === id) ?? AVATAR_PRESETS[0];
}

export function defaultProfileDetails(profile: PlayerProfile): ProfileDetails {
  return {
    callsign: profile.callsign,
    fullName: profile.fullName ?? '',
    bio: profile.bio ?? '',
    country: profile.country ?? 'OTHER',
    avatarPreset: profile.avatarPreset ?? 'viper',
    favoriteWeapon: profile.favoriteWeapon ?? 'any',
    favoriteMap: profile.favoriteMap ?? 'any',
    playstyle: profile.playstyle ?? 'rusher',
  };
}

/** Merge editable details into the local profile and mirror to the cloud. */
export function applyProfileDetails(details: ProfileDetails): PlayerProfile {
  const merged = updateProfile({ ...details });
  void pushProfileToCloud(merged);
  return merged;
}

/** Build the cloud document from the local profile. */
export function profileToDoc(p: PlayerProfile): UserProfileDoc {
  return {
    uid: p.id,
    callsign: p.callsign,
    email: p.email,
    fullName: p.fullName ?? '',
    bio: p.bio ?? '',
    country: p.country ?? 'OTHER',
    avatarPreset: p.avatarPreset ?? 'viper',
    favoriteWeapon: p.favoriteWeapon ?? 'any',
    favoriteMap: p.favoriteMap ?? 'any',
    playstyle: p.playstyle ?? 'rusher',
    status: p.status ?? 'active',
    friendCode: p.friendCode,
    level: p.level,
    kills: p.kills,
    deaths: p.deaths ?? 0,
    wins: p.wins,
    matchesPlayed: p.matchesPlayed ?? 0,
    createdAt: p.createdAt,
    lastSeen: Date.now(),
  };
}

function supabaseHeaders(p: PlayerProfile): Record<string, string> {
  const cfg = getSupabaseConfig();
  return {
    apikey: cfg?.anonKey ?? '',
    Authorization: `Bearer ${p.accessToken || cfg?.anonKey || ''}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates',
  };
}

/**
 * Upsert the operator document. Fire-and-forget: failures are swallowed so a
 * flaky network never blocks gameplay or menu interactions.
 */
export async function pushProfileToCloud(p: PlayerProfile): Promise<void> {
  const kind = getBackendKind();
  const doc = profileToDoc(p);
  try {
    if (kind === 'supabase') {
      const cfg = getSupabaseConfig();
      if (!cfg) return;
      await fetch(`${cfg.url}/rest/v1/profiles`, {
        method: 'POST',
        headers: supabaseHeaders(p),
        body: JSON.stringify(doc),
      });
    } else if (kind === 'firebase') {
      const cfg = getFirebaseConfig();
      if (!cfg?.databaseURL) return;
      const authQ = p.accessToken ? `?auth=${encodeURIComponent(p.accessToken)}` : '';
      await fetch(`${cfg.databaseURL}/users/${encodeURIComponent(p.id)}.json${authQ}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
    }
  } catch {
    // offline — local profile remains authoritative
  }
}

/**
 * Pull the cloud profile doc for the current user and merge its editable
 * fields into the local profile (used after sign-in / on session restore).
 */
export async function hydrateLocalProfileFromCloud(): Promise<PlayerProfile | null> {
  const p = getOrCreateProfile();
  if (p.method === 'guest') return null;
  const doc = await fetchProfileDoc(p.id);
  if (!doc) return null;
  const patch: Partial<PlayerProfile> = {
    callsign: doc.callsign || p.callsign,
    fullName: doc.fullName,
    bio: doc.bio,
    country: doc.country,
    avatarPreset: doc.avatarPreset,
    favoriteWeapon: doc.favoriteWeapon,
    favoriteMap: doc.favoriteMap,
    playstyle: doc.playstyle,
    level: Math.max(p.level, doc.level || 1),
    kills: Math.max(p.kills, doc.kills || 0),
    deaths: Math.max(p.deaths ?? 0, doc.deaths || 0),
    wins: Math.max(p.wins, doc.wins || 0),
    matchesPlayed: Math.max(p.matchesPlayed ?? 0, doc.matchesPlayed || 0),
    friendCode: doc.friendCode || p.friendCode,
    status: doc.status ?? p.status ?? 'active',
  };
  return updateProfile(patch);
}

/** Fetch a public profile document by uid (used when adding friends). */
export async function fetchProfileDoc(uid: string): Promise<UserProfileDoc | null> {
  const kind = getBackendKind();
  const p = getOrCreateProfile();
  try {
    if (kind === 'supabase') {
      const cfg = getSupabaseConfig();
      if (!cfg) return null;
      const res = await fetch(
        `${cfg.url}/rest/v1/profiles?select=*&uid=eq.${encodeURIComponent(uid)}&limit=1`,
        { headers: { apikey: cfg.anonKey, Authorization: `Bearer ${p.accessToken || cfg.anonKey}` } },
      );
      if (!res.ok) return null;
      const rows = (await res.json()) as UserProfileDoc[];
      return rows[0] ?? null;
    }
    if (kind === 'firebase') {
      const cfg = getFirebaseConfig();
      if (!cfg?.databaseURL) return null;
      const authQ = p.accessToken ? `?auth=${encodeURIComponent(p.accessToken)}` : '';
      const res = await fetch(
        `${cfg.databaseURL}/users/${encodeURIComponent(uid)}.json${authQ}`,
      );
      if (!res.ok) return null;
      return (await res.json()) as UserProfileDoc | null;
    }
  } catch {
    return null;
  }
  return null;
}
