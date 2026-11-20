export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type GraphicsQuality = 'high' | 'medium';

export type WeaponId = 'rifle' | 'pistol' | 'shotgun' | 'marksman' | 'knife';

export type MapId = 'dusk_yard' | 'arctic_outpost' | 'desert_compound';

export type ZoneId = 'landing' | 'building' | 'forest' | 'restriction' | 'central';

export interface ZoneSpec {
  id: ZoneId;
  name: string;
  code: string;
  accentColor: string;
}

export type WeaponSkinId = 'standard' | 'desert_tan' | 'arctic_camo' | 'carbon_gold';

export type EnemyArchetype = 'trooper' | 'striker' | 'juggernaut';

export type EnemyRole = 'rusher' | 'rifleman' | 'marksman';

export type EnemyAIState = 'patrol' | 'alert' | 'attack' | 'ko';

export interface GameSettings {
  sensitivity: number; // 0.3 to 2.5
  quality: GraphicsQuality;
  muted: boolean;
  mapId: MapId;
  weaponSkin: WeaponSkinId;
}

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  shortLabel: string;
  keyBind: '1' | '2' | '3' | '4' | '5';
  automatic: boolean;
  fireRate: number; // rounds or swings per second
  damage: number;
  headshotMultiplier: number;
  magSize: number;
  startReserve: number;
  maxReserve: number;
  reloadTime: number; // seconds
  baseSpread: number; // radians
  adsSpread: number;
  moveSpreadPenalty: number;
  adsFov: number;
  recoilPitch: number;
  recoilYaw: number;
  kickBack: number;
  range: number;
  pellets?: number;
  isMelee?: boolean;
  meleeReach?: number;
  pumpDuration?: number;
}

export interface KillFeedEntry {
  id: number;
  text: string;
  headshot: boolean;
  archetype: EnemyArchetype;
  timestamp: number;
}

export interface HudDamageIndicator {
  id: number;
  angleRad: number; // 0 = ahead, +PI/2 = right, PI = behind, -PI/2 = left
  intensity: number; // 0..1
}

export interface HudRadarBlip {
  id: number;
  dx: number; // relative to player rotated into view space (-1..1 normalized to radar range)
  dz: number;
  role: EnemyRole;
  firing: boolean;
}

export interface RunStats {
  wave: number;
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
}

export interface HudSnapshot {
  phase: GamePhase;
  mapId: MapId;
  currentZone: ZoneId;
  weaponSkin: WeaponSkinId;
  health: number;
  maxHealth: number;
  wave: number;
  enemiesRemaining: number;
  waveBannerTimer: number;
  waveClearBannerTimer: number;
  activeWeapon: WeaponId;
  ammoInMag: number;
  magSize: number;
  ammoReserve: number;
  isMeleeActive: boolean;
  grenades: number;
  maxGrenades: number;
  grenadeThrowing: boolean;
  isReloading: boolean;
  reloadProgress: number;
  isAds: boolean;
  isSprinting: boolean;
  isCrouching: boolean;
  isSliding: boolean;
  crosshairSpread: number; // pixels
  hitmarkerTimer: number;
  hitmarkerCrit: boolean;
  hitmarkerKill: boolean;
  damageFlash: number; // 0..1
  damageIndicators: HudDamageIndicator[];
  radarBlips: HudRadarBlip[];
  playerYaw: number;
  pointerLocked: boolean;
  killFeed: KillFeedEntry[];
  stats: RunStats;
}

export interface AABB2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
  minY?: number;
}

export interface RampCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  axis: 'x' | 'z';
  lowY: number;
  highY: number;
  /** +1 means height increases from min->max along axis; -1 means max->min */
  dir: 1 | -1;
}

export interface WaveConfig {
  wave: number;
  enemyCount: number;
  speedMultiplier: number;
  accuracy: number;
  trooperWeight: number;
  strikerWeight: number;
  juggernautWeight: number;
}
