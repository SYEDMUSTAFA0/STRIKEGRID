import { useEffect, useRef } from 'react';
import { MAP_SPECS, MATCH_MODE_SPECS, WEAPON_ORDER, WEAPON_SPECS, ZONE_SPECS } from '../game/rules';
import type { HudSnapshot, MapId, WeaponId } from '../game/types';
import { ChatBox } from './ChatBox';
import type { ChatLine } from './ChatBox';
import { VoiceControls } from './VoiceControls';
import type { VoiceStatus } from '../game/voice';

interface VoiceHudProps {
  enabled: boolean;
  muted: boolean;
  status: VoiceStatus;
  level: number;
  peerCount: number;
  onToggleMic: () => void;
  onToggleMute: () => void;
}

interface GameHUDProps {
  hud: HudSnapshot;
  mapId?: MapId;
  muted: boolean;
  onToggleMute: () => void;
  onPause: () => void;
  showScores?: boolean;
  chatLines?: ChatLine[];
  chatSelfName?: string;
  chatOpen?: boolean;
  onChatOpenChange?: (open: boolean) => void;
  onSendChat?: (text: string) => void;
  voice?: VoiceHudProps;
}

const SLOT_SHORT_NAME: Record<WeaponId, string> = {
  rifle: 'MK-18',
  pistol: 'P226',
  shotgun: 'M870',
  marksman: 'MK-14',
  knife: 'KNIFE',
  smg: 'SMG',
  lmg: 'LMG',
  deagle: 'DGL',
};

export function GameHUD({ hud, mapId = 'dusk_yard', muted, onToggleMute, onPause, showScores = false, chatLines, chatSelfName, chatOpen = false, onChatOpenChange, onSendChat, voice }: GameHUDProps) {
  const ghostHealthRef = useRef(hud.health);

  useEffect(() => {
    if (hud.health > ghostHealthRef.current) {
      ghostHealthRef.current = hud.health;
    } else {
      const id = window.setTimeout(() => {
        ghostHealthRef.current = hud.health;
      }, 280);
      return () => window.clearTimeout(id);
    }
  }, [hud.health]);

  if (hud.phase !== 'playing') return null;

  const healthPct = Math.max(0, Math.min(100, (hud.health / hud.maxHealth) * 100));
  const ghostPct = Math.max(healthPct, Math.min(100, (ghostHealthRef.current / hud.maxHealth) * 100));
  const lowHealth = hud.health <= 30;
  const activeSpec = WEAPON_SPECS[hud.activeWeapon];
  const spread = hud.crosshairSpread;
  const showHitmarker = hud.hitmarkerTimer > 0;
  const vignetteOpacity = Math.min(
    0.82,
    hud.damageFlash * 0.72 + (lowHealth ? (1 - hud.health / 30) * 0.35 : 0),
  );

  return (
    <div className="fixed inset-0 pointer-events-none z-10 overflow-hidden font-mono text-stone-100">
      {/* Peripheral Red Damage Vignette */}
      {vignetteOpacity > 0.01 && (
        <div
          className="fixed inset-0 pointer-events-none transition-opacity duration-75"
          style={{
            opacity: vignetteOpacity,
            background:
              'radial-gradient(circle at 50% 50%, rgba(185, 28, 28, 0) 48%, rgba(153, 27, 27, 0.78) 100%)',
          }}
        />
      )}

      {/* Directional Incoming Fire Arcs */}
      {hud.damageIndicators.length > 0 && (
        <div
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-60 h-60 pointer-events-none"
          aria-hidden="true"
        >
          {hud.damageIndicators.map((ind) => {
            const deg = (ind.angleRad * 180) / Math.PI;
            return (
              <div
                key={ind.id}
                className="absolute inset-0"
                style={{ transform: `rotate(${deg}deg)`, opacity: ind.intensity }}
              >
                <svg viewBox="0 0 120 120" className="w-full h-full">
                  <path
                    d="M 42 14 Q 60 4 78 14 L 73 22 Q 60 14 47 22 Z"
                    fill="#ef4444"
                  />
                </svg>
              </div>
            );
          })}
        </div>
      )}

      {/* Dynamic Center Crosshair & Hitmarker (hidden while driving) */}
      {!hud.vehicle.active && (
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        aria-hidden="true"
      >
        <div
          className="w-1 h-1 rounded-full"
          style={{
            backgroundColor: showHitmarker
              ? hud.hitmarkerCrit
                ? '#fbbf24'
                : '#ef4444'
              : hud.isAds
                ? 'rgba(245, 158, 11, 0.95)'
                : 'rgba(245, 245, 244, 0.9)',
          }}
        />

        {!hud.isAds && !hud.isMeleeActive && (
          <>
            <span
              className="absolute left-1/2 -translate-x-1/2 w-[2px] h-2.5 bg-stone-100/90 shadow-[0_0_2px_rgba(0,0,0,0.9)]"
              style={{ bottom: `${spread}px` }}
            />
            <span
              className="absolute left-1/2 -translate-x-1/2 w-[2px] h-2.5 bg-stone-100/90 shadow-[0_0_2px_rgba(0,0,0,0.9)]"
              style={{ top: `${spread}px` }}
            />
            <span
              className="absolute top-1/2 -translate-y-1/2 h-[2px] w-2.5 bg-stone-100/90 shadow-[0_0_2px_rgba(0,0,0,0.9)]"
              style={{ right: `${spread}px` }}
            />
            <span
              className="absolute top-1/2 -translate-y-1/2 h-[2px] w-2.5 bg-stone-100/90 shadow-[0_0_2px_rgba(0,0,0,0.9)]"
              style={{ left: `${spread}px` }}
            />
          </>
        )}

        {showHitmarker && (
          <>
            <svg
              viewBox="0 0 36 36"
              className="w-8 h-8 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            >
              <g
                stroke={hud.hitmarkerCrit ? '#fbbf24' : '#ef4444'}
                strokeWidth={hud.hitmarkerKill ? '2.8' : '2.2'}
                strokeLinecap="round"
              >
                <line x1="6" y1="6" x2="12" y2="12" />
                <line x1="30" y1="6" x2="24" y2="12" />
                <line x1="6" y1="30" x2="12" y2="24" />
                <line x1="30" y1="30" x2="24" y2="24" />
              </g>
              {hud.hitmarkerKill && (
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="none"
                  stroke={hud.hitmarkerCrit ? '#fde68a' : '#fca5a5'}
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                />
              )}
            </svg>
            {(hud.hitmarkerKill || hud.hitmarkerCrit) && (
              <div
                className="absolute top-7 left-1/2 -translate-x-1/2 text-[10px] font-bold tracking-[0.22em] uppercase whitespace-nowrap"
                style={{ color: hud.hitmarkerCrit ? '#fbbf24' : '#fca5a5' }}
              >
                {hud.hitmarkerCrit ? (hud.hitmarkerKill ? 'HEADSHOT KILL' : 'CRIT') : 'KILL'}
              </div>
            )}
          </>
        )}

        {hud.isReloading && (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 w-16 h-1 bg-stone-900/80 border border-stone-600/60 overflow-hidden">
            <div
              className="h-full bg-amber-400"
              style={{ width: `${Math.round(hud.reloadProgress * 100)}%` }}
            />
          </div>
        )}
      </div>
      )}

      {/* Top-Left: Wave & Hostiles Cluster + Compact Tactical Radar */}
      <div className="fixed top-3 left-3 sm:top-4 sm:left-5 flex flex-col items-start gap-1.5 sm:gap-2.5">
        <div className="flex items-center gap-2.5 sm:gap-4 bg-[#11151d]/90 border-l-2 border-amber-500 px-2.5 sm:px-3.5 py-1.5 sm:py-2 shadow-lg">
          <div>
            <div className="text-[9px] sm:text-[10px] tracking-[0.2em] text-stone-400 uppercase">Wave</div>
            <div className="text-lg sm:text-2xl font-bold leading-none tabular-nums text-amber-400">
              {String(hud.wave).padStart(2, '0')}
            </div>
          </div>
          <div className="h-6 sm:h-7 w-px bg-stone-700/80" />
          <div>
            <div className="text-[9px] sm:text-[10px] tracking-[0.2em] text-stone-400 uppercase">Hostiles</div>
            <div className="text-lg sm:text-2xl font-bold leading-none tabular-nums text-stone-100">
              {hud.enemiesRemaining}
            </div>
          </div>
          <div className="hidden sm:block h-6 sm:h-7 w-px bg-stone-700/80" />
          <div className="hidden sm:block">
            <div className="text-[10px] tracking-[0.2em] text-stone-400 uppercase">Kills</div>
            <div className="text-2xl font-bold leading-none tabular-nums text-stone-200">
              {hud.stats.kills}
            </div>
          </div>
        </div>

        {/* Active Sector Zone Indicator */}
        {(() => {
          const z = ZONE_SPECS[hud.currentZone];
          return (
            <div
              data-testid="hud-zone"
              className="flex items-center gap-2.5 bg-[#11151d]/90 border-l-2 px-3 py-1.5 shadow-lg"
              style={{ borderColor: z.accentColor }}
            >
              <span
                className="text-[10px] font-bold tracking-[0.18em] uppercase"
                style={{ color: z.accentColor }}
              >
                {z.code}
              </span>
              <span className="h-3 w-px bg-stone-700/80" />
              <span className="text-[11px] font-bold tracking-[0.16em] text-stone-100 uppercase">
                {z.name}
              </span>
            </div>
          );
        })()}

        {/* Difficulty level chip */}
        <div className="flex items-center gap-2 bg-[#11151d]/90 border-l-2 border-stone-600 px-3 py-1 shadow-lg">
          <span className="text-[9px] tracking-[0.2em] uppercase text-stone-500">LV</span>
          <span className="text-[12px] font-bold tabular-nums text-stone-100">
            {String(hud.levelInfo.level).padStart(2, '0')}
          </span>
          <span className="h-3 w-px bg-stone-700/80" />
          <span
            className={`text-[9px] font-bold tracking-[0.18em] uppercase ${
              hud.levelInfo.label === 'EASY'
                ? 'text-emerald-400'
                : hud.levelInfo.label === 'MEDIUM'
                  ? 'text-sky-400'
                  : hud.levelInfo.label === 'HARD'
                    ? 'text-orange-400'
                    : 'text-red-400'
            }`}
          >
            {hud.levelInfo.label}
          </span>
          <span className="h-3 w-px bg-stone-700/80" />
          <span className="text-[9px] tracking-[0.16em] uppercase text-stone-500">
            W{hud.levelInfo.waveInLevel}/{hud.levelInfo.wavesPerLevel}
          </span>
        </div>

        {/* Compact Tactical Motion Radar */}
        <div
          className="relative w-20 h-20 sm:w-26 sm:h-26 rounded-full bg-[#11151d]/90 border border-stone-700/85 shadow-lg overflow-hidden"
          aria-label="Tactical radar"
        >
          <svg viewBox="-50 -50 100 100" className="w-full h-full">
            <circle cx="0" cy="0" r="46" fill="none" stroke="#334155" strokeWidth="0.8" />
            <circle cx="0" cy="0" r="24" fill="none" stroke="#1e293b" strokeWidth="0.8" />
            <line x1="-46" y1="0" x2="46" y2="0" stroke="#1e293b" strokeWidth="0.6" />
            <line x1="0" y1="-46" x2="0" y2="46" stroke="#1e293b" strokeWidth="0.6" />
            <polygon points="0,0 -26,-42 26,-42" fill="rgba(245, 158, 11, 0.1)" />

            <g transform={`rotate(${(hud.playerYaw * 180) / Math.PI})`}>
              <text
                x="0"
                y="-38"
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="8"
                fontWeight="bold"
              >
                N
              </text>
            </g>

            {hud.radarBlips.map((b) => {
              const cx = b.dx * 42;
              const cy = b.dz * 42;
              const color =
                b.role === 'marksman' ? '#38bdf8' : b.role === 'rusher' ? '#ef4444' : '#f59e0b';
              return (
                <g key={b.id}>
                  {b.firing && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r="5.5"
                      fill="none"
                      stroke="#fde68a"
                      strokeWidth="1"
                      opacity="0.85"
                    />
                  )}
                  <circle cx={cx} cy={cy} r="2.8" fill={color} />
                </g>
              );
            })}

            <polygon points="0,-5 3.6,3.5 0,1.5 -3.6,3.5" fill="#f8fafc" />
          </svg>
        </div>
      </div>

      {/* Wave Announcement & Wave Cleared Banners */}
      {hud.waveBannerTimer > 0 && (
        <div className="fixed top-16 sm:top-20 left-1/2 -translate-x-1/2 bg-[#11151d]/92 border-y border-amber-500/70 px-4 sm:px-7 py-2 text-center">
          <div className="text-[10px] sm:text-[11px] tracking-[0.35em] text-amber-400 uppercase">
            {MAP_SPECS[mapId].name} Alert
          </div>
          <div className="text-base sm:text-xl font-bold tracking-[0.18em] text-stone-100 uppercase">
            Wave {hud.wave} Deployed
          </div>
        </div>
      )}
      {hud.waveClearBannerTimer > 0 && hud.waveBannerTimer <= 0 && (
        <div className="fixed top-16 sm:top-20 left-1/2 -translate-x-1/2 bg-[#11151d]/92 border-y border-emerald-500/70 px-4 sm:px-7 py-2 text-center">
          <div className="text-[10px] sm:text-[11px] tracking-[0.35em] text-emerald-400 uppercase">
            All Hostiles Neutralized
          </div>
          <div className="text-base sm:text-xl font-bold tracking-[0.18em] text-stone-100 uppercase">
            Wave {String(hud.wave).padStart(2, '0')} Cleared
          </div>
        </div>
      )}

      {/* Radiation Hazard Warning */}
      {hud.radiation.active && (
        <div className="fixed top-[30%] left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 pointer-events-none">
          <div className="bg-[#1a1408]/92 border border-lime-500/70 border-l-4 px-5 py-2 text-center shadow-[0_0_30px_rgba(132,204,22,0.25)]">
            <div className="text-[10px] tracking-[0.3em] text-lime-400 uppercase font-bold">
              ☢ Radiation Field
            </div>
            <div className="text-[9px] tracking-[0.2em] text-stone-400 uppercase">
              {hud.radiation.dps.toFixed(1)} dmg/s — exit the zone
            </div>
          </div>
          <div className="w-40 h-1 bg-stone-900/80 border border-stone-700 overflow-hidden">
            <div
              className="h-full bg-lime-400 transition-all duration-150"
              style={{ width: `${Math.round(hud.radiation.intensity * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Vehicle proximity prompt / driving cluster */}
      {hud.vehicle.nearPrompt && !hud.vehicle.active && (
        <div className="fixed bottom-[22%] left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="bg-[#11151d]/92 border border-stone-600 px-4 py-1.5 text-[11px] tracking-[0.2em] uppercase text-stone-100 shadow-lg">
            <span className="text-amber-400 font-bold">E</span> — Enter {hud.vehicle.label}
          </div>
        </div>
      )}
      {hud.vehicle.active && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 pointer-events-none flex flex-col items-center gap-1">
          <div className="bg-[#11151d]/92 border border-amber-500/60 px-5 py-2 text-center shadow-lg">
            <div className="text-[9px] tracking-[0.28em] text-stone-400 uppercase">{hud.vehicle.label}</div>
            <div className="text-2xl font-bold tabular-nums text-amber-400 leading-none">
              {hud.vehicle.speedKmh}
              <span className="text-[10px] text-stone-500 ml-1">km/h</span>
            </div>
          </div>
          <div className="text-[9px] tracking-[0.2em] uppercase text-stone-400">
            WASD Drive · Space Brake · <span className="text-amber-400">E</span> Exit
          </div>
        </div>
      )}

      {/* Top-Right: Utility Controls + Kill Feed */}
      <div className="fixed top-3 right-3 sm:top-4 sm:right-5 flex flex-col items-end gap-2">
        <div className="flex items-center gap-2 pointer-events-auto">
          {voice && (
            <VoiceControls
              enabled={voice.enabled}
              muted={voice.muted}
              status={voice.status}
              level={voice.level}
              peerCount={voice.peerCount}
              onToggleMic={voice.onToggleMic}
              onToggleMute={voice.onToggleMute}
            />
          )}
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            title="Toggle Audio (M)"
            className="w-9 h-9 flex items-center justify-center bg-[#11151d]/90 hover:bg-[#1b2230] border border-stone-700 text-stone-200 transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              {muted ? (
                <path d="M22 9l-6 6M16 9l6 6" stroke="#ef4444" />
              ) : (
                <path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" />
              )}
            </svg>
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            aria-label="Pause game"
            title="Pause (P / Esc)"
            className="w-9 h-9 flex items-center justify-center bg-[#11151d]/90 hover:bg-[#1b2230] border border-stone-700 text-stone-200 transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" />
              <rect x="14" y="5" width="4" height="14" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col items-end gap-1">
          {hud.killFeed.map((entry) => (
            <div
              key={entry.id}
              className="px-2 py-1 text-[9px] sm:text-xs tracking-wider uppercase bg-[#11151d]/85 border-r-2"
              style={{
                borderColor: entry.headshot ? '#fbbf24' : '#ef4444',
                color: entry.headshot ? '#fde68a' : '#e7e5e4',
              }}
            >
              {entry.text}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom-Left: Health Bar & Stance */}
      <div className="fixed bottom-3 left-3 sm:bottom-5 sm:left-5 w-44 sm:w-64 bg-[#11151d]/85 border-l-2 border-stone-500 px-2.5 sm:px-3.5 py-2 sm:py-2.5 shadow-lg">
        <div className="flex items-baseline justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-emerald-400" fill="currentColor">
              <path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7V3z" />
            </svg>
            <span className="text-[10px] tracking-[0.22em] text-stone-400 uppercase">Armor HP</span>
          </div>
          <span
            className={`text-xl sm:text-2xl font-bold leading-none tabular-nums ${
              lowHealth ? 'text-red-400' : 'text-stone-100'
            }`}
          >
            {hud.health}
          </span>
        </div>
        <div className="relative h-2.5 bg-stone-900 border border-stone-700/80 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-red-500/65 transition-all duration-300"
            style={{ width: `${ghostPct}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 transition-all duration-75"
            style={{
              width: `${healthPct}%`,
              backgroundColor: lowHealth ? '#ef4444' : '#34d399',
            }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] tracking-[0.18em] text-stone-400 uppercase">
          <span className={hud.isSliding ? 'text-amber-400 font-bold' : ''}>
            {hud.isSliding
              ? 'SLIDING'
              : hud.isCrouching
                ? 'CROUCH'
                : hud.isSprinting
                  ? 'SPRINT'
                  : 'READY'}
          </span>
          {!hud.pointerLocked &&
            !(typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) && (
              <span className="text-amber-400">CLICK VIEW TO AIM</span>
            )}
        </div>
      </div>

      {/* Tab scoreboard — live operator standings */}
      {showScores && hud.multiplayer.enabled && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/55 pointer-events-none">
          <div className="w-[92vw] max-w-[420px] bg-[#0d1219]/95 border border-stone-700 border-t-2 border-t-amber-500 p-3 sm:p-4 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[10px] tracking-[0.3em] text-amber-400 uppercase">Live Scoreboard</div>
                <div className="text-[13px] font-bold tracking-[0.16em] text-stone-100 uppercase">
                  {MATCH_MODE_SPECS[hud.multiplayer.matchMode]?.name ?? 'Co-op Squad Survival'}
                </div>
              </div>
              <div className="text-right text-[9px] tracking-[0.18em] uppercase text-stone-500">
                <div>Room {hud.multiplayer.roomCode}</div>
                <div>
                  {hud.multiplayer.isHost ? 'Host' : 'Operator'}
                  {hud.multiplayer.selfSide && hud.multiplayer.selfSide !== 'attack'
                    ? ` · ${hud.multiplayer.selfSide.toUpperCase()}`
                    : hud.multiplayer.selfSide === 'attack'
                      ? ' · ATTACK ALL'
                      : ''}
                </div>
              </div>
            </div>
            {(() => {
              const alpha = hud.multiplayer.scores.filter((s) => s.team === 'alpha');
              const bravo = hud.multiplayer.scores.filter((s) => s.team === 'bravo');
              if (alpha.length === 0 && bravo.length === 0) return null;
              const aKills = alpha.reduce((n, s) => n + s.kills, 0);
              const bKills = bravo.reduce((n, s) => n + s.kills, 0);
              const myTeam = hud.multiplayer.selfSide === 'alpha' || hud.multiplayer.selfSide === 'bravo'
                ? hud.multiplayer.selfSide
                : null;
              return (
                <div className="mb-2 flex items-center justify-between border border-stone-800 bg-[#10151d] px-2 py-1">
                  <span className={`text-[10px] font-bold tracking-[0.16em] uppercase ${myTeam === 'alpha' ? 'text-amber-300' : 'text-stone-400'}`}>
                    Alpha {aKills}
                  </span>
                  <span className="text-[8.5px] tracking-[0.18em] uppercase text-stone-500">
                    {hud.multiplayer.friendlyFire ? 'FF ON' : 'Squads Protected'}
                  </span>
                  <span className={`text-[10px] font-bold tracking-[0.16em] uppercase ${myTeam === 'bravo' ? 'text-sky-300' : 'text-stone-400'}`}>
                    {bKills} Bravo
                  </span>
                </div>
              );
            })()}
            <div className="space-y-1">
              <div className="grid grid-cols-[2rem_1fr_3rem_3rem_4rem] gap-1 px-2 pb-1 text-[8.5px] tracking-[0.2em] uppercase text-stone-500 border-b border-stone-800">
                <span>#</span>
                <span>Operator</span>
                <span className="text-right">Team</span>
                <span className="text-right">Kills</span>
                <span className="text-right">Deaths</span>
              </div>
              {hud.multiplayer.scores.map((s, idx) => (
                <div
                  key={s.id}
                  className={`grid grid-cols-[2rem_1fr_3rem_3rem_4rem] gap-1 px-2 py-1 text-[11px] tracking-[0.12em] uppercase ${
                    s.isSelf ? 'bg-amber-500/10 border border-amber-500/40' : 'border border-transparent'
                  }`}
                >
                  <span className="text-stone-500 tabular-nums">{idx + 1}</span>
                  <span className={`truncate font-bold ${s.isSelf ? 'text-amber-300' : 'text-stone-200'}`}>
                    {s.nickname}
                    {s.isSelf ? ' ◄' : ''}
                  </span>
                  <span className="text-right text-stone-400">
                    {s.team ? (s.team === 'alpha' ? 'ALPHA' : 'BRAVO') : '—'}
                  </span>
                  <span className="text-right tabular-nums text-stone-100 font-bold">{s.kills}</span>
                  <span className="text-right tabular-nums text-stone-400">{s.deaths}</span>
                </div>
              ))}
              {hud.multiplayer.scores.length === 0 && (
                <div className="px-2 py-3 text-[10px] tracking-[0.16em] uppercase text-stone-500 text-center">
                  Waiting for squad telemetry…
                </div>
              )}
            </div>
            <div className="mt-3 pt-2 border-t border-stone-800 text-[9px] tracking-[0.2em] uppercase text-stone-500 text-center">
              Press TAB to close
            </div>
          </div>
        </div>
      )}

      {/* Bottom-Right: 5-Slot Arsenal, Frag Grenade Ordnance & Diegetic Ammo Readout */}
      <div className="fixed bottom-3 right-3 sm:bottom-5 sm:right-5 flex flex-col items-end gap-1.5 sm:gap-2">
        <div className="flex flex-wrap justify-end gap-1 max-w-[70vw] sm:max-w-none">
          {WEAPON_ORDER.map((wId) => {
            const spec = WEAPON_SPECS[wId];
            const active = hud.activeWeapon === wId;
            return (
              <div
                key={wId}
                className={`px-2 py-1 text-[10px] tracking-[0.14em] uppercase border ${
                  active
                    ? 'bg-[#161c26]/95 border-amber-500 text-amber-300 font-bold'
                    : 'bg-[#11151d]/90 border-stone-700/80 text-stone-400'
                }`}
              >
                [{spec.keyBind}] {SLOT_SHORT_NAME[wId]}
              </div>
            );
          })}
        </div>

        <div className="flex items-stretch gap-2">
          {/* Frag Grenade [G] Slot */}
          <div
            data-testid="grenade-hud"
            className={`bg-[#11151d]/85 border px-3 py-2 flex flex-col justify-between items-center shadow-lg min-w-[76px] ${
              hud.grenadeThrowing
                ? 'border-amber-400 text-amber-300'
                : hud.grenades === 0
                  ? 'border-stone-800 text-stone-500'
                  : 'border-stone-700 text-stone-200'
            }`}
          >
            <div className="text-[9.5px] tracking-[0.18em] text-stone-400 uppercase">[G] FRAG</div>
            <div className="flex items-center gap-1.5 my-0.5">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden="true">
                <path d="M9 2h6v2h-2v2.1c2.8.5 5 3 5 6.4 0 3.9-2.7 7.5-6 7.5s-6-3.6-6-7.5c0-3.4 2.2-5.9 5-6.4V4H9V2zm7.5 1.5l1.4 1.4-1.2 1.2-1.4-1.4 1.2-1.2z" />
              </svg>
              <span className="text-xl font-bold leading-none tabular-nums">
                {hud.grenades}
              </span>
            </div>
            <div className="text-[9px] tracking-[0.16em] text-stone-400 uppercase">
              {hud.grenadeThrowing ? 'ARMING' : `MAX ${hud.maxGrenades}`}
            </div>
          </div>

          {/* Active Weapon Ammo Readout */}
          <div className="bg-[#11151d]/85 border-r-2 border-amber-500 px-3 sm:px-4 py-2 text-right shadow-lg min-w-[160px] sm:min-w-[214px]">
            <div className="text-[10px] tracking-[0.2em] text-amber-400 uppercase">
              {activeSpec.name}
            </div>
            <div className="text-[9.5px] tracking-[0.18em] text-stone-400 uppercase">
              {activeSpec.shortLabel}
            </div>
            {hud.isMeleeActive ? (
              <div className="flex items-baseline justify-end gap-2 mt-1">
                <span className="text-2xl font-bold leading-none text-stone-100">∞</span>
                <span className="text-[10px] tracking-[0.14em] text-stone-400 uppercase">
                  LMB SLASH · RMB STAB
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-end gap-1.5 mt-0.5">
                  <span
                    className={`text-3xl font-bold leading-none tabular-nums ${
                      hud.ammoInMag <= Math.max(2, Math.floor(hud.magSize * 0.2))
                        ? 'text-red-400'
                        : 'text-stone-100'
                    }`}
                  >
                    {hud.ammoInMag}
                  </span>
                  <span className="text-sm text-stone-400 tabular-nums">/ {hud.ammoReserve}</span>
                </div>
                <div className="text-[10px] tracking-[0.18em] text-amber-400 uppercase mt-1 h-3.5">
                  {hud.isReloading
                    ? 'RELOADING...'
                    : hud.ammoInMag === 0
                      ? 'PRESS [R] TO RELOAD'
                      : ''}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Squad chat — bottom center */}
      {chatLines && onSendChat && onChatOpenChange && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[440px] max-w-[86vw] pointer-events-auto">
          <ChatBox
            lines={chatLines}
            onSend={onSendChat}
            open={chatOpen}
            onOpenChange={onChatOpenChange}
            selfName={chatSelfName}
            maxLines={30}
          />
        </div>
      )}
    </div>
  );
}
