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
  removeFriend,
  sanitizeCallsign,
  signInEmail,
  signInGoogle,
  signOut,
  updateProfile,
  recordMatchResult,
} from './game/auth';
import type { FriendEntry, PlayerProfile } from './game/auth';
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
import { DIFFICULTY_TIERS } from './game/rules';
import type {
  GameSettings,
  HudSnapshot,
  MapId,
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
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([]);
  const [friends, setFriends] = useState<FriendEntry[]>(() => getFriends());
  const [presenceInvite, setPresenceInvite] = useState<PresenceInvite | null>(null);
  const [lobbyNotice, setLobbyNotice] = useState('');
  const [matchConfig, setMatchConfig] = useState<LobbyMatchConfig>({
    mode: 'survival',
    mapId: INITIAL_MAP,
    tier: 'easy',
    level: INITIAL_LEVEL,
  });
  const matchConfigRef = useRef(matchConfig);
  const presenceRef = useRef<PresenceBackend | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  matchConfigRef.current = matchConfig;

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
    engineRef.current?.deploy(true);
  }, []);

  const handleResume = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    engineRef.current?.resumeGame();
  }, []);

  const handlePause = useCallback(() => {
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
      if (inGameplay() && GAME_KEYS.has(e.code)) e.preventDefault();
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
    backend.start(profile);
    return () => {
      backend.dispose();
      presenceRef.current = null;
    };
    // Restart presence when the signed-in identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, profile.backend, profile.method]);

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
      updateProfile(recordMatchResult(hud.stats.kills, false));
      setProfile(getOrCreateProfile());
    } else if (prev === 'playing' && hud.phase === 'levelclear' && hud.levelInfo.level >= 8) {
      updateProfile(recordMatchResult(hud.stats.kills, true));
      setProfile(getOrCreateProfile());
    }
  }, [hud.phase, hud.stats.kills, hud.levelInfo.level]);

  // ---------------- Auth handlers ----------------
  const handleSignInGuest = useCallback((callsign: string) => {
    setAuthError('');
    const p = updateProfile({
      callsign: sanitizeCallsign(callsign || `OP-${Math.floor(1000 + Math.random() * 9000)}`),
      method: 'guest',
      backend: getBackendKind(),
    });
    setProfile(p);
  }, []);

  const handleSignInEmail = useCallback((email: string, password: string) => {
    setAuthBusy(true);
    setAuthError('');
    signInEmail(email.trim(), password)
      .then((p) => setProfile(p))
      .catch((e) => setAuthError(e instanceof Error ? e.message : 'Sign-in failed'))
      .finally(() => setAuthBusy(false));
  }, []);

  const handleSignInGoogle = useCallback(() => {
    setAuthError('');
    try {
      signInGoogle();
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Google sign-in unavailable');
    }
  }, []);

  const handleSignOut = useCallback(() => {
    setProfile(signOut());
  }, []);

  // ---------------- Multiplayer channel ----------------
  const applyMatchConfig = useCallback((cfg: MpMatchConfig) => {
    const tier = DIFFICULTY_TIERS.find((t) => t.level === cfg.level)?.id ?? 'easy';
    const nextCfg: LobbyMatchConfig = {
      mode: cfg.mode,
      mapId: cfg.mapId as MapId,
      tier,
      level: cfg.level,
    };
    setMatchConfig(nextCfg);
    matchConfigRef.current = nextCfg;
    const merged: GameSettings = {
      ...settingsRef.current,
      mapId: cfg.mapId as MapId,
      level: cfg.level,
      matchMode: cfg.mode,
      tier,
    };
    settingsRef.current = merged;
    setSettings(merged);
    engineRef.current?.updateSettings(merged);
  }, []);

  const wireChannel = useCallback((ch: StrikeChannel) => {
    ch.onPeers((peers) => setMpPeers(peers));
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
    });
    applyMatchConfig({
      mapId: matchConfigRef.current.mapId,
      level: matchConfigRef.current.level,
      mode: matchConfigRef.current.mode,
      tier: matchConfigRef.current.tier,
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
    const target = player.friendCode || player.id;
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
      });
      return next;
    });
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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hud.phase, menuOpen, handleDeploy, handleToggleMenu, handleToggleMute]);

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
        onSignInGuest={handleSignInGuest}
        onSignInEmail={handleSignInEmail}
        onSignInGoogle={handleSignInGoogle}
        onSignOut={handleSignOut}
        onMpDeploy={handleMpDeploy}
        onDeployNextLevel={handleDeployNextLevel}
        onReplayLevel={handleReplayLevel}
      />
    </main>
  );
}
