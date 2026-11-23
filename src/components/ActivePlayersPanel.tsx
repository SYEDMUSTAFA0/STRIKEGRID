import type { OnlinePlayer } from '../game/onlinePresence';
import { avatarPreset } from '../game/userProfile';
import { WEAPON_SPECS } from '../game/rules';
import { UserPlus, LogIn } from 'lucide-react';

interface ActivePlayersPanelProps {
  players: OnlinePlayer[];
  /** Whether the local player is currently inside a room (enables Invite). */
  canInvite: boolean;
  backendKind: 'none' | 'supabase' | 'firebase';
  onInvite: (player: OnlinePlayer) => void;
  onJoinRoom: (player: OnlinePlayer) => void;
}

function Emblem({ preset, size = 22 }: { preset?: string; size?: number }) {
  const a = avatarPreset(preset);
  return (
    <span
      className="inline-flex items-center justify-center font-bold shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.48,
        color: '#0b0e13',
        background: `linear-gradient(135deg, ${a.color}, ${a.color}88)`,
        clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
      }}
      title={a.label}
    >
      {a.glyph}
    </span>
  );
}

function weaponLabel(id?: string): string {
  if (!id || id === 'any') return 'ANY';
  return (WEAPON_SPECS as Record<string, { shortLabel?: string; name?: string }>)[id]?.shortLabel
    ?? id.toUpperCase();
}

export function ActivePlayersPanel({
  players,
  canInvite,
  backendKind,
  onInvite,
  onJoinRoom,
}: ActivePlayersPanelProps) {
  // Directory = everyone currently joinable (excludes manually inactive users).
  const active = players.filter((p) => !p.isSelf && p.status !== 'inactive');
  const inactiveCount = players.filter((p) => !p.isSelf && p.status === 'inactive').length;

  return (
    <div className="max-h-56 overflow-y-auto no-scrollbar divide-y divide-stone-800/60">
      {active.length === 0 && (
        <div className="px-3 py-3 text-[10px] tracking-[0.14em] uppercase text-stone-500 text-center">
          {backendKind === 'none'
            ? 'No other tabs detected — open a second tab to test multiplayer'
            : 'No active operators online right now'}
          {inactiveCount > 0 ? ` (${inactiveCount} inactive)` : ''}
        </div>
      )}
      {active.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
          <div className="min-w-0 flex items-center gap-2">
            <Emblem preset={p.avatarPreset} />
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                p.status === 'match' ? 'bg-amber-400' : p.status === 'lobby' ? 'bg-sky-400' : 'bg-emerald-400'
              } tac-blink`}
            />
            <div className="min-w-0">
              <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-stone-200 truncate">
                {p.callsign}
              </div>
              <div className="text-[9px] tracking-[0.12em] uppercase text-stone-500 truncate">
                {p.country ? `${p.country} · ` : ''}
                LV {p.level ?? 1} · {weaponLabel(p.favoriteWeapon)}
                {p.status === 'match'
                  ? ` · In Match${p.mode ? ` · ${p.mode.toUpperCase()}` : ''}`
                  : p.status === 'lobby'
                    ? ' · In Lobby'
                    : ' · Online'}
                {' · '}
                {p.ping}ms
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span
              className={`px-1.5 py-px border text-[8.5px] tracking-[0.16em] uppercase ${
                p.status === 'match'
                  ? 'text-amber-400 border-amber-800'
                  : p.status === 'lobby'
                    ? 'text-sky-400 border-sky-800'
                    : 'text-emerald-400 border-emerald-800'
              }`}
            >
              {p.status === 'match' ? 'IN MATCH' : p.status === 'lobby' ? 'IN LOBBY' : 'ACTIVE'}
            </span>
            {p.roomCode && (
              <button
                type="button"
                onClick={() => onJoinRoom(p)}
                className="flex items-center gap-1 px-1.5 py-0.5 border border-stone-700 text-[9px] tracking-[0.14em] uppercase text-stone-300 hover:border-amber-500 hover:text-amber-300 cursor-pointer"
              >
                <LogIn className="w-3 h-3" /> Join
              </button>
            )}
            {canInvite && (
              <button
                type="button"
                onClick={() => onInvite(p)}
                className="flex items-center gap-1 px-1.5 py-0.5 border border-stone-700 text-[9px] tracking-[0.14em] uppercase text-stone-300 hover:border-sky-500 hover:text-sky-300 cursor-pointer"
              >
                <UserPlus className="w-3 h-3" /> Invite
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
