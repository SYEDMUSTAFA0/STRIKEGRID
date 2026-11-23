import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';

export interface ChatLine {
  id: string;
  fromId: string;
  fromName: string;
  text: string;
  ts: number;
  /** System/hint lines render dimmed and centered. */
  system?: boolean;
}

interface ChatBoxProps {
  lines: ChatLine[];
  onSend: (text: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selfName?: string;
  placeholder?: string;
  /** Max messages kept in the scrollback. */
  maxLines?: number;
  /** Show the "press enter" hint bar when closed. */
  showHint?: boolean;
}

/**
 * Shared chat panel used by the multiplayer lobby (global online chat) and
 * the in-match HUD (squad chat). Enter sends, Esc closes, all keys are
 * stop-propagated so the game never sees them.
 */
export function ChatBox({
  lines,
  onSend,
  open,
  onOpenChange,
  selfName,
  placeholder = 'Message…',
  maxLines = 60,
  showHint = true,
}: ChatBoxProps) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const visible = lines.slice(-maxLines);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
    onOpenChange(false);
    inputRef.current?.blur();
  };

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {visible.length > 0 && (
        <div
          ref={scrollRef}
          className="max-h-36 overflow-y-auto no-scrollbar flex flex-col gap-0.5 bg-[#0d1117]/80 border border-stone-800/80 px-2 py-1.5 backdrop-blur-sm"
        >
          {visible.map((m) =>
            m.system ? (
              <div key={m.id} className="text-[9.5px] tracking-[0.14em] uppercase text-stone-500 text-center py-0.5">
                {m.text}
              </div>
            ) : (
              <div key={m.id} className="text-[11px] leading-snug break-words">
                <span className="text-amber-400/90 font-bold">{m.fromName}: </span>
                <span className={m.fromId === 'self' ? 'text-sky-300' : 'text-stone-200'}>
                  {m.text}
                </span>
              </div>
            ),
          )}
        </div>
      )}

      {open ? (
        <div className="flex items-center gap-1.5 bg-[#0d1117]/90 border border-amber-500/60 px-2 py-1 backdrop-blur-sm">
          <MessageSquare className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={draft}
            maxLength={280}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onOpenChange(false);
                inputRef.current?.blur();
              }
            }}
            className="flex-1 bg-transparent text-[12px] text-stone-100 placeholder:text-stone-600 outline-none"
          />
          <button
            type="button"
            onClick={submit}
            className="text-amber-400 hover:text-amber-300 cursor-pointer"
            title="Send"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        showHint && (
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            className="self-start flex items-center gap-1.5 text-[9.5px] tracking-[0.18em] uppercase text-stone-500 hover:text-amber-300 transition-colors cursor-pointer"
          >
            <MessageSquare className="w-3 h-3" />
            {selfName ? `${selfName} · ` : ''}Chat [Enter]
          </button>
        )
      )}
    </div>
  );
}
