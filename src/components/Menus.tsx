import { MAP_SPECS, WEAPON_SKIN_SPECS, calculateAccuracyPercent } from '../game/rules';
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
}

const MAP_ORDER: MapId[] = ['dusk_yard', 'arctic_outpost', 'desert_compound'];
const SKIN_ORDER: WeaponSkinId[] = ['standard', 'desert_tan', 'arctic_camo', 'carbon_gold'];
const PREVIEW_WEAPONS: ReadonlyArray<{ id: WeaponId; label: string }> = [
  { id: 'rifle', label: 'MK-18' },
  { id: 'pistol', label: 'P226' },
  { id: 'shotgun', label: 'M870' },
  { id: 'marksman', label: 'MK-14' },
];

export function Menus({
  hud,
  settings,
  previewWeapon,
  onSelectPreviewWeapon,
  onUpdateSettings,
  onDeploy,
  onResume,
  onQuitToTitle,
}: MenusProps) {
  if (hud.phase === 'title') {
    const activeMap = MAP_SPECS[settings.mapId];

    return (
      <div className="fixed inset-0 z-20 flex flex-col justify-between p-6 md:p-10 pointer-events-none font-mono text-stone-100">
        {/* Left Tactical Title Lockup + Loadout + Controls Panel over calm negative space */}
        <div className="w-full max-w-[492px] bg-[#0d1118]/94 border-l-4 border-amber-500 p-6 shadow-2xl pointer-events-auto">
          {/* Bespoke Inline SVG Tactical Crest & Title Emblem */}
          <div className="flex items-center gap-3.5 mb-4">
            <svg viewBox="0 0 48 48" className="w-10 h-10 shrink-0" aria-hidden="true">
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
              <h1 className="text-3xl font-bold tracking-[0.14em] text-stone-100 leading-none">
                SECTOR 09
              </h1>
              <p className="text-[11px] tracking-[0.22em] text-amber-400 uppercase mt-1">
                {activeMap.name} · {activeMap.subtitle}
              </p>
            </div>
          </div>

          {/* Selectable Deployment Map */}
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-[0.22em] text-stone-400 mb-1.5">
              Deployment Sector
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {MAP_ORDER.map((id) => {
                const m = MAP_SPECS[id];
                const selected = settings.mapId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    data-map-id={id}
                    onClick={() => onUpdateSettings({ mapId: id })}
                    className={`text-left px-2 py-2 border transition-colors cursor-pointer ${
                      selected
                        ? 'bg-[#1a2230] border-amber-500 text-stone-100'
                        : 'bg-[#121721] border-stone-800 text-stone-400 hover:border-stone-600 hover:text-stone-200'
                    }`}
                  >
                    <div
                      className="w-full h-0.5 mb-1.5"
                      style={{ backgroundColor: selected ? m.badgeColor : '#334155' }}
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

          {/* Weapon Loadout / Skin Selector */}
          <div className="mb-4">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="text-[10px] uppercase tracking-[0.22em] text-stone-400">
                Arsenal Finish
              </div>
              <div className="flex border border-stone-800">
                {PREVIEW_WEAPONS.map((w) => {
                  const active = previewWeapon === w.id;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      data-preview-weapon={w.id}
                      onClick={() => onSelectPreviewWeapon(w.id)}
                      className={`px-1.5 py-0.5 text-[9.5px] tracking-wider uppercase cursor-pointer transition-colors ${
                        active
                          ? 'bg-amber-500 text-stone-950 font-bold'
                          : 'bg-[#121721] text-stone-400 hover:text-stone-200'
                      }`}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {SKIN_ORDER.map((id) => {
                const s = WEAPON_SKIN_SPECS[id];
                const selected = settings.weaponSkin === id;
                return (
                  <button
                    key={id}
                    type="button"
                    data-skin-id={id}
                    onClick={() => onUpdateSettings({ weaponSkin: id })}
                    className={`flex items-center gap-2 px-2.5 py-1.5 border text-left transition-colors cursor-pointer ${
                      selected
                        ? 'bg-[#1a2230] border-amber-500 text-stone-100'
                        : 'bg-[#121721] border-stone-800 text-stone-400 hover:border-stone-600 hover:text-stone-200'
                    }`}
                  >
                    <span className="flex w-4 h-4 shrink-0 border border-stone-600 overflow-hidden">
                      <span className="w-1/2 h-full" style={{ backgroundColor: s.swatchPrimary }} />
                      <span className="w-1/2 h-full" style={{ backgroundColor: s.swatchAccent }} />
                    </span>
                    <span className="text-[11px] tracking-wider uppercase truncate">{s.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Primary Deploy CTA */}
          <button
            type="button"
            data-start="true"
            onClick={onDeploy}
            className="w-full py-3 px-6 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-stone-950 font-bold tracking-[0.24em] uppercase text-sm transition-colors cursor-pointer"
          >
            DEPLOY
          </button>

          {/* Compact Tactical Settings */}
          <div className="mt-4 pt-3.5 border-t border-stone-800 space-y-3">
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
              <div className="flex border border-stone-700">
                {(['high', 'medium'] as GraphicsQuality[]).map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => onUpdateSettings({ quality: q })}
                    className={`px-3 py-1 text-[11px] uppercase tracking-wider cursor-pointer transition-colors ${
                      settings.quality === q
                        ? 'bg-amber-500 text-stone-950 font-bold'
                        : 'bg-[#141923] text-stone-300 hover:text-stone-100'
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
                className="px-3 py-1 text-[11px] uppercase tracking-wider border border-stone-700 bg-[#141923] hover:bg-[#1c2331] text-stone-200 cursor-pointer"
              >
                {settings.muted ? 'Muted' : 'Active'}
              </button>
            </div>
          </div>
        </div>

        {/* Single Flat Borderless Control Hint Line */}
        <div className="text-xs tracking-[0.14em] text-stone-300/90 uppercase bg-[#0e121a]/75 self-start px-3.5 py-1.5">
          WASD Move · Mouse Aim/Fire · RMB ADS · 1-5 Weapons / Scroll · V Knife · G Frag · R Reload · C Slide · Shift Sprint · Esc Pause
        </div>
      </div>
    );
  }

  if (hud.phase === 'paused') {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4 font-mono text-stone-100">
        <div className="w-full max-w-sm bg-[#10141c] border-t-2 border-amber-500 p-7 shadow-2xl">
          <h2 className="text-2xl font-bold tracking-[0.2em] uppercase text-stone-100 mb-5">
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
        <div className="w-full max-w-md bg-[#10141c] border-t-4 border-red-500 p-7 shadow-2xl">
          <div className="text-xs tracking-[0.28em] text-red-400 uppercase mb-1">
            Operator Down
          </div>
          <h2 className="text-3xl font-bold tracking-[0.16em] uppercase text-stone-100 mb-6">
            Mission Failed
          </h2>

          <div className="grid grid-cols-2 gap-3 mb-7">
            <div className="bg-[#161c28] border border-stone-800 p-3.5">
              <div className="text-[10px] tracking-[0.2em] text-stone-400 uppercase">
                Waves Survived
              </div>
              <div className="text-2xl font-bold tabular-nums text-amber-400 mt-1">
                {hud.stats.wave}
              </div>
            </div>
            <div className="bg-[#161c28] border border-stone-800 p-3.5">
              <div className="text-[10px] tracking-[0.2em] text-stone-400 uppercase">
                Total Kills
              </div>
              <div className="text-2xl font-bold tabular-nums text-stone-100 mt-1">
                {hud.stats.kills}
              </div>
            </div>
            <div className="bg-[#161c28] border border-stone-800 p-3.5">
              <div className="text-[10px] tracking-[0.2em] text-stone-400 uppercase">
                Accuracy
              </div>
              <div className="text-2xl font-bold tabular-nums text-stone-100 mt-1">
                {accuracy}%
              </div>
            </div>
            <div className="bg-[#161c28] border border-stone-800 p-3.5">
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
