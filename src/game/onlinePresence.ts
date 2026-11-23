/**
 * Live "Active on Internet" presence layer.
 *
 * Transport adapters (picked automatically from env config):
 *  - Supabase  : PostgREST polling of a `strikegrid_players` table
 *                (Realtime Presence requires the JS SDK; REST polling gives
 *                the same lobby-grade freshness with zero dependencies).
 *  - Firebase  : Realtime Database REST read/write of a `presence` node.
 *  - Offline   : BroadcastChannel heartbeat — same-browser tabs see each
 *                other instantly; works with no keys at all.
 *
 * All adapters expose the same interface so the UI never branches on backend.
 */

import {
  getBackendKind,
  getFirebaseConfig,
  getSupabaseConfig,
  type PlayerProfile,
} from './auth';
import type { MatchModeId } from './types';

export type PresenceStatus = 'online' | 'lobby' | 'match' | 'inactive';

export interface OnlinePlayer {
  id: string;
  callsign: string;
  friendCode?: string;
  status: PresenceStatus;
  mode?: string;
  ping: number;
  roomCode?: string;
  isSelf: boolean;
  // ---- Public profile card fields (from the cloud profile doc) ----
  avatarPreset?: string;
  country?: string;
  level?: number;
  favoriteWeapon?: string;
  fullName?: string;
  playstyle?: string;
}

export interface PresenceInvite {
  fromId: string;
  fromCallsign: string;
  roomCode: string;
  mode?: MatchModeId;
}

export interface PresenceBackend {
  readonly kind: 'supabase' | 'firebase' | 'offline';
  start(profile: PlayerProfile): void;
  /** Update what this client is currently doing (drives status badges). */
  setActivity(activity: { status: PresenceStatus; mode?: MatchModeId; roomCode?: string }): void;
  onPlayers(cb: (players: OnlinePlayer[]) => void): () => void;
  onInvite(cb: (invite: PresenceInvite) => void): () => void;
  /** Resolve a friend code / player id to a live presence entry, if online. */
  lookup(codeOrId: string): Promise<OnlinePlayer | null>;
  sendInvite(targetIdOrCode: string, roomCode: string, mode?: MatchModeId): void;
  /**
   * Manual ACTIVE/INACTIVE switch. When inactive the player is hidden from the
   * matchmaking directory and their cloud status reads `inactive`.
   */
  setManualStatus(active: boolean): void;
  dispose(): void;
}

const PRESENCE_TABLE = 'strikegrid_players';
const INVITE_TABLE = 'strikegrid_invites';
const POLL_MS = 4000;
const STALE_MS = 15000;

function nowIso(): string {
  return new Date().toISOString();
}

function toOnlinePlayer(raw: {
  id?: string;
  callsign?: string;
  friend_code?: string;
  friendCode?: string;
  status?: string;
  mode?: string;
  ping?: number;
  room_code?: string;
  roomCode?: string;
  avatar_preset?: string;
  avatarPreset?: string;
  country?: string;
  level?: number;
  favorite_weapon?: string;
  favoriteWeapon?: string;
  full_name?: string;
  fullName?: string;
  playstyle?: string;
  last_seen?: string;
  lastSeen?: number;
}, selfId: string): OnlinePlayer | null {
  if (!raw.id) return null;
  const status: PresenceStatus =
    raw.status === 'match' || raw.status === 'lobby' || raw.status === 'inactive'
      ? raw.status
      : 'online';
  return {
    id: raw.id,
    callsign: raw.callsign || 'OPERATOR',
    friendCode: raw.friend_code || raw.friendCode,
    status,
    mode: raw.mode,
    ping: Math.max(1, Math.round(raw.ping ?? 30)),
    roomCode: raw.room_code || raw.roomCode,
    isSelf: raw.id === selfId,
    avatarPreset: raw.avatar_preset || raw.avatarPreset,
    country: raw.country,
    level: typeof raw.level === 'number' ? raw.level : undefined,
    favoriteWeapon: raw.favorite_weapon || raw.favoriteWeapon,
    fullName: raw.full_name || raw.fullName,
    playstyle: raw.playstyle,
  };
}

function isFresh(raw: { last_seen?: string; lastSeen?: number }): boolean {
  const t = raw.last_seen ? Date.parse(raw.last_seen) : raw.lastSeen;
  return typeof t === 'number' && Date.now() - t < STALE_MS;
}

// ---------------------------------------------------------------------------
// Supabase (PostgREST polling)
// ---------------------------------------------------------------------------

class SupabasePresence implements PresenceBackend {
  readonly kind = 'supabase' as const;
  private cfg: { url: string; anonKey: string };
  private profile: PlayerProfile | null = null;
  private players = new Map<string, OnlinePlayer>();
  private timer: number | null = null;
  private disposed = false;
  private activity: { status: PresenceStatus; mode?: MatchModeId; roomCode?: string } = { status: 'online' };
  private manualActive = true;
  private readonly playerListeners = new Set<(p: OnlinePlayer[]) => void>();
  private readonly inviteListeners = new Set<(i: PresenceInvite) => void>();
  private readonly onPageHide = () => this.markInactiveForUnload();

  constructor() {
    const cfg = getSupabaseConfig();
    if (!cfg) throw new Error('Supabase not configured');
    this.cfg = cfg;
  }

  start(profile: PlayerProfile): void {
    this.profile = profile;
    this.manualActive = profile.status !== 'inactive';
    window.addEventListener('pagehide', this.onPageHide);
    void this.pushSelf();
    void this.poll();
    this.timer = window.setInterval(() => {
      void this.pushSelf();
      void this.poll();
    }, POLL_MS);
  }

  private headers(json = true): Record<string, string> {
    const h: Record<string, string> = {
      apikey: this.cfg.anonKey,
      Authorization: `Bearer ${this.profile?.accessToken || this.cfg.anonKey}`,
      Prefer: 'resolution=merge-duplicates',
    };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  private async pushSelf(): Promise<void> {
    if (!this.profile || this.disposed) return;
    const body = {
      id: this.profile.id,
      callsign: this.profile.callsign,
      friend_code: this.profile.friendCode,
      status: this.manualActive ? this.activity.status : 'inactive',
      mode: this.manualActive ? (this.activity.mode ?? null) : null,
      room_code: this.manualActive ? (this.activity.roomCode ?? null) : null,
      avatar_preset: this.profile.avatarPreset ?? null,
      country: this.profile.country ?? null,
      level: this.profile.level ?? 1,
      favorite_weapon: this.profile.favoriteWeapon ?? null,
      full_name: this.profile.fullName ?? null,
      playstyle: this.profile.playstyle ?? null,
      ping: 20 + Math.floor(Math.random() * 45),
      last_seen: nowIso(),
    };
    try {
      await fetch(`${this.cfg.url}/rest/v1/${PRESENCE_TABLE}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      });
    } catch {
      // offline — next poll retries
    }
  }

  private async poll(): Promise<void> {
    if (this.disposed || !this.profile) return;
    const cutoff = new Date(Date.now() - STALE_MS).toISOString();
    try {
      const res = await fetch(
        `${this.cfg.url}/rest/v1/${PRESENCE_TABLE}?select=*&last_seen=gte.${encodeURIComponent(cutoff)}`,
        { headers: this.headers(false) },
      );
      if (!res.ok) return;
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      const next = new Map<string, OnlinePlayer>();
      for (const row of rows) {
        const p = toOnlinePlayer(row as never, this.profile.id);
        if (p) next.set(p.id, p);
      }
      this.players = next;
      this.emit();
      await this.drainInvites();
    } catch {
      // transient network failure — keep last known list
    }
  }

  /** Pull pending room invites addressed to this player and fan them out. */
  private async drainInvites(): Promise<void> {
    if (!this.profile) return;
    const me = this.profile;
    const addr = `or=(to.eq.${encodeURIComponent(me.id)},to.eq.${encodeURIComponent(me.friendCode)})`;
    try {
      const res = await fetch(
        `${this.cfg.url}/rest/v1/${INVITE_TABLE}?select=*&${addr}&order=created_at.desc&limit=5`,
        { headers: this.headers(false) },
      );
      if (!res.ok) return;
      const rows = (await res.json()) as Array<{
        id?: number | string;
        from_id?: string;
        from_callsign?: string;
        room_code?: string;
        mode?: MatchModeId;
      }>;
      for (const row of rows) {
        if (!row.id || !row.room_code) continue;
        for (const cb of this.inviteListeners) {
          cb({
            fromId: row.from_id || 'unknown',
            fromCallsign: row.from_callsign || 'OPERATOR',
            roomCode: row.room_code,
            mode: row.mode,
          });
        }
        // Claim-and-delete so the invite fires once.
        void fetch(`${this.cfg.url}/rest/v1/${INVITE_TABLE}?id=eq.${encodeURIComponent(String(row.id))}`, {
          method: 'DELETE',
          headers: this.headers(false),
        }).catch(() => {});
      }
    } catch {
      // invites table may not exist yet — ignore
    }
  }

  setActivity(activity: { status: PresenceStatus; mode?: MatchModeId; roomCode?: string }): void {
    this.activity = activity;
    void this.pushSelf();
  }

  setManualStatus(active: boolean): void {
    this.manualActive = active;
    void this.pushSelf();
  }

  /** Best-effort inactive mark when the tab closes (RTDB/REST has no onDisconnect). */
  private markInactiveForUnload(): void {
    const me = this.profile;
    if (!me) return;
    void fetch(`${this.cfg.url}/rest/v1/${PRESENCE_TABLE}?id=eq.${encodeURIComponent(me.id)}`, {
      method: 'DELETE',
      headers: this.headers(false),
      keepalive: true,
    }).catch(() => {});
  }

  onPlayers(cb: (players: OnlinePlayer[]) => void): () => void {
    this.playerListeners.add(cb);
    cb(this.list());
    return () => this.playerListeners.delete(cb);
  }

  onInvite(cb: (invite: PresenceInvite) => void): () => void {
    this.inviteListeners.add(cb);
    return () => this.inviteListeners.delete(cb);
  }

  async lookup(codeOrId: string): Promise<OnlinePlayer | null> {
    const needle = codeOrId.trim().toUpperCase();
    if (!needle) return null;
    await this.poll();
    for (const p of this.players.values()) {
      if (p.isSelf) continue;
      if (p.id === needle || (p.friendCode || '').toUpperCase() === needle) return p;
    }
    // Fall back to a direct table probe by friend code.
    try {
      const res = await fetch(
        `${this.cfg.url}/rest/v1/${PRESENCE_TABLE}?select=*&friend_code=eq.${encodeURIComponent(needle)}&limit=1`,
        { headers: this.headers(false) },
      );
      if (res.ok) {
        const rows = (await res.json()) as Array<Record<string, unknown>>;
        const row = rows[0];
        if (row && this.profile && isFresh(row as never)) {
          return toOnlinePlayer(row as never, this.profile.id);
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  sendInvite(targetIdOrCode: string, roomCode: string, mode?: MatchModeId): void {
    const me = this.profile;
    if (!me || !roomCode) return;
    void fetch(`${this.cfg.url}/rest/v1/${INVITE_TABLE}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        to: targetIdOrCode,
        from_id: me.id,
        from_callsign: me.callsign,
        room_code: roomCode,
        mode: mode ?? null,
        created_at: nowIso(),
      }),
    }).catch(() => {});
  }

  private list(): OnlinePlayer[] {
    return [...this.players.values()].sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.callsign.localeCompare(b.callsign));
  }

  private emit(): void {
    const list = this.list();
    for (const cb of this.playerListeners) cb(list);
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('pagehide', this.onPageHide);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.playerListeners.clear();
    this.inviteListeners.clear();
    // Best-effort presence cleanup (rules may reject unauthenticated deletes).
    if (this.profile) {
      void fetch(`${this.cfg.url}/rest/v1/${PRESENCE_TABLE}?id=eq.${encodeURIComponent(this.profile.id)}`, {
        method: 'DELETE',
        headers: this.headers(false),
      }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Firebase Realtime Database (REST polling)
// ---------------------------------------------------------------------------

class FirebasePresence implements PresenceBackend {
  readonly kind = 'firebase' as const;
  private cfg: { apiKey: string; databaseURL: string };
  private profile: PlayerProfile | null = null;
  private players = new Map<string, OnlinePlayer>();
  private timer: number | null = null;
  private disposed = false;
  private activity: { status: PresenceStatus; mode?: MatchModeId; roomCode?: string } = { status: 'online' };
  private manualActive = true;
  private readonly playerListeners = new Set<(p: OnlinePlayer[]) => void>();
  private readonly inviteListeners = new Set<(i: PresenceInvite) => void>();
  private readonly onPageHide = () => this.markInactiveForUnload();

  constructor() {
    const cfg = getFirebaseConfig();
    if (!cfg) throw new Error('Firebase not configured');
    this.cfg = cfg;
  }

  private get base(): string | null {
    return this.cfg.databaseURL ? `${this.cfg.databaseURL}/strikegrid/presence` : null;
  }

  private authQuery(): string {
    return this.profile?.accessToken ? `?auth=${encodeURIComponent(this.profile.accessToken)}` : '';
  }

  start(profile: PlayerProfile): void {
    this.profile = profile;
    this.manualActive = profile.status !== 'inactive';
    window.addEventListener('pagehide', this.onPageHide);
    void this.pushSelf();
    void this.poll();
    this.timer = window.setInterval(() => {
      void this.pushSelf();
      void this.poll();
    }, POLL_MS);
  }

  private async pushSelf(): Promise<void> {
    const base = this.base;
    if (!base || !this.profile || this.disposed) return;
    const body = {
      callsign: this.profile.callsign,
      friendCode: this.profile.friendCode,
      status: this.manualActive ? this.activity.status : 'inactive',
      mode: this.manualActive ? (this.activity.mode ?? null) : null,
      roomCode: this.manualActive ? (this.activity.roomCode ?? null) : null,
      avatarPreset: this.profile.avatarPreset ?? null,
      country: this.profile.country ?? null,
      level: this.profile.level ?? 1,
      favoriteWeapon: this.profile.favoriteWeapon ?? null,
      fullName: this.profile.fullName ?? null,
      playstyle: this.profile.playstyle ?? null,
      ping: 20 + Math.floor(Math.random() * 45),
      lastSeen: Date.now(),
    };
    try {
      await fetch(`${base}/${encodeURIComponent(this.profile.id)}.json${this.authQuery()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // retry next tick
    }
  }

  private async poll(): Promise<void> {
    const base = this.base;
    if (!base || this.disposed || !this.profile) return;
    try {
      const res = await fetch(`${base}.json${this.authQuery()}`);
      if (!res.ok) return;
      const data = (await res.json()) as Record<string, Record<string, unknown>> | null;
      const next = new Map<string, OnlinePlayer>();
      if (data && typeof data === 'object') {
        for (const [id, raw] of Object.entries(data)) {
          if (!isFresh(raw as never)) continue;
          const p = toOnlinePlayer({ id, ...(raw as object) } as never, this.profile.id);
          if (p) next.set(id, p);
        }
      }
      this.players = next;
      this.emit();
      await this.drainInvites();
    } catch {
      // keep last known list
    }
  }

  /** Pull pending invites addressed to this uid (REST has no onDisconnect/watch). */
  private async drainInvites(): Promise<void> {
    const me = this.profile;
    if (!me || !this.cfg.databaseURL) return;
    const node = `${this.cfg.databaseURL}/strikegrid/invites/${encodeURIComponent(me.id)}`;
    const authQ = this.authQuery();
    try {
      const res = await fetch(`${node}.json${authQ}`);
      if (!res.ok) return;
      const data = (await res.json()) as Record<string, { fromId?: string; fromCallsign?: string; roomCode?: string; mode?: MatchModeId }> | null;
      if (!data || typeof data !== 'object') return;
      for (const [key, inv] of Object.entries(data)) {
        if (!inv?.roomCode) continue;
        for (const cb of this.inviteListeners) {
          cb({
            fromId: inv.fromId || 'unknown',
            fromCallsign: inv.fromCallsign || 'OPERATOR',
            roomCode: inv.roomCode,
            mode: inv.mode,
          });
        }
        void fetch(`${node}/${encodeURIComponent(key)}.json${authQ}`, { method: 'DELETE' }).catch(() => {});
      }
    } catch {
      // invites node may not exist — ignore
    }
  }

  setActivity(activity: { status: PresenceStatus; mode?: MatchModeId; roomCode?: string }): void {
    this.activity = activity;
    void this.pushSelf();
  }

  setManualStatus(active: boolean): void {
    this.manualActive = active;
    void this.pushSelf();
  }

  /** Best-effort inactive mark on tab close (true onDisconnect needs the SDK). */
  private markInactiveForUnload(): void {
    const base = this.base;
    if (!base || !this.profile) return;
    void fetch(`${base}/${encodeURIComponent(this.profile.id)}.json${this.authQuery()}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'inactive', lastSeen: Date.now() }),
      keepalive: true,
    }).catch(() => {});
  }

  onPlayers(cb: (players: OnlinePlayer[]) => void): () => void {
    this.playerListeners.add(cb);
    cb(this.list());
    return () => this.playerListeners.delete(cb);
  }

  onInvite(cb: (invite: PresenceInvite) => void): () => void {
    this.inviteListeners.add(cb);
    return () => this.inviteListeners.delete(cb);
  }

  async lookup(codeOrId: string): Promise<OnlinePlayer | null> {
    const needle = codeOrId.trim().toUpperCase();
    if (!needle) return null;
    await this.poll();
    for (const p of this.players.values()) {
      if (p.isSelf) continue;
      if (p.id === needle || (p.friendCode || '').toUpperCase() === needle) return p;
    }
    const base = this.base;
    if (base) {
      try {
        // Probe by friendCode requires a query — RTDB REST supports orderBy but
        // needs an index; instead scan the fresh node we already polled.
        void base;
      } catch {
        // ignore
      }
    }
    return null;
  }

  sendInvite(targetIdOrCode: string, roomCode: string, mode?: MatchModeId): void {
    const me = this.profile;
    if (!me || !this.cfg.databaseURL || !roomCode) return;
    const node = `${this.cfg.databaseURL}/strikegrid/invites/${encodeURIComponent(targetIdOrCode)}`;
    void fetch(`${node}.json${this.authQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromId: me.id,
        fromCallsign: me.callsign,
        roomCode,
        mode: mode ?? null,
        ts: Date.now(),
      }),
    }).catch(() => {});
  }

  private list(): OnlinePlayer[] {
    return [...this.players.values()].sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.callsign.localeCompare(b.callsign));
  }

  private emit(): void {
    const list = this.list();
    for (const cb of this.playerListeners) cb(list);
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('pagehide', this.onPageHide);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.playerListeners.clear();
    this.inviteListeners.clear();
    const base = this.base;
    if (base && this.profile) {
      void fetch(`${base}/${encodeURIComponent(this.profile.id)}.json${this.authQuery()}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Offline / same-browser fallback (BroadcastChannel presence)
// ---------------------------------------------------------------------------

interface OfflineWire {
  t: 'presence' | 'invite';
  id: string;
  callsign: string;
  friendCode?: string;
  status?: PresenceStatus;
  mode?: MatchModeId;
  roomCode?: string;
  ping?: number;
  ts: number;
  // invite fields
  to?: string;
  fromId?: string;
  fromCallsign?: string;
}

const OFFLINE_CHANNEL = 'strikegrid-presence-v1';
const OFFLINE_STALE_MS = 8000;

class OfflinePresence implements PresenceBackend {
  readonly kind = 'offline' as const;
  private profile: PlayerProfile | null = null;
  private bc: BroadcastChannel | null = null;
  private players = new Map<string, OnlinePlayer & { ts: number }>();
  private timer: number | null = null;
  private disposed = false;
  private activity: { status: PresenceStatus; mode?: MatchModeId; roomCode?: string } = { status: 'online' };
  private manualActive = true;
  private readonly playerListeners = new Set<(p: OnlinePlayer[]) => void>();
  private readonly inviteListeners = new Set<(i: PresenceInvite) => void>();

  start(profile: PlayerProfile): void {
    this.profile = profile;
    this.manualActive = profile.status !== 'inactive';
    try {
      this.bc = new BroadcastChannel(OFFLINE_CHANNEL);
      this.bc.onmessage = (ev: MessageEvent<OfflineWire>) => this.handle(ev.data);
    } catch {
      this.bc = null;
    }
    this.beat();
    this.timer = window.setInterval(() => {
      this.beat();
      this.prune();
    }, 2500);
  }

  private effectiveStatus(): PresenceStatus {
    return this.manualActive ? this.activity.status : 'inactive';
  }

  private beat(): void {
    if (!this.profile || this.disposed) return;
    const active = this.manualActive;
    const msg: OfflineWire = {
      t: 'presence',
      id: this.profile.id,
      callsign: this.profile.callsign,
      friendCode: this.profile.friendCode,
      status: this.effectiveStatus(),
      mode: active ? this.activity.mode : undefined,
      roomCode: active ? this.activity.roomCode : undefined,
      ping: 2 + Math.floor(Math.random() * 14),
      ts: Date.now(),
    };
    try {
      this.bc?.postMessage(msg);
    } catch {
      // ignore
    }
  }

  private handle(msg: OfflineWire): void {
    if (!msg || msg.t === 'presence') {
      if (!msg?.id || msg.id === this.profile?.id) return;
      const status: PresenceStatus =
        msg.status === 'match' || msg.status === 'lobby' || msg.status === 'inactive'
          ? msg.status
          : 'online';
      this.players.set(msg.id, {
        id: msg.id,
        callsign: msg.callsign || 'OPERATOR',
        friendCode: msg.friendCode,
        status,
        mode: msg.mode,
        roomCode: msg.roomCode,
        ping: msg.ping ?? 8,
        isSelf: false,
        ts: msg.ts || Date.now(),
      });
      this.emit();
      return;
    }
    if (msg.t === 'invite') {
      // Deliver only to the addressed player (id or friend code).
      const me = this.profile;
      if (!me) return;
      const addressed =
        msg.to === me.id || (msg.to || '').toUpperCase() === me.friendCode.toUpperCase();
      if (addressed && msg.fromId && msg.roomCode) {
        for (const cb of this.inviteListeners) {
          cb({
            fromId: msg.fromId,
            fromCallsign: msg.fromCallsign || 'OPERATOR',
            roomCode: msg.roomCode,
            mode: msg.mode,
          });
        }
      }
    }
  }

  private prune(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.players) {
      if (now - p.ts > OFFLINE_STALE_MS) {
        this.players.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  setActivity(activity: { status: PresenceStatus; mode?: MatchModeId; roomCode?: string }): void {
    this.activity = activity;
    this.beat();
  }

  setManualStatus(active: boolean): void {
    this.manualActive = active;
    this.beat();
    this.emit();
  }

  onPlayers(cb: (players: OnlinePlayer[]) => void): () => void {
    this.playerListeners.add(cb);
    cb(this.list());
    return () => this.playerListeners.delete(cb);
  }

  onInvite(cb: (invite: PresenceInvite) => void): () => void {
    this.inviteListeners.add(cb);
    return () => this.inviteListeners.delete(cb);
  }

  async lookup(codeOrId: string): Promise<OnlinePlayer | null> {
    const needle = codeOrId.trim().toUpperCase();
    if (!needle) return null;
    for (const p of this.players.values()) {
      if ((p.friendCode || '').toUpperCase() === needle || p.id === needle) return p;
    }
    return null;
  }

  sendInvite(targetIdOrCode: string, roomCode: string, mode?: MatchModeId): void {
    if (!this.profile || this.disposed) return;
    try {
      this.bc?.postMessage({
        t: 'invite',
        id: this.profile.id,
        callsign: this.profile.callsign,
        to: targetIdOrCode,
        fromId: this.profile.id,
        fromCallsign: this.profile.callsign,
        roomCode,
        mode,
        ts: Date.now(),
      } satisfies OfflineWire);
    } catch {
      // ignore
    }
  }

  private list(): OnlinePlayer[] {
    const self: OnlinePlayer | null = this.profile
      ? {
          id: this.profile.id,
          callsign: this.profile.callsign,
          friendCode: this.profile.friendCode,
          status: this.effectiveStatus(),
          mode: this.manualActive ? this.activity.mode : undefined,
          roomCode: this.manualActive ? this.activity.roomCode : undefined,
          ping: 4,
          isSelf: true,
          avatarPreset: this.profile.avatarPreset,
          country: this.profile.country,
          level: this.profile.level,
          favoriteWeapon: this.profile.favoriteWeapon,
          fullName: this.profile.fullName,
          playstyle: this.profile.playstyle,
        }
      : null;
    const others = [...this.players.values()].map(({ ts: _ts, ...p }) => p);
    return self ? [self, ...others] : others;
  }

  private emit(): void {
    const list = this.list();
    for (const cb of this.playerListeners) cb(list);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    try {
      this.bc?.close();
    } catch {
      // ignore
    }
    this.bc = null;
    this.players.clear();
    this.playerListeners.clear();
    this.inviteListeners.clear();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPresenceBackend(): PresenceBackend {
  const kind = getBackendKind();
  try {
    if (kind === 'supabase') return new SupabasePresence();
    if (kind === 'firebase') return new FirebasePresence();
  } catch {
    // misconfigured backend — degrade to offline rather than crash the menu
  }
  return new OfflinePresence();
}
