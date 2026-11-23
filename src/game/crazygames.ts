/**
 * CrazyGames HTML5 SDK v3 wrapper.
 *
 * Every export is a safe no-op when the game is not running inside the
 * CrazyGames portal (local dev, itch.io, etc.) — `window.CrazyGames.SDK`
 * is simply undefined and nothing throws.
 */

interface CrazyGamesSettings {
  muteAudio: boolean;
  [key: string]: unknown;
}

interface CrazyGamesGameApi {
  loadingStart(): void;
  loadingStop(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  settings: CrazyGamesSettings;
  settingsChange?: { addListener(cb: (s: CrazyGamesSettings) => void): void };
}

interface CrazyGamesDataApi {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;
  removeItem?(key: string): Promise<void>;
}

interface CrazyGamesSDK {
  init(): Promise<void>;
  game: CrazyGamesGameApi;
  data?: CrazyGamesDataApi;
  addSettingsChangeListener?(cb: (s: CrazyGamesSettings) => void): void;
}

declare global {
  interface Window {
    CrazyGames?: { SDK?: CrazyGamesSDK };
  }
}

function getSdk(): CrazyGamesSDK | null {
  if (typeof window === 'undefined') return null;
  return window.CrazyGames?.SDK ?? null;
}

let initialized = false;
let gameplayActive = false;

export interface CrazyGamesInitOptions {
  /** Called when the portal toggles audio mute (muteAudio=true means muted). */
  onAudioMuteChange?: (muted: boolean) => void;
}

/** Initialize the SDK once and wire up audio-mute + settings listeners. */
export async function initCrazyGames(options: CrazyGamesInitOptions = {}): Promise<void> {
  const sdk = getSdk();
  if (!sdk || initialized) return;
  initialized = true;

  try {
    await sdk.init();
  } catch {
    // Portal init failed — continue running as a normal web game.
  }

  // Reflect the portal's current mute state immediately, then follow changes.
  const applyMute = (settings?: CrazyGamesSettings) => {
    const muted = settings?.muteAudio ?? sdk.game.settings?.muteAudio;
    if (typeof muted === 'boolean') {
      options.onAudioMuteChange?.(muted);
    }
  };
  applyMute();

  try {
    sdk.game.settingsChange?.addListener(applyMute);
  } catch {
    // settingsChange unavailable on this SDK version — ignore.
  }
  try {
    sdk.addSettingsChangeListener?.(applyMute);
  } catch {
    // ignore
  }
}

/** Call once the game has finished initializing its assets. */
export function cgLoadingStart(): void {
  try {
    getSdk()?.game.loadingStart();
  } catch {
    // ignore
  }
}

export function cgLoadingStop(): void {
  try {
    getSdk()?.game.loadingStop();
  } catch {
    // ignore
  }
}

/** Call when actual gameplay begins (deploy) and ends (pause / game over). */
export function cgGameplayStart(): void {
  if (gameplayActive) return;
  gameplayActive = true;
  try {
    getSdk()?.game.gameplayStart();
  } catch {
    // ignore
  }
}

export function cgGameplayStop(): void {
  if (!gameplayActive) return;
  gameplayActive = false;
  try {
    getSdk()?.game.gameplayStop();
  } catch {
    // ignore
  }
}

/** Push the current mute state to the portal (best-effort). */
export function cgSyncMuted(muted: boolean): void {
  try {
    const sdk = getSdk();
    if (sdk?.game?.settings) {
      sdk.game.settings.muteAudio = muted;
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// SDK.data with automatic localStorage fallback
// ---------------------------------------------------------------------------

/**
 * Read a value previously stored via cgSetItem / SDK.data.
 * Falls back to localStorage when the SDK or its data API is unavailable.
 */
export async function cgGetItem<T = unknown>(key: string): Promise<T | null> {
  const sdk = getSdk();
  if (sdk?.data) {
    try {
      const value = await sdk.data.getItem(key);
      if (value != null) return value as T;
    } catch {
      // fall through to localStorage
    }
  }
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

/**
 * Persist a value through CrazyGames SDK.data when available, and always
 * mirror it to localStorage so local/non-portal sessions keep working.
 */
export function cgSetItem(key: string, value: unknown): void {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  try {
    localStorage.setItem(key, raw);
  } catch {
    // storage unavailable — ignore
  }
  const sdk = getSdk();
  if (!sdk?.data) return;
  void sdk.data.setItem(key, raw).catch(() => {});
}

const PERSISTED_KEYS = ['strikegrid:profile', 'strikegrid:friends'];

/**
 * Backfill localStorage from SDK.data on portal load so returning players
 * keep progress/unlocks even if site storage was cleared.
 */
export async function syncCrazyGamesData(): Promise<void> {
  const sdk = getSdk();
  if (!sdk?.data) return;
  for (const key of PERSISTED_KEYS) {
    try {
      if (localStorage.getItem(key) != null) continue;
      const remote = await sdk.data.getItem(key);
      if (remote == null) continue;
      localStorage.setItem(key, typeof remote === 'string' ? remote : JSON.stringify(remote));
    } catch {
      // ignore
    }
  }
}
