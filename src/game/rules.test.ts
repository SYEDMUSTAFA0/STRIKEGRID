import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAG_GRENADE_SPEC,
  MAP_LIGHTING_PROFILES,
  MAP_SPECS,
  WEAPON_ORDER,
  WEAPON_SKIN_SPECS,
  WEAPON_SPECS,
  ZONE_SPECS,
  calculateAccuracyPercent,
  computeDirectionalDamageAngle,
  computeExplosionSplashDamage,
  computeHitDamage,
  computeWeaponSpread,
  evaluateEnemyTransition,
  getEnemyRole,
  getNextWeaponId,
  getRampHeightAt,
  getRecoilPatternStep,
  getSurfaceFloorHeight,
  getLevelConfig,
  getRadiationIntensityAt,
  getWaveConfig,
  RADIATION_ZONES,
  getZoneAt,
  isPointClearOfObstacles,
  pickArchetypeForWave,
  resolveCircleAABBs,
} from './rules';
import type { RampCollider } from './types';

test('MAP_SPECS, WEAPON_ORDER, and WEAPON_SKIN_SPECS define all maps, 8 weapons, and 4 skins', () => {
  assert.deepEqual(Object.keys(MAP_SPECS), [
    'dusk_yard',
    'arctic_outpost',
    'desert_compound',
    'neon_docks',
    'highland_ridge',
    'sunken_foundry',
  ]);
  assert.deepEqual(WEAPON_ORDER, [
    'rifle',
    'pistol',
    'shotgun',
    'marksman',
    'knife',
    'smg',
    'lmg',
    'deagle',
  ]);
  assert.equal(WEAPON_SPECS.shotgun.pellets, 8);
  assert.equal(WEAPON_SPECS.knife.isMelee, true);
  assert.equal(WEAPON_SPECS.smg.automatic, true);
  assert.equal(WEAPON_SPECS.lmg.magSize, 100);
  assert.equal(WEAPON_SPECS.deagle.damage, 92);
  assert.equal(FRAG_GRENADE_SPEC.startCount, 3);
  assert.deepEqual(Object.keys(WEAPON_SKIN_SPECS), [
    'standard',
    'desert_tan',
    'arctic_camo',
    'carbon_gold',
  ]);
});

test('getNextWeaponId cycles cleanly forward and backward across all 8 loadout slots', () => {
  assert.equal(getNextWeaponId('rifle', 1), 'pistol');
  assert.equal(getNextWeaponId('pistol', 1), 'shotgun');
  assert.equal(getNextWeaponId('shotgun', 1), 'marksman');
  assert.equal(getNextWeaponId('marksman', 1), 'knife');
  assert.equal(getNextWeaponId('knife', 1), 'smg');
  assert.equal(getNextWeaponId('smg', 1), 'lmg');
  assert.equal(getNextWeaponId('lmg', 1), 'deagle');
  assert.equal(getNextWeaponId('deagle', 1), 'rifle');
  assert.equal(getNextWeaponId('rifle', -1), 'deagle');
  assert.equal(getNextWeaponId('deagle', -1), 'lmg');
});

test('getRampHeightAt and getSurfaceFloorHeight interpolate sloped ramps accurately', () => {
  const ramp: RampCollider = {
    minX: 0,
    maxX: 10,
    minZ: -2,
    maxZ: 2,
    axis: 'x',
    lowY: 0,
    highY: 2.5,
    dir: 1,
  };
  assert.equal(getRampHeightAt(-1, 0, ramp), null);
  assert.equal(getRampHeightAt(0, 0, ramp), 0);
  assert.equal(getRampHeightAt(5, 0, ramp), 1.25);
  assert.equal(getRampHeightAt(10, 0, ramp), 2.5);

  const deck = [{ minX: 10, maxX: 16, minZ: -3, maxZ: 3, maxY: 2.5 }];
  assert.equal(getSurfaceFloorHeight(5, 0, 1.2, 0.46, deck, [ramp]), 1.25);
  assert.equal(getSurfaceFloorHeight(12, 0, 2.5, 0.46, deck, [ramp]), 2.5);
});

test('resolveCircleAABBs slides along wall without penetrating and respects isPointClearOfObstacles', () => {
  const obstacles = [{ minX: -2, maxX: 2, minZ: -2, maxZ: 2, maxY: 3 }];
  const res = resolveCircleAABBs({ x: 2.2, y: 0, z: 0.5 }, 0.5, 1.7, obstacles);
  assert.ok(res.collided);
  assert.ok(Math.abs(res.x - 2.5) < 1e-5);
  assert.ok(Math.abs(res.z - 0.5) < 1e-5);

  assert.equal(isPointClearOfObstacles(0, 0, 0.5, obstacles), false);
  assert.equal(isPointClearOfObstacles(4, 0, 0.5, obstacles), true);
});

test('resolveCircleAABBs allows jumping over low barriers', () => {
  const obstacles = [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1, maxY: 1.0 }];
  const res = resolveCircleAABBs({ x: 0.2, y: 1.1, z: 0.2 }, 0.45, 1.7, obstacles);
  assert.equal(res.collided, false);
  assert.equal(res.x, 0.2);
});

test('computeWeaponSpread tightens on ADS and crouch, widens while moving, zero on knife', () => {
  const rifle = WEAPON_SPECS.rifle;
  const hipIdle = computeWeaponSpread(rifle, {
    isAds: false,
    moveSpeedRatio: 0,
    isCrouching: false,
    isAirborne: false,
  });
  const adsIdle = computeWeaponSpread(rifle, {
    isAds: true,
    moveSpeedRatio: 0,
    isCrouching: false,
    isAirborne: false,
  });
  const hipMoving = computeWeaponSpread(rifle, {
    isAds: false,
    moveSpeedRatio: 1,
    isCrouching: false,
    isAirborne: false,
  });
  const hipCrouch = computeWeaponSpread(rifle, {
    isAds: false,
    moveSpeedRatio: 0,
    isCrouching: true,
    isAirborne: false,
  });

  assert.ok(adsIdle < hipIdle);
  assert.ok(hipCrouch < hipIdle);
  assert.ok(hipMoving > hipIdle);
  assert.equal(
    computeWeaponSpread(WEAPON_SPECS.knife, {
      isAds: false,
      moveSpeedRatio: 1,
      isCrouching: false,
      isAirborne: true,
    }),
    0,
  );
});

test('computeHitDamage applies headshot multiplier for rifle, marksman, and shotgun', () => {
  const rifle = WEAPON_SPECS.rifle;
  const head = computeHitDamage(rifle, 'head');
  const torso = computeHitDamage(rifle, 'torso');
  const limb = computeHitDamage(rifle, 'limb');

  assert.equal(head.isCrit, true);
  assert.equal(head.damage, Math.round(rifle.damage * rifle.headshotMultiplier));
  assert.equal(torso.isCrit, false);
  assert.equal(torso.damage, rifle.damage);
  assert.ok(limb.damage < torso.damage);

  const marksmanHead = computeHitDamage(WEAPON_SPECS.marksman, 'head');
  assert.ok(marksmanHead.damage > 140);
});

test('getWaveConfig scales enemy count, speed, accuracy, and archetype mix', () => {
  const w1 = getWaveConfig(1);
  const w4 = getWaveConfig(4);
  assert.ok(w4.enemyCount > w1.enemyCount);
  assert.ok(w4.speedMultiplier > w1.speedMultiplier);
  assert.ok(w4.accuracy > w1.accuracy);
  assert.equal(w1.juggernautWeight, 0);
  assert.ok(w4.juggernautWeight > 0);
  assert.equal(pickArchetypeForWave(4, 0.01), 'juggernaut');
  assert.equal(pickArchetypeForWave(4, 0.99), 'trooper');
});

test('evaluateEnemyTransition respects LOS and attack token pool', () => {
  const patrolToAlert = evaluateEnemyTransition({
    currentState: 'patrol',
    hasLineOfSight: true,
    distanceToPlayer: 20,
    preferredRange: 18,
    attackCooldownRemaining: 1.0,
    hasAttackToken: false,
    canAcquireToken: true,
    alertMemoryTimer: 0,
  });
  assert.equal(patrolToAlert.nextState, 'alert');

  const alertToAttack = evaluateEnemyTransition({
    currentState: 'alert',
    hasLineOfSight: true,
    distanceToPlayer: 14,
    preferredRange: 18,
    attackCooldownRemaining: 0,
    hasAttackToken: false,
    canAcquireToken: true,
    alertMemoryTimer: 3,
  });
  assert.equal(alertToAttack.nextState, 'attack');
  assert.equal(alertToAttack.shouldAcquireToken, true);

  const blockedByTokens = evaluateEnemyTransition({
    currentState: 'alert',
    hasLineOfSight: true,
    distanceToPlayer: 14,
    preferredRange: 18,
    attackCooldownRemaining: 0,
    hasAttackToken: false,
    canAcquireToken: false,
    alertMemoryTimer: 3,
  });
  assert.equal(blockedByTokens.nextState, 'alert');
  assert.equal(blockedByTokens.shouldAcquireToken, false);
});

test('calculateAccuracyPercent handles zero shots and caps at 100', () => {
  assert.equal(calculateAccuracyPercent(0, 0), 0);
  assert.equal(calculateAccuracyPercent(20, 9), 45);
  assert.equal(calculateAccuracyPercent(5, 8), 100);
});

test('getRecoilPatternStep scales down recoil during ADS and zeroes knife', () => {
  const hip = getRecoilPatternStep('rifle', 2, false);
  const ads = getRecoilPatternStep('rifle', 2, true);
  assert.ok(ads.pitch < hip.pitch);
  assert.ok(Math.abs(ads.yaw) < Math.abs(hip.yaw));
  assert.deepEqual(getRecoilPatternStep('knife', 0, false), { pitch: 0, yaw: 0 });
});

test('computeDirectionalDamageAngle returns signed angle relative to player facing', () => {
  const ahead = computeDirectionalDamageAngle({ x: 0, z: 0 }, { x: 0, z: -1 }, { x: 0, z: -10 });
  const right = computeDirectionalDamageAngle({ x: 0, z: 0 }, { x: 0, z: -1 }, { x: 10, z: 0 });
  const left = computeDirectionalDamageAngle({ x: 0, z: 0 }, { x: 0, z: -1 }, { x: -10, z: 0 });
  assert.ok(Math.abs(ahead) < 1e-5);
  assert.ok(Math.abs(right - Math.PI / 2) < 1e-5);
  assert.ok(Math.abs(left + Math.PI / 2) < 1e-5);
});

test('computeExplosionSplashDamage and getEnemyRole behave deterministically', () => {
  assert.equal(computeExplosionSplashDamage(0, 7, 140), 140);
  assert.equal(computeExplosionSplashDamage(7, 7, 140), 0);
  assert.ok(computeExplosionSplashDamage(3.5, 7, 140) > 40);
  assert.equal(getEnemyRole('striker', 1), 'rusher');
  assert.equal(getEnemyRole('trooper', 3), 'marksman');
});

test('getZoneAt resolves all 4 named zones plus central yard and playerSpawn begins in landing', () => {
  assert.deepEqual(Object.keys(ZONE_SPECS), [
    'landing',
    'building',
    'forest',
    'restriction',
    'central',
  ]);
  for (const mapId of [
    'dusk_yard',
    'arctic_outpost',
    'desert_compound',
    'neon_docks',
    'highland_ridge',
    'sunken_foundry',
  ] as const) {
    const sp = MAP_SPECS[mapId].playerSpawn;
    assert.equal(getZoneAt(sp.x, sp.z, mapId), 'landing');
    assert.equal(getZoneAt(-28, 0, mapId), 'building');
    assert.equal(getZoneAt(28, 0, mapId), 'forest');
    assert.equal(getZoneAt(0, -30, mapId), 'restriction');
    assert.equal(getZoneAt(0, 0, mapId), 'central');
    const prof = MAP_LIGHTING_PROFILES[mapId];
    assert.ok(prof.exposure >= 0.75 && prof.exposure <= 1.0);
    assert.ok(prof.envIntensity >= 0.3 && prof.envIntensity <= 0.5);
    assert.ok(prof.bloomThreshold >= 0.88);
  }
});

test('getLevelConfig tiers scale smoothly from EASY to EXTREME', () => {
  assert.equal(getLevelConfig(1).label, 'EASY');
  assert.equal(getLevelConfig(2).label, 'EASY');
  assert.equal(getLevelConfig(3).label, 'MEDIUM');
  assert.equal(getLevelConfig(5).label, 'HARD');
  assert.equal(getLevelConfig(7).label, 'EXTREME');
  assert.equal(getLevelConfig(8).label, 'EXTREME');
  const easy = getLevelConfig(1);
  const extreme = getLevelConfig(8);
  assert.ok(extreme.enemyCountMult > easy.enemyCountMult);
  assert.ok(extreme.accuracyBonus > easy.accuracyBonus);
  assert.ok(extreme.radiationMult > easy.radiationMult);
  assert.ok(extreme.speedMult > easy.speedMult);
  // getWaveConfig respects level scaling
  const w1 = getWaveConfig(3, 1);
  const w8 = getWaveConfig(3, 8);
  assert.ok(w8.enemyCount >= w1.enemyCount);
  assert.ok(w8.accuracy >= w1.accuracy);
});

test('radiation zones exist on every map and intensity falls off at edges', () => {
  for (const mapId of [
    'dusk_yard',
    'arctic_outpost',
    'desert_compound',
    'neon_docks',
    'highland_ridge',
    'sunken_foundry',
  ] as const) {
    const zones = RADIATION_ZONES[mapId];
    assert.ok(zones.length >= 1, `${mapId} should have radiation zones`);
    const z = zones[0];
    const center = getRadiationIntensityAt(z.x, z.z, mapId);
    assert.ok(center && center.intensity > 0.9);
    const outside = getRadiationIntensityAt(z.x + z.radius + 5, z.z, mapId);
    assert.equal(outside, null);
    const edge = getRadiationIntensityAt(z.x + z.radius * 0.9, z.z, mapId);
    assert.ok(edge && edge.intensity > 0 && edge.intensity < 1);
  }
});
