import { useState } from 'react';
import { ActivePlayersPanel } from './ActivePlayersPanel';
import {
  DIFFICULTY_TIERS,
  MAP_SPECS,
  MATCH_MODE_SPECS,
  WEAPON_SKIN_SPECS,
} from '../game/rules';
import type { FriendEntry, PlayerProfile, BackendKind } from '../game/auth';
import type { OnlinePlayer, PresenceInvite } from '../game/onlinePresence';
import type { ChatLine } from './ChatBox';
import { ChatBox } from './ChatBox';
import { VoiceControls } from './VoiceControls';
import type { VoiceStatus } from '../game/voice';
import type { MatchModeId, DifficultyTierId, MapId, MultiplayerPeer, SquadSide } from '../game/types';
import {
  Bot,
  Copy,
  DoorOpen,
  Gamepad2,
  Shield,
  ShieldOff,
  Swords,
  UserPlus,
  UserCheck,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';

export interface LobbyMatchConfig {
  mode: MatchModeId;
  mapId: MapId;
  tier: DifficultyTierId;
  level: number;
  /** Allow damage between teammates (squad modes). Default off = protected. */
  friendlyFire: boolean;
}

export interface FriendsLobbyProps {
  profile: PlayerProfile;
  backendKind: BackendKind;
  onlinePlayers: OnlinePlayer[];
  friends: FriendEntry[];
  members: MultiplayerPeer[];
  roomCode: string;
  inRoom: boolean;
  isHost: boolean;
  channelSupported: boolean;
  matchConfig: LobbyMatchConfig;
  invite: PresenceInvite | null;
  onUpdateMatchConfig: (patch: Partial<LobbyMatchConfig>) => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onQuickMatch: () => void;
  onLeaveRoom: () => void;
  onToggleReady: (ready: boolean) => void;
  onStartMatch: () => void;
  onAddFriendByCode: (code: string) => void;
  onRemoveFriend: (code: string) => void;
  onInvitePlayer: (player: OnlinePlayer) => void;
  onJoinPlayerRoom: (player: OnlinePlayer) => void;
  onCopyFriendCode: () => void;
  onAcceptInvite: () => void;
  onDeclineInvite: () => void;
  /** This client's chosen combat role (attack / alpha / bravo). */
  selfSide: SquadSide;
  onSetSide: (side: SquadSide) => void;
  /** Host rule: allow fire between teammates. */
  onToggleFriendlyFire: () => void;
  /** Host-only: fill the roster with simulated squad bots for testing. */
  onSimulateBots: () => void;
  onClearBots: () => void;
  /** Lobby-wide text chat (all online players). */
  chatLines?: ChatLine[];
  onSendChat?: (text: string) => void;
  /** Lobby voice chat controls. */
  voice?: {
    enabled: boolean;
    muted: boolean;
    status: VoiceStatus;
    level: number;
    peerCount: number;
    onToggleMic: () => void;
    onToggleMute: () => void;
  };
}

const ARENA_ORDER: MapId[] = [
  'dusk_yard',
  'arctic_outpost',
  'desert_compound',
  'neon_docks',
  'highland_ridge',
  'sunken_foundry',
];

const MODE_ORDER: MatchModeId[] = ['survival', 'tdm', 'ffa', 'zone_control'];

export function FriendsLobby(props: FriendsLobbyProps) {
  const {
    profile,
    backendKind,
    onlinePlayers,
    friends,
    members,
    roomCode,
    inRoom,
    isHost,
    channelSupported,
    matchConfig,
    invite,
    onUpdateMatchConfig,
    onCreateRoom,
    onJoinRoom,
    onQuickMatch,
    onLeaveRoom,
    onToggleReady,
    onStartMatch,
    onAddFriendByCode,
    onRemoveFriend,
    onInvitePlayer,
    onJoinPlayerRoom,
    onCopyFriendCode,
    onAcceptInvite,
    onDeclineInvite,
    selfSide,
    onSetSide,
    onToggleFriendlyFire,
    onSimulateBots,
    onClearBots,
    chatLines,
    onSendChat,
    voice,
  } = props;

  const [friendInput, setFriendInput] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'friends' | 'players'>('players');
  const [chatOpen, setChatOpen] = useState(true);

  const remotePlayers = onlinePlayers.filter((p) => !p.isSelf);
  const selfReady = members[0]?.ready ?? false;
  const allReady = members.length > 0 && members.every((m) => m.ready);
  const activeMode = MATCH_MODE_SPECS[matchConfig.mode];
  const botCount = members.filter((m) => m.bot).length;

  const SIDE_META: Record<SquadSide, { label: string; hint: string; cls: string; dot: string }> = {
    attack: {
      label: 'ATTACK ALL',
      hint: 'Solo striker — everyone is a rival',
      cls: 'border-red-800/70 text-red-300',
      dot: 'bg-red-400',
    },
    alpha: {
      label: 'ALPHA SQUAD',
      hint: 'Team up — amber squad vs rival teams',
      cls: 'border-amber-600/70 text-amber-300',
      dot: 'bg-amber-400',
    },
    bravo: {
      label: 'BRAVO SQUAD',
      hint: 'Team up — sky squad vs rival teams',
      cls: 'border-sky-700/70 text-sky-300',
      dot: 'bg-sky-400',
    },
  };
  const sideChip = (side?: SquadSide, bot?: boolean) => {
    if (bot) return { label: 'BOT', cls: 'border-stone-600 text-stone-400', dot: 'bg-stone-500' };
    if (!side || side === 'attack') return SIDE_META.attack;
    return SIDE_META[side];
  };

  const handleCopyCode = () => {
    onCopyFriendCode();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="mt-2 border border-stone-800/80 bg-[#0d1219]/80 p-3 space-y-3">
      {/* Backend / transport banner */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[9.5px] tracking-[0.14em] uppercase">
          {backendKind === 'none' ? (
            <WifiOff className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
          )}
          <span className={backendKind === 'none' ? 'text-amber-400' : 'text-emerald-400'}>
            {backendKind === 'none'
              ? 'Offline Demo — BroadcastChannel'
              : backendKind === 'supabase'
                ? 'Supabase Live'
                : 'Firebase Live'}
          </span>
        </div>
        {!channelSupported && (
          <span className="text-[9px] tracking-[0.14em] uppercase text-amber-400">
            Local fallback active
          </span>
        )}
      </div>

      {/* Incoming invite toast */}
      {invite && (
        <div className="border border-sky-700/70 bg-sky-950/40 px-2.5 py-2 flex items-center justify-between gap-2">
          <div className="text-[10.5px] text-sky-200">
            <span className="font-bold">{invite.fromCallsign}</span> invited you to room{' '}
            <span className="text-amber-300 font-bold">{invite.roomCode}</span>
            {invite.mode ? ` · ${MATCH_MODE_SPECS[invite.mode].short}` : ''}
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onAcceptInvite}
              className="px-2.5 py-1 bg-sky-500 hover:bg-sky-400 text-stone-950 text-[10px] font-bold tracking-[0.14em] uppercase cursor-pointer"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={onDeclineInvite}
              className="px-2 py-1 border border-stone-700 text-stone-400 hover:text-stone-200 text-[10px] tracking-[0.14em] uppercase cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Identity strip: callsign + friend code */}
      <div className="flex items-center justify-between border border-stone-800/70 bg-[#10151d] px-2.5 py-2">
        <div className="min-w-0">
          <div className="text-[12px] font-bold tracking-[0.14em] text-stone-100 uppercase truncate">
            {profile.callsign}
          </div>
          <div className="text-[9px] tracking-[0.18em] uppercase text-stone-500">
            LV {profile.level} · {profile.kills} career kills · {profile.wins} wins
          </div>
        </div>
        <button
          type="button"
          onClick={handleCopyCode}
          title="Copy your Friend Code"
          className="flex items-center gap-1.5 border border-stone-700 bg-[#141923] hover:border-amber-500 px-2 py-1 text-[10px] tracking-[0.18em] uppercase text-stone-200 cursor-pointer"
        >
          <Copy className="w-3 h-3 text-amber-400" />
          <span className="text-amber-300 font-bold">{profile.friendCode}</span>
          {copied && <span className="text-emerald-400 text-[9px]">COPIED</span>}
        </button>
      </div>

      {!inRoom ? (
        <>
          {/* Quick actions */}
          <div className="flex gap-1.5">
            <button
              type="button"
              data-lobby="quick-match"
              onClick={onQuickMatch}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 text-[11px] font-bold tracking-[0.18em] uppercase cursor-pointer"
            >
              <Gamepad2 className="w-3.5 h-3.5" /> Find Active Match
            </button>
            <button
              type="button"
              data-lobby="create"
              onClick={onCreateRoom}
              className="flex-1 py-2 border border-stone-700 bg-[#141923] hover:bg-[#1c2331] text-stone-200 text-[11px] tracking-[0.18em] uppercase cursor-pointer"
            >
              Host Custom
            </button>
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="ROOM CODE"
              className="flex-1 bg-[#10151d] border border-stone-800 px-2.5 py-1.5 text-[11px] tracking-[0.3em] uppercase text-stone-100 placeholder:text-stone-600 focus:border-amber-500 outline-none"
            />
            <button
              type="button"
              data-lobby="join"
              onClick={() => joinInput.length === 6 && onJoinRoom(joinInput)}
              disabled={joinInput.length !== 6}
              className="px-3 py-1.5 border border-stone-700 bg-[#141923] hover:bg-[#1c2331] disabled:opacity-40 text-stone-200 text-[10px] tracking-[0.18em] uppercase cursor-pointer"
            >
              Join
            </button>
          </div>

          {/* Active players / friends tabs */}
          <div className="border border-stone-800/80">
            <div className="flex border-b border-stone-800/80">
              {(['players', 'friends'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-1.5 text-[10px] tracking-[0.2em] uppercase cursor-pointer transition-colors ${
                    activeTab === tab
                      ? 'bg-[#1a2230] text-amber-300 font-bold'
                      : 'bg-[#10151d] text-stone-500 hover:text-stone-300'
                  }`}
                >
                  {tab === 'players' ? `Active Now (${remotePlayers.length})` : `Friends (${friends.length})`}
                </button>
              ))}
            </div>

            {activeTab === 'players' ? (
              <ActivePlayersPanel
                players={onlinePlayers}
                canInvite={inRoom}
                backendKind={backendKind}
                onInvite={onInvitePlayer}
                onJoinRoom={onJoinPlayerRoom}
              />
            ) : (
              <div className="max-h-44 overflow-y-auto no-scrollbar">
                <div className="flex gap-1.5 p-2 border-b border-stone-800/60">
                  <input
                    type="text"
                    value={friendInput}
                    onChange={(e) =>
                      setFriendInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
                    }
                    placeholder="FRIEND CODE"
                    className="flex-1 bg-[#10151d] border border-stone-800 px-2 py-1 text-[11px] tracking-[0.3em] uppercase text-stone-100 placeholder:text-stone-600 focus:border-amber-500 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (friendInput.length === 6) {
                        onAddFriendByCode(friendInput);
                        setFriendInput('');
                      }
                    }}
                    disabled={friendInput.length !== 6}
                    className="px-2 py-1 bg-[#1a2230] border border-stone-700 disabled:opacity-40 text-stone-200 hover:text-amber-300 text-[10px] tracking-[0.14em] uppercase cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                  </button>
                </div>
                {friends.length === 0 && (
                  <div className="px-3 py-3 text-[10px] tracking-[0.14em] uppercase text-stone-500 text-center">
                    Add friends by their 6-char Friend Code
                  </div>
                )}
                {friends.map((f) => {
                  const online = remotePlayers.find(
                    (p) => (p.friendCode || '').toUpperCase() === f.friendCode,
                  );
                  return (
                    <div key={f.friendCode} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                      <div className="min-w-0 flex items-center gap-2">
                        <UserCheck
                          className={`w-3.5 h-3.5 shrink-0 ${online ? 'text-emerald-400' : 'text-stone-600'}`}
                        />
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-stone-200 truncate">
                            {online?.callsign || f.callsign}
                          </div>
                          <div className="text-[9px] tracking-[0.14em] uppercase text-stone-500">
                            {f.friendCode}
                            {online ? ' · ONLINE' : ' · offline'}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveFriend(f.friendCode)}
                        className="text-stone-600 hover:text-red-400 cursor-pointer"
                        title="Remove friend"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Room header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-stone-300">
              <span className="text-stone-500">Room</span>
              <span className="text-amber-400 font-bold text-[13px] tracking-[0.3em]">{roomCode}</span>
              <button
                type="button"
                onClick={handleCopyCode}
                className="text-stone-500 hover:text-amber-300 cursor-pointer"
                title="Copy room code"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
            <span className="text-[9px] tracking-[0.18em] uppercase text-stone-500">
              {isHost ? '★ You are HOST' : 'Squad Member'}
            </span>
          </div>

          {/* Squad roster */}
          <div className="border border-stone-800/80 divide-y divide-stone-800/60">
            {members.map((m, idx) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-[#10151d]"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-[10px] text-stone-500 w-4">{idx + 1}</span>
                  <span className="text-[11px] font-bold tracking-[0.12em] uppercase text-stone-200 truncate">
                    {m.nickname}
                    {idx === 0 ? ' (you)' : ''}
                  </span>
                  {m.isHost && <span className="text-amber-400 text-[10px]">★</span>}
                  {(() => {
                    const chip = sideChip(m.side, m.bot);
                    return (
                      <span
                        className={`px-1 py-px border text-[8px] font-bold tracking-[0.12em] uppercase ${chip.cls}`}
                      >
                        {chip.label}
                      </span>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {m.bot && <Bot className="w-3 h-3 text-stone-500" />}
                  {m.skin && m.skin !== 'standard' && (
                    <span
                      className="w-2.5 h-2.5 border border-stone-600"
                      style={{
                        background: `linear-gradient(135deg, ${WEAPON_SKIN_SPECS[m.skin].swatchPrimary} 50%, ${WEAPON_SKIN_SPECS[m.skin].swatchAccent} 50%)`,
                      }}
                      title={WEAPON_SKIN_SPECS[m.skin].name}
                    />
                  )}
                  <span className={`text-[9px] tracking-[0.16em] uppercase ${m.ready ? 'text-emerald-400' : 'text-stone-500'}`}>
                    {m.ready ? 'READY' : 'STANDBY'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Combat role: attack all vs team up — everyone picks before START */}
          <div className="border border-stone-800/80 bg-[#0d1219]/60 p-2.5 space-y-1.5">
            <div className="text-[9.5px] tracking-[0.2em] uppercase text-stone-400">
              Combat Role — pick before deploy
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(['attack', 'alpha', 'bravo'] as SquadSide[]).map((s) => {
                const meta = SIDE_META[s];
                const sel = selfSide === s;
                return (
                  <button
                    key={s}
                    type="button"
                    data-side={s}
                    onClick={() => onSetSide(s)}
                    title={meta.hint}
                    className={`px-1 py-1.5 border text-center cursor-pointer transition-colors ${
                      sel
                        ? `${meta.cls} bg-[#1a2230] font-bold`
                        : 'bg-[#11161f] border-stone-800 text-stone-500 hover:border-stone-600 hover:text-stone-300'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1 text-[9.5px] tracking-[0.1em] uppercase">
                      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="text-[8.5px] tracking-[0.1em] uppercase text-stone-600">
              {SIDE_META[selfSide].hint}
            </div>
          </div>

          {/* Host controls: mode / arena / tier */}
          {isHost ? (
            <div className="space-y-2 border border-stone-800/80 bg-[#0d1219]/60 p-2.5">
              <div className="text-[9.5px] tracking-[0.2em] uppercase text-stone-400 flex items-center gap-1.5">
                <Swords className="w-3 h-3 text-amber-500" /> Match Rules — Host Control
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                {MODE_ORDER.map((m) => {
                  const spec = MATCH_MODE_SPECS[m];
                  const sel = matchConfig.mode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => onUpdateMatchConfig({ mode: m })}
                      title={spec.description}
                      className={`px-1 py-1.5 border text-center cursor-pointer transition-colors ${
                        sel
                          ? 'bg-amber-500 text-stone-950 border-amber-500 font-bold'
                          : 'bg-[#11161f] border-stone-800 text-stone-400 hover:border-stone-600 hover:text-stone-200'
                      }`}
                    >
                      <div className="text-[10px] tracking-[0.12em] uppercase">{spec.short}</div>
                      <div className="text-[8px] tracking-[0.1em] uppercase opacity-70 truncate">
                        {m === 'survival' ? 'Co-op' : m === 'zone_control' ? 'Capture' : m === 'tdm' ? 'Teams' : 'Solo'}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="text-[9px] text-stone-500 leading-snug">{activeMode.description}</div>

              {/* Rules extras: friendly fire + simulated squad fill */}
              <div className="flex items-center justify-between gap-2 border border-stone-800/70 bg-[#10151d] px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-[9.5px] tracking-[0.14em] uppercase text-stone-300">
                  {matchConfig.friendlyFire ? (
                    <ShieldOff className="w-3.5 h-3.5 text-red-400" />
                  ) : (
                    <Shield className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  Friendly Fire {matchConfig.friendlyFire ? 'ON' : 'OFF — squads protected'}
                </div>
                <button
                  type="button"
                  data-lobby="ff-toggle"
                  onClick={onToggleFriendlyFire}
                  className={`px-2 py-0.5 border text-[9px] font-bold tracking-[0.14em] uppercase cursor-pointer ${
                    matchConfig.friendlyFire
                      ? 'border-red-800 text-red-300 hover:bg-red-950/40'
                      : 'border-emerald-800 text-emerald-300 hover:bg-emerald-950/40'
                  }`}
                >
                  {matchConfig.friendlyFire ? 'Disable' : 'Enable'}
                </button>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  data-lobby="bots"
                  onClick={botCount > 0 ? onClearBots : onSimulateBots}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-stone-700 bg-[#141923] hover:bg-[#1c2331] text-stone-300 text-[9.5px] font-bold tracking-[0.14em] uppercase cursor-pointer"
                >
                  <Bot className="w-3.5 h-3.5 text-stone-400" />
                  {botCount > 0 ? `Clear Bots (${botCount})` : 'Simulate Squad (4v4 fill)'}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                {ARENA_ORDER.map((id) => {
                  const m = MAP_SPECS[id];
                  const sel = matchConfig.mapId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onUpdateMatchConfig({ mapId: id })}
                      className={`px-1 py-1 border text-left cursor-pointer transition-colors ${
                        sel
                          ? 'bg-[#1a2230] border-amber-500 text-stone-100'
                          : 'bg-[#11161f] border-stone-800 text-stone-400 hover:border-stone-600 hover:text-stone-200'
                      }`}
                    >
                      <div className="w-full h-0.5 mb-1" style={{ backgroundColor: sel ? m.badgeColor : '#334155' }} />
                      <div className="text-[9px] font-bold tracking-wide uppercase leading-tight truncate">
                        {m.name}
                      </div>
                      <div className="text-[8px] tracking-widest uppercase text-stone-500 truncate">
                        {m.subtitle}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-3 gap-1">
                {DIFFICULTY_TIERS.map((t) => {
                  const sel = matchConfig.tier === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onUpdateMatchConfig({ tier: t.id, level: t.level })}
                      className={`py-1 border text-[10px] font-bold tracking-[0.14em] uppercase cursor-pointer transition-colors ${
                        sel
                          ? 'bg-amber-500 text-stone-950 border-amber-500'
                          : 'bg-[#11161f] border-stone-800 text-stone-400 hover:border-stone-600 hover:text-stone-200'
                      }`}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="border border-stone-800/80 bg-[#0d1219]/60 px-2.5 py-2 text-[10px] tracking-[0.12em] uppercase text-stone-400">
              Host selected: <span className="text-amber-300 font-bold">{activeMode.name}</span> ·{' '}
              {MAP_SPECS[matchConfig.mapId].name} ·{' '}
              {DIFFICULTY_TIERS.find((t) => t.id === matchConfig.tier)?.name ?? 'EASY'} ·{' '}
              {matchConfig.friendlyFire ? 'FF ON' : 'Squads Protected'}
            </div>
          )}

          {/* Ready / start / leave */}
          <div className="flex gap-1.5">
            <button
              type="button"
              data-lobby="ready"
              onClick={() => onToggleReady(!selfReady)}
              className={`flex-1 py-2 border text-[11px] font-bold tracking-[0.18em] uppercase cursor-pointer transition-colors ${
                selfReady
                  ? 'bg-emerald-600/90 border-emerald-500 text-stone-950'
                  : 'bg-[#141923] border-stone-700 text-stone-200 hover:bg-[#1c2331]'
              }`}
            >
              {selfReady ? 'READY ✓' : 'READY UP'}
            </button>
            {isHost && (
              <button
                type="button"
                data-lobby="start"
                onClick={onStartMatch}
                disabled={!allReady && members.length > 1}
                className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-stone-950 text-[11px] font-bold tracking-[0.18em] uppercase cursor-pointer"
              >
                START MATCH
              </button>
            )}
            <button
              type="button"
              data-lobby="leave"
              onClick={onLeaveRoom}
              className="px-2.5 py-2 border border-stone-800 text-stone-500 hover:text-red-300 hover:border-red-900 text-[10px] tracking-[0.18em] uppercase cursor-pointer"
            >
              <DoorOpen className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}

      {/* Lobby comms: voice channel + global online chat */}
      {(voice || (chatLines && onSendChat)) && (
        <div className="border-t border-stone-800/80 pt-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[9.5px] font-semibold tracking-[0.2em] uppercase text-stone-400">
              Lobby Comms
            </div>
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
          </div>
          {chatLines && onSendChat && (
            <ChatBox
              lines={chatLines}
              onSend={onSendChat}
              open={chatOpen}
              onOpenChange={setChatOpen}
              selfName={profile.callsign}
              placeholder="Message all online operators…"
              maxLines={40}
            />
          )}
        </div>
      )}
    </div>
  );
}
