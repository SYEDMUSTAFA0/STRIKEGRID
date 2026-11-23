import {
  MAP_SPECS,
  MAX_LEVEL,
  WEAPON_SKIN_SPECS,
  WEAPON_SPECS,
  ZONE_SPECS,
  calculateAccuracyPercent,
  getLevelConfig,
} from '../game/rules';
import { Crosshair, Menu, Play, User, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { FriendsLobby } from './FriendsLobby';
import type { FriendsLobbyProps } from './FriendsLobby';
import { AuthModal } from './AuthModal';
import { ProfilePanel } from './ProfilePanel';
import { avatarPreset, defaultProfileDetails, type ProfileDetails } from '../game/userProfile';
import type { BackendKind, PlayerProfile, RegistrationDetails } from '../game/auth';
import type {
  GameSettings,
  GraphicsQuality,
  HudSnapshot,
  MapId,
  WeaponId,
  WeaponSkinId,
} from '../game/types';

interface MenusProps {
  hud: HudSnapshot;
  settings: GameSettings;
  previewWeapon: WeaponId;
  onSelectPreviewWeapon: (weaponId: WeaponId) => void;
  onUpdateSettings: (next: Partial<GameSettings>) => void;
  onDeploy: () => void;
  onResume: () => void;
  onQuitToTitle: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  lobby: FriendsLobbyProps | null;
  profile: PlayerProfile;
  backendKind: BackendKind;
  authBusy: boolean;
  authError: string;
  authModalOpen: boolean;
  profilePanelOpen: boolean;
  onOpenAuthModal: () => void;
  onCloseAuthModal: () => void;
  onOpenProfilePanel: () => void;
  onCloseProfilePanel: () => void;
  onRegister: (email: string, password: string, details: RegistrationDetails) => void;
  onSignIn: (email: string, password: string) => void;
  onSignInGuest: (callsign: string) => void;
  onSignInGoogle: () => void;
  onSignOut: () => void;
  onSaveProfile: (details: ProfileDetails) => void;
  onToggleStatus: (active: boolean) => void;
  onMpDeploy: () => void;
  onDeployNextLevel: () => void;
  onReplayLevel: () => void;
}

const MAP_ORDER: MapId[] = [
  'dusk_yard',
  'neon_docks',
  'arctic_outpost',
  'highland_ridge',
  'desert_compound',
  'sunken_foundry',
];
const SKIN_ORDER: WeaponSkinId[] = ['standard', 'desert_tan', 'arctic_camo', 'carbon_gold'];
const PREVIEW_WEAPONS: ReadonlyArray<{ id: WeaponId; label: string }> = [
  { id: 'rifle', label: 'MK-18' },
  { id: 'pistol', label: 'P226' },
  { id: 'shotgun', label: 'M870' },
  { id: 'marksman', label: 'MK-14' },
  { id: 'smg', label: 'SMG' },
  { id: 'lmg', label: 'LMG' },
  { id: 'deagle', label: 'DGL' },
];

const MAP_BRIEFS: Record<MapId, string> = {
  dusk_yard:
    'Container compound at dusk. Overhead catwalks, steel ramps, and a gantry crane overlook the yard.',
  arctic_outpost:
    'Snowbound research base under whiteout. Radar domes, bunkers, and snowbank ramps in sub-zero fog.',
  desert_compound:
    'Sun-baked sandstone fortress at high noon. Walkable arches, sniper perches, and sandbag lines.',
  neon_docks:
    'Rain-slicked night harbor. Glowing cranes, neon container alleys, and docked patrol craft.',
  highland_ridge:
    'Golden-hour mountain relay outpost. Pine ridges, watchtowers, radar dishes, and long sightlines.',
  sunken_foundry:
    'Molten-steel works deep in the yard. Furnace glow, catwalk bridges, and close-quarters lanes.',
};

const MISSION_ZONES: ReadonlyArray<{ code: string; name: string; accent: string }> = [
  { code: ZONE_SPECS.landing.code, name: 'Landing Zone', accent: ZONE_SPECS.landing.accentColor },
  { code: ZONE_SPECS.building.code, name: 'Building Ops', accent: ZONE_SPECS.building.accentColor },
  { code: ZONE_SPECS.forest.code, name: 'Bio Woods', accent: ZONE_SPECS.forest.accentColor },
  { code: ZONE_SPECS.restriction.code, name: 'Sec-Max', accent: ZONE_SPECS.restriction.accentColor },
];

function StatBar({ label, value, max, display }: { label: string; value: number; max: number; display: string }) {
  const pct = Math.max(4, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-[9.5px] uppercase tracking-[0.18em] text-stone-400 mb-1">
        <span>{label}</span>
        <span className="tabular-nums text-stone-200">{display}</span>
      </div>
      <div className="h-1 rounded-full bg-stone-800/80 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-600 via-amber-500 to-amber-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-stone-300">
      <span className="w-1 h-3.5 rounded-full bg-gradient-to-b from-amber-400 to-amber-600" />
      {children}
    </div>
  );
}

export function Menus({
  hud,
  settings,
  previewWeapon,
  onSelectPreviewWeapon,
  onUpdateSettings,
  onDeploy,
  onResume,
  onQuitToTitle,
  menuOpen,
  onToggleMenu,
  lobby,
  profile,
  backendKind,
  authBusy,
  authError,
  authModalOpen,
  profilePanelOpen,
  onOpenAuthModal,
  onCloseAuthModal,
  onOpenProfilePanel,
  onCloseProfilePanel,
  onRegister,
  onSignIn,
  onSignInGuest,
  onSignInGoogle,
  onSignOut,
  onSaveProfile,
  onToggleStatus,
  onMpDeploy,
  onDeployNextLevel,
  onReplayLevel,
}: MenusProps) {
  const inMultiplayer = settings.mode === 'multi';
  const isActive = profile.status !== 'inactive';
  const emblem = avatarPreset(profile.avatarPreset);
  if (hud.phase === 'title' && !menuOpen) {
    return (
      <div className="fixed inset-0 z-20 pointer-events-none font-mono text-stone-100">
        <div className="absolute top-5 right-6 flex items-center gap-3 text-[10px] tracking-[0.22em] uppercase text-stone-400">
          <span className="hidden sm:inline">{MAP_SPECS[settings.mapId].name}</span>
          <button
            type="button"
            onClick={onToggleMenu}
            title="Menu Hidden · Press ESC"
            aria-label="Show menu"
            className="pointer-events-auto flex items-center justify-center rounded-md border border-amber-500/50 bg-[#0b0f16]/85 backdrop-blur-sm w-9 h-9 text-amber-400 hover:bg-amber-500 hover:text-stone-950 transition-colors cursor-pointer"
          >
            <Menu className="w-4.5 h-4.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={onDeploy}
          className="pointer-events-auto absolute bottom-6 right-6 rounded-md border border-stone-700 bg-[#0b0f16]/85 backdrop-blur-sm px-4 py-2 text-[11px] tracking-[0.24em] uppercase text-stone-200 hover:border-amber-500/70 hover:text-amber-400 transition-colors cursor-pointer"
        >
          Deploy [Enter]
        </button>
      </div>
    );
  }

  if (hud.phase === 'title') {
    const activeMap = MAP_SPECS[settings.mapId];

    const previewSpec = WEAPON_SPECS[previewWeapon];

    return (
      <div className="fixed inset-0 z-20 pointer-events-none font-mono text-stone-100">
        {/* Tactical backdrop: grid, scanlines, vignette, ambient glow */}
        <div className="absolute inset-0 tac-grid" />
        <div className="absolute inset-0 tac-scanlines opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#070a0f]/95 via-[#070a0f]/70 to-[#070a0f]/25" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_28%_38%,rgba(245,158,11,0.08),transparent_70%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_50%,rgba(0,0,0,0.6)_100%)]" />

        <div className="relative h-full flex flex-col p-4 sm:p-6 md:p-9">
          {/* Scrollable console area — panel scrolls, footer stays pinned */}
          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex tac-fade-up">
          {/* Deployment console panel */}
          <div className="relative w-full max-w-[560px] m-auto bg-[#0d1117]/95 backdrop-blur-md rounded-lg border border-stone-700/60 border-t-stone-600/80 p-4 sm:p-6 shadow-[0_24px_70px_rgba(0,0,0,0.65),0_0_50px_rgba(245,158,11,0.05)] pointer-events-auto">

            {/* Header lockup + live status cluster */}
            <div className="flex items-start justify-between gap-4 mb-5">
              <div className="flex items-center gap-3.5">
                <svg viewBox="0 0 48 48" className="w-12 h-12 shrink-0 drop-shadow-[0_0_14px_rgba(245,158,11,0.4)]" aria-hidden="true">
                  <polygon
                    points="24,3 44,14 44,34 24,45 4,34 4,14"
                    fill="#161c26"
                    stroke="#f59e0b"
                    strokeWidth="2.5"
                  />
                  <circle cx="24" cy="24" r="9" fill="none" stroke="#e7e5e4" strokeWidth="1.8" />
                  <line x1="24" y1="9" x2="24" y2="17" stroke="#f59e0b" strokeWidth="2.2" />
                  <line x1="24" y1="31" x2="24" y2="39" stroke="#f59e0b" strokeWidth="2.2" />
                  <line x1="9" y1="24" x2="17" y2="24" stroke="#f59e0b" strokeWidth="2.2" />
                  <line x1="31" y1="24" x2="39" y2="24" stroke="#f59e0b" strokeWidth="2.2" />
                  <circle cx="24" cy="24" r="2.2" fill="#f59e0b" />
                </svg>
                <div>
                  <h1 className="text-3xl sm:text-4xl font-black tracking-[0.12em] text-stone-100 leading-none">
                    SECTOR <span className="bg-gradient-to-b from-amber-300 to-amber-600 bg-clip-text text-transparent">09</span>
                  </h1>
                  <p className="text-[10px] font-medium tracking-[0.32em] text-stone-500 uppercase mt-2">
                    Tactical FPS · Wave Ops
                  </p>
                </div>
              </div>
              <div className="hidden sm:flex flex-col items-end gap-1 text-[9.5px] uppercase tracking-[0.2em] text-stone-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 tac-blink" />
                  Sim Online
                </span>
                <span>Engine v2.4 · WebGL</span>
                <span className="text-amber-500/80">{activeMap.name.toUpperCase()}</span>
              </div>
            </div>

            {/* Operator card + access */}
            <div className="mb-5 border-t border-stone-800/70 pt-4">
              <div className="flex items-center justify-between mb-2">
                <SectionLabel>Operator</SectionLabel>
                <span
                  className={`flex items-center gap-1 text-[9px] tracking-[0.18em] uppercase ${
                    backendKind === 'none' ? 'text-amber-400' : 'text-emerald-400'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current tac-blink" />
                  {backendKind === 'none' ? 'Offline' : backendKind.toUpperCase()}
                </span>
              </div>

              {/* Player card */}
              <div className="flex items-center justify-between gap-3 rounded-md border border-stone-700/60 bg-[#11161f]/80 px-3 py-2.5 mb-2.5">
                <div className="min-w-0 flex items-center gap-2.5">
                  <span
                    className="inline-flex items-center justify-center w-9 h-9 text-base font-bold shrink-0"
                    style={{
                      background: `${emblem.color}22`,
                      color: emblem.color,
                      clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
                    }}
                  >
                    {emblem.glyph}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold tracking-[0.14em] text-stone-100 uppercase truncate">
                        {profile.callsign}
                      </span>
                      <span
                        className={`px-1.5 py-px border text-[8.5px] tracking-[0.16em] uppercase ${
                          isActive
                            ? 'border-emerald-800 text-emerald-400'
                            : 'border-stone-700 text-stone-500'
                        }`}
                      >
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="text-[9px] tracking-[0.16em] uppercase text-stone-500 mt-0.5">
                      {profile.method === 'guest' ? 'Guest' : profile.method.toUpperCase()} · LV {profile.level} ·{' '}
                      {profile.kills} kills · {profile.wins} wins
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(profile.friendCode).catch(() => {});
                  }}
                  title="Copy Friend Code / Player ID"
                  className="shrink-0 flex flex-col items-end gap-0.5 rounded-md border border-stone-700/70 bg-[#141923] hover:border-amber-500/70 px-2.5 py-1.5 cursor-pointer transition-colors"
                >
                  <span className="text-[8px] tracking-[0.2em] uppercase text-stone-500">Friend Code</span>
                  <span className="text-[12px] font-bold tracking-[0.24em] text-amber-300">
                    {profile.friendCode}
                  </span>
                  <span className="text-[8px] tracking-[0.14em] uppercase text-stone-500">
                    ID {profile.id.slice(0, 10)}
                  </span>
                </button>
              </div>

              <div className="flex gap-1.5">
                <button
                  type="button"
                  data-auth="open"
                  onClick={onOpenAuthModal}
                  className="flex-1 py-2 rounded-md bg-gradient-to-b from-[#1c2534] to-[#161d29] hover:from-[#232f42] hover:to-[#1a2230] border border-stone-700/70 text-stone-200 text-[10px] font-medium tracking-[0.16em] uppercase cursor-pointer transition-all"
                >
                  {profile.method === 'guest' ? 'Sign In / Register' : 'Switch Account'}
                </button>
                <button
                  type="button"
                  data-profile="open"
                  onClick={onOpenProfilePanel}
                  className="flex-1 py-2 rounded-md bg-gradient-to-b from-[#1c2534] to-[#161d29] hover:from-[#232f42] hover:to-[#1a2230] border border-stone-700/70 text-stone-200 text-[10px] font-medium tracking-[0.16em] uppercase cursor-pointer transition-all"
                >
                  Operator Profile
                </button>
                {profile.method !== 'guest' && (
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="px-3 py-2 rounded-md border border-stone-800 text-stone-500 hover:text-red-300 hover:border-red-900/60 text-[10px] tracking-[0.16em] uppercase cursor-pointer transition-colors"
                  >
                    Sign Out
                  </button>
                )}
              </div>
              {authError && (
                <div className="mt-1.5 text-[9.5px] tracking-[0.12em] uppercase text-red-400">{authError}</div>
              )}
            </div>

            {/* Access modals */}
            <AuthModal
              open={authModalOpen}
              backendKind={backendKind}
              busy={authBusy}
              error={authError}
              onClose={onCloseAuthModal}
              onGuest={onSignInGuest}
              onRegister={onRegister}
              onSignIn={onSignIn}
              onGoogle={onSignInGoogle}
            />
            <ProfilePanel
              open={profilePanelOpen}
              profile={profile}
              busy={authBusy}
              onClose={onCloseProfilePanel}
              onSave={onSaveProfile}
              onToggleStatus={onToggleStatus}
            />

            {/* Mission brief strip */}
            <div className="mb-5 border-t border-stone-800/70 pt-4">
              <div className="flex items-center justify-between mb-1.5">
                <SectionLabel>Mission Brief</SectionLabel>
                <span className="text-[9px] tracking-[0.24em] text-stone-500 uppercase">
                  Objective: Survive
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-stone-300/90 mb-2.5">
                {MAP_BRIEFS[settings.mapId]}
              </p>
              <div className="grid grid-cols-4 gap-1.5">
                {MISSION_ZONES.map((z) => (
                  <div
                    key={z.code}
                    className="rounded-md border border-stone-800/70 bg-[#11161f]/70 px-1.5 py-1.5 text-center"
                  >
                    <div className="text-[8.5px] tracking-[0.14em] uppercase" style={{ color: z.accent }}>
                      {z.code}
                    </div>
                    <div className="text-[8px] tracking-[0.12em] uppercase text-stone-500 truncate">
                      {z.name}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Deployment sector selector */}
            <div className="mb-5 border-t border-stone-800/70 pt-4">
              <SectionLabel>Deployment Sector</SectionLabel>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-2">
                {MAP_ORDER.map((id) => {
                  const m = MAP_SPECS[id];
                  const selected = settings.mapId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      data-map-id={id}
                      onClick={() => onUpdateSettings({ mapId: id })}
                      className={`group text-left px-2.5 py-2.5 rounded-md border transition-all duration-200 cursor-pointer ${
                        selected
                          ? 'bg-gradient-to-b from-[#1e2839] to-[#161d2b] border-amber-500/80 text-stone-100 shadow-[0_0_18px_rgba(245,158,11,0.15)]'
                          : 'bg-[#11161f]/70 border-stone-800/80 text-stone-400 hover:border-stone-600 hover:text-stone-200 hover:bg-[#151b26]'
                      }`}
                    >
                      <div
                        className="w-full h-0.5 mb-1.5 transition-all"
                        style={{
                          backgroundColor: selected ? m.badgeColor : '#334155',
                          boxShadow: selected ? `0 0 8px ${m.badgeColor}` : 'none',
                        }}
                      />
                      <div className="text-[10.5px] font-bold tracking-wide uppercase leading-tight whitespace-nowrap">
                        {m.name}
                      </div>
                      <div className="text-[9.5px] tracking-widest uppercase text-stone-400 mt-0.5 whitespace-nowrap">
                        {m.subtitle}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Threat level selector */}
            <div className="mb-5 border-t border-stone-800/70 pt-4">
              <div className="flex items-center justify-between">
                <SectionLabel>Threat Level</SectionLabel>
                <span className="text-[9px] tracking-[0.2em] uppercase text-stone-500">
                  {getLevelConfig(hud.levelInfo.level).label} · LV {hud.levelInfo.level}
                </span>
              </div>
              <div className="grid grid-cols-8 gap-1 mt-2">
                {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((lv) => {
                  const cfg = getLevelConfig(lv);
                  const selected = settings.level === lv;
                  const tierColor =
                    cfg.label === 'EASY'
                      ? 'text-emerald-400'
                      : cfg.label === 'MEDIUM'
                        ? 'text-sky-400'
                        : cfg.label === 'HARD'
                          ? 'text-orange-400'
                          : 'text-red-400';
                  return (
                    <button
                      key={lv}
                      type="button"
                      data-level={lv}
                      onClick={() => onUpdateSettings({ level: lv })}
                      title={`${cfg.label} — LV ${lv}`}
                      className={`py-2 rounded-md border text-[10px] font-bold tracking-wider cursor-pointer transition-all duration-150 ${
                        selected
                          ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-stone-950 border-amber-400 shadow-[0_0_14px_rgba(245,158,11,0.35)]'
                          : 'bg-[#11161f]/70 border-stone-800/80 text-stone-400 hover:border-stone-600 hover:text-stone-200'
                      }`}
                    >
                      <span className={selected ? '' : tierColor}>{lv}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1 text-[8.5px] tracking-[0.16em] uppercase text-stone-600">
                <span>Easy 1-2</span>
                <span>Medium 3-4</span>
                <span>Hard 5-6</span>
                <span className="text-red-500/70">Extreme 7-8</span>
              </div>
            </div>

            {/* Operation mode: Solo / Multiplayer lobby */}
            <div className="mb-5 border-t border-stone-800/70 pt-4">
              <SectionLabel>Operation Mode</SectionLabel>
              <div className="flex rounded-md border border-stone-800/80 bg-[#0d1117]/80 p-0.5 mt-2">
                <button
                  type="button"
                  data-mode="solo"
                  onClick={() => onUpdateSettings({ mode: 'solo' })}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10.5px] font-semibold tracking-[0.18em] uppercase rounded cursor-pointer transition-all duration-200 ${
                    !inMultiplayer
                      ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-stone-950 shadow-[0_0_14px_rgba(245,158,11,0.3)]'
                      : 'text-stone-400 hover:text-stone-200 hover:bg-white/5'
                  }`}
                >
                  <User className="w-3 h-3" /> Solo
                </button>
                <button
                  type="button"
                  data-mode="multi"
                  onClick={() => onUpdateSettings({ mode: 'multi' })}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10.5px] font-semibold tracking-[0.18em] uppercase rounded cursor-pointer transition-all duration-200 ${
                    inMultiplayer
                      ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-stone-950 shadow-[0_0_14px_rgba(245,158,11,0.3)]'
                      : 'text-stone-400 hover:text-stone-200 hover:bg-white/5'
                  }`}
                >
                  <Users className="w-3 h-3" /> Multiplayer
                </button>
              </div>

              {inMultiplayer && lobby && <FriendsLobby {...lobby} />}
              {inMultiplayer && !lobby && (
                <div className="mt-2 border border-stone-800/80 bg-[#0d1219]/80 p-3 text-[10px] tracking-[0.14em] uppercase text-stone-500">
                  Lobby offline — presence backend unavailable
                </div>
              )}
            </div>

            {/* Arsenal finish + live weapon spec sheet */}
            <div className="mb-5 border-t border-stone-800/70 pt-4">
              <div className="flex items-center justify-between gap-2">
                <SectionLabel>Arsenal Finish</SectionLabel>
                <div className="flex flex-wrap justify-end rounded-md border border-stone-800/80 bg-[#0d1117]/80 p-0.5 max-w-[300px]">
                  {PREVIEW_WEAPONS.map((w) => {
                    const active = previewWeapon === w.id;
                    return (
                      <button
                        key={w.id}
                        type="button"
                        data-preview-weapon={w.id}
                        onClick={() => onSelectPreviewWeapon(w.id)}
                        className={`px-2 py-1 rounded text-[9.5px] font-semibold tracking-wider uppercase cursor-pointer transition-all duration-150 ${
                          active
                            ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-stone-950 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                            : 'text-stone-400 hover:text-stone-200 hover:bg-white/5'
                        }`}
                      >
                        {w.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5 mt-2">
                {SKIN_ORDER.map((id) => {
                  const s = WEAPON_SKIN_SPECS[id];
                  const selected = settings.weaponSkin === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      data-skin-id={id}
                      onClick={() => onUpdateSettings({ weaponSkin: id })}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-md border text-left transition-all duration-150 cursor-pointer ${
                        selected
                          ? 'bg-gradient-to-b from-[#1e2839] to-[#161d2b] border-amber-500/80 text-stone-100 shadow-[0_0_14px_rgba(245,158,11,0.12)]'
                          : 'bg-[#11161f]/70 border-stone-800/80 text-stone-400 hover:border-stone-600 hover:text-stone-200 hover:bg-[#151b26]'
                      }`}
                    >
                      <span className="flex w-5 h-5 shrink-0 rounded border border-stone-600/80 overflow-hidden">
                        <span className="w-1/2 h-full" style={{ backgroundColor: s.swatchPrimary }} />
                        <span className="w-1/2 h-full" style={{ backgroundColor: s.swatchAccent }} />
                      </span>
                      <span className="text-[11px] tracking-wider uppercase truncate">{s.name}</span>
                    </button>
                  );
                })}
              </div>

              {/* Live weapon telemetry for the previewed firearm */}
              <div className="mt-3 border-t border-stone-800/70 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Crosshair className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-[11px] font-bold tracking-[0.14em] uppercase text-stone-100">
                      {previewSpec.name}
                    </span>
                  </div>
                  <span className="text-[9px] tracking-[0.2em] uppercase text-stone-500">
                    {previewSpec.shortLabel} · Slot {previewSpec.keyBind}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <StatBar
                    label="Damage"
                    value={previewSpec.isMelee ? 0 : previewSpec.damage * (previewSpec.pellets ?? 1)}
                    max={previewSpec.isMelee ? 100 : 160}
                    display={previewSpec.isMelee ? '—' : String(previewSpec.damage * (previewSpec.pellets ?? 1))}
                  />
                  <StatBar
                    label="Fire Rate"
                    value={previewSpec.fireRate}
                    max={12}
                    display={`${previewSpec.fireRate.toFixed(1)}/s`}
                  />
                  <StatBar
                    label="Magazine"
                    value={previewSpec.magSize}
                    max={35}
                    display={previewSpec.isMelee ? '—' : `${previewSpec.magSize} rd`}
                  />
                  <StatBar
                    label="Effective Range"
                    value={previewSpec.range}
                    max={200}
                    display={`${previewSpec.range}m`}
                  />
                </div>
              </div>
            </div>

            {/* Deploy CTA */}
            <button
              type="button"
              data-start="true"
              onClick={inMultiplayer ? onMpDeploy : onDeploy}
              className="group relative w-full py-4 px-6 rounded-md bg-gradient-to-b from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 active:from-amber-600 active:to-amber-700 text-stone-950 font-black tracking-[0.28em] uppercase text-sm transition-all duration-200 cursor-pointer overflow-hidden shadow-[0_8px_30px_rgba(245,158,11,0.3)] hover:shadow-[0_8px_40px_rgba(245,158,11,0.45)]"
            >
              <span className="absolute inset-y-0 left-0 w-0 bg-white/25 transition-all duration-300 group-hover:w-full" />
              <span className="relative flex items-center justify-center gap-2.5">
                <Play className="w-4 h-4 fill-current" />
                {inMultiplayer ? (hud.multiplayer.isHost ? 'SYNC DEPLOY' : 'DEPLOY') : 'DEPLOY'}
                <span className="text-[10px] font-normal tracking-[0.2em] opacity-70 border border-stone-950/40 px-1.5 py-px">
                  ENTER
                </span>
              </span>
            </button>

            {/* Tactical settings */}
            <div className="mt-4 pt-3.5 border-t border-stone-800/80 space-y-3">
              <div>
                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-stone-200 mb-1">
                  <label htmlFor="title-sens">Mouse Sensitivity</label>
                  <span className="tabular-nums text-amber-400">
                    {settings.sensitivity.toFixed(2)}x
                  </span>
                </div>
                <input
                  id="title-sens"
                  type="range"
                  min="0.3"
                  max="2.5"
                  step="0.05"
                  value={settings.sensitivity}
                  onChange={(e) => onUpdateSettings({ sensitivity: parseFloat(e.target.value) })}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-[0.18em] text-stone-200">
                  Shadow Quality
                </span>
                <div className="flex rounded-md border border-stone-800/80 bg-[#0d1117]/80 p-0.5">
                  {(['high', 'medium'] as GraphicsQuality[]).map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => onUpdateSettings({ quality: q })}
                      className={`px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded cursor-pointer transition-all duration-150 ${
                        settings.quality === q
                          ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-stone-950 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                          : 'text-stone-400 hover:text-stone-200 hover:bg-white/5'
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-[0.18em] text-stone-200">Audio</span>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ muted: !settings.muted })}
                  className={`px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-md border cursor-pointer transition-all duration-150 ${
                    settings.muted
                      ? 'border-red-900/60 bg-red-950/40 text-red-300 hover:bg-red-950/60'
                      : 'border-stone-700/70 bg-[#141923] hover:bg-[#1c2331] text-stone-200'
                  }`}
                >
                  {settings.muted ? 'Muted' : 'Active'}
                </button>
              </div>
            </div>
          </div>
          </div>

          {/* Grouped control reference */}
          <div className="mt-4 shrink-0 flex flex-wrap justify-center gap-x-4 sm:gap-x-6 gap-y-1.5 rounded-md border border-stone-800/60 bg-[#0b0f16]/70 backdrop-blur-sm px-3 sm:px-5 py-2.5 text-[9px] sm:text-[10px] tracking-[0.14em] text-stone-400 uppercase pointer-events-none tac-fade-up" style={{ animationDelay: '0.15s' }}>
            <span><b className="text-stone-200">Move</b> WASD · Shift Sprint · C Slide</span>
            <span><b className="text-stone-200">Combat</b> LMB Fire · RMB ADS · R Reload</span>
            <span><b className="text-stone-200">Ordnance</b> V Knife · G Frag</span>
            <span><b className="text-stone-200">Weapons</b> 1-8 / Wheel</span>
            <span><b className="text-stone-200">Vehicle</b> E Enter/Exit · WASD Drive · Space Brake</span>
            <span><b className="text-stone-200">System</b> Esc Menu · M Mute</span>
          </div>
        </div>
      </div>
    );
  }

  if (hud.phase === 'levelclear') {
    const nextLevel = Math.min(MAX_LEVEL, hud.levelInfo.level + 1);
    const atMax = hud.levelInfo.level >= MAX_LEVEL;
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4 font-mono text-stone-100">
        <div className="w-full max-w-md rounded-lg bg-[#10141c]/95 backdrop-blur-md border border-emerald-900/50 border-t-4 border-t-emerald-500 p-5 sm:p-7 shadow-2xl tac-fade-up">
          <div className="text-xs tracking-[0.28em] text-emerald-400 uppercase mb-1">
            All Waves Cleared
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-[0.16em] uppercase text-stone-100 mb-2">
            Sector Secure
          </h2>
          <p className="text-[11px] tracking-[0.14em] uppercase text-stone-400 mb-6">
            Level {hud.levelInfo.level} · {hud.levelInfo.label} complete —{' '}
            {hud.stats.kills} eliminations
          </p>

          <div className="flex flex-col gap-2.5">
            {!atMax && (
              <button
                type="button"
                onClick={onDeployNextLevel}
                className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold tracking-[0.22em] uppercase text-sm cursor-pointer"
              >
                Next Level — LV {nextLevel} ({getLevelConfig(nextLevel).label})
              </button>
            )}
            <button
              type="button"
              onClick={onReplayLevel}
              className="w-full py-2.5 bg-[#19202d] hover:bg-[#232d3f] border border-stone-700 text-stone-200 tracking-[0.18em] uppercase text-xs cursor-pointer"
            >
              Replay Level {hud.levelInfo.level}
            </button>
            <button
              type="button"
              onClick={onQuitToTitle}
              className="w-full py-2.5 bg-transparent hover:bg-stone-900 border border-stone-800 text-stone-400 tracking-[0.18em] uppercase text-xs cursor-pointer"
            >
              Return to Title
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (hud.phase === 'paused') {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4 font-mono text-stone-100">
        <div className="w-full max-w-sm rounded-lg bg-[#10141c]/95 backdrop-blur-md border border-amber-900/40 border-t-2 border-t-amber-500 p-5 sm:p-7 shadow-2xl">
          <h2 className="text-xl sm:text-2xl font-bold tracking-[0.2em] uppercase text-stone-100 mb-5">
            Tactical Pause
          </h2>

          <div className="space-y-4 mb-6">
            <div>
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-stone-300 mb-1.5">
                <label htmlFor="pause-sens">Sensitivity</label>
                <span className="tabular-nums text-amber-400">
                  {settings.sensitivity.toFixed(2)}x
                </span>
              </div>
              <input
                id="pause-sens"
                type="range"
                min="0.3"
                max="2.5"
                step="0.05"
                value={settings.sensitivity}
                onChange={(e) => onUpdateSettings({ sensitivity: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.18em] text-stone-300">
                Shadows
              </span>
              <div className="flex border border-stone-700">
                {(['high', 'medium'] as GraphicsQuality[]).map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => onUpdateSettings({ quality: q })}
                    className={`px-3 py-1 text-xs uppercase tracking-wider cursor-pointer ${
                      settings.quality === q
                        ? 'bg-amber-500 text-stone-950 font-bold'
                        : 'bg-[#171d29] text-stone-400'
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onResume}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold tracking-[0.22em] uppercase text-sm cursor-pointer"
            >
              RESUME
            </button>
            <button
              type="button"
              onClick={onDeploy}
              className="w-full py-2.5 bg-[#19202d] hover:bg-[#232d3f] border border-stone-700 text-stone-200 tracking-[0.18em] uppercase text-xs cursor-pointer"
            >
              RESTART MISSION
            </button>
            <button
              type="button"
              onClick={onQuitToTitle}
              className="w-full py-2.5 bg-transparent hover:bg-stone-900 border border-stone-800 text-stone-400 tracking-[0.18em] uppercase text-xs cursor-pointer"
            >
              QUIT TO TITLE
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (hud.phase === 'gameover') {
    const accuracy = calculateAccuracyPercent(hud.stats.shotsFired, hud.stats.shotsHit);
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4 font-mono text-stone-100">
        <div className="w-full max-w-md rounded-lg bg-[#10141c]/95 backdrop-blur-md border border-red-900/50 border-t-4 border-t-red-500 p-5 sm:p-7 shadow-2xl">
          <div className="text-xs tracking-[0.28em] text-red-400 uppercase mb-1">
            Operator Down
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-[0.16em] uppercase text-stone-100 mb-6">
            Mission Failed
          </h2>

          <div className="grid grid-cols-2 gap-3 mb-7">
            <div className="rounded-md bg-[#161c28]/80 border border-stone-800/80 p-3.5">
              <div className="text-[10px] tracking-[0.2em] text-stone-400 uppercase">
                Waves Survived
              </div>
              <div className="text-2xl font-bold tabular-nums text-amber-400 mt-1">
                {hud.stats.wave}
              </div>
            </div>
            <div className="rounded-md bg-[#161c28]/80 border border-stone-800/80 p-3.5">
              <div className="text-[10px] tracking-[0.2em] text-stone-400 uppercase">
                Total Kills
              </div>
              <div className="text-2xl font-bold tabular-nums text-stone-100 mt-1">
                {hud.stats.kills}
              </div>
            </div>
            <div className="rounded-md bg-[#161c28]/80 border border-stone-800/80 p-3.5">
              <div className="text-[10px] tracking-[0.2em] text-stone-400 uppercase">
                Accuracy
              </div>
              <div className="text-2xl font-bold tabular-nums text-stone-100 mt-1">
                {accuracy}%
              </div>
            </div>
            <div className="rounded-md bg-[#161c28]/80 border border-stone-800/80 p-3.5">
              <div className="text-[10px] tracking-[0.2em] text-stone-400 uppercase">
                Headshots
              </div>
              <div className="text-2xl font-bold tabular-nums text-amber-300 mt-1">
                {hud.stats.headshots}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              data-start="true"
              onClick={onDeploy}
              className="w-full py-3.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold tracking-[0.24em] uppercase text-sm cursor-pointer"
            >
              REDEPLOY
            </button>
            <button
              type="button"
              onClick={onQuitToTitle}
              className="w-full py-2.5 bg-[#161c28] hover:bg-[#1f2737] border border-stone-700 text-stone-300 tracking-[0.18em] uppercase text-xs cursor-pointer"
            >
              RETURN TO BASE
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
