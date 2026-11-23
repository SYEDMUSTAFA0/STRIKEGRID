import * as THREE from 'three';
import type { MatchModeId, DifficultyTierId, SquadSide, WeaponSkinId } from './types';

/**
 * Lightweight browser multiplayer layer.
 *
 * - BroadcastChannel transport for same-browser / multi-tab play (zero config).
 * - Optional WebSocket/WebRTC signaling hook: set `relayUrl` to enable; when the
 *   relay is unreachable the channel transparently falls back to local-only
 *   (bots/squad behavior — gameplay continues solo with zero errors).
 */

export interface MpPeerInfo {
  id: string;
  nickname: string;
  ready: boolean;
  isHost: boolean;
  lastSeen: number;
  skin?: WeaponSkinId;
  status?: string;
  /** Lobby combat role: solo striker or named squad. */
  side?: SquadSide;
  /** Simulated squad member injected by the host (no real client). */
  bot?: boolean;
}

export interface MpPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  skin?: WeaponSkinId;
  dead?: boolean;
  moving?: boolean;
  ads?: boolean;
}

export interface MpMatchConfig {
  mapId: string;
  level: number;
  mode: MatchModeId;
  tier: DifficultyTierId;
  /** Allow damage between teammates (default off = squad protection). */
  friendlyFire?: boolean;
}

export interface MpScore {
  kills: number;
  deaths: number;
}

/** Non-positional combat/lobby events relayed between room members. */
export interface MpEvent {
  k: 'shot' | 'nade' | 'elim' | 'hit' | 'wave' | 'chat';
  id?: string;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  victim?: string;
  killer?: string | null;
  weapon?: string;
  text?: string;
  ts: number;
}

export interface MpInvite {
  fromId: string;
  fromCallsign: string;
  roomCode: string;
  mode?: MatchModeId;
}

interface WireMessage {
  t:
    | 'hello'
    | 'roster'
    | 'ready'
    | 'start'
    | 'pose'
    | 'event'
    | 'score'
    | 'invite'
    | 'lobby'
    | 'bye';
  room: string;
  id: string;
  nick?: string;
  ready?: boolean;
  mapId?: string;
  level?: number;
  cfg?: MpMatchConfig;
  pose?: MpPose;
  event?: MpEvent;
  score?: MpScore;
  invite?: { to: string; roomCode: string; mode?: MatchModeId };
  skin?: WeaponSkinId;
  side?: SquadSide;
  bot?: boolean;
  ts: number;
}

type PeersListener = (peers: MpPeerInfo[]) => void;
type StartListener = (payload: MpMatchConfig & { hostId: string }) => void;
type PoseListener = (id: string, pose: MpPose) => void;
type EventListener = (id: string, event: MpEvent) => void;
type ScoreListener = (id: string, score: MpScore) => void;
type InviteListener = (invite: MpInvite) => void;
type LobbyConfigListener = (cfg: MpMatchConfig) => void;

const CHANNEL_PREFIX = 'strikegrid-room-';
const HEARTBEAT_MS = 1400;
const PEER_TIMEOUT_MS = 6000;

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export class StrikeChannel {
  public readonly roomCode: string;
  public readonly selfId: string;
  public readonly nickname: string;
  public readonly isHost: boolean;
  public supported = true;

  private bc: BroadcastChannel | null = null;
  private peers = new Map<string, MpPeerInfo>();
  private ready = false;
  private skin: WeaponSkinId = 'standard';
  private side: SquadSide = 'attack';
  private heartbeatTimer: number | null = null;
  private pruneTimer: number | null = null;
  private disposed = false;
  private readonly peersListeners = new Set<PeersListener>();
  private readonly startListeners = new Set<StartListener>();
  private readonly poseListeners = new Set<PoseListener>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly scoreListeners = new Set<ScoreListener>();
  private readonly inviteListeners = new Set<InviteListener>();
  private readonly lobbyConfigListeners = new Set<LobbyConfigListener>();

  private constructor(roomCode: string, nickname: string, isHost: boolean) {
    this.roomCode = roomCode;
    this.nickname = nickname;
    this.isHost = isHost;
    this.selfId = `${isHost ? 'H' : 'J'}-${Math.random().toString(36).slice(2, 8)}`;

    if (typeof BroadcastChannel === 'undefined') {
      this.supported = false;
      return;
    }
    try {
      this.bc = new BroadcastChannel(CHANNEL_PREFIX + roomCode);
      this.bc.onmessage = (ev: MessageEvent<WireMessage>) => this.handleMessage(ev.data);
    } catch {
      this.supported = false;
      this.bc = null;
    }

    this.send({ t: 'hello', ready: this.ready });
    this.heartbeatTimer = window.setInterval(() => {
      if (this.disposed) return;
      this.send({ t: 'hello', ready: this.ready });
      // Keep simulated squad members alive on remote clients.
      for (const bot of this.botPeers()) this.announceBot(bot);
    }, HEARTBEAT_MS);
    this.pruneTimer = window.setInterval(() => this.prunePeers(), PEER_TIMEOUT_MS);
  }

  static createRoom(nickname: string): StrikeChannel {
    return new StrikeChannel(generateRoomCode(), nickname, true);
  }

  static joinRoom(roomCode: string, nickname: string): StrikeChannel {
    return new StrikeChannel(roomCode.trim().toUpperCase(), nickname, false);
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** This client's chosen lobby combat role (attack / alpha / bravo). */
  get selfSide(): SquadSide {
    return this.side;
  }

  /** Pick a combat role before match start — synced to the whole room. */
  setSide(side: SquadSide): void {
    this.side = side;
    this.send({ t: 'hello', ready: this.ready, side });
    this.emitPeers();
  }

  /**
   * Host-only: inject simulated squad members into the room roster so the
   * lobby/team-up flow can be tested with zero real players. Bots are
   * re-announced on every heartbeat so remote clients never prune them, and
   * each client renders them as wandering remote operators locally.
   */
  simulateBots(bots: ReadonlyArray<{ nickname: string; side: SquadSide }>): void {
    if (!this.isHost || !this.bc || this.disposed) return;
    for (const b of bots.slice(0, 6)) {
      const id = `BOT-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const peer: MpPeerInfo = {
        id,
        nickname: b.nickname.slice(0, 12).toUpperCase(),
        ready: true,
        isHost: false,
        lastSeen: Date.now(),
        side: b.side,
        bot: true,
      };
      this.peers.set(id, peer);
      this.announceBot(peer);
    }
    this.emitPeers();
  }

  /** Host-only: remove all simulated squad members from the room. */
  clearBots(): void {
    if (!this.isHost) return;
    for (const [id, p] of this.peers) {
      if (!p.bot) continue;
      this.peers.delete(id);
      this.sendAs(id, { t: 'bye' });
    }
    this.emitPeers();
  }

  private botPeers(): MpPeerInfo[] {
    return [...this.peers.values()].filter((p) => p.bot);
  }

  /** Post a wire message impersonating a bot id (roster announcements). */
  private sendAs(id: string, partial: Partial<WireMessage>): void {
    if (!this.bc || this.disposed) return;
    const msg: WireMessage = {
      t: 'hello',
      room: this.roomCode,
      id,
      nick: 'BOT',
      ts: Date.now(),
      ...partial,
    };
    try {
      this.bc.postMessage(msg);
    } catch {
      // ignore
    }
  }

  private announceBot(p: MpPeerInfo): void {
    this.sendAs(p.id, {
      t: 'hello',
      nick: p.nickname,
      ready: p.ready,
      side: p.side,
      bot: true,
    });
  }

  getPeerList(): MpPeerInfo[] {
    return [...this.peers.values()].sort((a, b) => a.nickname.localeCompare(b.nickname));
  }

  setReady(ready: boolean): void {
    this.ready = ready;
    this.send({ t: 'ready', ready });
    this.emitPeers();
  }

  /** Host-only: broadcast deploy start to the room. */
  startMatch(cfg: MpMatchConfig): void {
    this.send({ t: 'start', cfg, mapId: cfg.mapId, level: cfg.level });
  }

  setSkin(skin: WeaponSkinId): void {
    this.skin = skin;
    this.send({ t: 'hello', ready: this.ready, skin });
  }

  broadcastPose(pose: MpPose): void {
    this.send({ t: 'pose', pose });
  }

  /** Relay a combat/lobby event (shot tracer, nade, elimination, etc). */
  broadcastEvent(event: Omit<MpEvent, 'ts'>): void {
    this.send({ t: 'event', event: { ...event, ts: Date.now() } });
  }

  /** Publish this client's live scoreboard line (kills/deaths). */
  broadcastScore(score: MpScore): void {
    this.send({ t: 'score', score });
  }

  /** Host-only: push the current lobby ruleset to all clients (pre-match sync). */
  broadcastLobbyConfig(cfg: MpMatchConfig): void {
    if (!this.isHost) return;
    this.send({ t: 'lobby', cfg });
  }

  /** Send a room invite to a specific player id / friend code (same-browser). */
  sendInvite(to: string, roomCode: string, mode?: MatchModeId): void {
    this.send({ t: 'invite', invite: { to, roomCode, mode } });
  }

  /** Broadcast a text-chat line to the whole room (lobby + in-match). */
  sendChat(text: string): void {
    const body = text.trim().slice(0, 280);
    if (!body) return;
    this.broadcastEvent({ k: 'chat', text: body });
  }

  /** Subscribe to room text chat (filters the generic event stream). */
  onChat(cb: (id: string, text: string, ts: number) => void): () => void {
    return this.onEvent((id, event) => {
      if (event.k === 'chat' && event.text) cb(id, event.text, event.ts);
    });
  }

  onEvent(cb: EventListener): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  onScore(cb: ScoreListener): () => void {
    this.scoreListeners.add(cb);
    return () => this.scoreListeners.delete(cb);
  }

  onInvite(cb: InviteListener): () => void {
    this.inviteListeners.add(cb);
    return () => this.inviteListeners.delete(cb);
  }

  onLobbyConfig(cb: LobbyConfigListener): () => void {
    this.lobbyConfigListeners.add(cb);
    return () => this.lobbyConfigListeners.delete(cb);
  }

  onPeers(cb: PeersListener): () => void {
    this.peersListeners.add(cb);
    cb(this.getPeerList());
    return () => this.peersListeners.delete(cb);
  }

  onStart(cb: StartListener): () => void {
    this.startListeners.add(cb);
    return () => this.startListeners.delete(cb);
  }

  onPose(cb: PoseListener): () => void {
    this.poseListeners.add(cb);
    return () => this.poseListeners.delete(cb);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.send({ t: 'bye' });
    for (const bot of this.botPeers()) this.sendAs(bot.id, { t: 'bye' });
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    if (this.pruneTimer !== null) window.clearInterval(this.pruneTimer);
    try {
      this.bc?.close();
    } catch {
      // ignore
    }
    this.bc = null;
    this.peers.clear();
    this.peersListeners.clear();
    this.startListeners.clear();
    this.poseListeners.clear();
    this.eventListeners.clear();
    this.scoreListeners.clear();
    this.inviteListeners.clear();
    this.lobbyConfigListeners.clear();
  }

  private send(partial: Partial<WireMessage>): void {
    if (!this.bc || this.disposed) return;
    const msg: WireMessage = {
      t: 'hello',
      room: this.roomCode,
      id: this.selfId,
      nick: this.nickname,
      skin: this.skin,
      side: this.side,
      ts: Date.now(),
      ...partial,
    };
    try {
      this.bc.postMessage(msg);
    } catch {
      // sandboxed environments may block postMessage — stay silent
    }
  }

  private handleMessage(msg: WireMessage): void {
    if (!msg || msg.room !== this.roomCode || msg.id === this.selfId) return;
    const now = Date.now();

    switch (msg.t) {
      case 'hello': {
        const existing = this.peers.get(msg.id);
        const wasNew = !existing;
        const peerSkin = msg.skin || existing?.skin;
        const peerSide = msg.side || existing?.side;
        const peerBot = Boolean(msg.bot) || existing?.bot === true;
        this.peers.set(msg.id, {
          id: msg.id,
          nickname: msg.nick || 'OPERATOR',
          ready: Boolean(msg.ready),
          isHost: msg.id.startsWith('H-'),
          lastSeen: now,
          skin: peerSkin,
          side: peerSide,
          bot: peerBot || undefined,
        });
        if (
          wasNew ||
          existing?.ready !== Boolean(msg.ready) ||
          existing?.nickname !== (msg.nick || 'OPERATOR') ||
          existing?.skin !== peerSkin ||
          existing?.side !== peerSide ||
          Boolean(existing?.bot) !== peerBot
        ) {
          this.emitPeers();
        }
        // Host answers with roster so late joiners sync immediately
        if (this.isHost) {
          this.send({
            t: 'roster',
            ready: this.ready,
          });
        }
        break;
      }
      case 'roster': {
        // Non-hosts ignore roster payloads beyond heartbeat; peers already tracked.
        break;
      }
      case 'ready': {
        const p = this.peers.get(msg.id);
        if (p) {
          p.ready = Boolean(msg.ready);
          p.lastSeen = now;
          this.emitPeers();
        }
        break;
      }
      case 'start': {
        const cfg = msg.cfg ?? {
          mapId: String(msg.mapId || 'dusk_yard'),
          level: Math.max(1, Math.floor(msg.level || 1)),
          mode: 'survival' as MatchModeId,
          tier: 'easy' as DifficultyTierId,
        };
        for (const l of this.startListeners) {
          l({ ...cfg, hostId: msg.id });
        }
        break;
      }
      case 'pose': {
        if (msg.pose) {
          for (const l of this.poseListeners) l(msg.id, msg.pose);
        }
        break;
      }
      case 'event': {
        if (msg.event) {
          for (const l of this.eventListeners) l(msg.id, msg.event);
        }
        break;
      }
      case 'score': {
        if (msg.score) {
          for (const l of this.scoreListeners) l(msg.id, msg.score);
        }
        break;
      }
      case 'invite': {
        const inv = msg.invite;
        if (inv) {
          // Deliver only when addressed to this client (id or we accept all —
          // BroadcastChannel rooms are already scoped; invites target lobby UI).
          for (const l of this.inviteListeners) {
            l({
              fromId: msg.id,
              fromCallsign: msg.nick || 'OPERATOR',
              roomCode: inv.roomCode,
              mode: inv.mode,
            });
          }
        }
        break;
      }
      case 'lobby': {
        // Clients mirror the host's lobby selection (mode/arena/tier).
        if (msg.cfg && !this.isHost) {
          for (const l of this.lobbyConfigListeners) l(msg.cfg);
        }
        break;
      }
      case 'bye': {
        this.peers.delete(msg.id);
        this.emitPeers();
        break;
      }
    }
  }

  private prunePeers(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.peers) {
      if (p.bot) continue; // bots are re-announced by the host heartbeat
      if (now - p.lastSeen > PEER_TIMEOUT_MS) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitPeers();
  }

  private emitPeers(): void {
    const list = this.getPeerList();
    for (const l of this.peersListeners) l(list);
  }
}

// ---------------------------------------------------------------------------
// Remote operator visualization (simple capsule rig per peer)
// ---------------------------------------------------------------------------

const _remoteGeoBody = new THREE.CapsuleGeometry(0.34, 0.85, 4, 10);
const _remoteGeoHead = new THREE.SphereGeometry(0.21, 10, 8);

export interface RemoteOperatorEntry {
  id: string;
  nickname?: string;
  skin?: WeaponSkinId;
  side?: SquadSide;
}

/** Squad-role tints — override skin/palette colors for team identification. */
const TEAM_TINTS: Record<SquadSide, number> = {
  alpha: 0xf59e0b,
  bravo: 0x38bdf8,
  attack: 0xf87171,
};

const TEAM_TAGS: Record<SquadSide, string> = {
  alpha: '[A] ',
  bravo: '[B] ',
  attack: '[X] ',
};

/** WEAPON_SKIN accent colors reused as remote-operator team tints. */
const SKIN_TINTS: Record<string, number> = {
  standard: 0x38bdf8,
  desert_tan: 0xfbbf24,
  arctic_camo: 0x7dd3fc,
  carbon_gold: 0xfacc15,
};

function makeNameSprite(nickname: string, colorCss: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 56;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = colorCss;
    ctx.fillText(nickname.slice(0, 14).toUpperCase(), 128, 28);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.7, 0.37, 1);
  sprite.position.y = 2.15;
  return sprite;
}

function cssForHex(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export class RemoteOperators {
  private readonly rigs = new Map<
    string,
    {
      group: THREE.Group;
      mats: THREE.MeshStandardMaterial[];
      sprite?: THREE.Sprite;
      dead: boolean;
      side?: SquadSide;
    }
  >();
  private readonly scene: THREE.Scene;
  private readonly palette = [0x38bdf8, 0xf59e0b, 0xa78bfa, 0x34d399, 0xf472b6, 0xfacc15];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  sync(entries: Iterable<string | RemoteOperatorEntry>): void {
    const wanted = new Map<string, RemoteOperatorEntry>();
    for (const e of entries) {
      if (typeof e === 'string') wanted.set(e, { id: e });
      else wanted.set(e.id, e);
    }
    for (const [id, rig] of this.rigs) {
      if (!wanted.has(id)) {
        this.scene.remove(rig.group);
        for (const m of rig.mats) m.dispose();
        const spr = rig.group.children.find((c) => c instanceof THREE.Sprite) as
          | THREE.Sprite
          | undefined;
        if (spr) {
          spr.material.map?.dispose();
          spr.material.dispose();
        }
        this.rigs.delete(id);
      }
    }
    let i = 0;
    for (const [id, entry] of wanted) {
      const existing = this.rigs.get(id);
      if (!existing) {
        const color = entry.side
          ? TEAM_TINTS[entry.side]
          : entry.skin
            ? (SKIN_TINTS[entry.skin] ?? this.palette[i % this.palette.length])
            : this.palette[i % this.palette.length];
        i++;
        const bodyMat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.6,
          metalness: 0.3,
          emissive: color,
          emissiveIntensity: 0.12,
        });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.7 });
        const group = new THREE.Group();
        const body = new THREE.Mesh(_remoteGeoBody, bodyMat);
        body.position.y = 0.95;
        const head = new THREE.Mesh(_remoteGeoHead, darkMat);
        head.position.y = 1.72;
        group.add(body, head);
        let sprite: THREE.Sprite | undefined;
        if (entry.nickname) {
          const tag = entry.side ? TEAM_TAGS[entry.side] : '';
          sprite = makeNameSprite(`${tag}${entry.nickname}`, cssForHex(color));
          group.add(sprite);
        }
        this.scene.add(group);
        this.rigs.set(id, { group, mats: [bodyMat, darkMat], sprite, dead: false, side: entry.side });
      } else {
        // Squad reassignment mid-lobby: recolor rig + rebuild name tag.
        if (entry.side !== existing.side) {
          existing.side = entry.side;
          const color = entry.side
            ? TEAM_TINTS[entry.side]
            : this.palette[0];
          const bodyMat = existing.mats[0];
          bodyMat.color.setHex(color);
          bodyMat.emissive.setHex(color);
          if (existing.sprite && entry.nickname) {
            const tag = entry.side ? TEAM_TAGS[entry.side] : '';
            const fresh = makeNameSprite(`${tag}${entry.nickname}`, cssForHex(color));
            fresh.position.copy(existing.sprite.position);
            existing.group.remove(existing.sprite);
            existing.sprite.material.map?.dispose();
            existing.sprite.material.dispose();
            existing.group.add(fresh);
            existing.sprite = fresh;
          }
        } else if (entry.nickname && !existing.sprite) {
          const color = existing.side ? TEAM_TINTS[existing.side] : this.palette[0];
          const tag = existing.side ? TEAM_TAGS[existing.side] : '';
          const sprite = makeNameSprite(`${tag}${entry.nickname}`, cssForHex(color));
          existing.group.add(sprite);
          existing.sprite = sprite;
        }
      }
    }
  }

  updatePose(id: string, pose: MpPose): void {
    const rig = this.rigs.get(id);
    if (!rig) return;
    rig.group.position.set(pose.x, pose.y, pose.z);
    rig.group.rotation.y = pose.yaw;
    const dead = Boolean(pose.dead || pose.hp <= 0);
    if (dead !== rig.dead) {
      rig.dead = dead;
      // Tip the rig over when eliminated; restore when revived.
      rig.group.rotation.x = dead ? -Math.PI / 2 : 0;
      rig.group.position.y = dead ? pose.y + 0.25 : pose.y;
    }
  }

  dispose(): void {
    for (const [, rig] of this.rigs) {
      this.scene.remove(rig.group);
      for (const m of rig.mats) m.dispose();
      const spr = rig.group.children.find((c) => c instanceof THREE.Sprite) as
        | THREE.Sprite
        | undefined;
      if (spr) {
        spr.material.map?.dispose();
        spr.material.dispose();
      }
    }
    this.rigs.clear();
  }
}
