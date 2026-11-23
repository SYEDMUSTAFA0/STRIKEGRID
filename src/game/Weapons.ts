import * as THREE from 'three';
import {
  FRAG_GRENADE_SPEC,
  WEAPON_ORDER,
  WEAPON_SPECS,
  computeHitDamage,
  computeWeaponSpread,
  getNextWeaponId,
  getRecoilPatternStep,
} from './rules';
import { ProceduralTextureLibrary } from './textures';
import type { WeaponId, WeaponSkinId } from './types';
import type { SoundEngine } from './Audio';
import type { PropDamageOutcome, World } from './World';
import type { Player } from './Player';

export interface WeaponHitResult {
  enemyId: number;
  zone: 'head' | 'torso' | 'limb';
  damage: number;
  isCrit: boolean;
  isMelee: boolean;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

const _raycaster = new THREE.Raycaster();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzleWorld = new THREE.Vector3();
const _ejectWorld = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _spreadOffset = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _right = new THREE.Vector3();

interface WeaponRuntimeState {
  mag: number;
  reserve: number;
}

function makeBeveledShapeGeo(
  pts: ReadonlyArray<readonly [number, number]>,
  depth: number,
  bevelThickness = 0.003,
  bevelSize = 0.003,
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
  const uvAttr = geo.attributes.uv;
  if (uvAttr) {
    for (let i = 0; i < uvAttr.count; i++) {
      uvAttr.setXY(i, uvAttr.getX(i) * 4.2, uvAttr.getY(i) * 4.2);
    }
    uvAttr.needsUpdate = true;
  }
  geo.computeVertexNormals();
  return geo;
}

export class Weapons {
  public activeId: WeaponId = 'rifle';
  public currentSkin: WeaponSkinId = 'standard';
  public isReloading = false;
  public reloadElapsed = 0;
  public grenades = FRAG_GRENADE_SPEC.startCount;
  public readonly maxGrenades = FRAG_GRENADE_SPEC.maxCount;
  public grenadeThrowing = false;

  private readonly state: Record<WeaponId, WeaponRuntimeState> = {
    rifle: { mag: WEAPON_SPECS.rifle.magSize, reserve: WEAPON_SPECS.rifle.startReserve },
    pistol: { mag: WEAPON_SPECS.pistol.magSize, reserve: WEAPON_SPECS.pistol.startReserve },
    shotgun: { mag: WEAPON_SPECS.shotgun.magSize, reserve: WEAPON_SPECS.shotgun.startReserve },
    marksman: { mag: WEAPON_SPECS.marksman.magSize, reserve: WEAPON_SPECS.marksman.startReserve },
    knife: { mag: 1, reserve: 0 },
    smg: { mag: WEAPON_SPECS.smg.magSize, reserve: WEAPON_SPECS.smg.startReserve },
    lmg: { mag: WEAPON_SPECS.lmg.magSize, reserve: WEAPON_SPECS.lmg.startReserve },
    deagle: { mag: WEAPON_SPECS.deagle.magSize, reserve: WEAPON_SPECS.deagle.startReserve },
  };

  private readonly rigGroup = new THREE.Group();
  private readonly rifleGroup = new THREE.Group();
  private readonly pistolGroup = new THREE.Group();
  private readonly shotgunGroup = new THREE.Group();
  private readonly marksmanGroup = new THREE.Group();
  private readonly knifeGroup = new THREE.Group();
  private readonly smgGroup = new THREE.Group();
  private readonly lmgGroup = new THREE.Group();
  private readonly deagleGroup = new THREE.Group();
  private readonly grenadeVmGroup = new THREE.Group();

  private readonly leftArmGroup = new THREE.Group();
  private readonly leftTwoHandPose = new THREE.Group();
  private readonly leftPistolPose = new THREE.Group();
  private readonly leftKnifePose = new THREE.Group();
  private readonly rightArmGroup = new THREE.Group();

  private rifleMagMesh!: THREE.Mesh;
  private pistolMagMesh!: THREE.Mesh;
  private marksmanMagMesh!: THREE.Mesh;
  private smgMagMesh!: THREE.Mesh;
  private lmgMagMesh!: THREE.Mesh;
  private deagleMagMesh!: THREE.Mesh;
  private rifleBoltMesh!: THREE.Mesh;
  private pistolSlideMesh!: THREE.Mesh;
  private marksmanBoltMesh!: THREE.Mesh;
  private smgBoltMesh!: THREE.Mesh;
  private lmgBoltMesh!: THREE.Mesh;
  private deagleSlideMesh!: THREE.Mesh;
  private shotgunPumpGroup!: THREE.Group;

  private rifleMuzzleAnchor = new THREE.Object3D();
  private pistolMuzzleAnchor = new THREE.Object3D();
  private shotgunMuzzleAnchor = new THREE.Object3D();
  private marksmanMuzzleAnchor = new THREE.Object3D();
  private smgMuzzleAnchor = new THREE.Object3D();
  private lmgMuzzleAnchor = new THREE.Object3D();
  private deagleMuzzleAnchor = new THREE.Object3D();
  private rifleEjectAnchor = new THREE.Object3D();
  private pistolEjectAnchor = new THREE.Object3D();
  private shotgunEjectAnchor = new THREE.Object3D();
  private marksmanEjectAnchor = new THREE.Object3D();
  private smgEjectAnchor = new THREE.Object3D();
  private lmgEjectAnchor = new THREE.Object3D();
  private deagleEjectAnchor = new THREE.Object3D();

  private receiverMat!: THREE.MeshStandardMaterial;
  private polymerMat!: THREE.MeshStandardMaterial;
  private railMat!: THREE.MeshStandardMaterial;
  private barrelMat!: THREE.MeshStandardMaterial;
  private bladeMat!: THREE.MeshStandardMaterial;
  private readonly texLib: ProceduralTextureLibrary;
  private readonly arcticCamoTex: ReturnType<ProceduralTextureLibrary['createArcticCamoSet']>;
  private readonly carbonTex: ReturnType<ProceduralTextureLibrary['createCarbonFiberSet']>;

  private readonly muzzleLight = new THREE.PointLight(0xffb85c, 0, 7.5, 2);
  private readonly muzzleFlashMesh: THREE.Group;
  private muzzleFlashTimer = 0;

  private readonly showcaseGroup = new THREE.Group();
  private readonly showcaseSpinGroup = new THREE.Group();
  private readonly showcaseModels: Partial<Record<WeaponId, THREE.Group>> = {};
  private showcaseWeaponId: WeaponId = 'rifle';
  private readonly showcaseKeyLight = new THREE.PointLight(0xfff1dc, 1.35, 2.8, 2);
  private readonly showcaseRimLight = new THREE.PointLight(0x7dd3fc, 0.85, 2.8, 2);

  private fireCooldown = 0;
  private pumpTimer = 0;
  private meleeSwingTimer = 0;
  private meleeHeavySwing = false;
  private quickMeleeActive = false;
  private grenadeThrowTimer = 0;
  private grenadeSpawnedInThrow = false;
  private grenadeThrowCallback: ((origin: THREE.Vector3, velocity: THREE.Vector3) => void) | null = null;

  private kickOffsetZ = 0;
  private kickRotX = 0;
  private boltKick = 0;
  private heatLevel = 0;
  private shotStreak = 0;
  private streakResetTimer = 0;
  private swayX = 0;
  private swayY = 0;
  private reloadInsertPlayed = false;
  private switchAnim = 0;
  private readonly disposables: Array<{ dispose: () => void }> = [];

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly world: World,
    private readonly sound: SoundEngine,
    maxAnisotropy = 4,
    initialSkin: WeaponSkinId = 'standard',
  ) {
    this.texLib = new ProceduralTextureLibrary(maxAnisotropy);
    this.arcticCamoTex = this.texLib.createArcticCamoSet();
    this.carbonTex = this.texLib.createCarbonFiberSet();

    this.initMaterials();
    this.buildRifleModel();
    this.buildPistolModel();
    this.buildShotgunModel();
    this.buildMarksmanModel();
    this.buildKnifeModel();
    this.buildSmgModel();
    this.buildLmgModel();
    this.buildDeagleModel();
    this.buildGrenadeViewModel();
    this.buildFirstPersonArms();
    this.buildShowcaseRig();
    this.setSkin(initialSkin);

    this.muzzleFlashMesh = this.buildVolumetricMuzzleFlash();
    this.muzzleFlashMesh.visible = false;

    this.rigGroup.add(
      this.rifleGroup,
      this.pistolGroup,
      this.shotgunGroup,
      this.marksmanGroup,
      this.knifeGroup,
      this.smgGroup,
      this.lmgGroup,
      this.deagleGroup,
      this.grenadeVmGroup,
      this.leftArmGroup,
      this.rightArmGroup,
      this.muzzleLight,
      this.muzzleFlashMesh,
    );
    this.syncWeaponVisibility();
    this.camera.add(this.rigGroup);
    this.camera.add(this.showcaseGroup);
  }

  private initMaterials(): void {
    this.receiverMat = new THREE.MeshStandardMaterial({
      color: 0x2a2f37,
      roughness: 0.34,
      metalness: 0.86,
    });
    this.polymerMat = new THREE.MeshStandardMaterial({
      color: 0x16181c,
      roughness: 0.78,
      metalness: 0.1,
    });
    this.railMat = new THREE.MeshStandardMaterial({
      color: 0x6b5640,
      roughness: 0.45,
      metalness: 0.68,
    });
    this.barrelMat = new THREE.MeshStandardMaterial({
      color: 0x242830,
      roughness: 0.28,
      metalness: 0.9,
    });
    this.bladeMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.18,
      metalness: 0.94,
    });
    this.disposables.push(
      this.receiverMat,
      this.polymerMat,
      this.railMat,
      this.barrelMat,
      this.bladeMat,
    );
  }

  setSkin(skin: WeaponSkinId): void {
    this.currentSkin = skin;

    const resetMaps = (m: THREE.MeshStandardMaterial) => {
      m.map = null;
      m.normalMap = null;
      m.roughnessMap = null;
    };
    resetMaps(this.receiverMat);
    resetMaps(this.polymerMat);
    resetMaps(this.railMat);
    resetMaps(this.barrelMat);

    if (skin === 'desert_tan') {
      this.receiverMat.color.setHex(0xb89668);
      this.receiverMat.roughness = 0.48;
      this.receiverMat.metalness = 0.34;
      this.polymerMat.color.setHex(0x634d34);
      this.polymerMat.roughness = 0.72;
      this.polymerMat.metalness = 0.12;
      this.railMat.color.setHex(0xc8aa7e);
      this.railMat.roughness = 0.44;
      this.railMat.metalness = 0.38;
      this.barrelMat.color.setHex(0x8c96a4);
      this.barrelMat.roughness = 0.28;
      this.barrelMat.metalness = 0.85;
    } else if (skin === 'arctic_camo') {
      this.receiverMat.color.setHex(0xffffff);
      this.receiverMat.map = this.arcticCamoTex.map;
      this.receiverMat.normalMap = this.arcticCamoTex.normalMap;
      this.receiverMat.roughnessMap = this.arcticCamoTex.roughnessMap;
      this.receiverMat.roughness = 0.82;
      this.receiverMat.metalness = 0.12;

      this.railMat.color.setHex(0xffffff);
      this.railMat.map = this.arcticCamoTex.map;
      this.railMat.normalMap = this.arcticCamoTex.normalMap;
      this.railMat.roughness = 0.8;
      this.railMat.metalness = 0.14;

      this.polymerMat.color.setHex(0x334155);
      this.polymerMat.roughness = 0.78;
      this.polymerMat.metalness = 0.12;

      this.barrelMat.color.setHex(0x94a3b8);
      this.barrelMat.roughness = 0.34;
      this.barrelMat.metalness = 0.78;
    } else if (skin === 'carbon_gold') {
      this.receiverMat.color.setHex(0xd9a126);
      this.receiverMat.roughness = 0.25;
      this.receiverMat.metalness = 0.86;

      this.railMat.color.setHex(0xffffff);
      this.railMat.map = this.carbonTex.map;
      this.railMat.normalMap = this.carbonTex.normalMap;
      this.railMat.roughnessMap = this.carbonTex.roughnessMap;
      this.railMat.roughness = 0.42;
      this.railMat.metalness = 0.36;

      this.polymerMat.color.setHex(0x181b22);
      this.polymerMat.roughness = 0.72;
      this.polymerMat.metalness = 0.14;

      this.barrelMat.color.setHex(0xe5b842);
      this.barrelMat.roughness = 0.22;
      this.barrelMat.metalness = 0.9;
    } else {
      this.receiverMat.color.setHex(0x2d333d);
      this.receiverMat.roughness = 0.36;
      this.receiverMat.metalness = 0.82;
      this.polymerMat.color.setHex(0x16181c);
      this.polymerMat.roughness = 0.78;
      this.polymerMat.metalness = 0.1;
      this.railMat.color.setHex(0x6e5942);
      this.railMat.roughness = 0.48;
      this.railMat.metalness = 0.62;
      this.barrelMat.color.setHex(0x262b34);
      this.barrelMat.roughness = 0.3;
      this.barrelMat.metalness = 0.88;
    }

    this.receiverMat.needsUpdate = true;
    this.polymerMat.needsUpdate = true;
    this.railMat.needsUpdate = true;
    this.barrelMat.needsUpdate = true;
  }

  private buildShowcaseRig(): void {
    // Positioned cleanly in the right-hand open viewport on the title screen
    this.showcaseGroup.position.set(0.35, 0.01, -0.84);
    this.showcaseGroup.visible = false;

    this.showcaseKeyLight.position.set(0.35, 0.42, 0.48);
    this.showcaseRimLight.position.set(-0.48, 0.22, -0.35);
    this.showcaseGroup.add(this.showcaseKeyLight, this.showcaseRimLight, this.showcaseSpinGroup);

    const centerClone = (source: THREE.Group, scale: number): THREE.Group => {
      const wrapper = new THREE.Group();
      const clone = source.clone();
      clone.rotation.set(0, Math.PI * 0.52, 0);
      clone.scale.setScalar(scale);
      clone.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(clone);
      const center = new THREE.Vector3();
      box.getCenter(center);
      clone.position.sub(center);
      wrapper.add(clone);
      return wrapper;
    };

    const rifleClone = centerClone(this.rifleGroup, 0.84);
    const pistolClone = centerClone(this.pistolGroup, 1.38);
    const shotgunClone = centerClone(this.shotgunGroup, 0.8);
    const marksmanClone = centerClone(this.marksmanGroup, 0.78);
    const smgClone = centerClone(this.smgGroup, 0.95);
    const lmgClone = centerClone(this.lmgGroup, 0.72);
    const deagleClone = centerClone(this.deagleGroup, 1.3);

    this.showcaseModels.rifle = rifleClone;
    this.showcaseModels.pistol = pistolClone;
    this.showcaseModels.shotgun = shotgunClone;
    this.showcaseModels.marksman = marksmanClone;
    this.showcaseModels.smg = smgClone;
    this.showcaseModels.lmg = lmgClone;
    this.showcaseModels.deagle = deagleClone;

    this.showcaseSpinGroup.add(
      rifleClone,
      pistolClone,
      shotgunClone,
      marksmanClone,
      smgClone,
      lmgClone,
      deagleClone,
    );
    this.syncShowcaseModelVisibility();
  }

  private syncShowcaseModelVisibility(): void {
    for (const key of [
      'rifle',
      'pistol',
      'shotgun',
      'marksman',
      'smg',
      'lmg',
      'deagle',
    ] as const) {
      const m = this.showcaseModels[key];
      if (m) m.visible = key === this.showcaseWeaponId;
    }
  }

  setShowcaseState(visible: boolean, previewWeapon?: WeaponId): void {
    this.showcaseGroup.visible = visible;
    this.showcaseKeyLight.intensity = visible ? 1.35 : 0;
    this.showcaseRimLight.intensity = visible ? 0.85 : 0;
    if (previewWeapon && this.showcaseModels[previewWeapon]) {
      this.showcaseWeaponId = previewWeapon;
      this.syncShowcaseModelVisibility();
    }
  }

  updateShowcase(dt: number, elapsed: number): void {
    if (!this.showcaseGroup.visible) return;
    this.showcaseSpinGroup.rotation.y += dt * 0.42;
    this.showcaseSpinGroup.rotation.x = Math.sin(elapsed * 0.9) * 0.08 + 0.08;
    this.showcaseSpinGroup.position.y = Math.sin(elapsed * 1.4) * 0.012;
  }

  setVisible(visible: boolean): void {
    this.rigGroup.visible = visible;
  }

  private addMeshPart(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    this.disposables.push(geo);
    return m;
  }

  // =========================================================================
  // 1. MK-18 CARBINE (Sculpted ExtrudeGeometry receiver, optic ring & fluted barrel)
  // =========================================================================
  private buildRifleModel(): void {
    const reticleDotMat = new THREE.MeshStandardMaterial({
      color: 0xff4d2e,
      emissive: 0xff3b1f,
      emissiveIntensity: 3.0,
    });
    this.disposables.push(reticleDotMat);

    // Beveled upper/lower receiver silhouette (profile along Z-Y, rotated Y by PI/2)
    const recvGeo = makeBeveledShapeGeo(
      [
        [-0.14, -0.024],
        [0.06, -0.024],
        [0.12, -0.04],
        [0.14, 0.032],
        [-0.14, 0.032],
      ],
      0.046,
      0.004,
      0.004,
    );
    recvGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.rifleGroup, recvGeo, this.receiverMat, 0, 0, 0);

    // Top Picatinny rail + octagonal handguard
    const handguardGeo = new THREE.CylinderGeometry(0.027, 0.027, 0.25, 8);
    handguardGeo.rotateX(Math.PI / 2);
    this.addMeshPart(this.rifleGroup, handguardGeo, this.railMat, 0, 0.009, -0.25);

    const railGeo = makeBeveledShapeGeo(
      [
        [-0.012, -0.005],
        [0.012, -0.005],
        [0.009, 0.006],
        [-0.009, 0.006],
      ],
      0.34,
      0.0015,
      0.0015,
    );
    this.addMeshPart(this.rifleGroup, railGeo, this.polymerMat, 0, 0.038, -0.07);

    // Lathe fluted barrel + 3-prong flash suppressor
    const barrelGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.014, 0),
        new THREE.Vector2(0.011, 0.05),
        new THREE.Vector2(0.011, 0.2),
        new THREE.Vector2(0.016, 0.22),
        new THREE.Vector2(0.016, 0.265),
        new THREE.Vector2(0.009, 0.265),
      ],
      12,
    );
    barrelGeo.rotateX(-Math.PI / 2);
    this.addMeshPart(this.rifleGroup, barrelGeo, this.barrelMat, 0, 0.01, -0.34);

    // Contoured pistol grip & angled foregrip
    const gripGeo = makeBeveledShapeGeo(
      [
        [-0.024, 0],
        [0.02, 0],
        [0.03, -0.105],
        [-0.012, -0.105],
      ],
      0.032,
      0.004,
      0.004,
    );
    gripGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.rifleGroup, gripGeo, this.polymerMat, 0, -0.022, 0.072);

    const foreGripGeo = makeBeveledShapeGeo(
      [
        [-0.018, 0],
        [0.018, 0],
        [0.012, -0.064],
        [-0.024, -0.064],
      ],
      0.028,
      0.003,
      0.003,
    );
    foreGripGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.rifleGroup, foreGripGeo, this.polymerMat, 0, -0.015, -0.24);

    // Buffer tube & sculpted buttstock
    const tubeGeo = new THREE.CylinderGeometry(0.017, 0.017, 0.12, 12);
    tubeGeo.rotateX(Math.PI / 2);
    this.addMeshPart(this.rifleGroup, tubeGeo, this.barrelMat, 0, 0.005, 0.19);
    const stockGeo = makeBeveledShapeGeo(
      [
        [-0.045, -0.045],
        [0.045, -0.06],
        [0.045, 0.025],
        [-0.045, 0.025],
      ],
      0.036,
      0.004,
      0.004,
    );
    stockGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.rifleGroup, stockGeo, this.polymerMat, 0, -0.01, 0.22);

    // True 3D Holographic Sight Hood (beveled arch + 3D dot — no PlaneGeometry)
    const hoodGeo = new THREE.TorusGeometry(0.019, 0.004, 8, 16, Math.PI * 1.12);
    this.addMeshPart(this.rifleGroup, hoodGeo, this.polymerMat, 0, 0.059, -0.02, 0, 0, -Math.PI * 0.06);
    const opticBaseGeo = makeBeveledShapeGeo(
      [
        [-0.019, -0.005],
        [0.019, -0.005],
        [0.017, 0.005],
        [-0.017, 0.005],
      ],
      0.062,
      0.002,
      0.002,
    );
    this.addMeshPart(this.rifleGroup, opticBaseGeo, this.polymerMat, 0, 0.044, -0.02);
    this.addMeshPart(
      this.rifleGroup,
      new THREE.SphereGeometry(0.0024, 8, 6),
      reticleDotMat,
      0,
      0.064,
      -0.02,
    );

    // Curved detachable magazine
    const magGeo = makeBeveledShapeGeo(
      [
        [-0.024, 0],
        [0.024, 0],
        [0.036, -0.13],
        [-0.012, -0.135],
      ],
      0.03,
      0.003,
      0.003,
    );
    magGeo.rotateY(Math.PI / 2);
    this.rifleMagMesh = this.addMeshPart(this.rifleGroup, magGeo, this.polymerMat, 0, -0.022, -0.055);

    const boltGeo = makeBeveledShapeGeo(
      [
        [-0.028, -0.008],
        [0.028, -0.008],
        [0.028, 0.008],
        [-0.028, 0.008],
      ],
      0.012,
      0.002,
      0.002,
    );
    boltGeo.rotateY(Math.PI / 2);
    this.rifleBoltMesh = this.addMeshPart(this.rifleGroup, boltGeo, this.barrelMat, 0.023, 0.012, -0.02);

    this.rifleEjectAnchor.position.set(0.034, 0.014, -0.02);
    this.rifleGroup.add(this.rifleEjectAnchor);
    this.rifleMuzzleAnchor.position.set(0, 0.01, -0.61);
    this.rifleGroup.add(this.rifleMuzzleAnchor);
  }

  // =========================================================================
  // 2. P226 TACTICAL PISTOL
  // =========================================================================
  private buildPistolModel(): void {
    const tritiumMat = new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 2.2,
    });
    this.disposables.push(tritiumMat);

    const slideGeo = makeBeveledShapeGeo(
      [
        [-0.014, -0.014],
        [0.014, -0.014],
        [0.012, 0.014],
        [-0.012, 0.014],
      ],
      0.205,
      0.003,
      0.003,
    );
    this.pistolSlideMesh = this.addMeshPart(this.pistolGroup, slideGeo, this.receiverMat, 0, 0.018, -0.02);

    const frameGeo = makeBeveledShapeGeo(
      [
        [-0.09, -0.01],
        [0.095, -0.01],
        [0.095, 0.01],
        [-0.085, 0.01],
      ],
      0.026,
      0.0025,
      0.0025,
    );
    frameGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.pistolGroup, frameGeo, this.polymerMat, 0, -0.01, -0.01);

    const gripGeo = makeBeveledShapeGeo(
      [
        [-0.022, 0],
        [0.022, 0],
        [0.036, -0.1],
        [-0.008, -0.1],
      ],
      0.028,
      0.004,
      0.004,
    );
    gripGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.pistolGroup, gripGeo, this.polymerMat, 0, -0.016, 0.048);

    const barrelGeo = new THREE.CylinderGeometry(0.0085, 0.0095, 0.075, 12);
    barrelGeo.rotateX(Math.PI / 2);
    this.addMeshPart(this.pistolGroup, barrelGeo, this.barrelMat, 0, 0.014, -0.145);

    for (const sx of [-0.007, 0.007]) {
      this.addMeshPart(
        this.pistolGroup,
        new THREE.SphereGeometry(0.003, 6, 6),
        tritiumMat,
        sx,
        0.036,
        0.072,
      );
    }
    this.addMeshPart(
      this.pistolGroup,
      new THREE.SphereGeometry(0.0032, 6, 6),
      tritiumMat,
      0,
      0.036,
      -0.11,
    );

    const magGeo = makeBeveledShapeGeo(
      [
        [-0.014, 0],
        [0.014, 0],
        [0.026, -0.095],
        [-0.004, -0.095],
      ],
      0.02,
      0.002,
      0.002,
    );
    magGeo.rotateY(Math.PI / 2);
    this.pistolMagMesh = this.addMeshPart(this.pistolGroup, magGeo, this.barrelMat, 0, -0.02, 0.048);

    this.pistolEjectAnchor.position.set(0.022, 0.022, -0.01);
    this.pistolGroup.add(this.pistolEjectAnchor);
    this.pistolMuzzleAnchor.position.set(0, 0.014, -0.185);
    this.pistolGroup.add(this.pistolMuzzleAnchor);
  }

  // =========================================================================
  // 3. M870 BREACHER SHOTGUN (Beveled receiver + reciprocating pump forend)
  // =========================================================================
  private buildShotgunModel(): void {
    const fiberMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xdc2626,
      emissiveIntensity: 2.2,
    });
    this.disposables.push(fiberMat);

    // Sculpted receiver hull
    const recvGeo = makeBeveledShapeGeo(
      [
        [-0.13, -0.028],
        [0.11, -0.028],
        [0.12, 0.032],
        [-0.13, 0.032],
      ],
      0.046,
      0.005,
      0.005,
    );
    recvGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.shotgunGroup, recvGeo, this.receiverMat, 0, 0.002, 0.02);

    // Heavy 12-gauge barrel + full-length magazine tube
    const barrelGeo = new THREE.CylinderGeometry(0.0145, 0.0155, 0.44, 14);
    barrelGeo.rotateX(Math.PI / 2);
    this.addMeshPart(this.shotgunGroup, barrelGeo, this.barrelMat, 0, 0.02, -0.31);

    const tubeMagGeo = new THREE.CylinderGeometry(0.0125, 0.0125, 0.4, 12);
    tubeMagGeo.rotateX(Math.PI / 2);
    this.addMeshPart(this.shotgunGroup, tubeMagGeo, this.railMat, 0, -0.008, -0.29);

    // Barrel clamp collar
    const clampGeo = new THREE.TorusGeometry(0.019, 0.005, 8, 12);
    this.addMeshPart(this.shotgunGroup, clampGeo, this.polymerMat, 0, 0.006, -0.47);

    // Ribbed Pump Forend Group (animates back and forth after each shell!)
    this.shotgunPumpGroup = new THREE.Group();
    this.shotgunPumpGroup.position.set(0, -0.008, -0.26);
    const pumpProfile = [
      new THREE.Vector2(0.018, -0.085),
      new THREE.Vector2(0.026, -0.065),
      new THREE.Vector2(0.024, -0.025),
      new THREE.Vector2(0.027, 0.0),
      new THREE.Vector2(0.024, 0.025),
      new THREE.Vector2(0.026, 0.065),
      new THREE.Vector2(0.018, 0.085),
    ];
    const pumpGeo = new THREE.LatheGeometry(pumpProfile, 14);
    pumpGeo.rotateX(Math.PI / 2);
    this.addMeshPart(this.shotgunPumpGroup, pumpGeo, this.polymerMat, 0, 0, 0);
    this.shotgunGroup.add(this.shotgunPumpGroup);

    // Tactical stock + contoured grip
    const stockGeo = makeBeveledShapeGeo(
      [
        [-0.08, -0.055],
        [0.08, -0.025],
        [0.08, 0.018],
        [-0.08, 0.008],
      ],
      0.038,
      0.005,
      0.005,
    );
    stockGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.shotgunGroup, stockGeo, this.polymerMat, 0, -0.024, 0.21);

    const gripGeo = makeBeveledShapeGeo(
      [
        [-0.02, 0],
        [0.018, 0],
        [0.028, -0.085],
        [-0.01, -0.085],
      ],
      0.032,
      0.004,
      0.004,
    );
    gripGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.shotgunGroup, gripGeo, this.polymerMat, 0, -0.022, 0.09);

    // Ghost ring rear + glowing red front bead
    const ghostRingGeo = new THREE.TorusGeometry(0.012, 0.003, 8, 14);
    this.addMeshPart(this.shotgunGroup, ghostRingGeo, this.receiverMat, 0, 0.044, 0.06);
    this.addMeshPart(
      this.shotgunGroup,
      new THREE.SphereGeometry(0.004, 8, 6),
      fiberMat,
      0,
      0.04,
      -0.5,
    );

    this.shotgunEjectAnchor.position.set(0.032, 0.012, -0.01);
    this.shotgunGroup.add(this.shotgunEjectAnchor);
    this.shotgunMuzzleAnchor.position.set(0, 0.02, -0.55);
    this.shotgunGroup.add(this.shotgunMuzzleAnchor);
  }

  // =========================================================================
  // 4. MK-14 MARKSMAN RIFLE (Precision chassis + Lathe telescopic scope)
  // =========================================================================
  private buildMarksmanModel(): void {
    const scopeCrossMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 1.8,
    });
    this.disposables.push(scopeCrossMat);

    // Precision chassis receiver & ventilated rail shroud
    const chassisGeo = makeBeveledShapeGeo(
      [
        [-0.26, -0.024],
        [0.14, -0.024],
        [0.15, 0.028],
        [-0.25, 0.028],
      ],
      0.046,
      0.004,
      0.004,
    );
    chassisGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.marksmanGroup, chassisGeo, this.railMat, 0, 0, -0.06);

    const upperGeo = makeBeveledShapeGeo(
      [
        [-0.14, -0.015],
        [0.11, -0.015],
        [0.11, 0.02],
        [-0.14, 0.02],
      ],
      0.042,
      0.003,
      0.003,
    );
    upperGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.marksmanGroup, upperGeo, this.receiverMat, 0, 0.024, 0.01);

    // Long precision barrel + cylindrical brake
    const barrelGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.014, 0),
        new THREE.Vector2(0.011, 0.06),
        new THREE.Vector2(0.0105, 0.28),
        new THREE.Vector2(0.017, 0.295),
        new THREE.Vector2(0.017, 0.345),
        new THREE.Vector2(0.01, 0.345),
      ],
      14,
    );
    barrelGeo.rotateX(-Math.PI / 2);
    this.addMeshPart(this.marksmanGroup, barrelGeo, this.barrelMat, 0, 0.016, -0.19);

    // Telescopic Sniper Scope (Lathe bell profile + mount rings + 3D reticle crosshairs)
    const scopeGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.019, -0.11),
        new THREE.Vector2(0.019, -0.065),
        new THREE.Vector2(0.013, -0.045),
        new THREE.Vector2(0.013, 0.05),
        new THREE.Vector2(0.023, 0.085),
        new THREE.Vector2(0.023, 0.125),
        new THREE.Vector2(0.019, 0.125),
      ],
      16,
    );
    scopeGeo.rotateX(-Math.PI / 2);
    this.addMeshPart(this.marksmanGroup, scopeGeo, this.polymerMat, 0, 0.072, -0.03);

    const ringGeo = new THREE.TorusGeometry(0.0155, 0.0045, 8, 14);
    this.addMeshPart(this.marksmanGroup, ringGeo, this.receiverMat, 0, 0.072, 0.01);
    this.addMeshPart(this.marksmanGroup, ringGeo.clone(), this.receiverMat, 0, 0.072, -0.075);

    // 3D reticle crossbars inside scope ocular bell
    const hWire = new THREE.CylinderGeometry(0.0008, 0.0008, 0.028, 6);
    hWire.rotateZ(Math.PI / 2);
    const vWire = new THREE.CylinderGeometry(0.0008, 0.0008, 0.028, 6);
    this.addMeshPart(this.marksmanGroup, hWire, scopeCrossMat, 0, 0.072, -0.02);
    this.addMeshPart(this.marksmanGroup, vWire, scopeCrossMat, 0, 0.072, -0.02);

    // Stock + Grip
    const stockGeo = makeBeveledShapeGeo(
      [
        [-0.07, -0.05],
        [0.07, -0.03],
        [0.07, 0.025],
        [-0.07, 0.018],
      ],
      0.036,
      0.004,
      0.004,
    );
    stockGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.marksmanGroup, stockGeo, this.polymerMat, 0, -0.016, 0.21);

    const gripGeo = makeBeveledShapeGeo(
      [
        [-0.02, 0],
        [0.018, 0],
        [0.028, -0.095],
        [-0.01, -0.095],
      ],
      0.032,
      0.004,
      0.004,
    );
    gripGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.marksmanGroup, gripGeo, this.polymerMat, 0, -0.02, 0.08);

    // 7.62 Box Magazine + Bolt handle
    const magGeo = makeBeveledShapeGeo(
      [
        [-0.022, 0],
        [0.022, 0],
        [0.025, -0.098],
        [-0.018, -0.102],
      ],
      0.03,
      0.003,
      0.003,
    );
    magGeo.rotateY(Math.PI / 2);
    this.marksmanMagMesh = this.addMeshPart(this.marksmanGroup, magGeo, this.polymerMat, 0, -0.022, -0.05);

    const boltGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.045, 10);
    boltGeo.rotateZ(Math.PI / 2);
    this.marksmanBoltMesh = this.addMeshPart(this.marksmanGroup, boltGeo, this.barrelMat, 0.028, 0.024, 0.01);

    this.marksmanEjectAnchor.position.set(0.034, 0.024, -0.01);
    this.marksmanGroup.add(this.marksmanEjectAnchor);
    this.marksmanMuzzleAnchor.position.set(0, 0.016, -0.54);
    this.marksmanGroup.add(this.marksmanMuzzleAnchor);
  }

  // =========================================================================
  // 5. COMBAT KNIFE (Sculpted beveled tanto blade + ribbed Lathe hilt)
  // =========================================================================
  private buildKnifeModel(): void {
    // Beveled Tanto Blade
    const bladeGeo = makeBeveledShapeGeo(
      [
        [-0.012, 0],
        [0.015, 0],
        [0.015, 0.145],
        [0.002, 0.215],
        [-0.012, 0.165],
      ],
      0.005,
      0.002,
      0.002,
    );
    bladeGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.knifeGroup, bladeGeo, this.bladeMat, 0, 0.02, -0.03, -0.25, 0, 0);

    // Sculpted Crossguard
    const guardGeo = makeBeveledShapeGeo(
      [
        [-0.028, -0.006],
        [0.028, -0.006],
        [0.024, 0.007],
        [-0.024, 0.007],
      ],
      0.018,
      0.002,
      0.002,
    );
    guardGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.knifeGroup, guardGeo, this.receiverMat, 0, 0.018, -0.028, -0.25, 0, 0);

    // Ribbed Lathe Tactical Grip + Steel Pommel
    const handleProfile = [
      new THREE.Vector2(0.014, -0.095),
      new THREE.Vector2(0.017, -0.08),
      new THREE.Vector2(0.013, -0.065),
      new THREE.Vector2(0.017, -0.045),
      new THREE.Vector2(0.013, -0.025),
      new THREE.Vector2(0.017, -0.005),
      new THREE.Vector2(0.015, 0.01),
    ];
    const handleGeo = new THREE.LatheGeometry(handleProfile, 14);
    this.addMeshPart(this.knifeGroup, handleGeo, this.polymerMat, 0, 0.012, -0.026, -0.25, 0, 0);

    const pommelGeo = new THREE.ConeGeometry(0.014, 0.022, 8);
    pommelGeo.rotateX(Math.PI);
    this.addMeshPart(this.knifeGroup, pommelGeo, this.receiverMat, 0, -0.095, 0.001, -0.25, 0, 0);

    this.knifeGroup.position.set(-0.04, 0.07, 0.02);
    this.knifeGroup.rotation.set(-0.22, 0.28, 0.24);
  }

  // =========================================================================
  // 6. KR-9 VECTOR SMG (Compact receiver, suppressor, vertical foregrip, wire stock)
  // =========================================================================
  private buildSmgModel(): void {
    const recvGeo = makeBeveledShapeGeo(
      [
        [-0.16, -0.022],
        [0.08, -0.022],
        [0.11, -0.034],
        [0.12, 0.028],
        [-0.15, 0.028],
      ],
      0.04,
      0.004,
      0.004,
    );
    recvGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.smgGroup, recvGeo, this.receiverMat, 0, 0, 0);

    // Short barrel + cylindrical suppressor
    const barrelGeo = new THREE.CylinderGeometry(0.013, 0.014, 0.16, 12);
    barrelGeo.rotateX(Math.PI / 2);
    this.addMeshPart(this.smgGroup, barrelGeo, this.barrelMat, 0, 0.008, -0.2);
    const supGeo = new THREE.CylinderGeometry(0.021, 0.021, 0.13, 12);
    supGeo.rotateX(Math.PI / 2);
    this.addMeshPart(this.smgGroup, supGeo, this.polymerMat, 0, 0.008, -0.28);
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.TorusGeometry(0.022, 0.0035, 6, 12);
      this.addMeshPart(this.smgGroup, ring, this.barrelMat, 0, 0.008, -0.235 - i * 0.032);
    }

    // Top rail + rear aperture sight
    const railGeo = makeBeveledShapeGeo(
      [
        [-0.01, -0.004],
        [0.01, -0.004],
        [0.008, 0.005],
        [-0.008, 0.005],
      ],
      0.22,
      0.0015,
      0.0015,
    );
    this.addMeshPart(this.smgGroup, railGeo, this.polymerMat, 0, 0.034, -0.04);
    const sightGeo = new THREE.TorusGeometry(0.011, 0.0028, 6, 12);
    this.addMeshPart(this.smgGroup, sightGeo, this.receiverMat, 0, 0.05, 0.02);

    // Vertical foregrip + pistol grip
    const vgripGeo = makeBeveledShapeGeo(
      [
        [-0.016, 0],
        [0.016, 0],
        [0.012, -0.07],
        [-0.02, -0.07],
      ],
      0.026,
      0.003,
      0.003,
    );
    vgripGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.smgGroup, vgripGeo, this.polymerMat, 0, -0.02, -0.13);

    const gripGeo = makeBeveledShapeGeo(
      [
        [-0.02, 0],
        [0.018, 0],
        [0.026, -0.09],
        [-0.008, -0.09],
      ],
      0.03,
      0.003,
      0.003,
    );
    gripGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.smgGroup, gripGeo, this.polymerMat, 0, -0.02, 0.07);

    // Wire skeleton stock
    const wireGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.16, 6);
    wireGeo.rotateX(Math.PI / 2);
    this.addMeshPart(this.smgGroup, wireGeo, this.barrelMat, 0, 0.004, 0.17);
    const cheekGeo = new THREE.BoxGeometry(0.03, 0.018, 0.1);
    this.addMeshPart(this.smgGroup, cheekGeo, this.polymerMat, 0, 0.028, 0.15);

    // Curved SMG magazine
    const magGeo = makeBeveledShapeGeo(
      [
        [-0.02, 0],
        [0.02, 0],
        [0.03, -0.11],
        [-0.01, -0.115],
      ],
      0.026,
      0.003,
      0.003,
    );
    magGeo.rotateY(Math.PI / 2);
    this.smgMagMesh = this.addMeshPart(this.smgGroup, magGeo, this.polymerMat, 0, -0.02, -0.04);

    const boltGeo = makeBeveledShapeGeo(
      [
        [-0.02, -0.006],
        [0.02, -0.006],
        [0.02, 0.006],
        [-0.02, 0.006],
      ],
      0.01,
      0.002,
      0.002,
    );
    boltGeo.rotateY(Math.PI / 2);
    this.smgBoltMesh = this.addMeshPart(this.smgGroup, boltGeo, this.barrelMat, 0.02, 0.012, -0.01);

    this.smgEjectAnchor.position.set(0.028, 0.012, -0.01);
    this.smgGroup.add(this.smgEjectAnchor);
    this.smgMuzzleAnchor.position.set(0, 0.008, -0.35);
    this.smgGroup.add(this.smgMuzzleAnchor);
  }

  // =========================================================================
  // 7. M249 SAW LMG (Long barrel + bipod, box magazine, top carry handle)
  // =========================================================================
  private buildLmgModel(): void {
    const recvGeo = makeBeveledShapeGeo(
      [
        [-0.3, -0.026],
        [0.12, -0.026],
        [0.14, 0.03],
        [-0.29, 0.03],
      ],
      0.05,
      0.004,
      0.004,
    );
    recvGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.lmgGroup, recvGeo, this.receiverMat, 0, 0, -0.04);

    // Long barrel + flash hider + bipod legs
    const barrelGeo = new THREE.CylinderGeometry(0.015, 0.016, 0.42, 14);
    barrelGeo.rotateX(Math.PI / 2);
    this.addMeshPart(this.lmgGroup, barrelGeo, this.barrelMat, 0, 0.014, -0.32);
    const hiderGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.07, 10);
    hiderGeo.rotateX(Math.PI / 2);
    this.addMeshPart(this.lmgGroup, hiderGeo, this.polymerMat, 0, 0.014, -0.53);

    for (const sx of [-1, 1]) {
      const legGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.16, 6);
      const leg = this.addMeshPart(
        this.lmgGroup,
        legGeo,
        this.barrelMat,
        sx * 0.035,
        0.0,
        -0.44,
        0,
        0,
        sx * 0.5,
      );
      leg.position.y = -0.06;
    }

    // Top carry handle
    const handleGeo = makeBeveledShapeGeo(
      [
        [-0.16, -0.008],
        [0.16, -0.008],
        [0.16, 0.008],
        [-0.16, 0.008],
      ],
      0.014,
      0.002,
      0.002,
    );
    handleGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.lmgGroup, handleGeo, this.barrelMat, 0, 0.062, -0.02);
    for (const hx of [-0.14, 0.14]) {
      this.addMeshPart(
        this.lmgGroup,
        new THREE.BoxGeometry(0.014, 0.03, 0.014),
        this.barrelMat,
        hx,
        0.045,
        -0.02,
      );
    }

    // Box magazine + foregrip + stock
    const magGeo = new THREE.BoxGeometry(0.055, 0.11, 0.12);
    this.lmgMagMesh = this.addMeshPart(this.lmgGroup, magGeo, this.polymerMat, 0, -0.09, -0.08);

    const gripGeo = makeBeveledShapeGeo(
      [
        [-0.02, 0],
        [0.018, 0],
        [0.026, -0.095],
        [-0.008, -0.095],
      ],
      0.032,
      0.004,
      0.004,
    );
    gripGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.lmgGroup, gripGeo, this.polymerMat, 0, -0.022, 0.09);

    const stockGeo = makeBeveledShapeGeo(
      [
        [-0.055, -0.05],
        [0.055, -0.05],
        [0.05, 0.02],
        [-0.05, 0.02],
      ],
      0.04,
      0.005,
      0.005,
    );
    stockGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.lmgGroup, stockGeo, this.polymerMat, 0, -0.014, 0.24);

    const boltGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.05, 10);
    boltGeo.rotateZ(Math.PI / 2);
    this.lmgBoltMesh = this.addMeshPart(this.lmgGroup, boltGeo, this.barrelMat, 0.032, 0.026, -0.02);

    this.lmgEjectAnchor.position.set(0.038, 0.02, -0.02);
    this.lmgGroup.add(this.lmgEjectAnchor);
    this.lmgMuzzleAnchor.position.set(0, 0.014, -0.57);
    this.lmgGroup.add(this.lmgMuzzleAnchor);
  }

  // =========================================================================
  // 8. DEAGLE .50 TAC (Oversized slide, long barrel, heavy grip)
  // =========================================================================
  private buildDeagleModel(): void {
    const slideGeo = makeBeveledShapeGeo(
      [
        [-0.02, -0.016],
        [0.02, -0.016],
        [0.017, 0.02],
        [-0.017, 0.02],
      ],
      0.26,
      0.003,
      0.003,
    );
    this.deagleSlideMesh = this.addMeshPart(this.deagleGroup, slideGeo, this.receiverMat, 0, 0.022, -0.03);

    const frameGeo = makeBeveledShapeGeo(
      [
        [-0.1, -0.012],
        [0.1, -0.012],
        [0.1, 0.012],
        [-0.095, 0.012],
      ],
      0.03,
      0.0025,
      0.0025,
    );
    frameGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.deagleGroup, frameGeo, this.polymerMat, 0, -0.008, -0.01);

    const barrelGeo = new THREE.CylinderGeometry(0.012, 0.013, 0.11, 14);
    barrelGeo.rotateX(Math.PI / 2);
    this.addMeshPart(this.deagleGroup, barrelGeo, this.barrelMat, 0, 0.018, -0.19);

    const gripGeo = makeBeveledShapeGeo(
      [
        [-0.026, 0],
        [0.026, 0],
        [0.042, -0.12],
        [-0.01, -0.12],
      ],
      0.034,
      0.004,
      0.004,
    );
    gripGeo.rotateY(Math.PI / 2);
    this.addMeshPart(this.deagleGroup, gripGeo, this.polymerMat, 0, -0.02, 0.055);

    // Serrated rear sight block
    const sightGeo = new THREE.BoxGeometry(0.024, 0.014, 0.02);
    this.addMeshPart(this.deagleGroup, sightGeo, this.receiverMat, 0, 0.042, 0.085);

    const magGeo = makeBeveledShapeGeo(
      [
        [-0.016, 0],
        [0.016, 0],
        [0.03, -0.1],
        [-0.004, -0.1],
      ],
      0.024,
      0.002,
      0.002,
    );
    magGeo.rotateY(Math.PI / 2);
    this.deagleMagMesh = this.addMeshPart(this.deagleGroup, magGeo, this.barrelMat, 0, -0.024, 0.055);

    this.deagleEjectAnchor.position.set(0.026, 0.026, -0.01);
    this.deagleGroup.add(this.deagleEjectAnchor);
    this.deagleMuzzleAnchor.position.set(0, 0.018, -0.25);
    this.deagleGroup.add(this.deagleMuzzleAnchor);
  }

  // =========================================================================
  // 6. FRAG GRENADE VIEWMODEL (Lathe segmented hull + spoon + ring + LED)
  // =========================================================================
  private buildGrenadeViewModel(): void {
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x3b4d38,
      roughness: 0.56,
      metalness: 0.38,
    });
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0xff2b2b,
      emissive: 0xff1e1e,
      emissiveIntensity: 3.2,
    });
    this.disposables.push(bodyMat, ledMat);

    const hullGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, -0.048),
        new THREE.Vector2(0.024, -0.042),
        new THREE.Vector2(0.036, -0.018),
        new THREE.Vector2(0.038, 0.0),
        new THREE.Vector2(0.035, 0.02),
        new THREE.Vector2(0.022, 0.042),
        new THREE.Vector2(0.014, 0.052),
      ],
      16,
    );
    this.addMeshPart(this.grenadeVmGroup, hullGeo, bodyMat, 0, 0, 0);

    const collarGeo = new THREE.CylinderGeometry(0.016, 0.018, 0.018, 12);
    this.addMeshPart(this.grenadeVmGroup, collarGeo, this.receiverMat, 0, 0.056, 0);

    const spoonGeo = makeBeveledShapeGeo(
      [
        [0, 0.06],
        [0.026, 0.05],
        [0.038, 0.01],
        [0.034, -0.032],
        [0.024, -0.03],
        [0.029, 0.008],
        [0.02, 0.042],
        [0, 0.05],
      ],
      0.012,
      0.0015,
      0.0015,
    );
    this.addMeshPart(this.grenadeVmGroup, spoonGeo, this.barrelMat, 0, 0, 0);

    const ringGeo = new THREE.TorusGeometry(0.012, 0.0024, 8, 16);
    this.addMeshPart(this.grenadeVmGroup, ringGeo, this.bladeMat, -0.018, 0.058, 0.004);
    this.addMeshPart(
      this.grenadeVmGroup,
      new THREE.SphereGeometry(0.0055, 8, 6),
      ledMat,
      0,
      0.067,
      0.01,
    );
    this.grenadeVmGroup.position.set(-0.04, 0.05, 0.02);
    this.grenadeVmGroup.scale.setScalar(0.88);
    this.grenadeVmGroup.visible = false;
  }

  // =========================================================================
  // SCULPTED 3D FIRST-PERSON ARMS, WRISTWATCH & ARTICULATED FINGERS
  // =========================================================================
  private buildFirstPersonArms(): void {
    const sleeveTex = this.texLib.createCamoFabricSet([58, 64, 54], 909);
    const sleeveMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: sleeveTex.map,
      normalMap: sleeveTex.normalMap,
      roughnessMap: sleeveTex.roughnessMap,
      roughness: 0.85,
      metalness: 0.05,
    });
    const gloveMat = new THREE.MeshStandardMaterial({
      color: 0x1b1d21,
      roughness: 0.72,
      metalness: 0.14,
    });
    const knuckleMat = new THREE.MeshStandardMaterial({
      color: 0x2b2f36,
      roughness: 0.52,
      metalness: 0.34,
    });
    const cuffMat = new THREE.MeshStandardMaterial({
      color: 0x343942,
      roughness: 0.5,
      metalness: 0.5,
    });

    // Tapered anatomical Lathe forearm
    const forearmGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.044, -0.17),
        new THREE.Vector2(0.048, -0.08),
        new THREE.Vector2(0.042, 0.03),
        new THREE.Vector2(0.033, 0.13),
        new THREE.Vector2(0.029, 0.17),
      ],
      14,
    );
    const wristGeo = new THREE.CylinderGeometry(0.031, 0.034, 0.026, 12);
    const palmGeo = makeBeveledShapeGeo(
      [
        [-0.018, -0.026],
        [0.018, -0.026],
        [0.02, 0.024],
        [-0.02, 0.024],
      ],
      0.044,
      0.005,
      0.005,
    );
    const fingerGeo = new THREE.CapsuleGeometry(0.0068, 0.026, 5, 8);
    const thumbGeo = new THREE.CapsuleGeometry(0.0085, 0.026, 5, 8);
    const watchBezelGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.009, 12);
    this.disposables.push(
      sleeveMat,
      gloveMat,
      knuckleMat,
      cuffMat,
      forearmGeo,
      wristGeo,
      palmGeo,
      fingerGeo,
      thumbGeo,
      watchBezelGeo,
    );

    const buildSegmentedArm = (
      shoulderPos: [number, number, number],
      handPos: [number, number, number],
      handRot: [number, number, number],
      thumbSide: 1 | -1,
      withWatch = false,
    ): THREE.Group => {
      const arm = new THREE.Group();
      const s = new THREE.Vector3(...shoulderPos);
      const h = new THREE.Vector3(...handPos);
      const mid = s.clone().lerp(h, 0.48);

      const forearm = new THREE.Mesh(forearmGeo, sleeveMat);
      forearm.position.copy(mid);
      forearm.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        h.clone().sub(s).normalize(),
      );
      arm.add(forearm);

      const wristPos = s.clone().lerp(h, 0.87);
      const wrist = new THREE.Mesh(wristGeo, cuffMat);
      wrist.position.copy(wristPos);
      wrist.quaternion.copy(forearm.quaternion);
      arm.add(wrist);

      if (withWatch) {
        const bezel = new THREE.Mesh(watchBezelGeo, knuckleMat);
        bezel.position.copy(wristPos).add(new THREE.Vector3(0, 0.029, 0));
        arm.add(bezel);
      }

      const hand = new THREE.Group();
      hand.position.copy(h);
      hand.rotation.set(handRot[0], handRot[1], handRot[2]);

      const palm = new THREE.Mesh(palmGeo, gloveMat);
      hand.add(palm);

      // 4 Articulated Curled Fingers around grip / foregrip
      for (let f = 0; f < 4; f++) {
        const finger = new THREE.Mesh(fingerGeo, knuckleMat);
        finger.position.set(thumbSide * -0.021, 0.015 - f * 0.011, -0.014);
        finger.rotation.set(0.25, 0, thumbSide * 0.85);
        hand.add(finger);
      }

      const thumb = new THREE.Mesh(thumbGeo, gloveMat);
      thumb.position.set(thumbSide * 0.016, 0.016, -0.018);
      thumb.rotation.set(Math.PI / 2 - 0.25, 0, thumbSide * -0.2);
      hand.add(thumb);

      arm.add(hand);
      return arm;
    };

    const rArm = buildSegmentedArm(
      [0.14, -0.22, 0.34],
      [0.016, -0.072, 0.074],
      [0.24, 0.05, 0],
      -1,
      false,
    );
    this.rightArmGroup.add(rArm);

    const lTwoHand = buildSegmentedArm(
      [-0.25, -0.25, 0.1],
      [-0.022, -0.048, -0.235],
      [-0.1, -0.18, 0.25],
      1,
      true,
    );
    this.leftTwoHandPose.add(lTwoHand);

    const lPistol = buildSegmentedArm(
      [-0.2, -0.24, 0.32],
      [-0.02, -0.078, 0.058],
      [0.22, -0.16, 0.15],
      1,
      true,
    );
    this.leftPistolPose.add(lPistol);

    const lKnife = buildSegmentedArm(
      [-0.24, -0.26, 0.22],
      [-0.14, -0.11, -0.04],
      [0.12, 0.3, -0.45],
      1,
      true,
    );
    this.leftKnifePose.add(lKnife);

    this.leftArmGroup.add(this.leftTwoHandPose, this.leftPistolPose, this.leftKnifePose);
  }

  private buildVolumetricMuzzleFlash(): THREE.Group {
    const g = new THREE.Group();
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0xffa947,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xfff3c4,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const spikeGeo = new THREE.ConeGeometry(0.028, 0.18, 7);
    spikeGeo.rotateZ(Math.PI / 2);
    const coreGeo = new THREE.ConeGeometry(0.052, 0.24, 8);
    coreGeo.rotateX(-Math.PI / 2);
    const orbGeo = new THREE.SphereGeometry(0.036, 10, 8);
    this.disposables.push(outerMat, innerMat, spikeGeo, coreGeo, orbGeo);

    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(spikeGeo, outerMat);
      const ang = (i / 6) * Math.PI * 2;
      spike.rotation.z = ang;
      spike.position.set(Math.cos(ang) * 0.045, Math.sin(ang) * 0.045, 0);
      g.add(spike);
    }
    const core = new THREE.Mesh(coreGeo, outerMat);
    core.position.z = -0.09;
    const orb = new THREE.Mesh(orbGeo, innerMat);
    g.add(core, orb);
    return g;
  }

  private syncWeaponVisibility(): void {
    const showKnife = this.activeId === 'knife' || this.quickMeleeActive;
    const hideGuns = this.grenadeThrowing || showKnife;
    this.rifleGroup.visible = !hideGuns && this.activeId === 'rifle';
    this.pistolGroup.visible = !hideGuns && this.activeId === 'pistol';
    this.shotgunGroup.visible = !hideGuns && this.activeId === 'shotgun';
    this.marksmanGroup.visible = !hideGuns && this.activeId === 'marksman';
    this.smgGroup.visible = !hideGuns && this.activeId === 'smg';
    this.lmgGroup.visible = !hideGuns && this.activeId === 'lmg';
    this.deagleGroup.visible = !hideGuns && this.activeId === 'deagle';
    this.knifeGroup.visible = !this.grenadeThrowing && showKnife;
    this.grenadeVmGroup.visible = this.grenadeThrowing;
  }

  reset(): void {
    this.activeId = 'rifle';
    this.state.rifle = { mag: WEAPON_SPECS.rifle.magSize, reserve: WEAPON_SPECS.rifle.startReserve };
    this.state.pistol = { mag: WEAPON_SPECS.pistol.magSize, reserve: WEAPON_SPECS.pistol.startReserve };
    this.state.shotgun = { mag: WEAPON_SPECS.shotgun.magSize, reserve: WEAPON_SPECS.shotgun.startReserve };
    this.state.marksman = { mag: WEAPON_SPECS.marksman.magSize, reserve: WEAPON_SPECS.marksman.startReserve };
    this.state.knife = { mag: 1, reserve: 0 };
    this.state.smg = { mag: WEAPON_SPECS.smg.magSize, reserve: WEAPON_SPECS.smg.startReserve };
    this.state.lmg = { mag: WEAPON_SPECS.lmg.magSize, reserve: WEAPON_SPECS.lmg.startReserve };
    this.state.deagle = { mag: WEAPON_SPECS.deagle.magSize, reserve: WEAPON_SPECS.deagle.startReserve };
    this.grenades = FRAG_GRENADE_SPEC.startCount;
    this.grenadeThrowing = false;
    this.grenadeThrowTimer = 0;
    this.isReloading = false;
    this.reloadElapsed = 0;
    this.fireCooldown = 0;
    this.pumpTimer = 0;
    this.meleeSwingTimer = 0;
    this.quickMeleeActive = false;
    this.kickOffsetZ = 0;
    this.kickRotX = 0;
    this.boltKick = 0;
    this.heatLevel = 0;
    this.shotStreak = 0;
    this.streakResetTimer = 0;
    this.rifleBoltMesh.position.z = -0.02;
    this.pistolSlideMesh.position.z = -0.02;
    this.marksmanBoltMesh.position.z = 0.01;
    this.smgBoltMesh.position.z = -0.01;
    this.lmgBoltMesh.position.z = -0.02;
    this.deagleSlideMesh.position.z = -0.03;
    this.shotgunPumpGroup.position.z = -0.26;
    this.rigGroup.position.set(0.22, -0.2, -0.44);
    this.rigGroup.rotation.set(0, 0, 0);
    this.syncWeaponVisibility();
    this.muzzleFlashMesh.visible = false;
    this.muzzleLight.intensity = 0;
    this.resetMagazinePositions();
    this.updateLeftArmPlacement(0);
  }

  private resetMagazinePositions(): void {
    this.rifleMagMesh.position.set(0, -0.022, -0.055);
    this.rifleMagMesh.rotation.set(0, 0, 0);
    this.pistolMagMesh.position.set(0, -0.02, 0.048);
    this.pistolMagMesh.rotation.set(0, 0, 0);
    this.marksmanMagMesh.position.set(0, -0.022, -0.05);
    this.marksmanMagMesh.rotation.set(0, 0, 0);
    this.smgMagMesh.position.set(0, -0.02, -0.04);
    this.smgMagMesh.rotation.set(0, 0, 0);
    this.lmgMagMesh.position.set(0, -0.09, -0.08);
    this.lmgMagMesh.rotation.set(0, 0, 0);
    this.deagleMagMesh.position.set(0, -0.024, 0.055);
    this.deagleMagMesh.rotation.set(0, 0, 0);
  }

  private updateLeftArmPlacement(reloadDrop: number): void {
    const isKnife = this.activeId === 'knife' || this.quickMeleeActive || this.grenadeThrowing;
    const isPistol = !isKnife && (this.activeId === 'pistol' || this.activeId === 'deagle');
    const isTwoHand = !isKnife && !isPistol;

    this.leftTwoHandPose.visible = isTwoHand;
    this.leftPistolPose.visible = isPistol;
    this.leftKnifePose.visible = isKnife;

    this.leftArmGroup.position.set(
      reloadDrop * 0.03,
      -reloadDrop * 0.22,
      reloadDrop * 0.12,
    );
    this.leftArmGroup.rotation.set(-reloadDrop * 0.3, 0, 0);
  }

  addAmmo(amountMultiplier = 1): void {
    this.state.rifle.reserve = Math.min(
      WEAPON_SPECS.rifle.maxReserve,
      this.state.rifle.reserve + Math.round(30 * amountMultiplier),
    );
    this.state.pistol.reserve = Math.min(
      WEAPON_SPECS.pistol.maxReserve,
      this.state.pistol.reserve + Math.round(15 * amountMultiplier),
    );
    this.state.shotgun.reserve = Math.min(
      WEAPON_SPECS.shotgun.maxReserve,
      this.state.shotgun.reserve + Math.round(8 * amountMultiplier),
    );
    this.state.marksman.reserve = Math.min(
      WEAPON_SPECS.marksman.maxReserve,
      this.state.marksman.reserve + Math.round(12 * amountMultiplier),
    );
    this.state.smg.reserve = Math.min(
      WEAPON_SPECS.smg.maxReserve,
      this.state.smg.reserve + Math.round(30 * amountMultiplier),
    );
    this.state.lmg.reserve = Math.min(
      WEAPON_SPECS.lmg.maxReserve,
      this.state.lmg.reserve + Math.round(60 * amountMultiplier),
    );
    this.state.deagle.reserve = Math.min(
      WEAPON_SPECS.deagle.maxReserve,
      this.state.deagle.reserve + Math.round(7 * amountMultiplier),
    );
    if (amountMultiplier >= 1 && this.grenades < this.maxGrenades) {
      this.grenades = Math.min(this.maxGrenades, this.grenades + 1);
    }
  }

  getActiveSpec() {
    return WEAPON_SPECS[this.activeId];
  }

  getActiveAmmo() {
    return this.state[this.activeId];
  }

  switchTo(id: WeaponId): void {
    if (this.activeId === id || this.grenadeThrowing) return;
    this.activeId = id;
    this.isReloading = false;
    this.reloadElapsed = 0;
    this.pumpTimer = 0;
    this.quickMeleeActive = false;
    this.resetMagazinePositions();
    this.syncWeaponVisibility();
    this.switchAnim = 1.0;
    this.updateLeftArmPlacement(0);
    this.sound.playSwitch();
  }

  startReload(): void {
    if (this.isReloading || this.grenadeThrowing) return;
    const spec = this.getActiveSpec();
    if (spec.isMelee) return;
    const st = this.getActiveAmmo();
    if (st.mag >= spec.magSize || st.reserve <= 0) return;
    this.isReloading = true;
    this.reloadElapsed = 0;
    this.reloadInsertPlayed = false;
    this.sound.playReload('start');
  }

  update(
    dt: number,
    player: Player,
    inputs: {
      fireHeld: boolean;
      fireJustPressed: boolean;
      adsHeld: boolean;
      reloadJustPressed: boolean;
      meleeJustPressed: boolean;
      grenadeJustPressed: boolean;
      switchWeapon: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | null;
      wheelDelta: -1 | 0 | 1;
    },
    moveMetrics: { moveSpeedRatio: number; bobAmount: number; bobPhase: number },
    enemyMeshes: THREE.Object3D[],
    onHitEnemy: (hit: WeaponHitResult) => void,
    onShotFired: () => void,
    onHitProp?: (outcome: PropDamageOutcome) => void,
    onSpawnGrenade?: (origin: THREE.Vector3, velocity: THREE.Vector3) => void,
  ): { isAds: boolean; crosshairSpreadPx: number } {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.heatLevel = Math.max(0, this.heatLevel - dt * 0.42);
    if (this.streakResetTimer > 0) {
      this.streakResetTimer -= dt;
      if (this.streakResetTimer <= 0) this.shotStreak = 0;
    }

    if (inputs.switchWeapon !== null) {
      const targetId = WEAPON_ORDER[inputs.switchWeapon - 1];
      if (targetId) this.switchTo(targetId);
    } else if (inputs.wheelDelta !== 0) {
      this.switchTo(getNextWeaponId(this.activeId, inputs.wheelDelta));
    }

    // Trigger Frag Grenade pull-pin & windup throw on [G]
    if (inputs.grenadeJustPressed && !this.grenadeThrowing && this.grenades > 0) {
      this.grenadeThrowing = true;
      this.grenadeThrowTimer = 0.42;
      this.grenadeSpawnedInThrow = false;
      this.grenadeThrowCallback = onSpawnGrenade ?? null;
      this.isReloading = false;
      this.quickMeleeActive = false;
      this.syncWeaponVisibility();
      this.sound.playGrenadePin();
    }

    if (this.grenadeThrowing) {
      this.grenadeThrowTimer -= dt;
      const elapsed = 0.42 - this.grenadeThrowTimer;
      if (!this.grenadeSpawnedInThrow && elapsed >= 0.22) {
        this.grenadeSpawnedInThrow = true;
        this.grenades = Math.max(0, this.grenades - 1);
        this.sound.playGrenadeThrow();

        this.camera.getWorldDirection(_camForward);
        _camUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
        _camRight.crossVectors(_camForward, _camUp).normalize();
        const throwOrigin = this.camera.position
          .clone()
          .addScaledVector(_camForward, 0.55)
          .addScaledVector(_camRight, 0.18)
          .addScaledVector(_camUp, -0.08);
        const throwVel = _camForward
          .clone()
          .multiplyScalar(FRAG_GRENADE_SPEC.throwSpeed)
          .add(new THREE.Vector3(0, FRAG_GRENADE_SPEC.upwardBoost, 0))
          .addScaledVector(player.velocity, 0.3);

        this.grenadeThrowCallback?.(throwOrigin, throwVel);
      }
      if (this.grenadeThrowTimer <= 0) {
        this.grenadeThrowing = false;
        this.grenadeThrowCallback = null;
        this.switchAnim = 0.55;
        this.syncWeaponVisibility();
      }
    }

    // Quick Melee [V]
    if (
      inputs.meleeJustPressed &&
      !this.grenadeThrowing &&
      this.meleeSwingTimer <= 0
    ) {
      this.isReloading = false;
      this.quickMeleeActive = this.activeId !== 'knife';
      this.meleeHeavySwing = false;
      this.meleeSwingTimer = 0.34;
      this.syncWeaponVisibility();
      this.performMeleeAttack(false, enemyMeshes, onHitEnemy, onHitProp);
    }

    const spec = this.getActiveSpec();
    const st = this.getActiveAmmo();

    if (inputs.reloadJustPressed && !spec.isMelee && !this.grenadeThrowing) {
      this.startReload();
    }

    let reloadDrop = 0;
    if (this.isReloading) {
      this.reloadElapsed += dt;
      const t = Math.min(1, this.reloadElapsed / spec.reloadTime);
      const skipMagDrop = this.activeId === 'shotgun' || this.activeId === 'lmg';
      const magMesh =
        this.activeId === 'pistol'
          ? this.pistolMagMesh
          : this.activeId === 'marksman'
            ? this.marksmanMagMesh
            : this.activeId === 'smg'
              ? this.smgMagMesh
              : this.activeId === 'deagle'
                ? this.deagleMagMesh
                : this.activeId === 'lmg'
                  ? this.lmgMagMesh
                  : this.rifleMagMesh;
      const baseY = this.activeId === 'lmg' ? -0.09 : -0.022;

      if (t < 0.45) {
        reloadDrop = t / 0.45;
        if (!skipMagDrop) {
          magMesh.position.y = baseY - reloadDrop * 0.24;
          magMesh.rotation.x = -reloadDrop * 0.45;
        }
      } else if (t < 0.85) {
        if (!this.reloadInsertPlayed && t > 0.6) {
          this.reloadInsertPlayed = true;
          this.sound.playReload('insert');
        }
        const up = (t - 0.45) / 0.4;
        reloadDrop = 1 - up;
        if (!skipMagDrop) {
          magMesh.position.y = baseY - reloadDrop * 0.24;
          magMesh.rotation.x = -reloadDrop * 0.45;
        }
      } else {
        this.resetMagazinePositions();
      }

      if (this.reloadElapsed >= spec.reloadTime) {
        const needed = spec.magSize - st.mag;
        const take = Math.min(needed, st.reserve);
        st.mag += take;
        st.reserve -= take;
        this.isReloading = false;
        this.reloadElapsed = 0;
        reloadDrop = 0;
        this.resetMagazinePositions();
      }
    }

    const isAds =
      inputs.adsHeld &&
      !player.isSprinting &&
      !this.isReloading &&
      !spec.isMelee &&
      !this.grenadeThrowing;

    // Active Weapon Fire / Knife Slash & Stab
    if (!this.grenadeThrowing && this.meleeSwingTimer <= 0) {
      if (spec.isMelee) {
        if ((inputs.fireJustPressed || inputs.adsHeld) && this.fireCooldown <= 0) {
          const heavy = inputs.adsHeld && !inputs.fireJustPressed;
          this.meleeHeavySwing = heavy;
          this.meleeSwingTimer = heavy ? 0.42 : 0.32;
          this.fireCooldown = 1 / (heavy ? spec.fireRate * 0.78 : spec.fireRate);
          this.performMeleeAttack(heavy, enemyMeshes, onHitEnemy, onHitProp);
        }
      } else {
        const wantsFire = spec.automatic ? inputs.fireHeld : inputs.fireJustPressed;
        if (wantsFire && !this.isReloading && this.fireCooldown <= 0) {
          if (st.mag > 0) {
            this.fireShot(player, moveMetrics.moveSpeedRatio, isAds, enemyMeshes, onHitEnemy, onHitProp);
            onShotFired();
            st.mag -= 1;
            this.fireCooldown = 1 / spec.fireRate;
            if (spec.pumpDuration) {
              this.pumpTimer = spec.pumpDuration;
            }
            if (st.mag === 0 && st.reserve > 0) {
              this.startReload();
            }
          } else if (inputs.fireJustPressed) {
            this.startReload();
          }
        }
      }
    }

    // Update Melee Slash Swing Animation
    if (this.meleeSwingTimer > 0) {
      this.meleeSwingTimer = Math.max(0, this.meleeSwingTimer - dt);
      if (this.meleeSwingTimer <= 0 && this.quickMeleeActive) {
        this.quickMeleeActive = false;
        this.switchAnim = 0.45;
        this.syncWeaponVisibility();
      }
    }

    // Update Shotgun Pump Action Animation
    if (this.pumpTimer > 0) {
      this.pumpTimer = Math.max(0, this.pumpTimer - dt);
      const pProg = 1 - this.pumpTimer / (WEAPON_SPECS.shotgun.pumpDuration ?? 0.44);
      const slideBack = Math.sin(Math.min(1, pProg) * Math.PI) * 0.085;
      this.shotgunPumpGroup.position.z = -0.26 + slideBack;
    } else {
      this.shotgunPumpGroup.position.z = -0.26;
    }

    this.updateLeftArmPlacement(reloadDrop);

    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0) {
        this.muzzleFlashMesh.visible = false;
        this.muzzleLight.intensity = 0;
      }
    }

    this.boltKick = THREE.MathUtils.damp(this.boltKick, 0, 26, dt);
    this.rifleBoltMesh.position.z = -0.02 + this.boltKick;
    this.pistolSlideMesh.position.z = -0.02 + this.boltKick;
    this.marksmanBoltMesh.position.z = 0.01 + this.boltKick;
    this.smgBoltMesh.position.z = -0.01 + this.boltKick;
    this.lmgBoltMesh.position.z = -0.02 + this.boltKick;
    this.deagleSlideMesh.position.z = -0.03 + this.boltKick * 1.4;

    this.kickOffsetZ = THREE.MathUtils.damp(this.kickOffsetZ, 0, 16, dt);
    this.kickRotX = THREE.MathUtils.damp(this.kickRotX, 0, 16, dt);
    this.switchAnim = THREE.MathUtils.damp(this.switchAnim, 0, 11, dt);
    this.swayX = THREE.MathUtils.damp(this.swayX, THREE.MathUtils.clamp(-player.lookDeltaX * 0.55, -0.04, 0.04), 12, dt);
    this.swayY = THREE.MathUtils.damp(this.swayY, THREE.MathUtils.clamp(player.lookDeltaY * 0.55, -0.04, 0.04), 12, dt);

    const hipPos = this.grenadeThrowing
      ? { x: 0.15, y: -0.1, z: -0.34 }
      : this.activeId === 'knife' || this.quickMeleeActive
        ? { x: 0.16, y: -0.11, z: -0.34 }
        : this.activeId === 'pistol' || this.activeId === 'deagle'
          ? { x: 0.2, y: -0.17, z: -0.45 }
          : this.activeId === 'smg'
            ? { x: 0.2, y: -0.17, z: -0.42 }
            : this.activeId === 'marksman' || this.activeId === 'lmg'
              ? { x: 0.21, y: -0.175, z: -0.42 }
              : { x: 0.21, y: -0.175, z: -0.43 };

    const adsPos =
      this.activeId === 'pistol'
        ? { x: 0, y: -0.044, z: -0.36 }
        : this.activeId === 'deagle'
          ? { x: 0, y: -0.05, z: -0.38 }
          : this.activeId === 'marksman'
            ? { x: 0, y: -0.072, z: -0.28 }
            : this.activeId === 'shotgun' || this.activeId === 'lmg'
              ? { x: 0, y: -0.046, z: -0.36 }
              : this.activeId === 'smg'
                ? { x: 0, y: -0.05, z: -0.35 }
                : { x: 0, y: -0.064, z: -0.35 };

    // Swing offset for Knife / Quick Melee
    let swingOffsetX = 0;
    let swingOffsetY = 0;
    let swingOffsetZ = 0;
    let swingRotX = 0;
    let swingRotY = 0;
    let swingRotZ = 0;
    if (this.meleeSwingTimer > 0) {
      const dur = this.meleeHeavySwing ? 0.42 : 0.32;
      const p = 1 - this.meleeSwingTimer / dur;
      const arc = Math.sin(p * Math.PI);
      if (this.meleeHeavySwing) {
        swingOffsetX = -0.12 * arc;
        swingOffsetZ = -0.24 * arc;
        swingRotX = -0.65 * arc;
      } else {
        swingOffsetX = -0.26 * arc;
        swingOffsetY = 0.06 * arc;
        swingOffsetZ = -0.16 * arc;
        swingRotY = 0.95 * arc;
        swingRotZ = 0.85 * arc;
      }
    }

    // Windup offset for Frag Grenade Throw
    let fragOffsetY = 0;
    let fragOffsetZ = 0;
    let fragRotX = 0;
    if (this.grenadeThrowing) {
      const p = 1 - this.grenadeThrowTimer / 0.42;
      if (p < 0.52) {
        const pull = p / 0.52;
        fragOffsetZ = pull * 0.14;
        fragOffsetY = pull * 0.05;
        fragRotX = pull * 0.45;
      } else {
        const fwd = (p - 0.52) / 0.48;
        fragOffsetZ = 0.14 - fwd * 0.34;
        fragOffsetY = 0.05 - fwd * 0.18;
        fragRotX = 0.45 - fwd * 1.1;
      }
    }

    const targetX = (isAds ? adsPos.x : hipPos.x + (player.isSprinting ? -0.05 : 0)) + swingOffsetX;
    const targetY =
      (isAds ? adsPos.y : hipPos.y) -
      (player.isSprinting ? 0.055 : 0) -
      this.switchAnim * 0.16 +
      swingOffsetY +
      fragOffsetY;
    const targetZ = (isAds ? adsPos.z : hipPos.z) + this.kickOffsetZ + swingOffsetZ + fragOffsetZ;

    const bobX = Math.cos(moveMetrics.bobPhase * 0.5) * 0.012 * moveMetrics.bobAmount;
    const bobY = Math.abs(Math.sin(moveMetrics.bobPhase)) * -0.014 * moveMetrics.bobAmount;

    this.rigGroup.position.x = THREE.MathUtils.damp(this.rigGroup.position.x, targetX + this.swayX + bobX, 16, dt);
    this.rigGroup.position.y = THREE.MathUtils.damp(this.rigGroup.position.y, targetY + this.swayY + bobY, 16, dt);
    this.rigGroup.position.z = THREE.MathUtils.damp(this.rigGroup.position.z, targetZ, 22, dt);

    const sprintRotY = player.isSprinting ? 0.48 : 0;
    const sprintRotZ = player.isSprinting ? 0.22 : player.isSliding ? -0.18 : 0;
    const reloadRotZ = this.isReloading ? 0.42 : 0;
    const reloadRotX = this.isReloading ? -0.28 : 0;

    this.rigGroup.rotation.x = THREE.MathUtils.damp(
      this.rigGroup.rotation.x,
      this.kickRotX + reloadRotX - this.switchAnim * 0.35 + swingRotX + fragRotX,
      16,
      dt,
    );
    this.rigGroup.rotation.y = THREE.MathUtils.damp(
      this.rigGroup.rotation.y,
      sprintRotY + swingRotY,
      13,
      dt,
    );
    this.rigGroup.rotation.z = THREE.MathUtils.damp(
      this.rigGroup.rotation.z,
      sprintRotZ + reloadRotZ + swingRotZ,
      13,
      dt,
    );

    const spreadRad = computeWeaponSpread(spec, {
      isAds,
      moveSpeedRatio: moveMetrics.moveSpeedRatio,
      isCrouching: player.isCrouching || player.isSliding,
      isAirborne: !player.isGrounded,
    });
    const crosshairSpreadPx = spec.isMelee
      ? 6
      : Math.round(THREE.MathUtils.clamp(spreadRad * 780 + this.kickOffsetZ * 140, 4, 48));

    return { isAds, crosshairSpreadPx };
  }

  private performMeleeAttack(
    heavy: boolean,
    enemyMeshes: THREE.Object3D[],
    onHitEnemy: (hit: WeaponHitResult) => void,
    onHitProp?: (outcome: PropDamageOutcome) => void,
  ): void {
    const knifeSpec = WEAPON_SPECS.knife;
    const reach = knifeSpec.meleeReach ?? 2.85;
    _origin.copy(this.camera.position);
    this.camera.getWorldDirection(_dir);

    _raycaster.set(_origin, _dir);
    _raycaster.near = 0.1;
    _raycaster.far = reach;

    const worldHits = _raycaster.intersectObjects(this.world.raycastTargets, false);
    const enemyHits =
      enemyMeshes.length > 0 ? _raycaster.intersectObjects(enemyMeshes, false) : [];

    const firstWorld = worldHits[0];
    const firstEnemy = enemyHits[0];
    const enemyDist = firstEnemy ? firstEnemy.distance : Infinity;
    const worldDist = firstWorld ? firstWorld.distance : Infinity;

    if (firstEnemy && enemyDist < worldDist) {
      this.sound.playKnifeSlash(true);
      const { enemyId, zone } = firstEnemy.object.userData as {
        enemyId: number;
        zone: 'head' | 'torso' | 'limb';
      };
      const baseDmg = heavy ? Math.round(knifeSpec.damage * 1.35) : knifeSpec.damage;
      const isCrit = zone === 'head';
      const damage = isCrit ? Math.round(baseDmg * knifeSpec.headshotMultiplier) : baseDmg;
      const normal = firstEnemy.face
        ? firstEnemy.face.normal.clone().transformDirection(firstEnemy.object.matrixWorld)
        : _dir.clone().negate();

      this.world.spawnSparks(firstEnemy.point, normal, 10);
      onHitEnemy({
        enemyId,
        zone,
        damage,
        isCrit,
        isMelee: true,
        point: firstEnemy.point.clone(),
        normal,
      });
    } else if (firstWorld) {
      this.sound.playKnifeSlash(true);
      const normal = firstWorld.face
        ? firstWorld.face.normal.clone().transformDirection(firstWorld.object.matrixWorld)
        : _dir.clone().negate();
      this.world.spawnSparks(firstWorld.point, normal, 7);
      const propOutcome = this.world.damageProp(firstWorld.object, knifeSpec.damage);
      if (propOutcome) {
        onHitProp?.(propOutcome);
      }
    } else {
      this.sound.playKnifeSlash(false);
    }
  }

  private getActiveAnchors(): { muzzle: THREE.Object3D; eject: THREE.Object3D } {
    if (this.activeId === 'pistol') {
      return { muzzle: this.pistolMuzzleAnchor, eject: this.pistolEjectAnchor };
    }
    if (this.activeId === 'shotgun') {
      return { muzzle: this.shotgunMuzzleAnchor, eject: this.shotgunEjectAnchor };
    }
    if (this.activeId === 'marksman') {
      return { muzzle: this.marksmanMuzzleAnchor, eject: this.marksmanEjectAnchor };
    }
    if (this.activeId === 'smg') {
      return { muzzle: this.smgMuzzleAnchor, eject: this.smgEjectAnchor };
    }
    if (this.activeId === 'lmg') {
      return { muzzle: this.lmgMuzzleAnchor, eject: this.lmgEjectAnchor };
    }
    if (this.activeId === 'deagle') {
      return { muzzle: this.deagleMuzzleAnchor, eject: this.deagleEjectAnchor };
    }
    return { muzzle: this.rifleMuzzleAnchor, eject: this.rifleEjectAnchor };
  }

  private fireShot(
    player: Player,
    moveSpeedRatio: number,
    isAds: boolean,
    enemyMeshes: THREE.Object3D[],
    onHitEnemy: (hit: WeaponHitResult) => void,
    onHitProp?: (outcome: PropDamageOutcome) => void,
  ): void {
    const spec = this.getActiveSpec();
    this.sound.playGunshot(this.activeId, false);

    const recoilStep = getRecoilPatternStep(this.activeId, this.shotStreak, isAds);
    this.shotStreak++;
    this.streakResetTimer = 0.34;
    player.applyRecoil(recoilStep.pitch, recoilStep.yaw);

    this.kickOffsetZ = Math.min(0.16, this.kickOffsetZ + spec.kickBack);
    this.kickRotX = Math.min(
      0.3,
      this.kickRotX +
        (this.activeId === 'shotgun'
          ? 0.17
          : this.activeId === 'lmg'
            ? 0.15
            : this.activeId === 'deagle'
              ? 0.16
              : 0.11),
    );
    this.boltKick = 0.044;
    this.heatLevel = Math.min(
      1,
      this.heatLevel +
        (this.activeId === 'lmg' ? 0.22 : this.activeId === 'rifle' ? 0.14 : 0.12),
    );

    const { muzzle, eject } = this.getActiveAnchors();
    muzzle.getWorldPosition(_muzzleWorld);
    this.muzzleFlashMesh.position.copy(muzzle.position);
    this.muzzleFlashMesh.rotation.z = Math.random() * Math.PI * 2;
    const scale =
      (this.activeId === 'shotgun'
        ? 1.25
        : this.activeId === 'lmg'
          ? 1.45
          : this.activeId === 'deagle'
            ? 1.35
            : 0.9) + Math.random() * 0.4;
    this.muzzleFlashMesh.scale.set(scale, scale, scale);
    this.muzzleFlashMesh.visible = true;
    this.muzzleLight.position.copy(muzzle.position);
    this.muzzleLight.intensity =
      this.activeId === 'shotgun'
        ? 4.2
        : this.activeId === 'lmg'
          ? 5.2
          : this.activeId === 'deagle'
            ? 4.6
            : 3.2;
    this.muzzleFlashTimer = 0.04;

    eject.getWorldPosition(_ejectWorld);
    this.camera.getWorldDirection(_camForward);
    _camUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
    _camRight.crossVectors(_camForward, _camUp).normalize();
    this.world.spawnShellCasing(_ejectWorld, _camRight, _camUp, _camForward);

    if (this.heatLevel > 0.35) {
      this.world.spawnSmokeWisp(_muzzleWorld, 1, 0.52);
    }

    const spread = computeWeaponSpread(spec, {
      isAds,
      moveSpeedRatio,
      isCrouching: player.isCrouching || player.isSliding,
      isAirborne: !player.isGrounded,
    });

    const pellets = spec.pellets ?? 1;
    for (let p = 0; p < pellets; p++) {
      _origin.copy(this.camera.position);
      this.camera.getWorldDirection(_dir);
      _right.crossVectors(_dir, _up).normalize();
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * spread;
      _spreadOffset
        .copy(_right)
        .multiplyScalar(Math.cos(angle) * radius)
        .addScaledVector(_up, Math.sin(angle) * radius);
      _dir.add(_spreadOffset).normalize();

      _raycaster.set(_origin, _dir);
      _raycaster.near = 0.1;
      _raycaster.far = spec.range;

      const worldHits = _raycaster.intersectObjects(this.world.raycastTargets, false);
      const enemyHits =
        enemyMeshes.length > 0 ? _raycaster.intersectObjects(enemyMeshes, false) : [];

      const firstWorld = worldHits[0];
      const firstEnemy = enemyHits[0];
      const enemyDist = firstEnemy ? firstEnemy.distance : Infinity;
      const worldDist = firstWorld ? firstWorld.distance : Infinity;

      if (firstEnemy && enemyDist < worldDist) {
        const { enemyId, zone } = firstEnemy.object.userData as {
          enemyId: number;
          zone: 'head' | 'torso' | 'limb';
        };
        const { damage, isCrit } = computeHitDamage(spec, zone);
        const normal = firstEnemy.face
          ? firstEnemy.face.normal.clone().transformDirection(firstEnemy.object.matrixWorld)
          : _dir.clone().negate();

        this.world.spawnTracer(_muzzleWorld, firstEnemy.point);
        this.world.spawnSparks(firstEnemy.point, normal, isCrit ? 12 : 6);

        onHitEnemy({
          enemyId,
          zone,
          damage,
          isCrit,
          isMelee: false,
          point: firstEnemy.point.clone(),
          normal,
        });
      } else if (firstWorld) {
        const normal = firstWorld.face
          ? firstWorld.face.normal.clone().transformDirection(firstWorld.object.matrixWorld)
          : _dir.clone().negate();

        this.world.spawnTracer(_muzzleWorld, firstWorld.point);
        this.world.spawnSparks(firstWorld.point, normal, pellets > 1 ? 4 : 8);
        if (p < 3) {
          this.world.spawnBulletDecal(firstWorld.point, normal);
        }

        const propOutcome = this.world.damageProp(firstWorld.object, spec.damage);
        if (propOutcome) {
          this.sound.playHitmarker(false, propOutcome.destroyed);
          onHitProp?.(propOutcome);
        } else if (p === 0 && Math.random() < 0.38) {
          this.sound.playRicochet();
        }
      } else if (p < 3) {
        const farEnd = _origin.clone().addScaledVector(_dir, 65);
        this.world.spawnTracer(_muzzleWorld, farEnd);
      }
    }
  }

  dispose(): void {
    this.camera.remove(this.rigGroup);
    this.camera.remove(this.showcaseGroup);
    this.texLib.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
