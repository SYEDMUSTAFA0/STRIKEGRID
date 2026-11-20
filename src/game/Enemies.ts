import * as THREE from 'three';
import {
  ENEMY_SPECS,
  computeExplosionSplashDamage,
  evaluateEnemyTransition,
  getEnemyRole,
  getSurfaceFloorHeight,
  getWaveConfig,
  pickArchetypeForWave,
  resolveCircleAABBs,
} from './rules';
import { ProceduralTextureLibrary } from './textures';
import type { EnemyAIState, EnemyArchetype, EnemyRole, WeaponSkinId } from './types';
import type { World } from './World';
import type { SoundEngine } from './Audio';
import type { Player } from './Player';

const MAX_ATTACK_TOKENS = 3;
const ENEMY_RADIUS = 0.48;
const _raycaster = new THREE.Raycaster();
const _toPlayer = new THREE.Vector3();
const _eyeOrigin = new THREE.Vector3();
const _muzzlePos = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _moveVec = new THREE.Vector3();
const _strafeVec = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function makeExtrudedGeo(
  pts: ReadonlyArray<readonly [number, number]>,
  depth: number,
  bevelThickness = 0.01,
  bevelSize = 0.01,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i][0], pts[i][1]);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments: 2,
    steps: 1,
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return geo;
}

function makeCurvedArcGeo(
  innerR: number,
  outerR: number,
  startAng: number,
  endAng: number,
  height: number,
  bevel = 0.005,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const segs = 12;
  for (let i = 0; i <= segs; i++) {
    const a = startAng + (i / segs) * (endAng - startAng);
    const x = Math.sin(a) * outerR;
    const y = Math.cos(a) * outerR;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let i = segs; i >= 0; i--) {
    const a = startAng + (i / segs) * (endAng - startAng);
    shape.lineTo(Math.sin(a) * innerR, Math.cos(a) * innerR);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    steps: 1,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, height / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

interface EnemyActor {
  id: number;
  archetype: EnemyArchetype;
  role: EnemyRole;
  group: THREE.Group;
  bodyParts: THREE.Mesh[];
  pelvisGroup: THREE.Group;
  torsoPivot: THREE.Group;
  headGroup: THREE.Group;
  leftShoulder: THREE.Group;
  leftElbow: THREE.Group;
  rightShoulder: THREE.Group;
  rightElbow: THREE.Group;
  leftHip: THREE.Group;
  leftKnee: THREE.Group;
  rightHip: THREE.Group;
  rightKnee: THREE.Group;
  muzzleAnchor: THREE.Object3D;
  laserLine: THREE.Line;
  laserMat: THREE.LineBasicMaterial;
  vestMat: THREE.MeshStandardMaterial;

  hp: number;
  maxHp: number;
  state: EnemyAIState;
  hasAttackToken: boolean;
  waypointIndex: number;
  strafeDir: number;
  strafeTimer: number;
  alertMemory: number;
  attackCooldown: number;
  telegraphTimer: number;
  burstRemaining: number;
  burstTimer: number;
  hitFlashTimer: number;
  flinchTimer: number;
  koTimer: number;
  koRollDir: number;
  walkCycle: number;
  breathPhase: number;
  speedMult: number;
  accuracy: number;
}

export class Enemies {
  private readonly actors: EnemyActor[] = [];
  private readonly hitboxMeshes: THREE.Mesh[] = [];
  private nextId = 1;
  private activeTokenCount = 0;

  private readonly texLib: ProceduralTextureLibrary;
  private readonly sharedGeos: {
    cranium: THREE.SphereGeometry;
    jawLathe: THREE.LatheGeometry;
    neck: THREE.LatheGeometry;
    brow: THREE.ExtrudeGeometry;
    nose: THREE.ExtrudeGeometry;
    cheekbone: THREE.CapsuleGeometry;
    ear: THREE.SphereGeometry;
    eyeWhite: THREE.SphereGeometry;
    eyePupil: THREE.SphereGeometry;
    helmetDome: THREE.LatheGeometry;
    helmetRail: THREE.ExtrudeGeometry;
    nvgMount: THREE.ExtrudeGeometry;
    headsetCup: THREE.LatheGeometry;
    micBoom: THREE.TubeGeometry;
    goggleVisor: THREE.ExtrudeGeometry;
    balaclava: THREE.LatheGeometry;
    mandible: THREE.ExtrudeGeometry;
    torsoUpper: THREE.CapsuleGeometry;
    collarGuard: THREE.TorusGeometry;
    pelvis: THREE.ExtrudeGeometry;
    plateFront: THREE.ExtrudeGeometry;
    plateBack: THREE.ExtrudeGeometry;
    magPouch: THREE.ExtrudeGeometry;
    backpack: THREE.ExtrudeGeometry;
    packFlap: THREE.ExtrudeGeometry;
    canteen: THREE.LatheGeometry;
    antenna: THREE.TubeGeometry;
    belt: THREE.CylinderGeometry;
    pauldron: THREE.SphereGeometry;
    jointCap: THREE.SphereGeometry;
    upperArm: THREE.CapsuleGeometry;
    forearm: THREE.CapsuleGeometry;
    glovePalm: THREE.ExtrudeGeometry;
    gloveFinger: THREE.CapsuleGeometry;
    thigh: THREE.CapsuleGeometry;
    shin: THREE.CapsuleGeometry;
    kneePad: THREE.ExtrudeGeometry;
    boot: THREE.ExtrudeGeometry;
    rifleBody: THREE.ExtrudeGeometry;
    rifleBarrel: THREE.LatheGeometry;
    rifleMag: THREE.ExtrudeGeometry;
    shadow: THREE.CircleGeometry;
  };

  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly darkGearMat: THREE.MeshStandardMaterial;
  private readonly bootMat: THREE.MeshStandardMaterial;
  private readonly balaclavaMat: THREE.MeshStandardMaterial;
  private readonly skinMats: THREE.MeshStandardMaterial[];
  private readonly uniformMats: Record<EnemyArchetype, THREE.MeshStandardMaterial>;
  private readonly helmetMats: Record<EnemyArchetype, THREE.MeshStandardMaterial>;
  private readonly eyeWhiteMat: THREE.MeshStandardMaterial;
  private readonly eyePupilMat: THREE.MeshStandardMaterial;
  private readonly enemyRifleBodyMat: THREE.MeshStandardMaterial;
  private readonly enemyRifleBarrelMat: THREE.MeshStandardMaterial;
  private readonly enemyRifleMagMat: THREE.MeshStandardMaterial;
  private readonly arcticCamoTex: ReturnType<ProceduralTextureLibrary['createArcticCamoSet']>;
  private readonly carbonTex: ReturnType<ProceduralTextureLibrary['createCarbonFiberSet']>;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    private readonly sound: SoundEngine,
    maxAnisotropy = 4,
    initialSkin: WeaponSkinId = 'standard',
  ) {
    this.texLib = new ProceduralTextureLibrary(maxAnisotropy);
    this.arcticCamoTex = this.texLib.createArcticCamoSet();
    this.carbonTex = this.texLib.createCarbonFiberSet();

    // Sculpted jaw/chin lathe profile (narrow neck taper -> jawline -> cheekbones)
    const jawProfile = [
      new THREE.Vector2(0.048, -0.055),
      new THREE.Vector2(0.072, -0.028),
      new THREE.Vector2(0.094, 0.008),
      new THREE.Vector2(0.103, 0.048),
      new THREE.Vector2(0.095, 0.08),
    ];
    const neckProfile = [
      new THREE.Vector2(0.058, -0.045),
      new THREE.Vector2(0.05, 0.0),
      new THREE.Vector2(0.048, 0.045),
    ];
    // Sculpted ballistic high-cut helmet shell
    const helmetProfile = [
      new THREE.Vector2(0.128, -0.015),
      new THREE.Vector2(0.133, 0.032),
      new THREE.Vector2(0.118, 0.088),
      new THREE.Vector2(0.075, 0.126),
      new THREE.Vector2(0.0, 0.138),
    ];
    const headsetProfile = [
      new THREE.Vector2(0.0, -0.016),
      new THREE.Vector2(0.032, -0.014),
      new THREE.Vector2(0.038, 0.0),
      new THREE.Vector2(0.034, 0.014),
      new THREE.Vector2(0.0, 0.018),
    ];
    const balaclavaProfile = [
      new THREE.Vector2(0.078, -0.05),
      new THREE.Vector2(0.096, -0.01),
      new THREE.Vector2(0.102, 0.03),
      new THREE.Vector2(0.09, 0.05),
    ];
    const canteenProfile = [
      new THREE.Vector2(0.0, -0.065),
      new THREE.Vector2(0.036, -0.058),
      new THREE.Vector2(0.042, 0.02),
      new THREE.Vector2(0.026, 0.05),
      new THREE.Vector2(0.016, 0.068),
      new THREE.Vector2(0.0, 0.068),
    ];
    const rifleBarrelProfile = [
      new THREE.Vector2(0.015, 0),
      new THREE.Vector2(0.012, 0.04),
      new THREE.Vector2(0.011, 0.2),
      new THREE.Vector2(0.018, 0.215),
      new THREE.Vector2(0.018, 0.27),
      new THREE.Vector2(0.01, 0.27),
    ];

    const micCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.102, 0.092, 0.01),
      new THREE.Vector3(-0.088, 0.065, 0.075),
      new THREE.Vector3(-0.028, 0.054, 0.105),
    ]);
    const antennaCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(-0.01, 0.14, -0.015),
      new THREE.Vector3(-0.025, 0.31, -0.04),
    ]);

    const rifleBarrelGeo = new THREE.LatheGeometry(rifleBarrelProfile, 12);
    rifleBarrelGeo.rotateX(Math.PI / 2);

    const rifleBodyGeo = makeExtrudedGeo(
      [
        [-0.24, -0.028],
        [0.06, -0.028],
        [0.18, -0.042],
        [0.24, 0.036],
        [-0.22, 0.038],
      ],
      0.046,
      0.006,
      0.006,
    );
    rifleBodyGeo.rotateY(Math.PI / 2);

    const rifleMagGeo = makeExtrudedGeo(
      [
        [-0.024, 0],
        [0.024, 0],
        [0.034, -0.115],
        [-0.014, -0.12],
      ],
      0.03,
      0.004,
      0.004,
    );
    rifleMagGeo.rotateY(Math.PI / 2);

    // Sculpted tactical boot profile (heel -> instep -> armored toe box)
    const bootGeo = makeExtrudedGeo(
      [
        [-0.085, -0.055],
        [0.145, -0.055],
        [0.15, -0.005],
        [0.05, 0.025],
        [-0.01, 0.07],
        [-0.08, 0.07],
      ],
      0.096,
      0.012,
      0.012,
    );
    bootGeo.rotateY(-Math.PI / 2);

    this.sharedGeos = {
      cranium: new THREE.SphereGeometry(0.108, 14, 12),
      jawLathe: new THREE.LatheGeometry(jawProfile, 14),
      neck: new THREE.LatheGeometry(neckProfile, 12),
      brow: makeCurvedArcGeo(0.082, 0.106, -0.55, 0.55, 0.02, 0.004),
      nose: makeExtrudedGeo(
        [
          [0, 0.024],
          [0.022, -0.018],
          [0.005, -0.024],
          [-0.006, 0.0],
        ],
        0.02,
        0.004,
        0.004,
      ),
      cheekbone: new THREE.CapsuleGeometry(0.018, 0.04, 4, 8),
      ear: new THREE.SphereGeometry(0.024, 8, 6),
      eyeWhite: new THREE.SphereGeometry(0.015, 8, 6),
      eyePupil: new THREE.SphereGeometry(0.008, 6, 6),
      helmetDome: new THREE.LatheGeometry(helmetProfile, 16),
      helmetRail: makeExtrudedGeo(
        [
          [-0.055, -0.012],
          [0.055, -0.008],
          [0.052, 0.014],
          [-0.052, 0.016],
        ],
        0.012,
        0.003,
        0.003,
      ),
      nvgMount: makeExtrudedGeo(
        [
          [-0.018, -0.02],
          [0.018, -0.02],
          [0.014, 0.02],
          [-0.014, 0.02],
        ],
        0.022,
        0.004,
        0.004,
      ),
      headsetCup: new THREE.LatheGeometry(headsetProfile, 12),
      micBoom: new THREE.TubeGeometry(micCurve, 10, 0.0045, 6, false),
      goggleVisor: makeCurvedArcGeo(0.088, 0.114, -0.78, 0.78, 0.044, 0.006),
      balaclava: new THREE.LatheGeometry(balaclavaProfile, 14),
      mandible: makeCurvedArcGeo(0.085, 0.118, -0.82, 0.82, 0.072, 0.007),
      torsoUpper: new THREE.CapsuleGeometry(0.165, 0.32, 6, 12),
      collarGuard: new THREE.TorusGeometry(0.115, 0.032, 8, 16),
      pelvis: makeExtrudedGeo(
        [
          [-0.145, -0.075],
          [0.145, -0.075],
          [0.155, 0.075],
          [-0.155, 0.075],
        ],
        0.18,
        0.018,
        0.018,
      ),
      plateFront: makeExtrudedGeo(
        [
          [-0.135, -0.155],
          [0.135, -0.155],
          [0.12, 0.09],
          [0.065, 0.16],
          [-0.065, 0.16],
          [-0.12, 0.09],
        ],
        0.06,
        0.014,
        0.014,
      ),
      plateBack: makeExtrudedGeo(
        [
          [-0.13, -0.15],
          [0.13, -0.15],
          [0.115, 0.12],
          [0.06, 0.155],
          [-0.06, 0.155],
          [-0.115, 0.12],
        ],
        0.055,
        0.012,
        0.012,
      ),
      magPouch: makeExtrudedGeo(
        [
          [-0.026, -0.052],
          [0.026, -0.052],
          [0.028, 0.052],
          [-0.028, 0.052],
        ],
        0.036,
        0.007,
        0.007,
      ),
      backpack: makeExtrudedGeo(
        [
          [-0.115, -0.16],
          [0.115, -0.16],
          [0.1, 0.16],
          [-0.1, 0.16],
        ],
        0.12,
        0.018,
        0.018,
      ),
      packFlap: makeExtrudedGeo(
        [
          [-0.105, -0.05],
          [0.105, -0.05],
          [0.095, 0.05],
          [-0.095, 0.05],
        ],
        0.125,
        0.012,
        0.012,
      ),
      canteen: new THREE.LatheGeometry(canteenProfile, 12),
      antenna: new THREE.TubeGeometry(antennaCurve, 10, 0.0055, 6, false),
      belt: new THREE.CylinderGeometry(0.168, 0.172, 0.06, 14),
      pauldron: new THREE.SphereGeometry(0.092, 10, 8),
      jointCap: new THREE.SphereGeometry(0.054, 10, 8),
      upperArm: new THREE.CapsuleGeometry(0.056, 0.21, 5, 10),
      forearm: new THREE.CapsuleGeometry(0.046, 0.2, 5, 10),
      glovePalm: makeExtrudedGeo(
        [
          [-0.024, -0.03],
          [0.024, -0.03],
          [0.026, 0.028],
          [-0.026, 0.028],
        ],
        0.046,
        0.008,
        0.008,
      ),
      gloveFinger: new THREE.CapsuleGeometry(0.008, 0.026, 4, 6),
      thigh: new THREE.CapsuleGeometry(0.078, 0.28, 5, 10),
      shin: new THREE.CapsuleGeometry(0.06, 0.29, 5, 10),
      kneePad: makeCurvedArcGeo(0.045, 0.074, -0.75, 0.75, 0.088, 0.008),
      boot: bootGeo,
      rifleBody: rifleBodyGeo,
      rifleBarrel: rifleBarrelGeo,
      rifleMag: rifleMagGeo,
      shadow: new THREE.CircleGeometry(0.68, 18),
    };
    this.sharedGeos.shadow.rotateX(-Math.PI / 2);
    this.sharedGeos.headsetCup.rotateZ(Math.PI / 2);
    this.sharedGeos.collarGuard.rotateX(Math.PI / 2);
    this.sharedGeos.helmetRail.rotateY(Math.PI / 2);
    this.sharedGeos.nose.rotateY(Math.PI / 2);

    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.darkGearMat = new THREE.MeshStandardMaterial({
      color: 0x1c1f24,
      roughness: 0.58,
      metalness: 0.35,
    });
    this.bootMat = new THREE.MeshStandardMaterial({
      color: 0x181716,
      roughness: 0.85,
      metalness: 0.1,
    });
    this.balaclavaMat = new THREE.MeshStandardMaterial({
      color: 0x22262e,
      roughness: 0.9,
      metalness: 0.04,
    });
    this.eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xeee8e0, roughness: 0.2 });
    this.eyePupilMat = new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 0.1 });

    this.skinMats = [
      new THREE.MeshStandardMaterial({ color: 0xd5a182, roughness: 0.68, metalness: 0.02 }),
      new THREE.MeshStandardMaterial({ color: 0xb98262, roughness: 0.68, metalness: 0.02 }),
      new THREE.MeshStandardMaterial({ color: 0x7a5039, roughness: 0.68, metalness: 0.02 }),
    ];

    const makeUniform = (rgb: [number, number, number], seed: number) => {
      const tex = this.texLib.createCamoFabricSet(rgb, seed);
      return new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: tex.map,
        normalMap: tex.normalMap,
        roughnessMap: tex.roughnessMap,
        roughness: 0.86,
        metalness: 0.05,
      });
    };

    this.uniformMats = {
      trooper: makeUniform([74, 82, 68], 601),
      striker: makeUniform([52, 58, 66], 602),
      juggernaut: makeUniform([62, 58, 54], 603),
    };

    this.helmetMats = {
      trooper: new THREE.MeshStandardMaterial({ color: 0x424a3e, roughness: 0.55, metalness: 0.25 }),
      striker: new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.5, metalness: 0.3 }),
      juggernaut: new THREE.MeshStandardMaterial({ color: 0x2f3136, roughness: 0.42, metalness: 0.55 }),
    };

    this.enemyRifleBodyMat = new THREE.MeshStandardMaterial({
      color: 0x2d333d,
      roughness: 0.36,
      metalness: 0.82,
    });
    this.enemyRifleBarrelMat = new THREE.MeshStandardMaterial({
      color: 0x262b34,
      roughness: 0.3,
      metalness: 0.88,
    });
    this.enemyRifleMagMat = new THREE.MeshStandardMaterial({
      color: 0x16181c,
      roughness: 0.78,
      metalness: 0.1,
    });
    this.setWeaponSkin(initialSkin);
  }

  setWeaponSkin(skin: WeaponSkinId): void {
    this.enemyRifleBodyMat.map = null;
    this.enemyRifleBodyMat.normalMap = null;
    this.enemyRifleMagMat.map = null;

    if (skin === 'desert_tan') {
      this.enemyRifleBodyMat.color.setHex(0xb89668);
      this.enemyRifleBodyMat.roughness = 0.48;
      this.enemyRifleBodyMat.metalness = 0.34;
      this.enemyRifleBarrelMat.color.setHex(0x8c96a4);
      this.enemyRifleMagMat.color.setHex(0x634d34);
    } else if (skin === 'arctic_camo') {
      this.enemyRifleBodyMat.color.setHex(0xffffff);
      this.enemyRifleBodyMat.map = this.arcticCamoTex.map;
      this.enemyRifleBodyMat.normalMap = this.arcticCamoTex.normalMap;
      this.enemyRifleBodyMat.roughness = 0.82;
      this.enemyRifleBodyMat.metalness = 0.12;
      this.enemyRifleBarrelMat.color.setHex(0x94a3b8);
      this.enemyRifleMagMat.color.setHex(0x334155);
    } else if (skin === 'carbon_gold') {
      this.enemyRifleBodyMat.color.setHex(0xd9a126);
      this.enemyRifleBodyMat.roughness = 0.24;
      this.enemyRifleBodyMat.metalness = 0.88;
      this.enemyRifleBarrelMat.color.setHex(0xe5b842);
      this.enemyRifleMagMat.color.setHex(0xffffff);
      this.enemyRifleMagMat.map = this.carbonTex.map;
    } else {
      this.enemyRifleBodyMat.color.setHex(0x2d333d);
      this.enemyRifleBodyMat.roughness = 0.36;
      this.enemyRifleBodyMat.metalness = 0.82;
      this.enemyRifleBarrelMat.color.setHex(0x262b34);
      this.enemyRifleMagMat.color.setHex(0x16181c);
    }
    this.enemyRifleBodyMat.needsUpdate = true;
    this.enemyRifleBarrelMat.needsUpdate = true;
    this.enemyRifleMagMat.needsUpdate = true;
  }

  getHitboxMeshes(): THREE.Object3D[] {
    return this.hitboxMeshes;
  }

  getAliveCount(): number {
    let count = 0;
    for (let i = 0; i < this.actors.length; i++) {
      if (this.actors[i].state !== 'ko') count++;
    }
    return count;
  }

  clearAll(): void {
    for (const actor of this.actors) {
      this.scene.remove(actor.group);
      this.scene.remove(actor.laserLine);
      actor.laserLine.geometry.dispose();
      actor.laserMat.dispose();
      actor.vestMat.dispose();
    }
    this.actors.length = 0;
    this.hitboxMeshes.length = 0;
    this.activeTokenCount = 0;
  }

  spawnWave(wave: number, playerPos: THREE.Vector3): void {
    this.clearAll();
    const cfg = getWaveConfig(wave);
    const validSpawns = this.world.spawnPoints.filter(
      (sp) => sp.distanceToSquared(playerPos) > 16 * 16,
    );
    const pool = validSpawns.length > 0 ? validSpawns : this.world.spawnPoints;

    for (let i = 0; i < cfg.enemyCount; i++) {
      const sp = pool[i % pool.length];
      const jitterX = ((i % 3) - 1) * 1.4;
      const jitterZ = (Math.floor(i / 3) % 2 === 0 ? 1 : -1) * 1.2;
      const archetype = pickArchetypeForWave(wave, (i + 0.37) / cfg.enemyCount);
      this.spawnActor(archetype, sp.x + jitterX, sp.z + jitterZ, cfg.speedMultiplier, cfg.accuracy);
    }
  }

  spawnTitleTourUnits(): void {
    this.clearAll();
    const spots: Array<{ x: number; z: number; type: EnemyArchetype }> = [
      { x: -6, z: -2, type: 'trooper' },
      { x: 7, z: -12, type: 'striker' },
      { x: 0, z: -22, type: 'juggernaut' },
    ];
    for (const s of spots) {
      const resolved = resolveCircleAABBs({ x: s.x, y: 0, z: s.z }, ENEMY_RADIUS, 1.8, this.world.obstacles);
      this.spawnActor(s.type, resolved.x, resolved.z, 0.85, 0.4);
    }
  }

  private spawnActor(
    archetype: EnemyArchetype,
    x: number,
    z: number,
    speedMult: number,
    accuracy: number,
  ): void {
    const spec = ENEMY_SPECS[archetype];
    const id = this.nextId++;
    const group = new THREE.Group();
    group.scale.setScalar(spec.scale);

    const skinMat = this.skinMats[id % this.skinMats.length];
    const uniformMat = this.uniformMats[archetype];
    const helmetMat = this.helmetMats[archetype];
    const vestMat = new THREE.MeshStandardMaterial({
      color: spec.colorHex,
      roughness: 0.62,
      metalness: 0.25,
    });
    const goggleMat = new THREE.MeshStandardMaterial({
      color: spec.accentHex,
      emissive: spec.accentHex,
      emissiveIntensity: 1.35,
      roughness: 0.15,
      metalness: 0.4,
    });

    const bodyParts: THREE.Mesh[] = [];
    const registerHitbox = (mesh: THREE.Mesh, zone: 'head' | 'torso' | 'limb') => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { enemyId: id, zone };
      bodyParts.push(mesh);
      this.hitboxMeshes.push(mesh);
    };

    const shadow = new THREE.Mesh(this.sharedGeos.shadow, this.shadowMat);
    shadow.position.y = 0.015;
    group.add(shadow);

    // Root Pelvis Group
    const pelvisGroup = new THREE.Group();
    pelvisGroup.position.y = 0.92;
    group.add(pelvisGroup);

    const pelvisMesh = new THREE.Mesh(this.sharedGeos.pelvis, uniformMat);
    registerHitbox(pelvisMesh, 'torso');
    const beltMesh = new THREE.Mesh(this.sharedGeos.belt, this.darkGearMat);
    beltMesh.position.y = 0.07;
    pelvisGroup.add(pelvisMesh, beltMesh);

    // ---- ARTICULATED LEGS WITH JOINT CAPS, KNEE GUARDS & SCULPTED BOOTS ----
    const buildLeg = (side: -1 | 1) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.105, -0.02, 0);

      const hipCap = new THREE.Mesh(this.sharedGeos.jointCap, uniformMat);
      hipCap.scale.setScalar(1.3);
      const thigh = new THREE.Mesh(this.sharedGeos.thigh, uniformMat);
      thigh.position.y = -0.22;
      registerHitbox(thigh, 'limb');

      const knee = new THREE.Group();
      knee.position.set(0, -0.44, 0);
      const kneeCap = new THREE.Mesh(this.sharedGeos.jointCap, uniformMat);
      const pad = new THREE.Mesh(this.sharedGeos.kneePad, this.darkGearMat);
      pad.position.set(0, -0.04, 0.008);
      const shin = new THREE.Mesh(this.sharedGeos.shin, uniformMat);
      shin.position.y = -0.21;
      registerHitbox(shin, 'limb');

      const boot = new THREE.Mesh(this.sharedGeos.boot, this.bootMat);
      boot.position.set(0, -0.41, 0.018);
      boot.castShadow = true;

      knee.add(kneeCap, pad, shin, boot);
      hip.add(hipCap, thigh, knee);
      pelvisGroup.add(hip);
      return { hip, knee };
    };

    const leftLeg = buildLeg(-1);
    const rightLeg = buildLeg(1);

    // ---- SCULPTED TORSO, BEVELED SAPI ARMOR PLATES, COLLAR & BACKPACK ----
    const torsoPivot = new THREE.Group();
    torsoPivot.position.y = 0.08;
    pelvisGroup.add(torsoPivot);

    const torsoCore = new THREE.Mesh(this.sharedGeos.torsoUpper, uniformMat);
    torsoCore.position.y = 0.24;
    torsoCore.scale.set(1.06, 1.0, 0.72);
    registerHitbox(torsoCore, 'torso');

    const collar = new THREE.Mesh(this.sharedGeos.collarGuard, vestMat);
    collar.position.set(0, 0.49, 0);

    const plateFront = new THREE.Mesh(this.sharedGeos.plateFront, vestMat);
    plateFront.position.set(0, 0.28, 0.115);
    registerHitbox(plateFront, 'torso');

    const plateBack = new THREE.Mesh(this.sharedGeos.plateBack, vestMat);
    plateBack.position.set(0, 0.28, -0.105);
    registerHitbox(plateBack, 'torso');

    for (const px of [-0.075, 0, 0.075]) {
      const pouch = new THREE.Mesh(this.sharedGeos.magPouch, this.darkGearMat);
      pouch.position.set(px, 0.2, 0.165);
      torsoPivot.add(pouch);
    }

    const backpack = new THREE.Mesh(this.sharedGeos.backpack, this.darkGearMat);
    backpack.position.set(0, 0.27, -0.195);
    const packFlap = new THREE.Mesh(this.sharedGeos.packFlap, vestMat);
    packFlap.position.set(0, 0.41, -0.195);
    const canteen = new THREE.Mesh(this.sharedGeos.canteen, uniformMat);
    canteen.position.set(0.115, 0.2, -0.18);
    const antenna = new THREE.Mesh(this.sharedGeos.antenna, this.darkGearMat);
    antenna.position.set(-0.085, 0.44, -0.22);

    torsoPivot.add(torsoCore, collar, plateFront, plateBack, backpack, packFlap, canteen, antenna);

    // ---- SCULPTED HUMAN HEAD, CURVED VISOR & BALLISTIC HELMET ----
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.56, 0.01);
    torsoPivot.add(headGroup);

    const neck = new THREE.Mesh(this.sharedGeos.neck, skinMat);
    neck.position.y = -0.015;
    const jaw = new THREE.Mesh(this.sharedGeos.jawLathe, skinMat);
    jaw.position.set(0, 0.055, 0.008);
    jaw.scale.set(0.9, 1.0, 1.04);
    registerHitbox(jaw, 'head');

    const cranium = new THREE.Mesh(this.sharedGeos.cranium, skinMat);
    cranium.position.set(0, 0.118, 0);
    cranium.scale.set(0.92, 1.08, 1.02);
    registerHitbox(cranium, 'head');

    const brow = new THREE.Mesh(this.sharedGeos.brow, skinMat);
    brow.position.set(0, 0.122, 0.005);
    const nose = new THREE.Mesh(this.sharedGeos.nose, skinMat);
    nose.position.set(0, 0.098, 0.1);

    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(this.sharedGeos.cheekbone, skinMat);
      cheek.position.set(side * 0.048, 0.088, 0.072);
      cheek.rotation.set(0.25, 0, side * 0.4);
      const ear = new THREE.Mesh(this.sharedGeos.ear, skinMat);
      ear.position.set(side * 0.098, 0.105, -0.005);
      ear.scale.set(0.5, 1.0, 0.75);
      headGroup.add(cheek, ear);
    }

    for (const ex of [-0.036, 0.036]) {
      const ew = new THREE.Mesh(this.sharedGeos.eyeWhite, this.eyeWhiteMat);
      ew.position.set(ex, 0.118, 0.092);
      const ep = new THREE.Mesh(this.sharedGeos.eyePupil, this.eyePupilMat);
      ep.position.set(ex, 0.118, 0.103);
      headGroup.add(ew, ep);
    }

    const helmet = new THREE.Mesh(this.sharedGeos.helmetDome, helmetMat);
    helmet.position.set(0, 0.112, -0.006);
    helmet.scale.set(0.96, 1.02, 1.05);
    registerHitbox(helmet, 'head');

    const railL = new THREE.Mesh(this.sharedGeos.helmetRail, this.darkGearMat);
    railL.position.set(-0.114, 0.142, 0.01);
    const railR = new THREE.Mesh(this.sharedGeos.helmetRail, this.darkGearMat);
    railR.position.set(0.114, 0.142, 0.01);
    const nvgMount = new THREE.Mesh(this.sharedGeos.nvgMount, this.darkGearMat);
    nvgMount.position.set(0, 0.165, 0.125);

    const goggles = new THREE.Mesh(this.sharedGeos.goggleVisor, goggleMat);
    goggles.position.set(0, 0.1, 0.002);

    headGroup.add(neck, jaw, cranium, brow, nose, helmet, railL, railR, nvgMount, goggles);

    if (archetype === 'trooper') {
      const cupL = new THREE.Mesh(this.sharedGeos.headsetCup, this.darkGearMat);
      cupL.position.set(-0.105, 0.1, 0);
      const cupR = new THREE.Mesh(this.sharedGeos.headsetCup, this.darkGearMat);
      cupR.position.set(0.105, 0.1, 0);
      const mic = new THREE.Mesh(this.sharedGeos.micBoom, this.darkGearMat);
      headGroup.add(cupL, cupR, mic);
    } else if (archetype === 'striker') {
      const balaclava = new THREE.Mesh(this.sharedGeos.balaclava, this.balaclavaMat);
      balaclava.position.set(0, 0.048, 0.008);
      headGroup.add(balaclava);
    } else if (archetype === 'juggernaut') {
      const mandible = new THREE.Mesh(this.sharedGeos.mandible, helmetMat);
      mandible.position.set(0, 0.02, 0.004);
      headGroup.add(mandible);
    }

    // ---- ARTICULATED ARMS WITH JOINT CAPS, CURLED GLOVED FINGERS & SCULPTED RIFLE ----
    const buildGlove = (thumbSide: 1 | -1) => {
      const g = new THREE.Group();
      const palm = new THREE.Mesh(this.sharedGeos.glovePalm, this.darkGearMat);
      g.add(palm);
      for (let f = 0; f < 3; f++) {
        const finger = new THREE.Mesh(this.sharedGeos.gloveFinger, this.darkGearMat);
        finger.position.set(thumbSide * -0.02, 0.01 - f * 0.012, 0.015);
        finger.rotation.z = thumbSide * 0.7;
        g.add(finger);
      }
      return g;
    };

    const leftShoulder = new THREE.Group();
    leftShoulder.position.set(-0.22, 0.44, 0.01);
    const lPauldron = new THREE.Mesh(this.sharedGeos.pauldron, vestMat);
    const lUpper = new THREE.Mesh(this.sharedGeos.upperArm, uniformMat);
    lUpper.position.y = -0.14;
    registerHitbox(lUpper, 'limb');
    const leftElbow = new THREE.Group();
    leftElbow.position.y = -0.28;
    const lElbowCap = new THREE.Mesh(this.sharedGeos.jointCap, uniformMat);
    const lFore = new THREE.Mesh(this.sharedGeos.forearm, uniformMat);
    lFore.position.y = -0.13;
    registerHitbox(lFore, 'limb');
    const lGlove = buildGlove(1);
    lGlove.position.y = -0.27;
    leftElbow.add(lElbowCap, lFore, lGlove);
    leftShoulder.add(lPauldron, lUpper, leftElbow);
    leftShoulder.rotation.set(-0.78, -0.38, 0.15);
    leftElbow.rotation.set(-0.72, 0.25, 0);

    const rightShoulder = new THREE.Group();
    rightShoulder.position.set(0.22, 0.44, 0.01);
    const rPauldron = new THREE.Mesh(this.sharedGeos.pauldron, vestMat);
    const rUpper = new THREE.Mesh(this.sharedGeos.upperArm, uniformMat);
    rUpper.position.y = -0.14;
    registerHitbox(rUpper, 'limb');
    const rightElbow = new THREE.Group();
    rightElbow.position.y = -0.28;
    const rElbowCap = new THREE.Mesh(this.sharedGeos.jointCap, uniformMat);
    const rFore = new THREE.Mesh(this.sharedGeos.forearm, uniformMat);
    rFore.position.y = -0.13;
    registerHitbox(rFore, 'limb');
    const rGlove = buildGlove(-1);
    rGlove.position.y = -0.27;

    const rifleGroup = new THREE.Group();
    rifleGroup.position.set(-0.05, -0.28, 0.14);
    rifleGroup.rotation.x = 1.48;
    const rBody = new THREE.Mesh(this.sharedGeos.rifleBody, this.enemyRifleBodyMat);
    const rBarrel = new THREE.Mesh(this.sharedGeos.rifleBarrel, this.enemyRifleBarrelMat);
    rBarrel.position.set(0, 0.012, 0.22);
    const rMag = new THREE.Mesh(this.sharedGeos.rifleMag, this.enemyRifleMagMat);
    rMag.position.set(0, -0.025, 0.06);
    const muzzleAnchor = new THREE.Object3D();
    muzzleAnchor.position.set(0, 0.012, 0.5);
    rifleGroup.add(rBody, rBarrel, rMag, muzzleAnchor);

    rightElbow.add(rElbowCap, rFore, rGlove, rifleGroup);
    rightShoulder.add(rPauldron, rUpper, rightElbow);
    rightShoulder.rotation.set(-0.92, 0.12, -0.06);
    rightElbow.rotation.set(-0.56, 0, 0);

    torsoPivot.add(leftShoulder, rightShoulder);

    const startY = getSurfaceFloorHeight(x, z, 1.0, ENEMY_RADIUS, this.world.obstacles, this.world.ramps);
    group.position.set(x, startY, z);
    this.scene.add(group);

    const laserGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 1),
    ]);
    const laserMat = new THREE.LineBasicMaterial({
      color: spec.accentHex,
      transparent: true,
      opacity: 0.78,
    });
    const laserLine = new THREE.Line(laserGeo, laserMat);
    laserLine.visible = false;
    this.scene.add(laserLine);

    const role = getEnemyRole(archetype, id);
    this.actors.push({
      id,
      archetype,
      role,
      group,
      bodyParts,
      pelvisGroup,
      torsoPivot,
      headGroup,
      leftShoulder,
      leftElbow,
      rightShoulder,
      rightElbow,
      leftHip: leftLeg.hip,
      leftKnee: leftLeg.knee,
      rightHip: rightLeg.hip,
      rightKnee: rightLeg.knee,
      muzzleAnchor,
      laserLine,
      laserMat,
      vestMat,
      hp: spec.maxHp,
      maxHp: spec.maxHp,
      state: 'patrol',
      hasAttackToken: false,
      waypointIndex: id % Math.max(1, this.world.waypoints.length),
      strafeDir: id % 2 === 0 ? 1 : -1,
      strafeTimer: 1.4,
      alertMemory: 0,
      attackCooldown: 0.7 + (id % 4) * 0.35,
      telegraphTimer: 0,
      burstRemaining: 0,
      burstTimer: 0,
      hitFlashTimer: 0,
      flinchTimer: 0,
      koTimer: 0,
      koRollDir: id % 2 === 0 ? 1 : -1,
      walkCycle: 0,
      breathPhase: id * 1.1,
      speedMult,
      accuracy,
    });
  }

  applyDamage(
    enemyId: number,
    damage: number,
    _isCrit: boolean,
  ): { killed: boolean; archetype: EnemyArchetype; position: THREE.Vector3 } | null {
    const actor = this.actors.find((a) => a.id === enemyId);
    if (!actor || actor.state === 'ko') return null;

    actor.hp -= damage;
    actor.hitFlashTimer = 0.065;
    actor.flinchTimer = 0.22;
    actor.vestMat.emissive.setHex(0xffffff);
    actor.vestMat.emissiveIntensity = 1.2;
    actor.alertMemory = 5.0;
    if (actor.state === 'patrol') actor.state = 'alert';

    if (actor.hp <= 0) {
      actor.state = 'ko';
      actor.koTimer = 0.55;
      actor.laserLine.visible = false;
      if (actor.hasAttackToken) {
        actor.hasAttackToken = false;
        this.activeTokenCount = Math.max(0, this.activeTokenCount - 1);
      }
      for (const part of actor.bodyParts) {
        const idx = this.hitboxMeshes.indexOf(part);
        if (idx >= 0) this.hitboxMeshes.splice(idx, 1);
      }
      return {
        killed: true,
        archetype: actor.archetype,
        position: actor.group.position.clone(),
      };
    }

    return {
      killed: false,
      archetype: actor.archetype,
      position: actor.group.position.clone(),
    };
  }

  applyExplosionDamage(
    origin: THREE.Vector3,
    radius: number,
    maxDamage: number,
  ): Array<{ killed: boolean; archetype: EnemyArchetype; position: THREE.Vector3 }> {
    const outcomes: Array<{ killed: boolean; archetype: EnemyArchetype; position: THREE.Vector3 }> = [];
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i];
      if (a.state === 'ko') continue;
      const dist = Math.hypot(
        a.group.position.x - origin.x,
        a.group.position.y + 0.9 - origin.y,
        a.group.position.z - origin.z,
      );
      const dmg = computeExplosionSplashDamage(dist, radius, maxDamage);
      if (dmg > 0) {
        const res = this.applyDamage(a.id, dmg, false);
        if (res) outcomes.push(res);
      }
    }
    return outcomes;
  }

  getRadarUnits(): Array<{ id: number; x: number; z: number; role: EnemyRole; firing: boolean }> {
    const out: Array<{ id: number; x: number; z: number; role: EnemyRole; firing: boolean }> = [];
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i];
      if (a.state === 'ko') continue;
      out.push({
        id: a.id,
        x: a.group.position.x,
        z: a.group.position.z,
        role: a.role,
        firing: a.state === 'attack',
      });
    }
    return out;
  }

  private checkLineOfSight(fromPos: THREE.Vector3, targetPos: THREE.Vector3): boolean {
    _eyeOrigin.set(fromPos.x, fromPos.y + 1.55, fromPos.z);
    _targetPos.set(targetPos.x, targetPos.y + 1.35, targetPos.z);
    _toPlayer.subVectors(_targetPos, _eyeOrigin);
    const dist = _toPlayer.length();
    if (dist < 0.5) return true;
    _toPlayer.divideScalar(dist);

    _raycaster.set(_eyeOrigin, _toPlayer);
    _raycaster.near = 0.2;
    _raycaster.far = dist - 0.35;
    const hits = _raycaster.intersectObjects(this.world.raycastTargets, false);
    return hits.length === 0;
  }

  update(
    dt: number,
    player: Player,
    isTitleDemo: boolean,
    onPlayerHit: (dmg: number, attackerPos: THREE.Vector3) => void,
  ): void {
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i];
      const spec = ENEMY_SPECS[a.archetype];

      if (a.hitFlashTimer > 0) {
        a.hitFlashTimer -= dt;
        if (a.hitFlashTimer <= 0) {
          a.vestMat.emissive.setHex(0x000000);
          a.vestMat.emissiveIntensity = 0;
        }
      }

      if (a.flinchTimer > 0) {
        a.flinchTimer = Math.max(0, a.flinchTimer - dt);
      }

      if (a.state === 'ko') {
        a.koTimer -= dt;
        const t = 1 - Math.max(0, a.koTimer / 0.55);
        const ease = 1 - Math.pow(1 - t, 2);
        a.group.rotation.x = -ease * (Math.PI / 2.05);
        a.group.rotation.z = ease * 0.28 * a.koRollDir;
        a.pelvisGroup.position.y = 0.92 - ease * 0.52;
        a.leftKnee.rotation.x = ease * 1.1;
        a.rightKnee.rotation.x = ease * 0.8;
        a.leftShoulder.rotation.set(-0.2 - ease * 0.9, -0.7, -0.6 * ease);
        a.rightShoulder.rotation.set(-0.2 - ease * 0.7, 0.6, 0.7 * ease);
        a.headGroup.rotation.x = ease * 0.45;

        if (a.koTimer <= 0) {
          if (Math.random() < 0.72) {
            const dropKind = player.health < 70 && Math.random() < 0.55 ? 'health' : 'ammo';
            this.world.spawnPickup(a.group.position, dropKind);
          }
          this.scene.remove(a.group);
          this.scene.remove(a.laserLine);
          a.laserLine.geometry.dispose();
          a.laserMat.dispose();
          a.vestMat.dispose();
          this.actors.splice(i, 1);
        }
        continue;
      }

      a.breathPhase += dt * 2.3;
      const breathOffset = Math.sin(a.breathPhase) * 0.025;
      const flinchPitch = a.flinchTimer > 0 ? Math.sin((a.flinchTimer / 0.22) * Math.PI) * -0.32 : 0;

      if (isTitleDemo) {
        this.stepPatrol(a, spec.speed * 0.7, dt);
        a.torsoPivot.rotation.x = breathOffset;
        continue;
      }

      a.attackCooldown = Math.max(0, a.attackCooldown - dt);
      a.alertMemory = Math.max(0, a.alertMemory - dt);

      const distToPlayer = Math.hypot(
        player.position.x - a.group.position.x,
        player.position.z - a.group.position.z,
      );
      const hasLOS = distToPlayer < 48 && this.checkLineOfSight(a.group.position, player.position);
      if (hasLOS) a.alertMemory = 4.0;

      const rolePreferredRange =
        a.role === 'marksman'
          ? Math.max(spec.preferredRange, 26)
          : a.role === 'rusher'
            ? Math.min(spec.preferredRange, 9)
            : spec.preferredRange;

      const transition = evaluateEnemyTransition({
        currentState: a.state,
        hasLineOfSight: hasLOS,
        distanceToPlayer: distToPlayer,
        preferredRange: rolePreferredRange,
        attackCooldownRemaining: a.attackCooldown,
        hasAttackToken: a.hasAttackToken,
        canAcquireToken: this.activeTokenCount < MAX_ATTACK_TOKENS,
        alertMemoryTimer: a.alertMemory,
      });

      if (transition.shouldAcquireToken) {
        a.hasAttackToken = true;
        this.activeTokenCount++;
        a.telegraphTimer = spec.telegraphTime;
        a.burstRemaining = spec.burstCount;
        a.burstTimer = 0;
        this.sound.playTelegraph();
      } else if (transition.shouldReleaseToken && a.hasAttackToken) {
        a.hasAttackToken = false;
        this.activeTokenCount = Math.max(0, this.activeTokenCount - 1);
        a.laserLine.visible = false;
      }
      a.state = transition.nextState;

      if (a.state === 'patrol') {
        a.laserLine.visible = false;
        a.torsoPivot.rotation.x = THREE.MathUtils.damp(a.torsoPivot.rotation.x, breathOffset + flinchPitch, 10, dt);
        a.torsoPivot.rotation.y = THREE.MathUtils.damp(a.torsoPivot.rotation.y, 0, 8, dt);
        this.stepPatrol(a, spec.speed * a.speedMult * 0.65, dt);
      } else if (a.state === 'alert') {
        if (a.role === 'marksman' && hasLOS && distToPlayer < 42) {
          a.muzzleAnchor.getWorldPosition(_muzzlePos);
          const posAttr = a.laserLine.geometry.attributes.position as THREE.BufferAttribute;
          posAttr.setXYZ(0, _muzzlePos.x, _muzzlePos.y, _muzzlePos.z);
          posAttr.setXYZ(1, player.position.x, player.position.y + 1.28, player.position.z);
          posAttr.needsUpdate = true;
          a.laserLine.visible = true;
          a.laserMat.opacity = 0.28;
        } else {
          a.laserLine.visible = false;
        }
        this.facePoint(a, player.position.x, player.position.z, dt);
        a.torsoPivot.rotation.x = THREE.MathUtils.damp(a.torsoPivot.rotation.x, 0.05 + flinchPitch, 10, dt);
        a.torsoPivot.rotation.y = THREE.MathUtils.damp(a.torsoPivot.rotation.y, -0.14, 8, dt);
        this.stepChaseStrafe(a, player.position, rolePreferredRange, spec.speed * a.speedMult, dt);
      } else if (a.state === 'attack') {
        this.facePoint(a, player.position.x, player.position.z, dt);
        a.leftHip.rotation.x = THREE.MathUtils.damp(a.leftHip.rotation.x, -0.12, 10, dt);
        a.rightHip.rotation.x = THREE.MathUtils.damp(a.rightHip.rotation.x, 0.12, 10, dt);
        a.leftKnee.rotation.x = THREE.MathUtils.damp(a.leftKnee.rotation.x, 0.15, 10, dt);
        a.rightKnee.rotation.x = THREE.MathUtils.damp(a.rightKnee.rotation.x, 0.1, 10, dt);
        a.torsoPivot.rotation.x = THREE.MathUtils.damp(a.torsoPivot.rotation.x, 0.08 + flinchPitch, 10, dt);
        a.torsoPivot.rotation.y = THREE.MathUtils.damp(a.torsoPivot.rotation.y, -0.18, 10, dt);
        this.stepAttack(a, spec, player, dt, onPlayerHit);
      }
    }
  }

  private stepPatrol(a: EnemyActor, speed: number, dt: number): void {
    if (this.world.waypoints.length === 0) return;
    const wp = this.world.waypoints[a.waypointIndex];
    const dx = wp.x - a.group.position.x;
    const dz = wp.z - a.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.5) {
      a.waypointIndex = (a.waypointIndex + 1 + (a.id % 2)) % this.world.waypoints.length;
      return;
    }
    this.facePoint(a, wp.x, wp.z, dt);
    this.moveWithCollision(a, (dx / dist) * speed, (dz / dist) * speed, dt);
  }

  private stepChaseStrafe(
    a: EnemyActor,
    playerPos: THREE.Vector3,
    preferredRange: number,
    speed: number,
    dt: number,
  ): void {
    a.strafeTimer -= dt;
    if (a.strafeTimer <= 0) {
      a.strafeDir *= -1;
      a.strafeTimer = a.role === 'rusher' ? 0.9 + Math.random() * 0.9 : 1.3 + Math.random() * 1.3;
    }

    _moveVec.set(playerPos.x - a.group.position.x, 0, playerPos.z - a.group.position.z);
    const dist = _moveVec.length();
    if (dist < 0.001) return;
    _moveVec.divideScalar(dist);
    _strafeVec.crossVectors(_moveVec, _up).multiplyScalar(a.strafeDir);

    let advanceFactor = 0.15;
    let strafeFactor = 0.6;
    let roleSpeed = speed;

    if (a.role === 'rusher') {
      advanceFactor = dist > preferredRange ? 1.05 : -0.25;
      strafeFactor = 0.98;
      roleSpeed = speed * 1.18;
    } else if (a.role === 'marksman') {
      advanceFactor = dist > preferredRange + 3 ? 0.6 : dist < preferredRange - 4 ? -0.7 : 0.05;
      strafeFactor = 0.42;
    } else {
      advanceFactor = dist > preferredRange + 2.5 ? 0.9 : dist < preferredRange - 3 ? -0.45 : 0.15;
      strafeFactor = 0.68;
    }

    const vx = (_moveVec.x * advanceFactor + _strafeVec.x * strafeFactor) * roleSpeed;
    const vz = (_moveVec.z * advanceFactor + _strafeVec.z * strafeFactor) * roleSpeed;
    this.moveWithCollision(a, vx, vz, dt);
  }

  private stepAttack(
    a: EnemyActor,
    spec: (typeof ENEMY_SPECS)[EnemyArchetype],
    player: Player,
    dt: number,
    onPlayerHit: (dmg: number, attackerPos: THREE.Vector3) => void,
  ): void {
    a.muzzleAnchor.getWorldPosition(_muzzlePos);

    if (a.telegraphTimer > 0) {
      a.telegraphTimer -= dt;
      const posAttr = a.laserLine.geometry.attributes.position as THREE.BufferAttribute;
      posAttr.setXYZ(0, _muzzlePos.x, _muzzlePos.y, _muzzlePos.z);
      posAttr.setXYZ(1, player.position.x, player.position.y + 1.28, player.position.z);
      posAttr.needsUpdate = true;
      a.laserLine.visible = true;
      a.laserMat.opacity = 0.45 + 0.45 * Math.sin(a.telegraphTimer * 26);
      return;
    }

    a.laserLine.visible = false;
    a.burstTimer -= dt;
    if (a.burstTimer <= 0 && a.burstRemaining > 0) {
      a.burstRemaining--;
      a.burstTimer = spec.burstInterval;
      this.fireEnemyShot(a, spec.damagePerShot, player, onPlayerHit);
    }

    if (a.burstRemaining <= 0) {
      a.state = 'alert';
      a.attackCooldown = spec.attackCooldown;
      if (a.hasAttackToken) {
        a.hasAttackToken = false;
        this.activeTokenCount = Math.max(0, this.activeTokenCount - 1);
      }
    }
  }

  private fireEnemyShot(
    a: EnemyActor,
    damage: number,
    player: Player,
    onPlayerHit: (dmg: number, attackerPos: THREE.Vector3) => void,
  ): void {
    const distToPlayer = Math.hypot(
      player.position.x - a.group.position.x,
      player.position.z - a.group.position.z,
    );
    this.sound.playGunshot(a.archetype === 'striker' ? 'pistol' : 'rifle', true, distToPlayer);
    a.muzzleAnchor.getWorldPosition(_muzzlePos);
    _targetPos.set(
      player.position.x,
      player.position.y + (player.isSliding ? 0.65 : player.isCrouching ? 0.85 : 1.32),
      player.position.z,
    );

    const roleAcc = a.role === 'marksman' ? Math.min(0.92, a.accuracy + 0.12) : a.accuracy;
    const inaccuracy = (1 - roleAcc) * 2.4;
    _targetPos.x += (Math.random() - 0.5) * inaccuracy;
    _targetPos.y += (Math.random() - 0.5) * inaccuracy * 0.65;
    _targetPos.z += (Math.random() - 0.5) * inaccuracy;

    _toPlayer.subVectors(_targetPos, _muzzlePos);
    const dist = _toPlayer.length();
    _toPlayer.divideScalar(dist);

    _raycaster.set(_muzzlePos, _toPlayer);
    _raycaster.near = 0.2;
    _raycaster.far = dist + 2;
    const worldHits = _raycaster.intersectObjects(this.world.raycastTargets, false);
    const wallDist = worldHits[0] ? worldHits[0].distance : Infinity;

    if (wallDist < dist - 0.4) {
      this.world.spawnTracer(_muzzlePos, worldHits[0].point);
      this.world.spawnSparks(worldHits[0].point, _toPlayer.clone().negate(), 4);
      return;
    }

    this.world.spawnTracer(_muzzlePos, _targetPos);
    const missOffset = Math.hypot(_targetPos.x - player.position.x, _targetPos.z - player.position.z);
    if (missOffset < 0.65) {
      onPlayerHit(damage, a.group.position);
    }
  }

  private facePoint(a: EnemyActor, tx: number, tz: number, dt: number): void {
    const targetYaw = Math.atan2(tx - a.group.position.x, tz - a.group.position.z);
    let diff = targetYaw - a.group.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    a.group.rotation.y += diff * (1 - Math.exp(-10 * dt));
  }

  private moveWithCollision(a: EnemyActor, vx: number, vz: number, dt: number): void {
    const nextX = a.group.position.x + vx * dt;
    const nextZ = a.group.position.z + vz * dt;
    const prevY = a.group.position.y;
    const probeY =
      getSurfaceFloorHeight(nextX, nextZ, prevY, ENEMY_RADIUS, this.world.obstacles, this.world.ramps) + 0.55;

    const resolved = resolveCircleAABBs(
      { x: nextX, y: probeY, z: nextZ },
      ENEMY_RADIUS,
      1.3,
      this.world.obstacles,
    );
    const moved = Math.hypot(resolved.x - a.group.position.x, resolved.z - a.group.position.z);
    a.group.position.x = resolved.x;
    a.group.position.z = resolved.z;

    const groundY = getSurfaceFloorHeight(
      resolved.x,
      resolved.z,
      prevY,
      ENEMY_RADIUS,
      this.world.obstacles,
      this.world.ramps,
    );
    a.group.position.y = THREE.MathUtils.damp(a.group.position.y, groundY, 12, dt);

    if (resolved.collided) {
      a.strafeDir *= -1;
    }

    a.walkCycle += moved * 3.6;
    const swing = Math.sin(a.walkCycle) * 0.58;
    a.leftHip.rotation.x = swing;
    a.rightHip.rotation.x = -swing;
    a.leftKnee.rotation.x = Math.max(0.08, Math.sin(a.walkCycle + Math.PI * 0.6) * 0.65);
    a.rightKnee.rotation.x = Math.max(0.08, Math.sin(a.walkCycle + Math.PI * 1.6) * 0.65);
    a.pelvisGroup.position.y = 0.92 + Math.abs(Math.cos(a.walkCycle)) * 0.032;
  }

  dispose(): void {
    this.clearAll();
    this.texLib.dispose();
    Object.values(this.sharedGeos).forEach((g) => g.dispose());
    this.shadowMat.dispose();
    this.darkGearMat.dispose();
    this.bootMat.dispose();
    this.balaclavaMat.dispose();
    this.eyeWhiteMat.dispose();
    this.eyePupilMat.dispose();
    this.skinMats.forEach((m) => m.dispose());
    Object.values(this.uniformMats).forEach((m) => m.dispose());
    Object.values(this.helmetMats).forEach((m) => m.dispose());
    this.enemyRifleBodyMat.dispose();
    this.enemyRifleBarrelMat.dispose();
    this.enemyRifleMagMat.dispose();
  }
}
