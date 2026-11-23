import { Mic, MicOff } from 'lucide-react';
import type { VoiceStatus } from '../game/voice';

interface VoiceControlsProps {
  /** Microphone stream is live. */
  enabled: boolean;
  /** Local mic is muted (still connected). */
  muted: boolean;
  status: VoiceStatus;
  /** Local mic level 0..1 for the speaking meter. */
  level: number;
  /** Number of active remote voice peers. */
  peerCount: number;
  onToggleMic: () => void;
  onToggleMute: () => void;
}

/** Compact voice-chat cluster: mic toggle, level meter, peer count. */
export function VoiceControls({
  enabled,
  muted,
  status,
  level,
  peerCount,
  onToggleMic,
  onToggleMute,
}: VoiceControlsProps) {
  const live = enabled && status === 'live';
  const pct = Math.round(Math.min(1, level) * 100);

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        tabIndex={-1}
        onClick={(e) => {
          e.currentTarget.blur();
          onToggleMic();
        }}
        aria-label={live ? 'Disable voice chat' : 'Enable voice chat'}
        title={
          status === 'unsupported'
            ? 'Voice chat needs microphone access'
            : live
              ? 'Voice chat live — click to disable'
              : 'Enable voice chat'
        }
        className={`w-9 h-9 flex items-center justify-center border transition-colors cursor-pointer ${
          live
            ? muted
              ? 'bg-[#11151d]/90 border-stone-600 text-stone-400'
              : 'bg-emerald-950/80 border-emerald-500/70 text-emerald-300'
            : 'bg-[#11151d]/90 border-stone-700 text-stone-200 hover:bg-[#1b2230]'
        }`}
      >
        {live && !muted ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
      </button>

      {live && (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleMute();
          }}
          aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
          title={muted ? 'Mic muted — click to unmute' : 'Mute microphone'}
          className={`w-7 h-9 flex items-center justify-center border text-[9px] font-bold tracking-wider cursor-pointer ${
            muted
              ? 'bg-red-950/70 border-red-800/70 text-red-300'
              : 'bg-[#11151d]/90 border-stone-700 text-stone-300 hover:bg-[#1b2230]'
          }`}
        >
          {muted ? 'MUT' : 'TALK'}
        </button>
      )}

      {live && (
        <div className="flex flex-col items-end gap-0.5 bg-[#11151d]/85 border border-stone-700/80 px-2 py-1">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[8.5px] tracking-[0.2em] uppercase text-emerald-300">
              Voice{peerCount > 0 ? ` · ${peerCount}` : ''}
            </span>
          </div>
          <div className="w-16 h-1 bg-stone-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-100 ${muted ? 'bg-stone-600' : 'bg-emerald-400'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
