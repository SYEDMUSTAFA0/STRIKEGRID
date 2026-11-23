/**
 * WebRTC mesh voice chat for SECTOR 09.
 *
 * - Audio-only peer connections between the local player and every peer id
 *   supplied via `setPeers()` (typically the online-presence player list).
 * - Signaling is transport-agnostic: the host app injects `sendSignal` /
 *   `onSignal`, which the presence backends relay through Supabase /
 *   Firebase RTDB / BroadcastChannel. Messages are tiny JSON blobs.
 * - Non-trickle ICE: each side waits for candidate gathering to finish
 *   (bounded ~4s) so a single offer/answer pair completes a call — this
 *   keeps setup reliable over high-latency REST polling.
 * - Glare-free by construction: for each pair the lexicographically smaller
 *   peer id is always the caller (offers), the other only answers.
 */

export type VoiceSignalPayload =
  | { t: 'voice-offer'; sdp: string }
  | { t: 'voice-answer'; sdp: string }
  | { t: 'voice-leave' };

export type VoiceStatus = 'off' | 'starting' | 'live' | 'error' | 'unsupported';

export interface VoiceChatOptions {
  selfId: string;
  /** Relay one signaling payload to a specific peer id. */
  sendSignal: (toId: string, payload: VoiceSignalPayload) => void;
  /** Subscribe to inbound signaling payloads. */
  onSignal: (cb: (fromId: string, payload: unknown) => void) => () => void;
  /** Optional element remote audio streams are attached to (defaults to body). */
  audioContainer?: HTMLElement;
  iceServers?: RTCIceServer[];
  /** Hard cap on simultaneous voice peers (mesh cost grows quadratically). */
  maxPeers?: number;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser: AnalyserNode | null;
  audioCtx: AudioContext | null;
  isCaller: boolean;
  makingOffer: boolean;
  negotiated: boolean;
  failedRetries: number;
}

const ICE_GATHER_TIMEOUT_MS = 4000;
const LEVEL_TICK_MS = 120;

function waitIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = window.setTimeout(done, ICE_GATHER_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export class VoiceChat {
  private readonly opts: VoiceChatOptions;
  private stream: MediaStream | null = null;
  private pcs = new Map<string, PeerEntry>();
  private desiredPeers = new Set<string>();
  private signalUnsub: (() => void) | null = null;
  private levelTimer: number | null = null;
  private localCtx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private micMuted = false;
  private disposed = false;
  private audioContainer: HTMLElement | null = null;

  constructor(opts: VoiceChatOptions) {
    this.opts = opts;
  }

  get isEnabled(): boolean {
    return this.stream !== null;
  }

  get isMicMuted(): boolean {
    return this.micMuted;
  }

  private setStatus(s: VoiceStatus): void {
    this.onStatus?.(s);
  }

  onStatus?: (s: VoiceStatus) => void;
  onLocalLevel?: (level: number) => void;
  onPeerLevel?: (id: string, level: number) => void;

  /** Acquire the microphone and bring voice live. Requires a user gesture. */
  async enable(): Promise<boolean> {
    if (this.stream || this.disposed) return this.stream !== null;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.setStatus('unsupported');
      return false;
    }
    this.setStatus('starting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch {
      this.stream = null;
      this.setStatus('error');
      return false;
    }
    if (this.disposed) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      return false;
    }
    this.signalUnsub = this.opts.onSignal((fromId, payload) => this.handleSignal(fromId, payload));
    this.setupLocalMeter();
    // Bring up mesh links for everyone currently in scope.
    for (const id of this.desiredPeers) this.ensurePeer(id);
    // Caller side kicks off negotiation once the answerer peer exists.
    for (const [id, entry] of this.pcs) {
      if (entry.isCaller) window.setTimeout(() => void this.negotiate(id), 350);
    }
    this.setStatus('live');
    return true;
  }

  /** Tear the whole voice session down (mic off, all peers closed). */
  disable(): void {
    if (this.disposed) return;
    for (const id of [...this.pcs.keys()]) {
      try {
        this.opts.sendSignal(id, { t: 'voice-leave' });
      } catch {
        // ignore
      }
      this.closePeer(id);
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.signalUnsub?.();
    this.signalUnsub = null;
    this.teardownLocalMeter();
    this.setStatus('off');
  }

  /** Update which peer ids should have an active voice link (capped). */
  setPeers(ids: string[]): void {
    const cap = this.opts.maxPeers ?? 6;
    const next = new Set(ids.filter((id) => id && id !== this.opts.selfId).slice(0, cap));
    const removed = [...this.desiredPeers].filter((id) => !next.has(id));
    for (const id of removed) {
      this.desiredPeers.delete(id);
      this.closePeer(id);
    }
    for (const id of next) {
      const isNew = !this.desiredPeers.has(id);
      this.desiredPeers.add(id);
      if (isNew && this.stream) {
        this.ensurePeer(id);
        const entry = this.pcs.get(id);
        if (entry?.isCaller) window.setTimeout(() => void this.negotiate(id), 350);
      }
    }
  }

  /** Mute the local microphone without tearing down peer connections. */
  setMuted(muted: boolean): void {
    this.micMuted = muted;
    this.stream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }

  private ensurePeer(id: string): PeerEntry | null {
    const existing = this.pcs.get(id);
    if (existing) return existing;
    if (!this.stream || typeof RTCPeerConnection === 'undefined') return null;

    const isCaller = this.opts.selfId < id;
    const pc = new RTCPeerConnection({
      iceServers: this.opts.iceServers ?? [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    const track = this.stream.getAudioTracks()[0];
    if (track) pc.addTrack(track, this.stream);

    const container = this.opts.audioContainer ?? document.body;
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.style.display = 'none';
    container.appendChild(audio);

    const entry: PeerEntry = {
      pc,
      audio,
      analyser: null,
      audioCtx: null,
      isCaller,
      makingOffer: false,
      negotiated: false,
      failedRetries: 0,
    };
    this.pcs.set(id, entry);

    pc.onnegotiationneeded = () => {
      if (entry.isCaller && !entry.makingOffer && !entry.negotiated) void this.negotiate(id);
    };
    pc.ontrack = (e) => {
      const [remote] = e.streams;
      if (remote) {
        entry.audio.srcObject = remote;
        void entry.audio.play().catch(() => {});
        this.setupPeerMeter(id, remote);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && entry.isCaller && entry.failedRetries < 2) {
        entry.failedRetries++;
        window.setTimeout(() => void this.negotiate(id), 1200);
      }
    };
    return entry;
  }

  private async negotiate(id: string): Promise<void> {
    const entry = this.pcs.get(id);
    if (!entry || !entry.isCaller || entry.makingOffer || this.disposed) return;
    const { pc } = entry;
    if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-local-offer') return;
    entry.makingOffer = true;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceGathering(pc);
      const sdp = pc.localDescription?.sdp ?? offer.sdp;
      if (sdp) {
        entry.negotiated = true;
        this.opts.sendSignal(id, { t: 'voice-offer', sdp });
      }
    } catch {
      // negotiation failed — peer will retry on next roster change
    } finally {
      entry.makingOffer = false;
    }
  }

  private async answer(id: string, sdp: string): Promise<void> {
    const entry = this.pcs.get(id);
    if (!entry || entry.makingOffer || this.disposed) return;
    const { pc } = entry;
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitIceGathering(pc);
      const localSdp = pc.localDescription?.sdp ?? answer.sdp;
      if (localSdp) this.opts.sendSignal(id, { t: 'voice-answer', sdp: localSdp });
    } catch {
      // stale/invalid offer — ignore
    }
  }

  /** Public entry point for hosts that relay signals themselves. */
  receiveSignal(fromId: string, payload: unknown): void {
    this.handleSignal(fromId, payload);
  }

  private handleSignal(fromId: string, raw: unknown): void {
    const sig = raw as VoiceSignalPayload | null;
    if (!sig || typeof sig !== 'object' || this.disposed) return;
    if (sig.t === 'voice-leave') {
      this.closePeer(fromId);
      this.desiredPeers.delete(fromId);
      return;
    }
    // Ensure a peer entry exists even if the roster hasn't refreshed yet.
    if (!this.pcs.has(fromId)) this.ensurePeer(fromId);
    const entry = this.pcs.get(fromId);
    if (!entry) return;
    if (sig.t === 'voice-offer' && typeof sig.sdp === 'string') {
      // Caller role owns offers; if we are the caller and still making ours,
      // ignore the collision (the remote will answer ours instead).
      if (entry.isCaller && entry.makingOffer) return;
      void this.answer(fromId, sig.sdp);
    } else if (sig.t === 'voice-answer' && typeof sig.sdp === 'string') {
      const { pc } = entry;
      if (pc.signalingState === 'have-local-offer') {
        void pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp }).catch(() => {});
      }
    }
  }

  private closePeer(id: string): void {
    const entry = this.pcs.get(id);
    if (!entry) return;
    this.pcs.delete(id);
    try {
      entry.pc.ontrack = null;
      entry.pc.onnegotiationneeded = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.close();
    } catch {
      // ignore
    }
    try {
      entry.audio.pause();
      entry.audio.srcObject = null;
      entry.audio.remove();
    } catch {
      // ignore
    }
    // entry.audioCtx is the shared meter context — do NOT close it here.
    entry.analyser = null;
    entry.audioCtx = null;
    this.onPeerLevel?.(id, 0);
  }

  // ---------------- Level metering (speaking indicators) ----------------

  private setupLocalMeter(): void {
    try {
      this.localCtx = new AudioContext();
      const src = this.localCtx.createMediaStreamSource(this.stream!);
      this.localAnalyser = this.localCtx.createAnalyser();
      this.localAnalyser.fftSize = 512;
      src.connect(this.localAnalyser);
      const buf = new Uint8Array(this.localAnalyser.frequencyBinCount);
      this.levelTimer = window.setInterval(() => {
        if (!this.localAnalyser) return;
        this.localAnalyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        this.onLocalLevel?.(Math.min(1, rms * 3.2));
        for (const [id, entry] of this.pcs) {
          if (!entry.analyser) continue;
          entry.analyser.getByteTimeDomainData(buf);
          let s = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            s += v * v;
          }
          const peerRms = Math.sqrt(s / buf.length);
          this.onPeerLevel?.(id, Math.min(1, peerRms * 3.2));
        }
      }, LEVEL_TICK_MS);
    } catch {
      this.localCtx = null;
      this.localAnalyser = null;
    }
  }

  private setupPeerMeter(id: string, stream: MediaStream): void {
    const entry = this.pcs.get(id);
    if (!entry || !this.localCtx || entry.analyser) return;
    try {
      const ctx = this.localCtx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      entry.analyser = analyser;
      entry.audioCtx = ctx;
    } catch {
      // metering is best-effort
    }
  }

  private teardownLocalMeter(): void {
    if (this.levelTimer !== null) window.clearInterval(this.levelTimer);
    this.levelTimer = null;
    this.localAnalyser = null;
    try {
      void this.localCtx?.close();
    } catch {
      // ignore
    }
    this.localCtx = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disable();
    for (const id of [...this.pcs.keys()]) this.closePeer(id);
    this.desiredPeers.clear();
  }
}
