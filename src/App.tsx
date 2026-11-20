import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine } from './game/Engine';
import { GameHUD } from './components/GameHUD';
import { Menus } from './components/Menus';
import type { GameSettings, HudSnapshot, MapId, WeaponId, WeaponSkinId } from './game/types';

function resolveInitialMapId(): MapId {
  if (typeof window === 'undefined') return 'dusk_yard';
  const mapParam = new URLSearchParams(window.location.search).get('map');
  if (mapParam === 'arctic_outpost' || mapParam === 'desert_compound' || mapParam === 'dusk_yard') {
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
  });
  const settingsRef = useRef<GameSettings>(settings);
  const [previewWeapon, setPreviewWeapon] = useState<WeaponId>('rifle');
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const engine = new Engine(container, settingsRef.current, (snapshot) => {
      setHud(snapshot);
    });
    engineRef.current = engine;

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (hud.phase === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        handleDeploy();
      } else if (e.code === 'KeyM') {
        handleToggleMute();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hud.phase, handleDeploy, handleToggleMute]);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0b0e13]">
      <div ref={mountRef} data-testid="fps-canvas-container" className="w-full h-full" />

      <GameHUD
        hud={hud}
        mapId={settings.mapId}
        muted={settings.muted}
        onToggleMute={handleToggleMute}
        onPause={handlePause}
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
      />
    </main>
  );
}
