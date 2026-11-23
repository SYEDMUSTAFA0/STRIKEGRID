import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Player, TouchAction } from '../game/Player';

interface TouchControlsProps {
  /** Resolved lazily so the engine (created once on mount) is always current. */
  getPlayer: () => Player | null;
  /** Only show while a run is live (not title/pause/game-over). */
  active: boolean;
  /** Show the vehicle brake pad while driving. */
  vehicleActive?: boolean;
}

function detectTouch(): boolean {
  if (typeof window === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

const LOOK_SENS = 2.2;

interface PadButtonProps {
  label: ReactNode;
  sub?: string;
  onDown: () => void;
  onUp?: () => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

function PadButton({ label, sub, onDown, onUp, className = '', size = 'md' }: PadButtonProps) {
  const [held, setHeld] = useState(false);
  const sizes = {
    sm: 'w-11 h-11 text-[9px]',
    md: 'w-14 h-14 text-[10px]',
    lg: 'w-20 h-20 text-[11px]',
  } as const;
  return (
    <button
      type="button"
      className={`pointer-events-auto flex flex-col items-center justify-center rounded-full border backdrop-blur-sm font-mono font-bold tracking-widest uppercase transition-colors touch-none select-none ${
        held
          ? 'bg-amber-500/80 border-amber-300 text-stone-950'
          : 'bg-[#11151d]/80 border-stone-600/80 text-stone-200 active:bg-[#1c2331]'
      } ${sizes[size]} ${className}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setHeld(true);
        onDown();
      }}
      onPointerUp={() => {
        setHeld(false);
        onUp?.();
      }}
      onPointerCancel={() => {
        setHeld(false);
        onUp?.();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span>{label}</span>
      {sub && <span className="text-[7.5px] tracking-[0.14em] opacity-60 normal-case">{sub}</span>}
    </button>
  );
}

export function TouchControls({ getPlayer, active, vehicleActive = false }: TouchControlsProps) {
  const [enabled] = useState(detectTouch);
  const stickRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const stickPointer = useRef<number | null>(null);
  const lookPointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const lookSurfaceRef = useRef<HTMLDivElement | null>(null);

  const resetStick = () => {
    stickPointer.current = null;
    if (knobRef.current) knobRef.current.style.transform = 'translate(-50%, -50%)';
    getPlayer()?.setTouchMove(0, 0);
  };

  // Release all held inputs when the overlay hides or unmounts.
  useEffect(() => {
    if (!active) {
      resetStick();
      const p = getPlayer();
      p?.setTouchFire(false);
      p?.setTouchAds(false);
      p?.setTouchBrake(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => () => {
    getPlayer()?.setTouchMove(0, 0);
    getPlayer()?.setTouchFire(false);
    getPlayer()?.setTouchAds(false);
    getPlayer()?.setTouchBrake(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!enabled || !active) return null;

  const fire = () => getPlayer()?.setTouchFire(true);
  const stopFire = () => getPlayer()?.setTouchFire(false);
  const act = (a: TouchAction) => () => getPlayer()?.queueTouchAction(a);

  return (
    <div className="fixed inset-0 z-20 pointer-events-none font-mono">
      {/* Right-side look surface — drag anywhere on the right ~62% of screen */}
      <div
        ref={lookSurfaceRef}
        className="absolute top-0 bottom-0 right-0 w-[62%] touch-none"
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return;
          lookPointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const lp = lookPointer.current;
          if (!lp || lp.id !== e.pointerId) return;
          const dx = e.clientX - lp.x;
          const dy = e.clientY - lp.y;
          lp.x = e.clientX;
          lp.y = e.clientY;
          getPlayer()?.applyTouchLook(dx * LOOK_SENS, dy * LOOK_SENS);
        }}
        onPointerUp={(e) => {
          if (lookPointer.current?.id === e.pointerId) lookPointer.current = null;
        }}
        onPointerCancel={(e) => {
          if (lookPointer.current?.id === e.pointerId) lookPointer.current = null;
        }}
      />

      {/* Move joystick — bottom left */}
      <div
        ref={stickRef}
        className="absolute bottom-24 left-5 w-28 h-28 sm:bottom-28 sm:left-8 rounded-full border border-stone-600/60 bg-[#11151d]/60 backdrop-blur-sm touch-none"
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return;
          stickPointer.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          const rect = e.currentTarget.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const dx = e.clientX - cx;
          const dy = e.clientY - cy;
          const len = Math.hypot(dx, dy) || 1;
          const clamped = Math.min(len, rect.width / 2 - 14);
          const nx = (dx / len) * clamped;
          const ny = (dy / len) * clamped;
          if (knobRef.current) {
            knobRef.current.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
          }
          getPlayer()?.setTouchMove(nx / (rect.width / 2), -ny / (rect.height / 2));
        }}
        onPointerMove={(e) => {
          if (stickPointer.current !== e.pointerId) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const dx = e.clientX - cx;
          const dy = e.clientY - cy;
          const len = Math.hypot(dx, dy) || 1;
          const maxR = rect.width / 2 - 14;
          const clamped = Math.min(len, maxR);
          const nx = (dx / len) * clamped;
          const ny = (dy / len) * clamped;
          if (knobRef.current) {
            knobRef.current.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
          }
          getPlayer()?.setTouchMove(nx / maxR, -ny / maxR);
        }}
        onPointerUp={() => resetStick()}
        onPointerCancel={() => resetStick()}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-3 h-3 rounded-full bg-stone-500/50" />
        </div>
        <div
          ref={knobRef}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-amber-500/50 border border-amber-300/70"
          style={{ transform: 'translate(-50%, -50%)' }}
        />
      </div>

      {/* Action cluster — bottom right */}
      <div className="absolute bottom-24 right-4 sm:bottom-28 sm:right-8 flex flex-col items-end gap-2 pointer-events-none">
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-2 mr-1">
            <PadButton label="R" sub="Reload" size="sm" onDown={act('reload')} />
            <PadButton label="V" sub="Knife" size="sm" onDown={act('melee')} />
            <PadButton label="G" sub="Frag" size="sm" onDown={act('grenade')} />
          </div>
          <PadButton
            label="ADS"
            size="sm"
            onDown={() => getPlayer()?.setTouchAds(true)}
            onUp={() => getPlayer()?.setTouchAds(false)}
          />
          <PadButton
            label="FIRE"
            size="lg"
            onDown={fire}
            onUp={stopFire}
          />
        </div>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-2">
            <PadButton label="1" sub="Primary" size="sm" onDown={act('slot1')} />
            <PadButton label="2" sub="Sidearm" size="sm" onDown={act('slot2')} />
          </div>
          <PadButton label="⤒" sub="Jump" size="md" onDown={act('jump')} />
          <PadButton label="C" sub="Crouch" size="md" onDown={act('crouch')} />
          <PadButton label="E" sub="Use" size="md" onDown={act('interact')} />
        </div>
      </div>

      {/* Vehicle brake — shown only while driving */}
      {vehicleActive && (
        <div className="absolute bottom-56 left-36 sm:left-44">
          <PadButton
            label="BRK"
            sub="Brake"
            size="md"
            onDown={() => getPlayer()?.setTouchBrake(true)}
            onUp={() => getPlayer()?.setTouchBrake(false)}
          />
        </div>
      )}
    </div>
  );
}
