import type {
  AABB2D,
  DifficultyTierId,
  EnemyArchetype,
  EnemyAIState,
  EnemyRole,
  MapId,
  MatchModeId,
  RampCollider,
  WeaponId,
  WeaponSkinId,
  WeaponSpec,
  WaveConfig,
  ZoneId,
  ZoneSpec,
} from './types';

export interface MapSpec {
  id: MapId;
  name: string;
  subtitle: string;
  badgeColor: string;
  playerSpawn: { x: number; y: number; z: number; yaw: number };
}

export const MAP_SPECS: Record<MapId, MapSpec> = {
  dusk_yard: {
    id: 'dusk_yard',
    name: 'Sector 09',
    subtitle: 'Dusk Yard',
    badgeColor: '#f59e0b',
    playerSpawn: { x: 0, y: 0, z: 34.5, yaw: 0 },
  },
  arctic_outpost: {
    id: 'arctic_outpost',
    name: 'Arctic Outpost',
    subtitle: 'Blizzard',
    badgeColor: '#38bdf8',
    playerSpawn: { x: 0, y: 0, z: 34.5, yaw: 0 },
  },
  desert_compound: {
    id: 'desert_compound',
    name: 'Desert Compound',
    subtitle: 'High Noon',
    badgeColor: '#fbbf24',
    playerSpawn: { x: 0, y: 0, z: 34.5, yaw: 0 },
  },
  neon_docks: {
    id: 'neon_docks',
    name: 'Neon Docks',
    subtitle: 'Night Harbor',
    badgeColor: '#22d3ee',
    playerSpawn: { x: 0, y: 0, z: 34.5, yaw: 0 },
  },
  highland_ridge: {
    id: 'highland_ridge',
    name: 'Highland Ridge',
    subtitle: 'Golden Hour',
    badgeColor: '#a3e635',
    playerSpawn: { x: 0, y: 0, z: 34.5, yaw: 0 },
  },
  sunken_foundry: {
    id: 'sunken_foundry',
    name: 'Sunken Foundry',
    subtitle: 'Molten Works',
    badgeColor: '#fb923c',
    playerSpawn: { x: 0, y: 0, z: 34.5, yaw: 0 },
  },
};

export interface MapLightingProfile {
  exposure: number;
  envIntensity: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  tourRadius: number;
  tourHeight: number;
  tourTarget: [number, number, number];
  tourStartAngle: number;
}

export const MAP_LIGHTING_PROFILES: Record<MapId, MapLightingProfile> = {
  dusk_yard: {
    exposure: 0.94,
    envIntensity: 0.4,
    bloomStrength: 0.22,
    bloomRadius: 0.3,
    bloomThreshold: 0.96,
    tourRadius: 27,
    tourHeight: 8.6,
    tourTarget: [0, 2.2, -4],
    tourStartAngle: 0.45,
  },
  arctic_outpost: {
    exposure: 0.84,
    envIntensity: 0.34,
    bloomStrength: 0.18,
    bloomRadius: 0.28,
    bloomThreshold: 0.98,
    tourRadius: 29,
    tourHeight: 9.2,
    tourTarget: [0, 2.4, -4],
    tourStartAngle: 1.15,
  },
  desert_compound: {
    exposure: 0.82,
    envIntensity: 0.36,
    bloomStrength: 0.18,
    bloomRadius: 0.28,
    bloomThreshold: 0.98,
    tourRadius: 28,
    tourHeight: 8.8,
    tourTarget: [0, 2.4, -4],
    tourStartAngle: -0.68,
  },
  neon_docks: {
    exposure: 0.88,
    envIntensity: 0.3,
    bloomStrength: 0.3,
    bloomRadius: 0.34,
    bloomThreshold: 0.9,
    tourRadius: 30,
    tourHeight: 10.5,
    tourTarget: [0, 2.6, -6],
    tourStartAngle: 2.2,
  },
  highland_ridge: {
    exposure: 0.9,
    envIntensity: 0.42,
    bloomStrength: 0.2,
    bloomRadius: 0.3,
    bloomThreshold: 0.96,
    tourRadius: 32,
    tourHeight: 11.5,
    tourTarget: [0, 3.2, -4],
    tourStartAngle: 0.9,
  },
  sunken_foundry: {
    exposure: 0.86,
    envIntensity: 0.32,
    bloomStrength: 0.28,
    bloomRadius: 0.32,
    bloomThreshold: 0.92,
    tourRadius: 27,
    tourHeight: 9.5,
    tourTarget: [0, 2.4, -6],
    tourStartAngle: -1.9,
  },
};

export const ZONE_SPECS: Record<ZoneId, ZoneSpec> = {
  landing: {
    id: 'landing',
    name: 'LANDING AREA',
    code: 'LZ-01',
    accentColor: '#38bdf8',
  },
  building: {
    id: 'building',
    name: 'BUILDING ZONE',
    code: 'OPS-BLDG',
    accentColor: '#f59e0b',
  },
  forest: {
    id: 'forest',
    name: 'FOREST AREA',
    code: 'BIO-WOODS',
    accentColor: '#34d399',
  },
  restriction: {
    id: 'restriction',
    name: 'RESTRICTION AREA',
    code: 'SEC-MAX',
    accentColor: '#ef4444',
  },
  central: {
    id: 'central',
    name: 'CENTRAL YARD',
    code: 'COMBAT-CTR',
    accentColor: '#cbd5e1',
  },
};

export function getZoneAt(x: number, z: number, _mapId?: MapId): ZoneId {
  if (z <= -22) return 'restriction';
  if (z >= 21) return 'landing';
  if (x <= -17) return 'building';
  if (x >= 17) return 'forest';
  return 'central';
}

export interface MatchModeSpec {
  id: MatchModeId;
  name: string;
  short: string;
  description: string;
  /** true when remote players are split into opposing squads */
  teamBased: boolean;
  /** enemy wave pressure multiplier applied on top of level config */
  pressureMult: number;
}

export const MATCH_MODE_SPECS: Record<MatchModeId, MatchModeSpec> = {
  survival: {
    id: 'survival',
    name: 'Co-op Squad Survival',
    short: 'SQUAD',
    description: 'Team up against escalating waves & radiation zones.',
    teamBased: false,
    pressureMult: 1,
  },
  tdm: {
    id: 'tdm',
    name: 'Team Deathmatch',
    short: 'TDM',
    description: 'Squad vs squad — hostile fire teams contest the arena.',
    teamBased: true,
    pressureMult: 1.15,
  },
  ffa: {
    id: 'ffa',
    name: 'Free-For-All',
    short: 'FFA',
    description: 'Every operator for themselves. Last one standing wins.',
    teamBased: true,
    pressureMult: 1.1,
  },
  zone_control: {
    id: 'zone_control',
    name: 'Zone Control',
    short: 'ZONE',
    description: 'Capture and hold LZ-01, OPS-BLDG, BIO-WOODS and SEC-MAX.',
    teamBased: true,
    pressureMult: 1.05,
  },
};

export const DIFFICULTY_TIERS: ReadonlyArray<{
  id: DifficultyTierId;
  name: string;
  level: number;
  hint: string;
}> = [
  { id: 'easy', name: 'EASY', level: 2, hint: 'LV 2 · Medium pressure' },
  { id: 'medium', name: 'MEDIUM', level: 4, hint: 'LV 4 · Hard pressure' },
  { id: 'hard', name: 'HARD', level: 6, hint: 'LV 6 · Extreme pressure' },
];

export interface WeaponSkinSpec {
  id: WeaponSkinId;
  name: string;
  swatchPrimary: string;
  swatchAccent: string;
}

export const WEAPON_SKIN_SPECS: Record<WeaponSkinId, WeaponSkinSpec> = {
  standard: {
    id: 'standard',
    name: 'Standard Issue',
    swatchPrimary: '#2a2f37',
    swatchAccent: '#6b5640',
  },
  desert_tan: {
    id: 'desert_tan',
    name: 'Desert Tan / FDE',
    swatchPrimary: '#a68b67',
    swatchAccent: '#8e959e',
  },
  arctic_camo: {
    id: 'arctic_camo',
    name: 'Arctic Camo',
    swatchPrimary: '#dce2ea',
    swatchAccent: '#64748b',
  },
  carbon_gold: {
    id: 'carbon_gold',
    name: 'Carbon & Gold',
    swatchPrimary: '#1c1f24',
    swatchAccent: '#d4a024',
  },
};

export const WEAPON_ORDER: readonly WeaponId[] = [
  'rifle',
  'pistol',
  'shotgun',
  'marksman',
  'knife',
  'smg',
  'lmg',
  'deagle',
];

export const WEAPON_SPECS: Record<WeaponId, WeaponSpec> = {
  rifle: {
    id: 'rifle',
    name: 'MK-18 CARBINE',
    shortLabel: 'AUTO · 5.56',
    keyBind: '1',
    automatic: true,
    fireRate: 10.2,
    damage: 28,
    headshotMultiplier: 2.4,
    magSize: 30,
    startReserve: 120,
    maxReserve: 180,
    reloadTime: 1.55,
    baseSpread: 0.016,
    adsSpread: 0.0035,
    moveSpreadPenalty: 0.022,
    adsFov: 52,
    recoilPitch: 0.021,
    recoilYaw: 0.009,
    kickBack: 0.068,
    range: 140,
  },
  pistol: {
    id: 'pistol',
    name: 'P226 TACTICAL',
    shortLabel: 'SEMI · 9MM',
    keyBind: '2',
    automatic: false,
    fireRate: 5.8,
    damage: 36,
    headshotMultiplier: 2.5,
    magSize: 15,
    startReserve: 75,
    maxReserve: 120,
    reloadTime: 1.15,
    baseSpread: 0.01,
    adsSpread: 0.002,
    moveSpreadPenalty: 0.012,
    adsFov: 58,
    recoilPitch: 0.03,
    recoilYaw: 0.007,
    kickBack: 0.055,
    range: 100,
  },
  shotgun: {
    id: 'shotgun',
    name: 'M870 BREACHER',
    shortLabel: 'PUMP · 12G',
    keyBind: '3',
    automatic: false,
    fireRate: 1.32,
    damage: 18, // per pellet (8 pellets = 144 max close-range damage)
    headshotMultiplier: 1.75,
    magSize: 8,
    startReserve: 32,
    maxReserve: 48,
    reloadTime: 1.85,
    baseSpread: 0.064,
    adsSpread: 0.042,
    moveSpreadPenalty: 0.018,
    adsFov: 60,
    recoilPitch: 0.062,
    recoilYaw: 0.018,
    kickBack: 0.11,
    range: 46,
    pellets: 8,
    pumpDuration: 0.44,
  },
  marksman: {
    id: 'marksman',
    name: 'MK-14 MARKSMAN',
    shortLabel: 'SEMI · 7.62',
    keyBind: '4',
    automatic: false,
    fireRate: 3.1,
    damage: 58,
    headshotMultiplier: 2.6,
    magSize: 12,
    startReserve: 48,
    maxReserve: 84,
    reloadTime: 1.75,
    baseSpread: 0.009,
    adsSpread: 0.0008,
    moveSpreadPenalty: 0.025,
    adsFov: 40,
    recoilPitch: 0.044,
    recoilYaw: 0.01,
    kickBack: 0.085,
    range: 180,
  },
  smg: {
    id: 'smg',
    name: 'KR-9 VECTOR SMG',
    shortLabel: 'AUTO · 9MM',
    keyBind: '6',
    automatic: true,
    fireRate: 13.2,
    damage: 22,
    headshotMultiplier: 2.1,
    magSize: 30,
    startReserve: 150,
    maxReserve: 210,
    reloadTime: 1.9,
    baseSpread: 0.021,
    adsSpread: 0.005,
    moveSpreadPenalty: 0.014,
    adsFov: 56,
    recoilPitch: 0.014,
    recoilYaw: 0.011,
    kickBack: 0.045,
    range: 95,
  },
  lmg: {
    id: 'lmg',
    name: 'M249 SAW LMG',
    shortLabel: 'BELT · 5.56',
    keyBind: '7',
    automatic: true,
    fireRate: 7.4,
    damage: 30,
    headshotMultiplier: 2.0,
    magSize: 100,
    startReserve: 200,
    maxReserve: 300,
    reloadTime: 4.4,
    baseSpread: 0.032,
    adsSpread: 0.009,
    moveSpreadPenalty: 0.03,
    adsFov: 50,
    recoilPitch: 0.034,
    recoilYaw: 0.016,
    kickBack: 0.095,
    range: 160,
  },
  deagle: {
    id: 'deagle',
    name: 'DEAGLE .50 TAC',
    shortLabel: 'SEMI · .50',
    keyBind: '8',
    automatic: false,
    fireRate: 3.6,
    damage: 92,
    headshotMultiplier: 2.2,
    magSize: 7,
    startReserve: 35,
    maxReserve: 49,
    reloadTime: 1.95,
    baseSpread: 0.013,
    adsSpread: 0.0028,
    moveSpreadPenalty: 0.016,
    adsFov: 55,
    recoilPitch: 0.078,
    recoilYaw: 0.022,
    kickBack: 0.125,
    range: 130,
  },
  knife: {
    id: 'knife',
    name: 'COMBAT KNIFE',
    shortLabel: 'MELEE · BLADE',
    keyBind: '5',
    automatic: false,
    fireRate: 2.35,
    damage: 65,
    headshotMultiplier: 1.85,
    magSize: 1,
    startReserve: 0,
    maxReserve: 0,
    reloadTime: 0.5,
    baseSpread: 0,
    adsSpread: 0,
    moveSpreadPenalty: 0,
    adsFov: 74,
    recoilPitch: 0,
    recoilYaw: 0,
    kickBack: 0,
    range: 2.85,
    isMelee: true,
    meleeReach: 2.85,
  },
};

export const FRAG_GRENADE_SPEC = {
  startCount: 3,
  maxCount: 4,
  fuseTime: 2.05,
  throwSpeed: 18.8,
  upwardBoost: 4.8,
  gravity: 21.0,
  radius: 9.5,
  maxDamage: 185,
  restitution: 0.44,
};

export function getNextWeaponId(current: WeaponId, delta: number): WeaponId {
  const idx = WEAPON_ORDER.indexOf(current);
  const step = delta >= 0 ? 1 : -1;
  const next = (Math.max(0, idx) + step + WEAPON_ORDER.length) % WEAPON_ORDER.length;
  return WEAPON_ORDER[next];
}

export interface ArchetypeSpec {
  archetype: EnemyArchetype;
  label: string;
  maxHp: number;
  speed: number;
  burstCount: number;
  burstInterval: number;
  telegraphTime: number;
  attackCooldown: number;
  damagePerShot: number;
  preferredRange: number;
  colorHex: number;
  accentHex: number;
  scale: number;
}

export const ENEMY_SPECS: Record<EnemyArchetype, ArchetypeSpec> = {
  trooper: {
    archetype: 'trooper',
    label: 'ENFORCER',
    maxHp: 90,
    speed: 4.1,
    burstCount: 3,
    burstInterval: 0.14,
    telegraphTime: 0.45,
    attackCooldown: 1.7,
    damagePerShot: 9,
    preferredRange: 18,
    colorHex: 0x3b444f,
    accentHex: 0xf59e0b,
    scale: 1.0,
  },
  striker: {
    archetype: 'striker',
    label: 'STRIKER',
    maxHp: 65,
    speed: 6.1,
    burstCount: 2,
    burstInterval: 0.11,
    telegraphTime: 0.35,
    attackCooldown: 1.35,
    damagePerShot: 8,
    preferredRange: 10,
    colorHex: 0x2c303a,
    accentHex: 0xef4444,
    scale: 0.94,
  },
  juggernaut: {
    archetype: 'juggernaut',
    label: 'HEAVY UNIT',
    maxHp: 190,
    speed: 2.75,
    burstCount: 5,
    burstInterval: 0.13,
    telegraphTime: 0.65,
    attackCooldown: 2.2,
    damagePerShot: 11,
    preferredRange: 22,
    colorHex: 0x292d33,
    accentHex: 0xf97316,
    scale: 1.16,
  },
};

/**
 * Evaluates exact surface Y height on a sloped ramp at (x, z), or null if outside ramp footprint.
 */
export function getRampHeightAt(x: number, z: number, ramp: RampCollider): number | null {
  if (x < ramp.minX || x > ramp.maxX || z < ramp.minZ || z > ramp.maxZ) {
    return null;
  }
  const span =
    ramp.axis === 'x'
      ? Math.max(1e-4, ramp.maxX - ramp.minX)
      : Math.max(1e-4, ramp.maxZ - ramp.minZ);
  const rawT =
    ramp.axis === 'x'
      ? (x - ramp.minX) / span
      : (z - ramp.minZ) / span;
  const clamped = Math.max(0, Math.min(1, rawT));
  const t = ramp.dir === 1 ? clamped : 1 - clamped;
  return ramp.lowY + t * (ramp.highY - ramp.lowY);
}

/**
 * Computes highest walkable floor height under an actor's footprint across terrain, ramps, and box tops.
 */
export function getSurfaceFloorHeight(
  x: number,
  z: number,
  currentY: number,
  actorRadius: number,
  obstacles: readonly AABB2D[],
  ramps: readonly RampCollider[],
): number {
  let floorY = 0;

  // Check sloped ramps using slight footprint sampling so climbing onto ramp edges feels seamless
  for (let i = 0; i < ramps.length; i++) {
    const r = ramps[i];
    if (
      x + actorRadius * 0.45 >= r.minX &&
      x - actorRadius * 0.45 <= r.maxX &&
      z + actorRadius * 0.45 >= r.minZ &&
      z - actorRadius * 0.45 <= r.maxZ
    ) {
      const cx = Math.max(r.minX, Math.min(r.maxX, x));
      const cz = Math.max(r.minZ, Math.min(r.maxZ, z));
      const h = getRampHeightAt(cx, cz, r);
      if (h !== null && currentY >= h - 0.62) {
        floorY = Math.max(floorY, h);
      }
    }
  }

  // Check walkable box tops / catwalks / perches
  for (let i = 0; i < obstacles.length; i++) {
    const b = obstacles[i];
    if (
      x + actorRadius * 0.65 > b.minX &&
      x - actorRadius * 0.65 < b.maxX &&
      z + actorRadius * 0.65 > b.minZ &&
      z - actorRadius * 0.65 < b.maxZ
    ) {
      if (currentY >= b.maxY - 0.56 && b.maxY <= 4.2) {
        floorY = Math.max(floorY, b.maxY);
      }
    }
  }

  return floorY;
}

/**
 * Pure circle-vs-AABB 2D sliding collision resolution on XZ plane.
 * Only blocks against obstacles whose vertical span overlaps the actor.
 */
export function resolveCircleAABBs(
  pos: { x: number; y: number; z: number },
  radius: number,
  actorHeight: number,
  obstacles: readonly AABB2D[],
  arenaHalfExtent = 45.6,
): { x: number; z: number; collided: boolean } {
  let x = Math.max(-arenaHalfExtent + radius, Math.min(arenaHalfExtent - radius, pos.x));
  let z = Math.max(-arenaHalfExtent + radius, Math.min(arenaHalfExtent - radius, pos.z));
  let collided = x !== pos.x || z !== pos.z;

  // Two passes resolve corner wedges cleanly without snagging.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < obstacles.length; i++) {
      const box = obstacles[i];
      const boxMinY = box.minY ?? 0;
      if (pos.y + actorHeight <= boxMinY + 0.05 || pos.y >= box.maxY - 0.12) {
        continue;
      }

      const closestX = Math.max(box.minX, Math.min(x, box.maxX));
      const closestZ = Math.max(box.minZ, Math.min(z, box.maxZ));

      const dx = x - closestX;
      const dz = z - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq < radius * radius) {
        collided = true;
        if (distSq > 1e-8) {
          const dist = Math.sqrt(distSq);
          const overlap = radius - dist;
          x += (dx / dist) * overlap;
          z += (dz / dist) * overlap;
        } else {
          // Center is inside AABB: push out along shallowest axis
          const penLeft = Math.abs(x - box.minX);
          const penRight = Math.abs(box.maxX - x);
          const penTop = Math.abs(z - box.minZ);
          const penBot = Math.abs(box.maxZ - z);
          const minPen = Math.min(penLeft, penRight, penTop, penBot);
          if (minPen === penLeft) x = box.minX - radius;
          else if (minPen === penRight) x = box.maxX + radius;
          else if (minPen === penTop) z = box.minZ - radius;
          else z = box.maxZ + radius;
        }
      }
    }
  }

  return { x, z, collided };
}

/**
 * Checks whether a 2D circle at floor level is clear of solid obstacles (for safe spawns).
 */
export function isPointClearOfObstacles(
  x: number,
  z: number,
  radius: number,
  obstacles: readonly AABB2D[],
): boolean {
  for (let i = 0; i < obstacles.length; i++) {
    const b = obstacles[i];
    if ((b.minY ?? 0) > 1.7 || b.maxY < 0.2) continue;
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz < radius * radius) {
      return false;
    }
  }
  return true;
}

/**
 * Computes effective spread angle (radians) based on weapon, ADS, movement speed, and crouch.
 */
export function computeWeaponSpread(
  spec: WeaponSpec,
  opts: { isAds: boolean; moveSpeedRatio: number; isCrouching: boolean; isAirborne: boolean },
): number {
  if (spec.isMelee) return 0;
  const base = opts.isAds ? spec.adsSpread : spec.baseSpread;
  const moveFactor = Math.min(1.4, Math.max(0, opts.moveSpeedRatio));
  const movePenalty = spec.moveSpreadPenalty * moveFactor * (opts.isAds ? 0.35 : 1.0);
  const crouchMult = opts.isCrouching ? 0.72 : 1.0;
  const airPenalty = opts.isAirborne ? 0.032 : 0;
  return (base + movePenalty) * crouchMult + airPenalty;
}

/**
 * Computes weapon hit damage for a given hitbox zone.
 */
export function computeHitDamage(
  spec: WeaponSpec,
  zone: 'head' | 'torso' | 'limb',
): { damage: number; isCrit: boolean } {
  if (zone === 'head') {
    return { damage: Math.round(spec.damage * spec.headshotMultiplier), isCrit: true };
  }
  if (zone === 'limb') {
    return { damage: Math.round(spec.damage * 0.78), isCrit: false };
  }
  return { damage: spec.damage, isCrit: false };
}

/**
 * Computes wave difficulty scaling across enemy count, speed, accuracy, and archetype mix.
 */
export function getWaveConfig(wave: number, level = 1): WaveConfig {
  const w = Math.max(1, Math.floor(wave));
  const lv = getLevelConfig(level);
  const enemyCount = Math.min(30, Math.round((4 + (w - 1) * 2) * lv.enemyCountMult));
  const speedMultiplier = Math.min(1.6, (1 + (w - 1) * 0.06) * lv.speedMult);
  const accuracy = Math.min(0.92, 0.36 + (w - 1) * 0.055 + lv.accuracyBonus);
  const strikerWeight = w >= 2 ? Math.min(0.45, 0.2 + (w - 2) * 0.05 + lv.strikerBonus) : 0.15;
  const juggernautWeight = w >= 3 ? Math.min(0.34, 0.12 + (w - 3) * 0.04 + lv.juggernautBonus) : 0;
  const trooperWeight = Math.max(0.25, 1 - strikerWeight - juggernautWeight);

  return {
    wave: w,
    enemyCount,
    speedMultiplier,
    accuracy,
    trooperWeight,
    strikerWeight,
    juggernautWeight,
  };
}

/**
 * Picks an enemy archetype deterministically from a [0, 1) roll using wave weights.
 */
export function pickArchetypeForWave(wave: number, roll: number): EnemyArchetype {
  const cfg = getWaveConfig(wave);
  const r = Math.max(0, Math.min(0.9999, roll));
  if (r < cfg.juggernautWeight) return 'juggernaut';
  if (r < cfg.juggernautWeight + cfg.strikerWeight) return 'striker';
  return 'trooper';
}

/**
 * Computes next AI state transition for an enemy given line-of-sight, distance, and attack token availability.
 */
export function evaluateEnemyTransition(input: {
  currentState: EnemyAIState;
  hasLineOfSight: boolean;
  distanceToPlayer: number;
  preferredRange: number;
  attackCooldownRemaining: number;
  hasAttackToken: boolean;
  canAcquireToken: boolean;
  alertMemoryTimer: number;
}): { nextState: EnemyAIState; shouldAcquireToken: boolean; shouldReleaseToken: boolean } {
  if (input.currentState === 'ko') {
    return { nextState: 'ko', shouldAcquireToken: false, shouldReleaseToken: input.hasAttackToken };
  }

  if (input.currentState === 'attack') {
    if (!input.hasLineOfSight && input.distanceToPlayer > input.preferredRange * 1.6) {
      return { nextState: 'alert', shouldAcquireToken: false, shouldReleaseToken: input.hasAttackToken };
    }
    return { nextState: 'attack', shouldAcquireToken: false, shouldReleaseToken: false };
  }

  if (input.hasLineOfSight) {
    const inRange = input.distanceToPlayer <= input.preferredRange * 1.45;
    if (
      inRange &&
      input.attackCooldownRemaining <= 0 &&
      (input.hasAttackToken || input.canAcquireToken)
    ) {
      return {
        nextState: 'attack',
        shouldAcquireToken: !input.hasAttackToken,
        shouldReleaseToken: false,
      };
    }
    return { nextState: 'alert', shouldAcquireToken: false, shouldReleaseToken: false };
  }

  if (input.alertMemoryTimer > 0) {
    return { nextState: 'alert', shouldAcquireToken: false, shouldReleaseToken: input.hasAttackToken };
  }

  return { nextState: 'patrol', shouldAcquireToken: false, shouldReleaseToken: input.hasAttackToken };
}

export function calculateAccuracyPercent(shotsFired: number, shotsHit: number): number {
  if (shotsFired <= 0) return 0;
  return Math.min(100, Math.round((shotsHit / shotsFired) * 100));
}

// Deterministic CS2-inspired spray kick curves (pitch multiplier, yaw multiplier)
const RIFLE_RECOIL_PATTERN: ReadonlyArray<readonly [number, number]> = [
  [0.85, 0.05],
  [1.0, -0.08],
  [1.1, 0.14],
  [1.15, 0.25],
  [1.05, 0.32],
  [0.95, 0.12],
  [0.85, -0.35],
  [0.8, -0.55],
  [0.75, -0.45],
  [0.7, 0.25],
  [0.72, 0.52],
  [0.68, 0.35],
];

const PISTOL_RECOIL_PATTERN: ReadonlyArray<readonly [number, number]> = [
  [0.9, 0.0],
  [1.05, -0.1],
  [1.1, 0.12],
  [1.0, -0.06],
];

const SHOTGUN_RECOIL_PATTERN: ReadonlyArray<readonly [number, number]> = [
  [1.05, 0.08],
  [1.1, -0.12],
  [1.0, 0.05],
];

const MARKSMAN_RECOIL_PATTERN: ReadonlyArray<readonly [number, number]> = [
  [1.0, 0.04],
  [1.08, -0.05],
  [1.05, 0.06],
];

const SMG_RECOIL_PATTERN: ReadonlyArray<readonly [number, number]> = [
  [0.72, 0.06],
  [0.8, -0.09],
  [0.86, 0.14],
  [0.9, 0.2],
  [0.78, -0.18],
  [0.7, 0.1],
  [0.66, -0.3],
  [0.62, 0.28],
];

const LMG_RECOIL_PATTERN: ReadonlyArray<readonly [number, number]> = [
  [0.9, 0.05],
  [1.0, -0.06],
  [1.12, 0.12],
  [1.2, 0.24],
  [1.1, 0.3],
  [0.95, -0.22],
  [0.85, -0.4],
  [0.8, 0.35],
  [0.75, 0.5],
  [0.7, -0.3],
];

const DEAGLE_RECOIL_PATTERN: ReadonlyArray<readonly [number, number]> = [
  [1.0, 0.05],
  [1.1, -0.12],
  [1.05, 0.18],
];

export function getRecoilPatternStep(
  weaponId: WeaponId,
  streakIndex: number,
  isAds: boolean,
): { pitch: number; yaw: number } {
  const spec = WEAPON_SPECS[weaponId];
  if (spec.isMelee) return { pitch: 0, yaw: 0 };
  const pattern =
    weaponId === 'rifle'
      ? RIFLE_RECOIL_PATTERN
      : weaponId === 'shotgun'
        ? SHOTGUN_RECOIL_PATTERN
        : weaponId === 'marksman'
          ? MARKSMAN_RECOIL_PATTERN
          : weaponId === 'smg'
            ? SMG_RECOIL_PATTERN
            : weaponId === 'lmg'
              ? LMG_RECOIL_PATTERN
              : weaponId === 'deagle'
                ? DEAGLE_RECOIL_PATTERN
                : PISTOL_RECOIL_PATTERN;
  const entry = pattern[Math.max(0, streakIndex) % pattern.length];
  const adsScale = isAds ? 0.68 : 1.0;
  return {
    pitch: spec.recoilPitch * entry[0] * adsScale,
    yaw: spec.recoilYaw * entry[1] * adsScale,
  };
}

/**
 * Signed horizontal angle (radians) from player look forward to attacker position.
 * 0 = directly ahead, +PI/2 = right, -PI/2 = left, ±PI = behind.
 */
export function computeDirectionalDamageAngle(
  playerPos: { x: number; z: number },
  playerForward: { x: number; z: number },
  attackerPos: { x: number; z: number },
): number {
  const dx = attackerPos.x - playerPos.x;
  const dz = attackerPos.z - playerPos.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-5) return 0;
  const fLen = Math.hypot(playerForward.x, playerForward.z) || 1;
  const fx = playerForward.x / fLen;
  const fz = playerForward.z / fLen;
  const ax = dx / len;
  const az = dz / len;
  const rx = -fz;
  const rz = fx;
  const forwardDot = fx * ax + fz * az;
  const rightDot = rx * ax + rz * az;
  return Math.atan2(rightDot, forwardDot);
}

/**
 * Radial falloff splash damage for explosive barrels and frag grenades.
 */
export function computeExplosionSplashDamage(
  distance: number,
  radius: number,
  maxDamage: number,
): number {
  if (distance >= radius || radius <= 0) return 0;
  const t = 1 - Math.max(0, distance) / radius;
  return Math.round(maxDamage * (0.25 + 0.75 * t * t));
}

export function getEnemyRole(archetype: EnemyArchetype, unitIndex: number): EnemyRole {
  if (archetype === 'striker') return 'rusher';
  if (archetype === 'juggernaut') return unitIndex % 2 === 0 ? 'marksman' : 'rifleman';
  return unitIndex % 3 === 0 ? 'marksman' : 'rifleman';
}

// ---------------------------------------------------------------------------
// Difficulty levels (Easy -> Extreme)
// ---------------------------------------------------------------------------

export const LEVELS_PER_TIER = { easy: 2, medium: 2, hard: 2 } as const;
export const WAVES_PER_LEVEL = 3;
export const MAX_LEVEL = 8;

export interface LevelConfig {
  level: number;
  label: 'EASY' | 'MEDIUM' | 'HARD' | 'EXTREME';
  enemyCountMult: number;
  speedMult: number;
  accuracyBonus: number;
  strikerBonus: number;
  juggernautBonus: number;
  radiationMult: number;
  ammoMult: number;
  aggroRadius: number;
}

function levelTier(level: number): LevelConfig['label'] {
  if (level <= 2) return 'EASY';
  if (level <= 4) return 'MEDIUM';
  if (level <= 6) return 'HARD';
  return 'EXTREME';
}

const LEVEL_TIER_PARAMS: Record<LevelConfig['label'], Omit<LevelConfig, 'level' | 'label'>> = {
  EASY: {
    enemyCountMult: 0.8,
    speedMult: 0.92,
    accuracyBonus: -0.08,
    strikerBonus: -0.05,
    juggernautBonus: -0.04,
    radiationMult: 0.6,
    ammoMult: 1.25,
    aggroRadius: 7,
  },
  MEDIUM: {
    enemyCountMult: 1.0,
    speedMult: 1.0,
    accuracyBonus: 0,
    strikerBonus: 0,
    juggernautBonus: 0,
    radiationMult: 1.0,
    ammoMult: 1.0,
    aggroRadius: 8.5,
  },
  HARD: {
    enemyCountMult: 1.18,
    speedMult: 1.08,
    accuracyBonus: 0.06,
    strikerBonus: 0.05,
    juggernautBonus: 0.04,
    radiationMult: 1.5,
    ammoMult: 0.85,
    aggroRadius: 10,
  },
  EXTREME: {
    enemyCountMult: 1.38,
    speedMult: 1.16,
    accuracyBonus: 0.12,
    strikerBonus: 0.08,
    juggernautBonus: 0.07,
    radiationMult: 2.1,
    ammoMult: 0.7,
    aggroRadius: 12,
  },
};

export function getLevelConfig(level: number): LevelConfig {
  const lv = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  const label = levelTier(lv);
  // Within a tier, later levels get a small extra ramp.
  const step = (lv - 1) % (label === 'EXTREME' ? MAX_LEVEL - 6 : 2);
  const ramp = step * 0.06;
  const base = LEVEL_TIER_PARAMS[label];
  return {
    level: lv,
    label,
    enemyCountMult: base.enemyCountMult * (1 + ramp * 0.5),
    speedMult: base.speedMult + ramp * 0.04,
    accuracyBonus: base.accuracyBonus + ramp * 0.02,
    strikerBonus: base.strikerBonus + ramp * 0.01,
    juggernautBonus: base.juggernautBonus + ramp * 0.01,
    radiationMult: base.radiationMult * (1 + ramp * 0.4),
    ammoMult: base.ammoMult * (1 - ramp * 0.15),
    aggroRadius: base.aggroRadius + ramp * 1.5,
  };
}

// ---------------------------------------------------------------------------
// Radiation hazard zones (per map, world XZ + radius + base dps)
// ---------------------------------------------------------------------------

export interface RadiationZoneSpec {
  x: number;
  z: number;
  radius: number;
  dps: number;
  label: string;
}

export const RADIATION_ZONES: Record<MapId, RadiationZoneSpec[]> = {
  dusk_yard: [
    { x: 2, z: -36, radius: 11, dps: 5, label: 'SECTOR C HOTZONE' },
  ],
  arctic_outpost: [
    { x: -14, z: -18, radius: 10, dps: 4, label: 'CRYO LEAK' },
    { x: 16, z: 8, radius: 8, dps: 6, label: 'REACTOR BLEED' },
  ],
  desert_compound: [
    { x: 0, z: -30, radius: 12, dps: 5, label: 'SCORCHED CACHE' },
  ],
  neon_docks: [
    { x: -22, z: -28, radius: 10, dps: 7, label: 'CHEMICAL BERTH' },
    { x: 20, z: 18, radius: 8, dps: 5, label: 'FUEL SIPHON' },
  ],
  highland_ridge: [
    { x: -18, z: -24, radius: 11, dps: 4, label: 'ORE VEIN' },
    { x: 18, z: -8, radius: 9, dps: 6, label: 'RELAY ARRAY' },
  ],
  sunken_foundry: [
    { x: 0, z: -22, radius: 13, dps: 9, label: 'MOLTEN CORE' },
    { x: -20, z: 10, radius: 8, dps: 5, label: 'SLAG PIT' },
  ],
};

export function getRadiationIntensityAt(
  x: number,
  z: number,
  mapId: MapId,
): { zone: RadiationZoneSpec; intensity: number } | null {
  const zones = RADIATION_ZONES[mapId];
  let best: { zone: RadiationZoneSpec; intensity: number } | null = null;
  for (const zone of zones) {
    const d = Math.hypot(x - zone.x, z - zone.z);
    if (d >= zone.radius) continue;
    // Full intensity in the core 55%, linear falloff to the edge.
    const core = zone.radius * 0.55;
    const intensity = d <= core ? 1 : 1 - (d - core) / (zone.radius - core);
    if (!best || intensity > best.intensity) best = { zone, intensity };
  }
  return best;
}
