import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine } from './game/Engine';
import { GameHUD } from './components/GameHUD';
import { Menus } from './components/Menus';
import { StrikeChannel } from './game/multiplayer';
import type { MpMatchConfig, MpPeerInfo } from './game/multiplayer';
import {
  addFriend,
  consumeOAuthSession,
  getBackendKind,
  getFriends,
  getOrCreateProfile,
  registerAccount,
  removeFriend,
  restoreSession,
  sanitizeCallsign,
  signInEmail,
  signInGoogle,
  signOut,
  updateProfile,
  recordMatchResult,
} from './game/auth';
import type { FriendEntry, PlayerProfile, RegistrationDetails } from './game/auth';
import {
  applyProfileDetails,
  hydrateLocalProfileFromCloud,
  pushProfileToCloud,
} from './game/userProfile';
import type { ProfileDetails } from './game/userProfile';
import { createPresenceBackend } from './game/onlinePresence';
import type { OnlinePlayer, PresenceBackend, PresenceInvite } from './game/onlinePresence';
import type { FriendsLobbyProps, LobbyMatchConfig } from './components/FriendsLobby';
import {
  cgGameplayStart,
  cgGameplayStop,
  cgLoadingStop,
  cgSyncMuted,
  initCrazyGames,
} from './game/crazygames';
import { VoiceChat } from './game/voice';
import type { VoiceStatus } from './game/voice';
import type { ChatLine } from './components/ChatBox';
import { DIFFICULTY_TIERS } from './game/rules';
import { TouchControls } from './components/TouchControls';
import type {
  GameSettings,
  HudSnapshot,
  MapId,
  SquadSide,
  WeaponId,
  WeaponSkinId,
} from './game/types';

function resolveInitialMapId(): MapId {
  if (typeof window === 'undefined') return 'dusk_yard';
  const mapParam = new URLSearchParams(window.location.search).get('map');
  if (
    mapParam === 'arctic_outpost' ||
    mapParam === 'desert_compound' ||
    mapParam === 'neon_docks' ||
    mapParam === 'highland_ridge' ||
    mapParam === 'sunken_foundry' ||
    mapParam === 'dusk_yard'
  ) {
    return mapParam;
  }
  return 'dusk_yard';
}

function resolveInitialSkin(): WeaponSkinId {
  if (typeof window === 'undefined') return 'standard';
  const skinParam = new URLSearchParams(window.location.search).get('skin');
  if (
    skinParam === 'desert_tan' ||
    skinParam === 'arctic_camo' ||
    skinParam === 'carbon_gold' ||
    skinParam === 'standard'
  ) {
    return skinParam;
  }
  return 'standard';
}

const INITIAL_MAP = resolveInitialMapId();
const INITIAL_SKIN = resolveInitialSkin();
const INITIAL_LEVEL = (() => {
  if (typeof window === 'undefined') return 1;
  const p = Number(new URLSearchParams(window.location.search).get('level'));
  return Number.isFinite(p) && p >= 1 ? Math.min(8, Math.floor(p)) : 1;
})();

const INITIAL_HUD: HudSnapshot = {
  phase: 'title',
  mapId: INITIAL_MAP,
  currentZone: 'landing',
  weaponSkin: INITIAL_SKIN,
  health: 100,
  maxHealth: 100,
  wave: 1,
  enemiesRemaining: 0,
  waveBannerTimer: 0,
  waveClearBannerTimer: 0,
  activeWeapon: 'rifle',
  ammoInMag: 30,
  magSize: 30,
  ammoReserve: 120,
  isMeleeActive: false,
  grenades: 3,
  maxGrenades: 4,
  grenadeThrowing: false,
  isReloading: false,
  reloadProgress: 0,
  isAds: false,
  isSprinting: false,
  isCrouching: false,
  isSliding: false,
  crosshairSpread: 12,
  hitmarkerTimer: 0,
  hitmarkerCrit: false,
  hitmarkerKill: false,
  damageFlash: 0,
  damageIndicators: [],
  radarBlips: [],
  playerYaw: 0,
  pointerLocked: false,
  killFeed: [],
  stats: {
    wave: 1,
    kills: 0,
    headshots: 0,
    shotsFired: 0,
    shotsHit: 0,
  },
  levelInfo: {
    level: 1,
    label: 'EASY',
    waveInLevel: 1,
    wavesPerLevel: 3,
  },
  vehicle: {
    active: false,
    nearPrompt: false,
    speedKmh: 0,
    label: '',
  },
  radiation: {
    active: false,
    intensity: 0,
    dps: 0,
  },
  multiplayer: {
    enabled: false,
    roomCode: '',
    nickname: '',
    isHost: false,
    connected: false,
    peers: [],
    matchMode: 'survival',
    tier: 'easy',
    scores: [],
    selfSide: null,
    friendlyFire: false,
  },
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Engine | null>(null);

  const [settings, setSettings] = useState<GameSettings>({
    sensitivity: 1.0,
    quality: 'high',
    muted: false,
    mapId: INITIAL_MAP,
    weaponSkin: INITIAL_SKIN,
    mode: 'solo',
    matchMode: 'survival',
    tier: 'easy',
    level: INITIAL_LEVEL,
    friendlyFire: false,
  });
  const settingsRef = useRef<GameSettings>(settings);
  const [previewWeapon, setPreviewWeapon] = useState<WeaponId>('rifle');
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [menuOpen, setMenuOpen] = useState(true);
  const mpRef = useRef<StrikeChannel | null>(null);
  const [mpPeers, setMpPeers] = useState<MpPeerInfo[]>([]);
  const [mpRoomCode, setMpRoomCode] = useState('');
  const [mpSupported, setMpSupported] = useState(true);
  const [scoresOpen, setScoresOpen] = useState(false);

  // ---- Identity / presence / lobby state ----
  const [profile, setProfile] = useState<PlayerProfile>(() => consumeOAuthSession() ?? getOrCreateProfile());
  const [backendKind] = useState(() => getBackendKind());
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [profilePanelOpen, setProfilePanelOpen] = useState(false);
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([]);
  const [friends, setFriends] = useState<FriendEntry[]>(() => getFriends());
  const [presenceInvite, setPresenceInvite] = useState<PresenceInvite | null>(null);
  const [lobbyNotice, setLobbyNotice] = useState('');
  const [matchConfig, setMatchConfig] = useState<LobbyMatchConfig>({
    mode: 'survival',
    mapId: INITIAL_MAP,
    tier: 'easy',
    level: INITIAL_LEVEL,
    friendlyFire: false,
  });
  const [selfSide, setSelfSide] = useState<SquadSide>('attack');
  const matchConfigRef = useRef(matchConfig);
  const presenceRef = useRef<PresenceBackend | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  matchConfigRef.current = matchConfig;

  // ---- Chat & voice state ----
  const [lobbyChat, setLobbyChat] = useState<ChatLine[]>([]);
  const [matchChat, setMatchChat] = useState<ChatLine[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('off');
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [voicePeerCount, setVoicePeerCount] = useState(0);
  const voiceRef = useRef<VoiceChat | null>(null);
  const voiceSignalCbs = useRef(new Set<(fromId: string, payload: unknown) => void>());
  const onlineIdsRef = useRef<string[]>([]);
  onlineIdsRef.current = onlinePlayers.filter((p) => !p.isSelf).map((p) => p.id);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const engine = new Engine(container, settingsRef.current, (snapshot) => {
      // Keep App-level level selection in sync when the engine advances levels
      if (
        snapshot.levelInfo &&
        snapshot.levelInfo.level !== settingsRef.current.level &&
        snapshot.phase !== 'title'
      ) {
        settingsRef.current = { ...settingsRef.current, level: snapshot.levelInfo.level };
        setSettings((s) => ({ ...s, level: snapshot.levelInfo.level }));
      }
      setHud(snapshot);
    });
    engineRef.current = engine;
    cgLoadingStop();

    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      engine.deploy(false);
    }

    return () => {
      engine.dispose();
      engineRef.current = null;
      voiceRef.current?.dispose();
      voiceRef.current = null;
    };
    // Mount WebGL engine once
  }, []);

  const handleUpdateSettings = useCallback((next: Partial<GameSettings>) => {
    const merged: GameSettings = { ...settingsRef.current, ...next };
    settingsRef.current = merged;
    setSettings(merged);
    engineRef.current?.updateSettings(merged);
  }, []);

  const handleSelectPreviewWeapon = useCallback((weaponId: WeaponId) => {
    setPreviewWeapon(weaponId);
    engineRef.current?.setPreviewWeapon(weaponId);
  }, []);

  const handleDeploy = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setChatOpen(false);
    engineRef.current?.deploy(true);
  }, []);

  const handleResume = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    engineRef.current?.resumeGame();
  }, []);

  const handlePause = useCallback(() => {
    setChatOpen(false);
    engineRef.current?.pauseGame();
  }, []);

  const handleQuitToTitle = useCallback(() => {
    engineRef.current?.enterTitleMode();
    setMenuOpen(true);
  }, []);

  const handleToggleMenu = useCallback(() => {
    setMenuOpen((open) => !open);
  }, []);

  const handleToggleMute = useCallback(() => {
    const merged: GameSettings = {
      ...settingsRef.current,
      muted: !settingsRef.current.muted,
    };
    settingsRef.current = merged;
    setSettings(merged);
    engineRef.current?.updateSettings(merged);
  }, []);

  // ---------------- Lobby chat & voice chat ----------------
  const ensureVoice = useCallback((): VoiceChat => {
    if (voiceRef.current) return voiceRef.current;
    const v = new VoiceChat({
      selfId: profileRef.current.id,
      sendSignal: (to, payload) => presenceRef.current?.sendSignal?.(to, payload),
      onSignal: (cb) => {
        voiceSignalCbs.current.add(cb);
        return () => {
          voiceSignalCbs.current.delete(cb);
        };
      },
      maxPeers: 6,
    });
    v.onStatus = (s) => setVoiceStatus(s);
    v.onLocalLevel = (l) => setVoiceLevel(l);
    v.onPeerLevel = () => {};
    voiceRef.current = v;
    return v;
  }, []);

  const handleToggleVoice = useCallback(async () => {
    const v = ensureVoice();
    if (v.isEnabled) {
      v.disable();
      presenceRef.current?.setVoiceActive?.(false);
      setVoiceEnabled(false);
      setVoicePeerCount(0);
      return;
    }
    const ok = await v.enable();
    setVoiceEnabled(ok);
    if (ok) {
      presenceRef.current?.setVoiceActive?.(true);
      v.setPeers(onlineIdsRef.current);
      setVoicePeerCount(Math.min(onlineIdsRef.current.length, 6));
    }
  }, [ensureVoice]);

  const handleToggleVoiceMute = useCallback(() => {
    setVoiceMuted((m) => {
      const next = !m;
      voiceRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const handleSendLobbyChat = useCallback((text: string) => {
    const line: ChatLine = {
      id: `self-${Date.now()}`,
      fromId: 'self',
      fromName: profileRef.current.callsign,
      text,
      ts: Date.now(),
    };
    setLobbyChat((prev) => [...prev.slice(-59), line]);
    presenceRef.current?.sendChat?.(text);
  }, []);

  const handleSendMatchChat = useCallback((text: string) => {
    const line: ChatLine = {
      id: `self-${Date.now()}`,
      fromId: 'self',
      fromName: profileRef.current.callsign,
      text,
      ts: Date.now(),
    };
    setMatchChat((prev) => [...prev.slice(-59), line]);
    mpRef.current?.sendChat(text);
  }, []);

  // ---------------- CrazyGames portal integration ----------------
  useEffect(() => {
    void initCrazyGames({
      onAudioMuteChange: (muted) => {
        const merged: GameSettings = { ...settingsRef.current, muted };
        settingsRef.current = merged;
        setSettings(merged);
        engineRef.current?.updateSettings(merged);
      },
    });
  }, []);

  // Mirror the in-game mute setting back to the portal.
  useEffect(() => {
    cgSyncMuted(settings.muted);
  }, [settings.muted]);

  // gameplayStart/gameplayStop on deploy / pause / game over transitions.
  const prevPhaseRef = useRef(hud.phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = hud.phase;
    if (hud.phase === 'playing' && prev !== 'playing') {
      cgGameplayStart();
    } else if (hud.phase !== 'playing' && prev === 'playing') {
      cgGameplayStop();
    }
  }, [hud.phase]);

  // Block browser/iframe scrolling on game keys and mouse wheel during
  // gameplay so the CrazyGames page never scrolls on jump or weapon switch.
  useEffect(() => {
    const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    const inGameplay = () => {
      const s = document.body.dataset.state;
      return s === 'playing' || s === 'paused' || s === 'levelclear' || s === 'gameover';
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!inGameplay()) return;
      // Let text fields (chat) receive Space/arrows normally.
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
    };
    const onWheel = (e: WheelEvent) => {
      if (inGameplay()) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('wheel', onWheel);
    };
  }, []);

  // ---------------- Presence backend lifecycle ----------------
  useEffect(() => {
    const backend = createPresenceBackend();
    presenceRef.current = backend;
    backend.onPlayers(setOnlinePlayers);
    backend.onInvite(setPresenceInvite);
    backend.onChat?.((m) => {
      setLobbyChat((prev) => [
        ...prev.slice(-59),
        { id: m.id, fromId: m.fromId, fromName: m.fromName, text: m.text, ts: m.ts },
      ]);
    });
    // Fan presence-relay signals out to the voice session (if any).
    backend.onSignal?.((fromId, payload) => {
      for (const cb of voiceSignalCbs.current) cb(fromId, payload);
    });
    backend.start(profile);
    return () => {
      voiceRef.current?.dispose();
      voiceRef.current = null;
      backend.dispose();
      presenceRef.current = null;
    };
    // Restart presence when the signed-in identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, profile.backend, profile.method]);

  // Keep the voice mesh pointed at whoever is currently online.
  useEffect(() => {
    voiceRef.current?.setPeers(onlineIdsRef.current);
    if (voiceRef.current?.isEnabled) {
      setVoicePeerCount(Math.min(onlineIdsRef.current.length, 6));
    }
  }, [onlinePlayers]);

  // Reflect lobby/match activity into presence status badges.
  useEffect(() => {
    const presence = presenceRef.current;
    if (!presence) return;
    if (hud.phase === 'playing' && settings.mode === 'multi') {
      presence.setActivity({ status: 'match', mode: settings.matchMode, roomCode: mpRoomCode || undefined });
    } else if (mpRoomCode) {
      presence.setActivity({ status: 'lobby', mode: matchConfig.mode, roomCode: mpRoomCode });
    } else {
      presence.setActivity({ status: 'online' });
    }
  }, [hud.phase, settings.mode, settings.matchMode, mpRoomCode, matchConfig.mode]);

  // Persist career stats when a run ends.
  const lastPhaseRef = useRef(hud.phase);
  useEffect(() => {
    const prev = lastPhaseRef.current;
    lastPhaseRef.current = hud.phase;
    if (prev === 'playing' && hud.phase === 'gameover') {
      const p = updateProfile(recordMatchResult(hud.stats.kills, false, 1));
      void pushProfileToCloud(p);
      setProfile(getOrCreateProfile());
    } else if (prev === 'playing' && hud.phase === 'levelclear' && hud.levelInfo.level >= 8) {
      const p = updateProfile(recordMatchResult(hud.stats.kills, true, 0));
      void pushProfileToCloud(p);
      setProfile(getOrCreateProfile());
    }
  }, [hud.phase, hud.stats.kills, hud.levelInfo.level]);

  // Restore a persisted cloud session (refreshes provider tokens) on mount.
  useEffect(() => {
    void restoreSession().then((p) => {
      setProfile((cur) => (cur.id === p.id ? p : cur));
      void hydrateLocalProfileFromCloud().then((hydrated) => {
        if (hydrated) setProfile(hydrated);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** After any successful auth: push the doc, then merge cloud fields back. */
  const syncProfileToCloud = useCallback((p: PlayerProfile) => {
    void pushProfileToCloud(p);
    void hydrateLocalProfileFromCloud().then((hydrated) => {
      if (hydrated) setProfile(hydrated);
    });
  }, []);

  // ---------------- Auth handlers ----------------
  const handleSignInGuest = useCallback((callsign: string) => {
    setAuthError('');
    const p = updateProfile({
      callsign: sanitizeCallsign(callsign || `OP-${Math.floor(1000 + Math.random() * 9000)}`),
      method: 'guest',
      backend: getBackendKind(),
      status: 'active',
    });
    setProfile(p);
    setAuthModalOpen(false);
    void pushProfileToCloud(p);
  }, []);

  const handleSignIn = useCallback((email: string, password: string) => {
    setAuthBusy(true);
    setAuthError('');
    signInEmail(email.trim(), password)
      .then((p) => {
        setProfile(p);
        setAuthModalOpen(false);
        syncProfileToCloud(p);
      })
      .catch((e) => setAuthError(e instanceof Error ? e.message : 'Sign-in failed'))
      .finally(() => setAuthBusy(false));
  }, [syncProfileToCloud]);

  const handleRegister = useCallback((email: string, password: string, details: RegistrationDetails) => {
    setAuthBusy(true);
    setAuthError('');
    registerAccount(email.trim(), password, details)
      .then((p) => {
        setProfile(p);
        setAuthModalOpen(false);
        syncProfileToCloud(p);
      })
      .catch((e) => setAuthError(e instanceof Error ? e.message : 'Registration failed'))
      .finally(() => setAuthBusy(false));
  }, [syncProfileToCloud]);

  const handleSignInGoogle = useCallback(() => {
    setAuthError('');
    try {
      signInGoogle();
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Google sign-in unavailable');
    }
  }, []);

  const handleSignOut = useCallback(() => {
    // Mark inactive in the cloud first, then drop to a local guest profile.
    const p = profileRef.current;
    if (p.method !== 'guest') {
      void pushProfileToCloud({ ...p, status: 'inactive' });
    }
    presenceRef.current?.setManualStatus(false);
    setProfile(signOut());
    setAuthModalOpen(false);
    setProfilePanelOpen(false);
  }, []);

  const handleSaveProfile = useCallback((details: ProfileDetails) => {
    const p = applyProfileDetails(details);
    setProfile(p);
  }, []);

  const handleToggleStatus = useCallback((active: boolean) => {
    const p = updateProfile({ status: active ? 'active' : 'inactive' });
    setProfile(p);
    presenceRef.current?.setManualStatus(active);
    void pushProfileToCloud(p);
  }, []);

  // ---------------- Multiplayer channel ----------------
  const applyMatchConfig = useCallback((cfg: MpMatchConfig) => {
    const tier = DIFFICULTY_TIERS.find((t) => t.level === cfg.level)?.id ?? 'easy';
    const nextCfg: LobbyMatchConfig = {
      mode: cfg.mode,
      mapId: cfg.mapId as MapId,
      tier,
      level: cfg.level,
      friendlyFire: Boolean(cfg.friendlyFire),
    };
    setMatchConfig(nextCfg);
    matchConfigRef.current = nextCfg;
    const merged: GameSettings = {
      ...settingsRef.current,
      mapId: cfg.mapId as MapId,
      level: cfg.level,
      matchMode: cfg.mode,
      tier,
      friendlyFire: Boolean(cfg.friendlyFire),
    };
    settingsRef.current = merged;
    setSettings(merged);
    engineRef.current?.updateSettings(merged);
  }, []);

  const wireChannel = useCallback((ch: StrikeChannel) => {
    ch.onPeers((peers) => setMpPeers(peers));
    ch.onChat((id, text, ts) => {
      const nick = ch.getPeerList().find((p) => p.id === id)?.nickname ?? 'OPERATOR';
      setMatchChat((prev) => [
        ...prev.slice(-59),
        { id: `${id}-${ts}`, fromId: id, fromName: nick, text, ts },
      ]);
    });
    ch.onStart((cfg) => {
      applyMatchConfig(cfg);
      engineRef.current?.deploy(false);
    });
    ch.onLobbyConfig((cfg) => {
      applyMatchConfig(cfg);
    });
    engineRef.current?.attachMultiplayer(ch);
    ch.setSkin(settingsRef.current.weaponSkin);
  }, [applyMatchConfig]);

  const teardownMp = useCallback(() => {
    mpRef.current?.dispose();
    mpRef.current = null;
    setMpPeers([]);
    setMpRoomCode('');
    setMatchChat([]);
    engineRef.current?.attachMultiplayer(null);
    const merged: GameSettings = { ...settingsRef.current, mode: 'solo' };
    settingsRef.current = merged;
    setSettings(merged);
  }, []);

  const handleCreateRoom = useCallback(() => {
    teardownMp();
    const ch = StrikeChannel.createRoom(profileRef.current.callsign);
    mpRef.current = ch;
    setMpSupported(ch.supported);
    setMpRoomCode(ch.roomCode);
    setMpPeers([]);
    wireChannel(ch);
    const merged: GameSettings = { ...settingsRef.current, mode: 'multi' };
    settingsRef.current = merged;
    setSettings(merged);
  }, [teardownMp, wireChannel]);

  const handleJoinRoom = useCallback((code: string) => {
    if (code.trim().length !== 6) return;
    teardownMp();
    const ch = StrikeChannel.joinRoom(code, profileRef.current.callsign);
    mpRef.current = ch;
    setMpSupported(ch.supported);
    setMpRoomCode(ch.roomCode);
    wireChannel(ch);
    const merged: GameSettings = { ...settingsRef.current, mode: 'multi' };
    settingsRef.current = merged;
    setSettings(merged);
  }, [teardownMp, wireChannel]);

  const handleQuickMatch = useCallback(() => {
    // Join the first lobby/match room advertised by a live presence entry.
    const target = onlinePlayers.find(
      (p) => !p.isSelf && p.roomCode && (p.status === 'lobby' || p.status === 'match'),
    );
    if (target?.roomCode) {
      handleJoinRoom(target.roomCode);
      setLobbyNotice(`Joined ${target.callsign}'s room`);
    } else {
      handleCreateRoom();
      setLobbyNotice('Opened a room — share the code or wait for operators');
    }
  }, [onlinePlayers, handleJoinRoom, handleCreateRoom]);

  const handleToggleReady = useCallback((ready: boolean) => {
    mpRef.current?.setReady(ready);
  }, []);

  const handleMpDeploy = useCallback(() => {
    const ch = mpRef.current;
    if (ch?.isHost) {
      ch.startMatch({
        mapId: matchConfigRef.current.mapId,
        level: matchConfigRef.current.level,
        mode: matchConfigRef.current.mode,
        tier: matchConfigRef.current.tier,
        friendlyFire: matchConfigRef.current.friendlyFire,
      });
      engineRef.current?.resetMultiplayerScores();
    }
    handleDeploy();
  }, [handleDeploy]);

  const handleLobbyStartMatch = useCallback(() => {
    const ch = mpRef.current;
    if (!ch?.isHost) return;
    ch.startMatch({
      mapId: matchConfigRef.current.mapId,
      level: matchConfigRef.current.level,
      mode: matchConfigRef.current.mode,
      tier: matchConfigRef.current.tier,
      friendlyFire: matchConfigRef.current.friendlyFire,
    });
    applyMatchConfig({
      mapId: matchConfigRef.current.mapId,
      level: matchConfigRef.current.level,
      mode: matchConfigRef.current.mode,
      tier: matchConfigRef.current.tier,
      friendlyFire: matchConfigRef.current.friendlyFire,
    });
    engineRef.current?.resetMultiplayerScores();
    engineRef.current?.deploy(true);
  }, [applyMatchConfig]);

  // ---------------- Friends / invites ----------------
  const handleAddFriendByCode = useCallback((code: string) => {
    const needle = code.trim().toUpperCase();
    if (needle.length !== 6) return;
    const presence = presenceRef.current;
    void (presence?.lookup(needle).then((found) => {
      setFriends(addFriend(needle, found?.callsign ?? needle));
      if (!found) setLobbyNotice(`${needle} saved — currently offline`);
      else setLobbyNotice(`${found.callsign} is online`);
    }) ?? Promise.resolve(setFriends(addFriend(needle, needle))));
  }, []);

  const handleRemoveFriend = useCallback((code: string) => {
    setFriends(removeFriend(code));
  }, []);

  const handleInvitePlayer = useCallback((player: OnlinePlayer) => {
    const ch = mpRef.current;
    // Prefer the uid — DB invite nodes are keyed by user id.
    const target = player.id || player.friendCode || '';
    presenceRef.current?.sendInvite(target, ch?.roomCode ?? '', matchConfigRef.current.mode);
    ch?.sendInvite(target, ch.roomCode, matchConfigRef.current.mode);
    setLobbyNotice(`Invite sent to ${player.callsign} — share code ${ch?.roomCode ?? ''}`);
  }, []);

  const handleJoinPlayerRoom = useCallback((player: OnlinePlayer) => {
    if (player.roomCode) handleJoinRoom(player.roomCode);
  }, [handleJoinRoom]);

  const handleAcceptInvite = useCallback(() => {
    const inv = presenceInvite;
    setPresenceInvite(null);
    if (inv?.roomCode) handleJoinRoom(inv.roomCode);
  }, [presenceInvite, handleJoinRoom]);

  const handleDeclineInvite = useCallback(() => setPresenceInvite(null), []);

  const handleUpdateMatchConfig = useCallback((patch: Partial<LobbyMatchConfig>) => {
    setMatchConfig((prev) => {
      const next = { ...prev, ...patch };
      matchConfigRef.current = next;
      // Mirror into GameSettings so the engine/title preview stay in sync.
      const merged: GameSettings = {
        ...settingsRef.current,
        mapId: next.mapId,
        level: next.level,
        matchMode: next.mode,
        tier: next.tier,
        friendlyFire: next.friendlyFire,
      };
      settingsRef.current = merged;
      setSettings(merged);
      engineRef.current?.updateSettings(merged);
      // Host broadcasts lobby config so clients' rosters stay in sync.
      mpRef.current?.broadcastLobbyConfig?.({
        mapId: next.mapId,
        level: next.level,
        mode: next.mode,
        tier: next.tier,
        friendlyFire: next.friendlyFire,
      });
      return next;
    });
  }, []);

  // ---------------- Squad role / friendly fire / bot fill ----------------
  const handleSetSide = useCallback((side: SquadSide) => {
    setSelfSide(side);
    mpRef.current?.setSide(side);
  }, []);

  const handleToggleFriendlyFire = useCallback(() => {
    handleUpdateMatchConfig({ friendlyFire: !matchConfigRef.current.friendlyFire });
  }, [handleUpdateMatchConfig]);

  const handleSimulateBots = useCallback(() => {
    const ch = mpRef.current;
    if (!ch?.isHost) return;
    ch.simulateBots([
      { nickname: 'VIPER-1', side: 'alpha' },
      { nickname: 'VIPER-2', side: 'alpha' },
      { nickname: 'HAVOC-1', side: 'bravo' },
      { nickname: 'HAVOC-2', side: 'bravo' },
    ]);
    setLobbyNotice('Simulated squad fill active — 2v2 bots in roster');
  }, []);

  const handleClearBots = useCallback(() => {
    mpRef.current?.clearBots();
    setLobbyNotice('Simulated squad removed');
  }, []);

  const handleDeployNextLevel = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    engineRef.current?.deployNextLevel();
  }, []);

  const handleReplayLevel = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    engineRef.current?.replayLevel();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (hud.phase === 'title') {
        if (e.code === 'Escape') {
          e.preventDefault();
          handleToggleMenu();
        } else if (menuOpen && (e.code === 'Enter' || e.code === 'Space')) {
          e.preventDefault();
          handleDeploy();
        }
      } else if (e.code === 'KeyM') {
        handleToggleMute();
      } else if (e.code === 'Tab' && hud.phase === 'playing') {
        e.preventDefault();
        setScoresOpen((open) => !open);
      } else if (e.code === 'Enter' && hud.phase === 'playing' && !chatOpen) {
        e.preventDefault();
        setChatOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hud.phase, menuOpen, chatOpen, handleDeploy, handleToggleMenu, handleToggleMute]);

  // Shared voice-chat prop bag (HUD + lobby).
  const voiceHud = {
    enabled: voiceEnabled,
    muted: voiceMuted,
    status: voiceStatus,
    level: voiceLevel,
    peerCount: voicePeerCount,
    onToggleMic: () => {
      void handleToggleVoice();
    },
    onToggleMute: handleToggleVoiceMute,
  };

  // Compose the FriendsLobby prop bag from live state.
  const lobbyProps: FriendsLobbyProps | null =
    settings.mode === 'multi'
      ? {
          profile,
          backendKind,
          onlinePlayers,
          friends,
          members: hud.multiplayer.peers,
          roomCode: mpRoomCode || hud.multiplayer.roomCode,
          inRoom: Boolean(mpRef.current) || hud.multiplayer.enabled,
          isHost: hud.multiplayer.isHost,
          channelSupported: mpSupported && hud.multiplayer.connected !== false,
          matchConfig,
          invite: presenceInvite,
          onUpdateMatchConfig: handleUpdateMatchConfig,
          onCreateRoom: handleCreateRoom,
          onJoinRoom: handleJoinRoom,
          onQuickMatch: handleQuickMatch,
          onLeaveRoom: teardownMp,
          onToggleReady: handleToggleReady,
          onStartMatch: handleLobbyStartMatch,
          onAddFriendByCode: handleAddFriendByCode,
          onRemoveFriend: handleRemoveFriend,
          onInvitePlayer: handleInvitePlayer,
          onJoinPlayerRoom: handleJoinPlayerRoom,
          onCopyFriendCode: () => {
            navigator.clipboard?.writeText(profile.friendCode).catch(() => {});
          },
          onAcceptInvite: handleAcceptInvite,
          onDeclineInvite: handleDeclineInvite,
          selfSide,
          onSetSide: handleSetSide,
          onToggleFriendlyFire: handleToggleFriendlyFire,
          onSimulateBots: handleSimulateBots,
          onClearBots: handleClearBots,
          chatLines: lobbyChat,
          onSendChat: handleSendLobbyChat,
          voice: voiceHud,
        }
      : null;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0b0e13]">
      <div ref={mountRef} data-testid="fps-canvas-container" className="w-full h-full" />

      <GameHUD
        hud={hud}
        mapId={settings.mapId}
        muted={settings.muted}
        onToggleMute={handleToggleMute}
        onPause={handlePause}
        showScores={scoresOpen}
        chatLines={matchChat}
        chatSelfName={profile.callsign}
        chatOpen={chatOpen}
        onChatOpenChange={setChatOpen}
        onSendChat={handleSendMatchChat}
        voice={voiceHud}
      />

      <TouchControls
        getPlayer={() => engineRef.current?.player ?? null}
        active={hud.phase === 'playing'}
        vehicleActive={hud.vehicle.active}
      />

      <Menus
        hud={hud}
        settings={settings}
        previewWeapon={previewWeapon}
        onSelectPreviewWeapon={handleSelectPreviewWeapon}
        onUpdateSettings={handleUpdateSettings}
        onDeploy={handleDeploy}
        onResume={handleResume}
        onQuitToTitle={handleQuitToTitle}
        menuOpen={menuOpen}
        onToggleMenu={handleToggleMenu}
        lobby={lobbyProps}
        profile={profile}
        backendKind={backendKind}
        authBusy={authBusy}
        authError={authError}
        authModalOpen={authModalOpen}
        profilePanelOpen={profilePanelOpen}
        onOpenAuthModal={() => setAuthModalOpen(true)}
        onCloseAuthModal={() => setAuthModalOpen(false)}
        onOpenProfilePanel={() => setProfilePanelOpen(true)}
        onCloseProfilePanel={() => setProfilePanelOpen(false)}
        onRegister={handleRegister}
        onSignIn={handleSignIn}
        onSignInGuest={handleSignInGuest}
        onSignInGoogle={handleSignInGoogle}
        onSignOut={handleSignOut}
        onSaveProfile={handleSaveProfile}
        onToggleStatus={handleToggleStatus}
        onMpDeploy={handleMpDeploy}
        onDeployNextLevel={handleDeployNextLevel}
        onReplayLevel={handleReplayLevel}
      />
    </main>
  );
}
