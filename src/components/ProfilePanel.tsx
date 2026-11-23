import { useState } from 'react';
import { Copy, X } from 'lucide-react';
import type { PlayerProfile } from '../game/auth';
import {
  AVATAR_PRESETS,
  COUNTRIES,
  PLAYSTYLES,
  avatarPreset,
  defaultProfileDetails,
  type ProfileDetails,
} from '../game/userProfile';
import { MAP_SPECS, WEAPON_SPECS } from '../game/rules';
import type { MapId, WeaponId } from '../game/types';

interface ProfilePanelProps {
  open: boolean;
  profile: PlayerProfile;
  busy?: boolean;
  onClose: () => void;
  onSave: (details: ProfileDetails) => void;
  onToggleStatus: (active: boolean) => void;
}

const WEAPON_CHOICES: ReadonlyArray<{ id: WeaponId | 'any'; label: string }> = [
  { id: 'any', label: 'Any' },
  { id: 'rifle', label: WEAPON_SPECS.rifle.name },
  { id: 'pistol', label: WEAPON_SPECS.pistol.name },
  { id: 'shotgun', label: WEAPON_SPECS.shotgun.name },
  { id: 'marksman', label: WEAPON_SPECS.marksman.name },
  { id: 'smg', label: WEAPON_SPECS.smg.name },
  { id: 'lmg', label: WEAPON_SPECS.lmg.name },
  { id: 'deagle', label: WEAPON_SPECS.deagle.name },
  { id: 'knife', label: WEAPON_SPECS.knife.name },
];

const MAP_CHOICES: ReadonlyArray<{ id: MapId | 'any'; label: string }> = [
  { id: 'any', label: 'Any' },
  { id: 'dusk_yard', label: MAP_SPECS.dusk_yard.name },
  { id: 'arctic_outpost', label: MAP_SPECS.arctic_outpost.name },
  { id: 'desert_compound', label: MAP_SPECS.desert_compound.name },
  { id: 'neon_docks', label: MAP_SPECS.neon_docks.name },
  { id: 'highland_ridge', label: MAP_SPECS.highland_ridge.name },
  { id: 'sunken_foundry', label: MAP_SPECS.sunken_foundry.name },
];

const inputCls =
  'w-full bg-[#10151d] border border-stone-800 px-2.5 py-1.5 text-[11px] tracking-[0.08em] text-stone-100 placeholder:text-stone-600 focus:border-amber-500 outline-none';
const selectCls = inputCls + ' cursor-pointer';

export function ProfilePanel({ open, profile, busy, onClose, onSave, onToggleStatus }: ProfilePanelProps) {
  const [details, setDetails] = useState<ProfileDetails>(() => defaultProfileDetails(profile));
  const [savedFlash, setSavedFlash] = useState(false);

  if (!open) return null;

  const isActive = profile.status !== 'inactive';
  const emblem = avatarPreset(details.avatarPreset || profile.avatarPreset);

  const handleSave = () => {
    onSave(details);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1600);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-3 sm:p-4 font-mono text-stone-100">
      <div className="w-full max-w-lg bg-[#0d1219] border border-stone-700 border-t-2 border-t-amber-500 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center justify-center w-9 h-9 text-lg font-bold"
              style={{ background: `${emblem.color}22`, color: emblem.color, clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }}
            >
              {emblem.glyph}
            </span>
            <div>
              <div className="text-[10px] tracking-[0.3em] text-amber-400 uppercase">Operator Profile</div>
              <div className="text-lg font-bold tracking-[0.18em] uppercase">{profile.callsign}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 border border-stone-800 text-stone-400 hover:text-stone-100 hover:border-stone-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Status toggle */}
          <div className="flex items-center justify-between border border-stone-800 bg-[#10151d] px-3 py-2.5">
            <div>
              <div className="text-[11px] font-bold tracking-[0.16em] uppercase">
                Status:{' '}
                <span className={isActive ? 'text-emerald-400' : 'text-stone-500'}>
                  {isActive ? 'ACTIVE' : 'INACTIVE'}
                </span>
              </div>
              <div className="text-[9px] tracking-[0.14em] uppercase text-stone-500">
                {isActive
                  ? 'Visible in Active Players — joinable & invitable'
                  : 'Stealth mode — hidden from matchmaking'}
              </div>
            </div>
            <button
              type="button"
              data-status-toggle={isActive ? 'active' : 'inactive'}
              onClick={() => onToggleStatus(!isActive)}
              className={`relative w-14 h-7 border cursor-pointer transition-colors ${
                isActive ? 'bg-emerald-600/30 border-emerald-500' : 'bg-[#141923] border-stone-700'
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 transition-all ${
                  isActive ? 'left-[calc(100%-1.4rem)] bg-emerald-400' : 'left-0.5 bg-stone-500'
                }`}
              />
              <span className={`absolute top-1/2 -translate-y-1/2 text-[8px] font-bold tracking-wider ${isActive ? 'left-1.5 text-stone-950' : 'right-1.5 text-stone-400'}`}>
                {isActive ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>

          {/* Identity fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[9px] tracking-[0.2em] uppercase text-stone-500">Callsign</span>
              <input
                className={`${inputCls} mt-1 uppercase`}
                value={details.callsign}
                maxLength={12}
                onChange={(e) => setDetails({ ...details, callsign: e.target.value.toUpperCase() })}
              />
            </label>
            <label className="block">
              <span className="text-[9px] tracking-[0.2em] uppercase text-stone-500">Full Name</span>
              <input
                className={`${inputCls} mt-1`}
                value={details.fullName}
                maxLength={32}
                onChange={(e) => setDetails({ ...details, fullName: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-[9px] tracking-[0.2em] uppercase text-stone-500">Country / Region</span>
              <select
                className={`${selectCls} mt-1`}
                value={details.country}
                onChange={(e) => setDetails({ ...details, country: e.target.value })}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[9px] tracking-[0.2em] uppercase text-stone-500">Playstyle</span>
              <select
                className={`${selectCls} mt-1`}
                value={details.playstyle}
                onChange={(e) => setDetails({ ...details, playstyle: e.target.value as ProfileDetails['playstyle'] })}
              >
                {PLAYSTYLES.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[9px] tracking-[0.2em] uppercase text-stone-500">Favorite Weapon</span>
              <select
                className={`${selectCls} mt-1`}
                value={details.favoriteWeapon}
                onChange={(e) => setDetails({ ...details, favoriteWeapon: e.target.value as WeaponId | 'any' })}
              >
                {WEAPON_CHOICES.map((w) => (
                  <option key={w.id} value={w.id}>{w.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[9px] tracking-[0.2em] uppercase text-stone-500">Favorite Map</span>
              <select
                className={`${selectCls} mt-1`}
                value={details.favoriteMap}
                onChange={(e) => setDetails({ ...details, favoriteMap: e.target.value as MapId | 'any' })}
              >
                {MAP_CHOICES.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>
            <label className="block col-span-1 sm:col-span-2">
              <span className="text-[9px] tracking-[0.2em] uppercase text-stone-500">Bio / Status Message</span>
              <input
                className={`${inputCls} mt-1`}
                value={details.bio}
                maxLength={80}
                placeholder="e.g. LZ-01 rushes only. No medics."
                onChange={(e) => setDetails({ ...details, bio: e.target.value })}
              />
            </label>
          </div>

          {/* Emblem picker */}
          <div>
            <div className="text-[9px] tracking-[0.2em] uppercase text-stone-500 mb-1">Tactical Emblem</div>
            <div className="grid grid-cols-8 gap-1 max-w-[320px]">
              {AVATAR_PRESETS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  title={a.label}
                  onClick={() => setDetails({ ...details, avatarPreset: a.id })}
                  className={`aspect-square flex items-center justify-center text-[13px] font-bold cursor-pointer border transition-colors ${
                    (details.avatarPreset || profile.avatarPreset) === a.id
                      ? 'border-amber-500'
                      : 'border-stone-800 hover:border-stone-600'
                  }`}
                  style={{ background: `${a.color}22`, color: a.color }}
                >
                  {a.glyph}
                </button>
              ))}
            </div>
          </div>

          {/* Friend code + career stats */}
          <div className="flex items-center justify-between border border-stone-800/70 bg-[#10151d] px-2.5 py-2">
            <div className="text-[9px] tracking-[0.16em] uppercase text-stone-500">
              Friend Code <span className="text-amber-300 font-bold text-[12px] tracking-[0.24em]">{profile.friendCode}</span>
              {' · '}ID {profile.id.slice(0, 12)}
            </div>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(profile.friendCode).catch(() => {})}
              className="text-stone-500 hover:text-amber-300 cursor-pointer"
              title="Copy friend code"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5 text-center">
            {[
              { label: 'Level', value: profile.level },
              { label: 'Kills', value: profile.kills },
              { label: 'Deaths', value: profile.deaths ?? 0 },
              { label: 'Wins', value: profile.wins },
            ].map((s) => (
              <div key={s.label} className="border border-stone-800/70 bg-[#10151d] py-1.5">
                <div className="text-[8.5px] tracking-[0.18em] uppercase text-stone-500">{s.label}</div>
                <div className="text-sm font-bold tabular-nums text-stone-100">{s.value}</div>
              </div>
            ))}
          </div>

          <button
            type="button"
            data-profile="save"
            disabled={busy}
            onClick={handleSave}
            className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-stone-950 text-[11px] font-bold tracking-[0.2em] uppercase cursor-pointer"
          >
            {savedFlash ? 'Saved ✓' : busy ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </div>
    </div>
  );
}
