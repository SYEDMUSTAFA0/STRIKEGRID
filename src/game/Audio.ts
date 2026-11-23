import type { WeaponId } from './types';

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private windStarted = false;
  private muted = false;
  private engineNodes: {
    osc: OscillatorNode;
    osc2: OscillatorNode;
    noise: AudioBufferSourceNode;
    gain: GainNode;
    filter: BiquadFilterNode;
  } | null = null;

  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.72;
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this.buildNoiseBuffer(1.6);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    if (!this.windStarted && this.ctx && this.masterGain) {
      this.startAmbientWind();
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.72, this.ctx.currentTime, 0.03);
    }
  }

  setWindActive(active: boolean): void {
    if (!this.windGain || !this.ctx) return;
    this.windGain.gain.setTargetAtTime(active ? 0.08 : 0.025, this.ctx.currentTime, 0.35);
  }

  /** Continuous vehicle engine loop. rpm01 in [0,1]; active=false idles it out. */
  setEngine(active: boolean, rpm01: number, kind: 'car' | 'bike' = 'car'): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) {
      this.engineNodes = null;
      return;
    }
    if (!this.engineNodes) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      const osc2 = this.ctx.createOscillator();
      osc2.type = 'square';
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      filter.Q.value = 2.2;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      osc2.connect(filter);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      osc.start();
      osc2.start();
      noise.start();
      this.engineNodes = { osc, osc2, noise, gain, filter };
    }
    const e = this.engineNodes;
    const rpm = Math.max(0, Math.min(1, rpm01));
    const base = kind === 'bike' ? 52 : 38;
    e.osc.frequency.setTargetAtTime(base + rpm * (kind === 'bike' ? 240 : 170), this.ctx.currentTime, 0.06);
    e.osc2.frequency.setTargetAtTime((base + rpm * 160) * 0.5, this.ctx.currentTime, 0.06);
    e.filter.frequency.setTargetAtTime(320 + rpm * 900, this.ctx.currentTime, 0.08);
    const target = active ? (kind === 'bike' ? 0.05 : 0.075) * (0.35 + rpm * 0.65) : 0;
    e.gain.gain.setTargetAtTime(target, this.ctx.currentTime, active ? 0.08 : 0.25);
  }

  /** Single Geiger-counter click; call rate scales with radiation intensity. */
  playGeiger(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(3400 + Math.random() * 900, now);
    gain.gain.setValueAtTime(0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.02);
  }

  playVehicleDoor(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(85, now + 0.09);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  private buildNoiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private startAmbientWind(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    this.windStarted = true;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 185;
    filter.Q.value = 1.6;

    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.14;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 65;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.03;

    src.connect(filter);
    filter.connect(this.windGain);
    this.windGain.connect(this.masterGain);

    src.start();
    lfo.start();
  }

  playGunshot(weapon: WeaponId, isEnemy = false, distance = 0): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    if (weapon === 'knife') {
      this.playKnifeSlash(false);
      return;
    }

    const now = this.ctx.currentTime;
    const pitchJitter = 0.94 + Math.random() * 0.12;
    const distAtten = isEnemy ? Math.max(0.18, 1 - distance / 52) : 1;

    // Per-weapon report profiles: gain, body pitch, crack filter, tail length
    const profile =
      weapon === 'shotgun'
        ? { gain: 0.72, osc: 'sawtooth' as const, freq: 128, filter: 1150, tail: 0.36, drop: 28 }
        : weapon === 'deagle'
          ? { gain: 0.74, osc: 'sawtooth' as const, freq: 96, filter: 950, tail: 0.4, drop: 24 }
          : weapon === 'lmg'
            ? { gain: 0.68, osc: 'sawtooth' as const, freq: 132, filter: 1350, tail: 0.3, drop: 30 }
            : weapon === 'marksman'
              ? { gain: 0.64, osc: 'triangle' as const, freq: 148, filter: 2450, tail: 0.3, drop: 36 }
              : weapon === 'smg'
                ? { gain: 0.52, osc: 'square' as const, freq: 205, filter: 1900, tail: 0.14, drop: 40 }
                : weapon === 'rifle'
                  ? { gain: 0.58, osc: 'triangle' as const, freq: 175, filter: 1650, tail: 0.25, drop: 36 }
                  : { gain: 0.46, osc: 'triangle' as const, freq: 225, filter: 2100, tail: 0.17, drop: 36 };

    const baseGain = profile.gain;
    const level = (isEnemy ? 0.28 : baseGain) * distAtten;

    // 1. Punchy low-end bass thump
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = profile.osc;
    const startFreq = profile.freq * pitchJitter;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(profile.drop, now + 0.12);

    oscGain.gain.setValueAtTime(level * 0.95, now);
    oscGain.gain.exponentialRampToValueAtTime(
      0.001,
      now + (weapon === 'shotgun' || weapon === 'deagle' ? 0.18 : 0.115),
    );
    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);

    // 2. High-transient crack & compound reverb tail
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = isEnemy && distance > 18 ? 'lowpass' : 'bandpass';
    const baseFilter = profile.filter;
    bp.frequency.setValueAtTime(
      (baseFilter * pitchJitter) / (1 + distance * 0.025),
      now,
    );
    bp.frequency.exponentialRampToValueAtTime(280, now + (weapon === 'shotgun' ? 0.34 : 0.24));
    bp.Q.value = weapon === 'marksman' ? 1.15 : weapon === 'smg' ? 0.9 : 0.75;

    const tailDur = profile.tail;
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(level * 0.9, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + tailDur);

    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + tailDur + 0.02);

    // 3. Crisp mechanical bolt/pump action on player shots
    if (!isEnemy) {
      if (weapon === 'shotgun') {
        // Delayed mechanical two-stage pump rack ("chack-chack")
        for (const [offset, freq] of [
          [0.24, 1450],
          [0.37, 1950],
        ] as const) {
          const pOsc = this.ctx.createOscillator();
          const pGain = this.ctx.createGain();
          pOsc.type = 'square';
          pOsc.frequency.setValueAtTime(freq, now + offset);
          pOsc.frequency.exponentialRampToValueAtTime(freq * 0.48, now + offset + 0.045);
          pGain.gain.setValueAtTime(0.11, now + offset);
          pGain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.05);
          pOsc.connect(pGain);
          pGain.connect(this.masterGain);
          pOsc.start(now + offset);
          pOsc.stop(now + offset + 0.055);
        }
      } else {
        const boltOsc = this.ctx.createOscillator();
        const boltGain = this.ctx.createGain();
        boltOsc.type = 'square';
        boltOsc.frequency.setValueAtTime(
          weapon === 'smg' ? 3100 : weapon === 'lmg' ? 1900 : weapon === 'deagle' ? 1500 : weapon === 'rifle' ? 2400 : 2850,
          now + 0.015,
        );
        boltOsc.frequency.exponentialRampToValueAtTime(950, now + 0.045);
        boltGain.gain.setValueAtTime(0.06, now + 0.015);
        boltGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        boltOsc.connect(boltGain);
        boltGain.connect(this.masterGain);
        boltOsc.start(now + 0.015);
        boltOsc.stop(now + 0.055);
      }
    }
  }

  playKnifeSlash(hit: boolean): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;

    // Sharp blade air-whoosh
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2400, now);
    bp.frequency.exponentialRampToValueAtTime(580, now + 0.14);
    bp.Q.value = 1.8;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.16);

    if (hit) {
      const impOsc = this.ctx.createOscillator();
      const impGain = this.ctx.createGain();
      impOsc.type = 'triangle';
      impOsc.frequency.setValueAtTime(260, now + 0.02);
      impOsc.frequency.exponentialRampToValueAtTime(65, now + 0.1);
      impGain.gain.setValueAtTime(0.35, now + 0.02);
      impGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      impOsc.connect(impGain);
      impGain.connect(this.masterGain);
      impOsc.start(now + 0.02);
      impOsc.stop(now + 0.12);
    }
  }

  playGrenadePin(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2600, now);
    osc.frequency.exponentialRampToValueAtTime(4200, now + 0.045);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  playGrenadeThrow(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.setValueAtTime(950, now);
    lp.frequency.exponentialRampToValueAtTime(380, now + 0.18);
    lp.Q.value = 1.2;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    src.connect(lp);
    lp.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.2);
  }

  playGrenadeBounce(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    const base = 1350 + Math.random() * 350;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 0.65, now + 0.055);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.065);
  }

  playGrenadeBeep(urgent: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(urgent ? 2250 : 1650, now);
    gain.gain.setValueAtTime(urgent ? 0.12 : 0.075, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  playShellClink(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    const base = 3600 + Math.random() * 1400;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 0.72, now + 0.045);
    gain.gain.setValueAtTime(0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  playExplosion(distance = 0): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;
    const atten = Math.max(0.25, 1 - distance / 55);

    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(115, now);
    sub.frequency.exponentialRampToValueAtTime(24, now + 0.45);
    subGain.gain.setValueAtTime(0.76 * atten, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    sub.connect(subGain);
    subGain.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 0.52);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, now);
    lp.frequency.exponentialRampToValueAtTime(140, now + 0.65);

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.68 * atten, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    noise.connect(lp);
    lp.connect(nGain);
    nGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.72);
  }

  playReload(stage: 'start' | 'insert'): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';

    if (stage === 'start') {
      osc.frequency.setValueAtTime(640, now);
      osc.frequency.exponentialRampToValueAtTime(280, now + 0.055);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    } else {
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.setValueAtTime(980, now + 0.04);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    }
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  playRicochet(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    const base = 1800 + Math.random() * 1400;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 0.42, now + 0.14);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  playHitmarker(headshot: boolean, killed = false): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = headshot ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(headshot ? 2050 : 1220, now);
    osc.frequency.exponentialRampToValueAtTime(headshot ? 2800 : 860, now + 0.055);
    gain.gain.setValueAtTime(headshot ? 0.3 : 0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.085);

    if (killed) {
      const kOsc = this.ctx.createOscillator();
      const kGain = this.ctx.createGain();
      kOsc.type = 'triangle';
      kOsc.frequency.setValueAtTime(headshot ? 980 : 660, now + 0.025);
      kOsc.frequency.exponentialRampToValueAtTime(headshot ? 1480 : 990, now + 0.11);
      kGain.gain.setValueAtTime(0.16, now + 0.025);
      kGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      kOsc.connect(kGain);
      kGain.connect(this.masterGain);
      kOsc.start(now + 0.025);
      kOsc.stop(now + 0.14);
    }
  }

  playFootstep(sprinting: boolean): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = (sprinting ? 290 : 210) * (0.9 + Math.random() * 0.2);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(sprinting ? 0.16 : 0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.09);
  }

  playSlide(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, now);
    bp.frequency.exponentialRampToValueAtTime(320, now + 0.35);
    bp.Q.value = 1.1;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.38);
  }

  playPlayerDamage(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(115, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.16);
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  playHeartbeat(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    for (const offset of [0, 0.16]) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(offset === 0 ? 64 : 54, now + offset);
      osc.frequency.exponentialRampToValueAtTime(32, now + offset + 0.12);
      gain.gain.setValueAtTime(offset === 0 ? 0.18 : 0.13, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.13);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + offset);
      osc.stop(now + offset + 0.14);
    }
  }

  playWaveSwell(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.55);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.68);
  }

  playTelegraph(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(1040, now + 0.18);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  playPickup(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.setValueAtTime(780, now + 0.06);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  playSwitch(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.045);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.masterGain = null;
    this.windGain = null;
    this.windStarted = false;
  }
}
