import { useState } from 'react';
import { X } from 'lucide-react';
import type { BackendKind, RegistrationDetails } from '../game/auth';
import {
  AVATAR_PRESETS,
  COUNTRIES,
  PLAYSTYLES,
} from '../game/userProfile';
import { MAP_SPECS, WEAPON_SPECS } from '../game/rules';
import type { MapId, WeaponId } from '../game/types';

interface AuthModalProps {
  open: boolean;
  backendKind: BackendKind;
  busy: boolean;
  error: string;
  onClose: () => void;
  onGuest: (callsign: string) => void;
  onRegister: (email: string, password: string, details: RegistrationDetails) => void;
  onSignIn: (email: string, password: string) => void;
  onGoogle: () => void;
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
  { id: 'dusk_yard', label: `${MAP_SPECS.dusk_yard.name} · ${MAP_SPECS.dusk_yard.subtitle}` },
  { id: 'arctic_outpost', label: `${MAP_SPECS.arctic_outpost.name} · ${MAP_SPECS.arctic_outpost.subtitle}` },
  { id: 'desert_compound', label: `${MAP_SPECS.desert_compound.name} · ${MAP_SPECS.desert_compound.subtitle}` },
  { id: 'neon_docks', label: `${MAP_SPECS.neon_docks.name} · ${MAP_SPECS.neon_docks.subtitle}` },
  { id: 'highland_ridge', label: `${MAP_SPECS.highland_ridge.name} · ${MAP_SPECS.highland_ridge.subtitle}` },
  { id: 'sunken_foundry', label: `${MAP_SPECS.sunken_foundry.name} · ${MAP_SPECS.sunken_foundry.subtitle}` },
];

const inputCls =
  'w-full bg-[#10151d] border border-stone-800 px-2.5 py-1.5 text-[11px] tracking-[0.08em] text-stone-100 placeholder:text-stone-600 focus:border-amber-500 outline-none';
const selectCls = inputCls + ' cursor-pointer';

export function AuthModal({
  open,
  backendKind,
  busy,
  error,
  onClose,
  onGuest,
  onRegister,
  onSignIn,
  onGoogle,
}: AuthModalProps) {
  const [tab, setTab] = useState<'signin' | 'register'>('signin');
  const [guestName, setGuestName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [details, setDetails] = useState<RegistrationDetails>({
    callsign: '',
    fullName: '',
    bio: '',
    country: 'OTHER',
    avatarPreset: 'viper',
    favoriteWeapon: 'any',
    favoriteMap: 'any',
    playstyle: 'rusher',
  });

  if (!open) return null;

  const submitAuth = () => {
    if (!email || !password) return;
    if (tab === 'register') {
      onRegister(email, password, {
        ...details,
        callsign: details.callsign || email.split('@')[0].toUpperCase().slice(0, 12),
      });
    } else {
      onSignIn(email, password);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-3 sm:p-4 font-mono text-stone-100">
      <div className="w-full max-w-lg bg-[#0d1219] border border-stone-700 border-t-2 border-t-amber-500 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
          <div>
            <div className="text-[10px] tracking-[0.3em] text-amber-400 uppercase">Operator Access</div>
            <div className="text-lg font-bold tracking-[0.18em] uppercase">
              {tab === 'signin' ? 'Sign In' : 'Register'}
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
          {/* Tabs */}
          <div className="flex border border-stone-800">
            {(['signin', 'register'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 py-1.5 text-[10.5px] tracking-[0.2em] uppercase cursor-pointer transition-colors ${
                  tab === t
                    ? 'bg-amber-500 text-stone-950 font-bold'
                    : 'bg-[#10151d] text-stone-400 hover:text-stone-200'
                }`}
              >
                {t === 'signin' ? 'Sign In' : 'Register'}
              </button>
            ))}
          </div>

          {backendKind === 'none' ? (
            <div className="border border-amber-900/60 bg-amber-950/30 px-3 py-2.5 text-[10px] tracking-[0.14em] uppercase text-amber-300 leading-relaxed">
              No cloud backend configured — Quick Callsign play is available below.
              Set VITE_SUPABASE_* or VITE_FIREBASE_* env vars for live accounts.
            </div>
          ) : (
            <>
              {tab === 'register' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    className={`${inputCls} col-span-2`}
                    placeholder="CALLSIGN *"
                    value={details.callsign}
                    maxLength={12}
                    onChange={(e) => setDetails({ ...details, callsign: e.target.value.toUpperCase() })}
                  />
                  <input
                    className={inputCls}
                    placeholder="FULL NAME"
                    value={details.fullName}
                    maxLength={32}
                    onChange={(e) => setDetails({ ...details, fullName: e.target.value })}
                  />
                  <select
                    className={selectCls}
                    value={details.country}
                    onChange={(e) => setDetails({ ...details, country: e.target.value })}
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                  <select
                    className={`${selectCls} col-span-2`}
                    value={details.playstyle}
                    onChange={(e) => setDetails({ ...details, playstyle: e.target.value as RegistrationDetails['playstyle'] })}
                  >
                    {PLAYSTYLES.map((p) => (
                      <option key={p.id} value={p.id}>{p.label} — {p.hint}</option>
                    ))}
                  </select>
                  <select
                    className={selectCls}
                    value={details.favoriteWeapon}
                    onChange={(e) => setDetails({ ...details, favoriteWeapon: e.target.value as WeaponId | 'any' })}
                  >
                    {WEAPON_CHOICES.map((w) => (
                      <option key={w.id} value={w.id}>{w.label}</option>
                    ))}
                  </select>
                  <select
                    className={selectCls}
                    value={details.favoriteMap}
                    onChange={(e) => setDetails({ ...details, favoriteMap: e.target.value as MapId | 'any' })}
                  >
                    {MAP_CHOICES.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <input
                    className={`${inputCls} col-span-2`}
                    placeholder="BIO / STATUS MESSAGE"
                    value={details.bio}
                    maxLength={80}
                    onChange={(e) => setDetails({ ...details, bio: e.target.value })}
                  />
                  {/* Avatar emblem picker */}
                  <div className="col-span-2">
                    <div className="text-[9px] tracking-[0.2em] uppercase text-stone-500 mb-1">Tactical Emblem</div>
                    <div className="grid grid-cols-8 gap-1 max-w-[320px]">
                      {AVATAR_PRESETS.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          title={a.label}
                          onClick={() => setDetails({ ...details, avatarPreset: a.id })}
                          className={`aspect-square flex items-center justify-center text-[13px] font-bold cursor-pointer border transition-colors ${
                            details.avatarPreset === a.id
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
                </div>
              )}

              <input
                type="email"
                className={inputCls}
                placeholder="EMAIL"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                type="password"
                className={inputCls}
                placeholder={tab === 'register' ? 'PASSWORD (min 6 chars)' : 'PASSWORD'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitAuth()}
              />

              <div className="flex gap-1.5">
                <button
                  type="button"
                  data-auth={tab === 'register' ? 'register' : 'signin'}
                  disabled={busy || !email || !password || (tab === 'register' && !details.callsign)}
                  onClick={submitAuth}
                  className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-stone-950 text-[11px] font-bold tracking-[0.18em] uppercase cursor-pointer"
                >
                  {busy ? 'WORKING…' : tab === 'register' ? 'Create Operator' : 'Sign In'}
                </button>
                {backendKind === 'supabase' && (
                  <button
                    type="button"
                    data-auth="google"
                    disabled={busy}
                    onClick={onGoogle}
                    className="px-4 py-2 bg-[#1a2230] hover:bg-[#232f42] border border-stone-700 text-stone-200 text-[11px] tracking-[0.14em] uppercase cursor-pointer"
                  >
                    Google
                  </button>
                )}
              </div>
            </>
          )}

          {/* Guest quick play — always available */}
          <div className="border-t border-stone-800 pt-3">
            <div className="text-[9px] tracking-[0.2em] uppercase text-stone-500 mb-1.5">
              No account? Quick Callsign
            </div>
            <div className="flex gap-1.5">
              <input
                className={inputCls}
                placeholder="CALLSIGN"
                value={guestName}
                maxLength={12}
                onChange={(e) => setGuestName(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && guestName.trim() && (onGuest(guestName), onClose())}
              />
              <button
                type="button"
                data-auth="guest"
                onClick={() => {
                  onGuest(guestName);
                  onClose();
                }}
                className="px-3 py-1.5 bg-[#1a2230] hover:bg-[#232f42] border border-stone-700 text-stone-200 text-[10px] tracking-[0.16em] uppercase cursor-pointer"
              >
                Play
              </button>
            </div>
          </div>

          {error && (
            <div className="text-[9.5px] tracking-[0.12em] uppercase text-red-400 border border-red-900/50 bg-red-950/30 px-2 py-1.5">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
