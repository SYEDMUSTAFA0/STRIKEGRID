import * as THREE from 'three';
import { ProceduralTextureLibrary } from './textures';
import {
  FRAG_GRENADE_SPEC,
  RADIATION_ZONES,
  getSurfaceFloorHeight,
  isPointClearOfObstacles,
  resolveCircleAABBs,
} from './rules';
import {
  addCompositeTree,
  addEnterableTacticalBuilding,
  addForestUndergrowth,
  addLandingHelipad,
  addRestrictionPerimeter,
  addTacticalMotorcycle,
  addTacticalVehicle,
  type WorldBuildContext,
} from './vehicles';
import type { AABB2D, GraphicsQuality, MapId, RampCollider } from './types';

export interface DrivableVehicle {
  id: number;
  group: THREE.Group;
  wheels: THREE.Object3D[];
  kind: 'car' | 'bike';
  label: string;
  /** Local half-extents: x = width/2, z = length/2 (model forward is +Z) */
  halfX: number;
  halfZ: number;
  /** Live axis-aligned collider kept in world.obstacles */
  obstacle: AABB2D | null;
  occupied: boolean;
}

export interface PickupItem {
  id: number;
  kind: 'ammo' | 'health';
  mesh: THREE.Group;
  position: THREE.Vector3;
  baseY: number;
  age: number;
  active: boolean;
}

interface TracerEntry {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

interface SparkEntry {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface ShellEntry {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  bounced: boolean;
}

interface SmokeEntry {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  baseScale: number;
}

interface ShockwaveEntry {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
}

interface FireballEntry {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
}

export interface ActiveFragGrenade {
  group: THREE.Group;
  ledMat: THREE.MeshStandardMaterial;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  fuse: number;
  beepTimer: number;
}

export interface DestructibleProp {
  id: number;
  kind: 'crate' | 'barrel';
  group: THREE.Group;
  hitMesh: THREE.Mesh;
  obstacle: AABB2D;
  position: THREE.Vector3;
  hp: number;
  alive: boolean;
  fireLight?: THREE.PointLight;
}

export interface PropDamageOutcome {
  destroyed: boolean;
  kind: 'crate' | 'barrel';
  position: THREE.Vector3;
  explosionRadius: number;
  explosionDamage: number;
}

export interface FragDetonationEvent {
  position: THREE.Vector3;
  radius: number;
  maxDamage: number;
}

const MAX_TRACERS = 44;
const MAX_SPARKS = 160;
const MAX_DECALS = 90;
const MAX_SHELLS = 36;
const MAX_SMOKE = 56;
const MAX_SHOCKWAVES = 8;
const MAX_FIREBALLS = 6;

const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();

export class World {
  public readonly obstacles: AABB2D[] = [];
  public readonly ramps: RampCollider[] = [];
  public readonly raycastTargets: THREE.Object3D[] = [];
  public readonly waypoints: THREE.Vector3[] = [];
  public readonly spawnPoints: THREE.Vector3[] = [];
  public readonly pickups: PickupItem[] = [];
  public currentMapId: MapId = 'dusk_yard';

  private readonly texLib: ProceduralTextureLibrary;
  private readonly sharedDisposables: Array<{ dispose: () => void }> = [];
  private mapDisposables: Array<{ dispose: () => void }> = [];
  private readonly mapGroup = new THREE.Group();

  private keyLight!: THREE.DirectionalLight;
  private fireLights: Array<{ light: THREE.PointLight; baseIntensity: number; phase: number }> = [];
  private flickerLamps: Array<{
    light: THREE.PointLight;
    bulbMat: THREE.MeshStandardMaterial;
    baseIntensity: number;
    phase: number;
  }> = [];
  private radarRotators: THREE.Object3D[] = [];
  private vehicleWheels: THREE.Object3D[] = [];
  private animatedBeacons: Array<{
    mat: THREE.MeshStandardMaterial;
    light?: THREE.PointLight;
    phase: number;
    baseIntensity: number;
  }> = [];
  private windSocks: THREE.Object3D[] = [];
  public readonly drivableVehicles: DrivableVehicle[] = [];
  private radiationFx: Array<{
    disc: THREE.Mesh;
    ring: THREE.Mesh;
    ringMat: THREE.MeshBasicMaterial;
    discMat: THREE.MeshBasicMaterial;
    phase: number;
  }> = [];
  private patrolVehicle: {
    group: THREE.Group;
    wheels: THREE.Object3D[];
    collider: AABB2D;
    dir: 1 | -1;
    speed: number;
    x: number;
    z: number;
    minX: number;
    maxX: number;
  } | null = null;
  private atmosphericPoints: THREE.Points | null = null;
  private particleMode: 'embers' | 'snow' | 'dust' | 'rain' = 'embers';
  private shadowQuality: GraphicsQuality = 'high';

  private destructibleProps: DestructibleProp[] = [];
  private nextPropId = 1;
  private onShellBounceSound: (() => void) | null = null;
  private onGrenadeBounceSound: (() => void) | null = null;
  private onGrenadeBeepSound: ((urgent: boolean) => void) | null = null;

  private activeGrenades: ActiveFragGrenade[] = [];
  private grenadeBodyGeo!: THREE.LatheGeometry;
  private grenadeSpoonGeo!: THREE.ExtrudeGeometry;
  private grenadeCollarGeo!: THREE.CylinderGeometry;
  private grenadeRingGeo!: THREE.TorusGeometry;
  private grenadeLedGeo!: THREE.SphereGeometry;
  private grenadeBodyMat!: THREE.MeshStandardMaterial;
  private grenadeTrimMat!: THREE.MeshStandardMaterial;

  private tracers: TracerEntry[] = [];
  private tracerCursor = 0;

  private sparkInstanced: THREE.InstancedMesh;
  private sparks: SparkEntry[] = [];
  private sparkCursor = 0;

  private shellInstanced: THREE.InstancedMesh;
  private shells: ShellEntry[] = [];
  private shellCursor = 0;

  private smokeInstanced: THREE.InstancedMesh;
  private smokes: SmokeEntry[] = [];
  private smokeCursor = 0;

  private shockwaves: ShockwaveEntry[] = [];
  private shockwaveCursor = 0;
  private fireballs: FireballEntry[] = [];
  private fireballCursor = 0;
  private explosionFlashLight: THREE.PointLight;

  private decals: THREE.Mesh[] = [];
  private decalCursor = 0;

  private nextPickupId = 1;
  private pickupSharedGeos: THREE.BufferGeometry[] = [];
  private pickupAmmoMat: THREE.MeshStandardMaterial;
  private pickupHealthMat: THREE.MeshStandardMaterial;
  private pickupTrimMat: THREE.MeshStandardMaterial;
  private contactShadowMat: THREE.MeshBasicMaterial;
  private contactShadowGeo: THREE.PlaneGeometry;

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    private readonly isSoftwareGl: boolean,
    initialMap: MapId = 'dusk_yard',
  ) {
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    this.texLib = new ProceduralTextureLibrary(maxAniso);

    scene.add(this.mapGroup);

    // Pooled Tracers
    const tracerGeo = new THREE.CylinderGeometry(0.016, 0.016, 1, 6);
    tracerGeo.rotateX(Math.PI / 2);
    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.92,
    });
    this.sharedDisposables.push(tracerGeo, tracerMat);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mesh = new THREE.Mesh(tracerGeo, tracerMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0, maxLife: 0.08 });
    }

    // Pooled Sparks
    const sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.16);
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
    this.sharedDisposables.push(sparkGeo, sparkMat);
    this.sparkInstanced = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
    this.sparkInstanced.frustumCulled = false;
    this.sparkInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_SPARKS; i++) {
      _mat4.makeScale(0, 0, 0);
      this.sparkInstanced.setMatrixAt(i, _mat4);
      this.sparks.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.3,
      });
    }
    this.sparkInstanced.instanceMatrix.needsUpdate = true;
    scene.add(this.sparkInstanced);

    // Pooled Bullet Hole Decals
    const holeTex = this.texLib.createBulletHoleTexture();
    const decalGeometry = new THREE.PlaneGeometry(0.18, 0.18);
    const decalMaterial = new THREE.MeshBasicMaterial({
      map: holeTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.sharedDisposables.push(decalGeometry, decalMaterial);
    for (let i = 0; i < MAX_DECALS; i++) {
      const m = new THREE.Mesh(decalGeometry, decalMaterial);
      m.visible = false;
      scene.add(m);
      this.decals.push(m);
    }

    // Shared Pickup Assets
    const crateBodyGeo = new THREE.BoxGeometry(0.56, 0.34, 0.42);
    const crateLidGeo = new THREE.BoxGeometry(0.6, 0.07, 0.46);
    const crateBadgeGeo = new THREE.BoxGeometry(0.24, 0.16, 0.44);
    this.pickupSharedGeos.push(crateBodyGeo, crateLidGeo, crateBadgeGeo);
    this.sharedDisposables.push(...this.pickupSharedGeos);

    this.pickupAmmoMat = new THREE.MeshStandardMaterial({
      color: 0x3e4c36,
      roughness: 0.55,
      metalness: 0.45,
    });
    this.pickupHealthMat = new THREE.MeshStandardMaterial({
      color: 0xd6d3cd,
      roughness: 0.42,
      metalness: 0.15,
    });
    this.pickupTrimMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0x7c2d12,
      emissiveIntensity: 0.8,
      roughness: 0.35,
      metalness: 0.6,
    });
    this.contactShadowGeo = new THREE.PlaneGeometry(1.1, 1.1);
    this.contactShadowGeo.rotateX(-Math.PI / 2);
    this.contactShadowMat = new THREE.MeshBasicMaterial({
      map: this.texLib.createContactShadowTexture(),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.sharedDisposables.push(
      this.pickupAmmoMat,
      this.pickupHealthMat,
      this.pickupTrimMat,
      this.contactShadowGeo,
      this.contactShadowMat,
    );

    // Pooled Brass Shell Casings
    const shellGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.032, 6);
    shellGeo.rotateZ(Math.PI / 2);
    const shellMat = new THREE.MeshStandardMaterial({
      color: 0xe6b84c,
      roughness: 0.25,
      metalness: 0.92,
    });
    this.sharedDisposables.push(shellGeo, shellMat);
    this.shellInstanced = new THREE.InstancedMesh(shellGeo, shellMat, MAX_SHELLS);
    this.shellInstanced.frustumCulled = false;
    this.shellInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_SHELLS; i++) {
      _mat4.makeScale(0, 0, 0);
      this.shellInstanced.setMatrixAt(i, _mat4);
      this.shells.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        spin: new THREE.Vector3(),
        life: 0,
        bounced: false,
      });
    }
    this.shellInstanced.instanceMatrix.needsUpdate = true;
    scene.add(this.shellInstanced);

    // Pooled Smoke / Heat Wisps
    const smokeGeo = new THREE.DodecahedronGeometry(0.08, 0);
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0xcbd5e1,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    this.sharedDisposables.push(smokeGeo, smokeMat);
    this.smokeInstanced = new THREE.InstancedMesh(smokeGeo, smokeMat, MAX_SMOKE);
    this.smokeInstanced.frustumCulled = false;
    this.smokeInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_SMOKE; i++) {
      _mat4.makeScale(0, 0, 0);
      this.smokeInstanced.setMatrixAt(i, _mat4);
      this.smokes.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.55,
        baseScale: 1,
      });
    }
    this.smokeInstanced.instanceMatrix.needsUpdate = true;
    scene.add(this.smokeInstanced);

    // Pooled Explosion Shockwaves & Volumetric Fireball Spheres
    const ringGeo = new THREE.RingGeometry(0.5, 0.85, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const fireballGeo = new THREE.IcosahedronGeometry(0.95, 2);
    this.sharedDisposables.push(ringGeo, fireballGeo);
    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffa73b,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.sharedDisposables.push(mat);
      this.shockwaves.push({ mesh, mat, life: 0, maxLife: 0.44 });
    }
    for (let i = 0; i < MAX_FIREBALLS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff8a2b,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(fireballGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.sharedDisposables.push(mat);
      this.fireballs.push({ mesh, mat, life: 0, maxLife: 0.34 });
    }
    this.explosionFlashLight = new THREE.PointLight(0xff7b24, 0, 28, 1.5);
    scene.add(this.explosionFlashLight);

    this.initGrenadeAssets();
    this.loadMap(initialMap);
  }

  private initGrenadeAssets(): void {
    // Sculpted 3D pineapple/M67 frag hull via LatheGeometry
    const hullPts = [
      new THREE.Vector2(0.0, -0.055),
      new THREE.Vector2(0.028, -0.052),
      new THREE.Vector2(0.044, -0.026),
      new THREE.Vector2(0.047, 0.0),
      new THREE.Vector2(0.043, 0.028),
      new THREE.Vector2(0.024, 0.05),
      new THREE.Vector2(0.018, 0.062),
      new THREE.Vector2(0.0, 0.064),
    ];
    this.grenadeBodyGeo = new THREE.LatheGeometry(hullPts, 14);
    this.grenadeBodyGeo.computeVertexNormals();

    const spoonShape = new THREE.Shape();
    spoonShape.moveTo(0, 0.065);
    spoonShape.lineTo(0.032, 0.06);
    spoonShape.lineTo(0.054, 0.02);
    spoonShape.lineTo(0.056, -0.036);
    spoonShape.lineTo(0.044, -0.04);
    spoonShape.lineTo(0.042, 0.016);
    spoonShape.lineTo(0.024, 0.048);
    spoonShape.lineTo(0, 0.053);
    spoonShape.closePath();
    this.grenadeSpoonGeo = new THREE.ExtrudeGeometry(spoonShape, {
      depth: 0.016,
      bevelEnabled: true,
      bevelThickness: 0.002,
      bevelSize: 0.002,
      bevelSegments: 2,
    });
    this.grenadeSpoonGeo.translate(0, 0, -0.008);

    this.grenadeCollarGeo = new THREE.CylinderGeometry(0.019, 0.021, 0.024, 10);
    this.grenadeRingGeo = new THREE.TorusGeometry(0.015, 0.003, 6, 12);
    this.grenadeLedGeo = new THREE.SphereGeometry(0.009, 8, 6);

    this.grenadeBodyMat = new THREE.MeshStandardMaterial({
      color: 0x3b4a34,
      roughness: 0.58,
      metalness: 0.35,
    });
    this.grenadeTrimMat = new THREE.MeshStandardMaterial({
      color: 0x262a30,
      roughness: 0.35,
      metalness: 0.85,
    });

    this.sharedDisposables.push(
      this.grenadeBodyGeo,
      this.grenadeSpoonGeo,
      this.grenadeCollarGeo,
      this.grenadeRingGeo,
      this.grenadeLedGeo,
      this.grenadeBodyMat,
      this.grenadeTrimMat,
    );
  }

  setShellBounceHandler(cb: () => void): void {
    this.onShellBounceSound = cb;
  }

  setGrenadeSoundHandlers(onBounce: () => void, onBeep: (urgent: boolean) => void): void {
    this.onGrenadeBounceSound = onBounce;
    this.onGrenadeBeepSound = onBeep;
  }

  loadMap(mapId: MapId): void {
    this.currentMapId = mapId;
    this.clearMap();

    if (mapId === 'arctic_outpost') {
      this.buildArcticOutpost();
    } else if (mapId === 'desert_compound') {
      this.buildDesertCompound();
    } else if (mapId === 'neon_docks') {
      this.buildNeonDocks();
    } else if (mapId === 'highland_ridge') {
      this.buildHighlandRidge();
    } else if (mapId === 'sunken_foundry') {
      this.buildSunkenFoundry();
    } else {
      this.buildDuskYard();
    }

    this.sanitizeSpawnsAndWaypoints();
    this.buildRadiationZones();
    this.setShadowQuality(this.shadowQuality);
  }

  private buildRadiationZones(): void {
    const zones = RADIATION_ZONES[this.currentMapId];
    if (!zones || zones.length === 0) return;
    const ringGeo = new THREE.RingGeometry(0.86, 1.0, 64);
    const discGeo = new THREE.CircleGeometry(1.0, 48);
    const tickGeo = new THREE.PlaneGeometry(0.5, 0.12);
    const hazardMat = new THREE.MeshBasicMaterial({
      color: 0xa3e635,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const discMatBase = new THREE.MeshBasicMaterial({
      color: 0x65a30d,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    for (const zone of zones) {
      const grp = new THREE.Group();
      grp.position.set(zone.x, 0.06, zone.z);

      const discMat = discMatBase.clone();
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.scale.setScalar(zone.radius);
      grp.add(disc);

      const ringMat = hazardMat.clone();
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(zone.radius);
      grp.add(ring);

      // Rotating hazard ticks just inside the rim
      const tickMat = hazardMat.clone();
      tickMat.opacity = 0.5;
      for (let i = 0; i < 10; i++) {
        const tick = new THREE.Mesh(tickGeo, tickMat);
        const ang = (i / 10) * Math.PI * 2;
        tick.position.set(Math.cos(ang) * zone.radius * 0.93, 0, Math.sin(ang) * zone.radius * 0.93);
        tick.rotation.x = -Math.PI / 2;
        tick.rotation.z = -ang;
        grp.add(tick);
      }
      grp.rotation.y = Math.random() * Math.PI;
      this.mapGroup.add(grp);
      this.mapDisposables.push(ringGeo, discGeo, tickGeo, hazardMat, discMatBase, discMat, ringMat, tickMat);
      this.radiationFx.push({
        disc,
        ring,
        ringMat,
        discMat,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  private sanitizeSpawnsAndWaypoints(): void {
    const cleanList = (list: THREE.Vector3[]) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const pt = list[i];
        if (!isPointClearOfObstacles(pt.x, pt.z, 0.65, this.obstacles)) {
          const resolved = resolveCircleAABBs(
            { x: pt.x, y: 0, z: pt.z },
            0.75,
            1.8,
            this.obstacles,
          );
          pt.x = resolved.x;
          pt.z = resolved.z;
        }
      }
    };
    cleanList(this.spawnPoints);
    cleanList(this.waypoints);
  }

  private clearMap(): void {
    this.clearPickups();
    this.clearDecals();
    this.clearGrenades();
    this.obstacles.length = 0;
    this.ramps.length = 0;
    this.raycastTargets.length = 0;
    this.waypoints.length = 0;
    this.spawnPoints.length = 0;
    this.fireLights.length = 0;
    this.flickerLamps.length = 0;
    this.destructibleProps.length = 0;
    this.radarRotators.length = 0;
    this.vehicleWheels.length = 0;
    this.animatedBeacons.length = 0;
    this.windSocks.length = 0;
    this.patrolVehicle = null;
    this.atmosphericPoints = null;
    this.drivableVehicles.length = 0;
    this.radiationFx.length = 0;

    while (this.mapGroup.children.length > 0) {
      this.mapGroup.remove(this.mapGroup.children[0]);
    }
    for (const d of this.mapDisposables) {
      d.dispose();
    }
    this.mapDisposables = [];
  }

  clearGrenades(): void {
    for (const g of this.activeGrenades) {
      this.scene.remove(g.group);
      g.ledMat.dispose();
    }
    this.activeGrenades.length = 0;
  }

  setShadowQuality(quality: GraphicsQuality): void {
    this.shadowQuality = quality;
    if (!this.keyLight) return;
    if (this.isSoftwareGl) {
      this.keyLight.castShadow = false;
      return;
    }
    this.keyLight.castShadow = true;
    const size = quality === 'high' ? 2048 : 1024;
    if (this.keyLight.shadow.mapSize.width !== size) {
      this.keyLight.shadow.mapSize.set(size, size);
      if (this.keyLight.shadow.map) {
        this.keyLight.shadow.map.dispose();
        this.keyLight.shadow.map = null;
      }
    }
  }

  private setupKeyLight(
    color: number,
    intensity: number,
    pos: [number, number, number],
  ): void {
    this.keyLight = new THREE.DirectionalLight(color, intensity);
    this.keyLight.position.set(pos[0], pos[1], pos[2]);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 2;
    this.keyLight.shadow.camera.far = 140;
    const d = 48;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.025;
    this.mapGroup.add(this.keyLight);
  }

  private addRimLight(colorHex: number, intensity: number, pos: [number, number, number]): void {
    const rim = new THREE.DirectionalLight(colorHex, intensity);
    rim.position.set(pos[0], pos[1], pos[2]);
    rim.castShadow = false;
    this.mapGroup.add(rim);
  }

  private addVolumetricBeam(
    x: number,
    y: number,
    z: number,
    tiltX: number,
    tiltZ: number,
    topR: number,
    botR: number,
    height: number,
    colorHex: number,
    opacity: number,
  ): void {
    const geo = new THREE.CylinderGeometry(topR, botR, height, 18, 1, true);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        beamColor: { value: new THREE.Color(colorHex) },
        beamOpacity: { value: opacity },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewPos;
        void main() {
          vUv = uv;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mvPos.xyz;
          vNormalView = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 beamColor;
        uniform float beamOpacity;
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewPos;
        void main() {
          float vertFade = smoothstep(0.0, 0.28, vUv.y) * smoothstep(1.0, 0.25, vUv.y);
          float rim = abs(dot(normalize(vNormalView), normalize(vViewPos)));
          float edgeSoft = pow(rim, 1.6);
          gl_FragColor = vec4(beamColor, vertFade * edgeSoft * beamOpacity);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(tiltX, 0, tiltZ);
    this.mapGroup.add(mesh);
    this.mapDisposables.push(geo, mat);
  }

  private buildSkyDome(
    topHex: number,
    midHex: number,
    horizonHex: number,
    sunDir: THREE.Vector3,
    sunColor: [number, number, number],
    sunGlow = 0.55,
  ): void {
    const skyGeo = new THREE.SphereGeometry(210, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(topHex) },
        midColor: { value: new THREE.Color(midHex) },
        horizonColor: { value: new THREE.Color(horizonHex) },
        sunDir: { value: sunDir.clone().normalize() },
        sunCol: { value: new THREE.Vector3(sunColor[0], sunColor[1], sunColor[2]) },
        sunGlow: { value: sunGlow },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 horizonColor;
        uniform vec3 sunDir;
        uniform vec3 sunCol;
        uniform float sunGlow;
        varying vec3 vWorldPos;
        void main() {
          vec3 dir = normalize(vWorldPos);
          float h = clamp(dir.y, 0.0, 1.0);
          vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.25, h));
          col = mix(col, topColor, smoothstep(0.22, 0.78, h));
          float sunAmt = max(dot(dir, sunDir), 0.0);
          col += sunCol * pow(sunAmt, 14.0) * sunGlow;
          col += sunCol * 1.25 * pow(sunAmt, 160.0);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.mapGroup.add(sky);
    this.mapDisposables.push(skyGeo, skyMat);
  }

  private buildAtmosphericParticles(
    mode: 'embers' | 'snow' | 'dust' | 'rain',
    count: number,
    colorHex: number,
    size: number,
    opacity: number,
  ): void {
    this.particleMode = mode;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 84;
      positions[i * 3 + 1] = 0.5 + Math.random() * 14;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 84;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: colorHex,
      size,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    this.atmosphericPoints = new THREE.Points(geo, mat);
    this.mapGroup.add(this.atmosphericPoints);
    this.mapDisposables.push(geo, mat);
  }

  private addStaticBox(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    registerCollision: boolean,
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.mapGroup.add(mesh);
    this.raycastTargets.push(mesh);
    this.mapDisposables.push(geo);

    if (registerCollision) {
      this.obstacles.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minZ: z - d / 2,
        maxZ: z + d / 2,
        minY: y - h / 2,
        maxY: y + h / 2,
      });
    }
    return mesh;
  }

  /**
   * Builds a true solid 3D sloped wedge ramp mesh via ExtrudeGeometry and registers an exact RampCollider.
   */
  private addSlopedRamp(opts: {
    centerX: number;
    centerZ: number;
    width: number;
    length: number;
    lowY: number;
    highY: number;
    axis: 'x' | 'z';
    dir: 1 | -1;
    mat: THREE.Material;
    railMat?: THREE.Material;
    withRails?: boolean;
  }): void {
    const { centerX, centerZ, width, length, lowY, highY, axis, dir, mat, railMat, withRails } = opts;
    const halfLen = length / 2;
    const halfWid = width / 2;

    const shape = new THREE.Shape();
    if (dir === 1) {
      shape.moveTo(-halfLen, lowY);
      shape.lineTo(halfLen, lowY);
      shape.lineTo(halfLen, highY);
    } else {
      shape.moveTo(-halfLen, lowY);
      shape.lineTo(halfLen, lowY);
      shape.lineTo(-halfLen, highY);
    }
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: width,
      bevelEnabled: false,
      steps: 1,
    });
    geo.translate(0, 0, -halfWid);
    if (axis === 'z') {
      // Shape was built along X -> Y; rotate so X becomes +Z
      geo.rotateY(-Math.PI / 2);
    }
    geo.computeVertexNormals();

    const rampMesh = new THREE.Mesh(geo, mat);
    rampMesh.position.set(centerX, 0, centerZ);
    rampMesh.castShadow = true;
    rampMesh.receiveShadow = true;
    this.mapGroup.add(rampMesh);
    this.raycastTargets.push(rampMesh);
    this.mapDisposables.push(geo);

    const spanX = axis === 'x' ? halfLen : halfWid;
    const spanZ = axis === 'z' ? halfLen : halfWid;
    this.ramps.push({
      minX: centerX - spanX,
      maxX: centerX + spanX,
      minZ: centerZ - spanZ,
      maxZ: centerZ + spanZ,
      axis,
      lowY,
      highY,
      dir,
    });

    if (withRails && railMat) {
      const railGeo = new THREE.BoxGeometry(axis === 'x' ? length : 0.1, 0.72, axis === 'z' ? length : 0.1);
      const slopeAngle = Math.atan2(highY - lowY, length) * (dir === 1 ? 1 : -1);
      const midY = (lowY + highY) * 0.5 + 0.38;
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(railGeo, railMat);
        if (axis === 'x') {
          rail.position.set(centerX, midY, centerZ + side * (halfWid - 0.08));
          rail.rotation.z = slopeAngle;
        } else {
          rail.position.set(centerX + side * (halfWid - 0.08), midY, centerZ);
          rail.rotation.x = -slopeAngle;
        }
        rail.castShadow = true;
        this.mapGroup.add(rail);
      }
      this.mapDisposables.push(railGeo);
    }
  }

  private buildPerimeterWalls(wallMat: THREE.Material, postMat: THREE.Material): void {
    this.addStaticBox(-47, 2.2, 0, 1.4, 4.4, 96, wallMat, true);
    this.addStaticBox(47, 2.2, 0, 1.4, 4.4, 96, wallMat, true);
    this.addStaticBox(0, 2.2, 47, 96, 4.4, 1.4, wallMat, true);
    this.addStaticBox(0, 2.2, -47, 96, 4.4, 1.4, wallMat, true);

    const postGeo = new THREE.BoxGeometry(0.25, 5.4, 0.25);
    this.mapDisposables.push(postGeo);
    for (let i = -44; i <= 44; i += 11) {
      for (const side of [-46.4, 46.4]) {
        const p1 = new THREE.Mesh(postGeo, postMat);
        p1.position.set(side, 2.7, i);
        const p2 = new THREE.Mesh(postGeo, postMat);
        p2.position.set(i, 2.7, side);
        this.mapGroup.add(p1, p2);
      }
    }
  }

  private createBuildContext(): WorldBuildContext {
    return {
      mapGroup: this.mapGroup,
      obstacles: this.obstacles,
      ramps: this.ramps,
      raycastTargets: this.raycastTargets,
      disposables: this.mapDisposables,
      texLib: this.texLib,
      beacons: this.animatedBeacons,
      windSocks: this.windSocks,
      wheels: this.vehicleWheels,
    };
  }

  private buildSharedZonesAndVehicles(
    mapId: MapId,
    mats: {
      wallMat: THREE.Material;
      roofMat: THREE.Material;
      trimMat: THREE.Material;
      rampMat: THREE.Material;
      barrierMat: THREE.Material;
    },
  ): void {
    const ctx = this.createBuildContext();
    const isArctic = mapId === 'arctic_outpost';
    const isDesert = mapId === 'desert_compound';
    const isNeon = mapId === 'neon_docks';
    const isHighland = mapId === 'highland_ridge';
    const isFoundry = mapId === 'sunken_foundry';
    const accentHex = isArctic
      ? 0x38bdf8
      : isDesert
        ? 0xf59e0b
        : isNeon
          ? 0x22d3ee
          : isHighland
            ? 0xa3e635
            : isFoundry
              ? 0xfb923c
              : 0xf59e0b;

    // 1. LANDING AREA (South z: 21..44) — Helipad, Wind Sock, Parked Bike & Tactical SUV
    addLandingHelipad(ctx, 0, 26, mats.roofMat, mats.trimMat);
    let obsMark = this.obstacles.length;
    const bike1 = addTacticalMotorcycle(
      ctx,
      8.0,
      28.0,
      -0.48,
      isArctic
        ? 0xdbeafe
        : isDesert
          ? 0xc29b61
          : isNeon
            ? 0x1f2a3a
            : isHighland
              ? 0x4a5d3a
              : isFoundry
                ? 0x3a2a22
                : 0x3b424c,
      accentHex,
    );
    this.drivableVehicles.push({
      id: this.drivableVehicles.length + 1,
      group: bike1,
      wheels: [],
      kind: 'bike',
      label: 'DIRT BIKE',
      halfX: 0.55,
      halfZ: 1.3,
      obstacle: this.obstacles[obsMark] ?? null,
      occupied: false,
    });
    const suv1 = addTacticalVehicle(ctx, {
      x: -9.8,
      z: 29.5,
      rotY: 0.38,
      variant: 'suv',
      bodyColorHex: isArctic
        ? 0x64748b
        : isDesert
          ? 0x9a7b56
          : isNeon
            ? 0x16222e
            : isHighland
              ? 0x55613f
              : isFoundry
                ? 0x4a3428
                : 0x2d3748,
      accentColorHex: accentHex,
      beaconColorHex: isArctic ? 0x38bdf8 : accentHex,
    });
    if (suv1.collider) {
      this.drivableVehicles.push({
        id: this.drivableVehicles.length + 1,
        group: suv1.group,
        wheels: suv1.wheels,
        kind: 'car',
        label: 'TACTICAL SUV',
        halfX: 1.1,
        halfZ: 2.2,
        obstacle: suv1.collider,
        occupied: false,
      });
    }

    // Live Moving Perimeter Patrol Pickup Truck on South Service Road (z = 40.5, clear of spawn & props)
    const patrol = addTacticalVehicle(ctx, {
      x: -24,
      z: 40.5,
      rotY: Math.PI / 2,
      variant: 'pickup',
      bodyColorHex: isArctic
        ? 0x475569
        : isDesert
          ? 0x8c6d46
          : isNeon
            ? 0x1b2836
            : isHighland
              ? 0x4c5a3c
              : isFoundry
                ? 0x40301f
                : 0x374151,
      accentColorHex: accentHex,
      beaconColorHex: accentHex,
      registerStaticCollision: false,
    });
    const patrolBox: AABB2D = {
      minX: -26.2,
      maxX: -21.8,
      minZ: 39.4,
      maxZ: 41.6,
      minY: 0,
      maxY: 1.9,
    };
    this.obstacles.push(patrolBox);
    this.patrolVehicle = {
      group: patrol.group,
      wheels: patrol.wheels,
      collider: patrolBox,
      dir: 1,
      speed: 4.8,
      x: -24,
      z: 40.5,
      minX: -32,
      maxX: 32,
    };

    // 2. BUILDING ZONE (West x <= -17) — Enterable Multi-Room Facility + Roof Ramp + Parked Bike & SUV
    addEnterableTacticalBuilding(ctx, {
      centerX: -28.0,
      centerZ: -1.5,
      wallMat: mats.wallMat,
      roofMat: mats.roofMat,
      trimMat: mats.trimMat,
      rampMat: mats.rampMat,
      accentColorHex: isArctic ? 0x38bdf8 : isDesert ? 0xf59e0b : accentHex,
      addSlopedRamp: (cfg) => this.addSlopedRamp(cfg),
    });
    obsMark = this.obstacles.length;
    const bike2 = addTacticalMotorcycle(
      ctx,
      -20.5,
      11.5,
      0.55,
      isArctic
        ? 0x93c5fd
        : isDesert
          ? 0xb48a54
          : isNeon
            ? 0x24384c
            : isHighland
              ? 0x5d7048
              : isFoundry
                ? 0x4e382a
                : 0x7c2d12,
      0xf59e0b,
    );
    this.drivableVehicles.push({
      id: this.drivableVehicles.length + 1,
      group: bike2,
      wheels: [],
      kind: 'bike',
      label: 'DIRT BIKE',
      halfX: 0.55,
      halfZ: 1.3,
      obstacle: this.obstacles[obsMark] ?? null,
      occupied: false,
    });
    const pickup1 = addTacticalVehicle(ctx, {
      x: -31.5,
      z: 13.5,
      rotY: 0.72,
      variant: 'pickup',
      bodyColorHex: isArctic
        ? 0x94a3b8
        : isDesert
          ? 0xa3855a
          : isNeon
            ? 0x22303f
            : isHighland
              ? 0x5c6b4a
              : isFoundry
                ? 0x4a3628
                : 0x4b5563,
      accentColorHex: isArctic ? 0x0ea5e9 : isDesert ? 0xd97706 : accentHex,
      beaconColorHex: 0xf59e0b,
    });
    if (pickup1.collider) {
      this.drivableVehicles.push({
        id: this.drivableVehicles.length + 1,
        group: pickup1.group,
        wheels: pickup1.wheels,
        kind: 'car',
        label: 'PICKUP TRUCK',
        halfX: 1.1,
        halfZ: 2.2,
        obstacle: pickup1.collider,
        occupied: false,
      });
    }

    // 3. FOREST AREA (East x >= 17) — Dense Composite 3D Trees & Fallen Timber Undergrowth
    const barkTex = this.texLib.createBarkSet(
      isArctic ? [74, 62, 54] : isDesert ? [108, 80, 56] : [78, 56, 40],
    );
    const barkMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: barkTex.map,
      normalMap: barkTex.normalMap,
      roughnessMap: barkTex.roughnessMap,
      roughness: 0.9,
      metalness: 0.04,
    });
    const foliageMat = new THREE.MeshStandardMaterial({
      color: isArctic ? 0x2d4f49 : isDesert ? 0x5c6b3c : 0x2b4d32,
      roughness: 0.86,
      metalness: 0.04,
    });
    const fernMat = new THREE.MeshStandardMaterial({
      color: isArctic ? 0x4a6b65 : isDesert ? 0x767c46 : 0x375f3c,
      roughness: 0.88,
      metalness: 0.02,
    });
    const snowCapMat = new THREE.MeshStandardMaterial({
      color: 0xd8e6f3,
      roughness: 0.84,
      metalness: 0.04,
    });
    this.mapDisposables.push(barkMat, foliageMat, fernMat, snowCapMat);

    const treeStyle = isArctic ? 'spruce_snow' : isDesert ? 'acacia_desert' : 'pine';
    const treePositions: Array<[number, number, number]> = [
      [23.5, -14.5, 1.05],
      [31.5, -15.5, 1.18],
      [39.0, -9.5, 0.96],
      [24.5, -4.5, 1.12],
      [33.5, -2.0, 1.24],
      [40.0, 4.5, 1.0],
      [23.5, 6.5, 0.95],
      [31.0, 10.5, 1.15],
      [38.5, 14.5, 1.08],
      [25.5, 15.5, 0.92],
    ];
    for (const [tx, tz, sc] of treePositions) {
      addCompositeTree(ctx, {
        x: tx,
        z: tz,
        scale: sc,
        style: treeStyle,
        barkMat,
        foliageMat,
        capMat: isArctic ? snowCapMat : undefined,
      });
    }

    const undergrowthSpots: Array<[number, number, number, boolean]> = [
      [28.5, -9.5, 0.4, true],
      [29.0, 2.5, -0.5, true],
      [35.5, 7.5, 0.9, false],
      [21.5, 12.0, 0.25, true],
    ];
    for (const [fx, fz, ry, hasLog] of undergrowthSpots) {
      addForestUndergrowth(ctx, fx, fz, ry, barkMat, fernMat, hasLog);
    }

    // 4. RESTRICTION AREA (North z <= -22) — Perimeter Security Fence, Gates, Signage & Patrol SUV/Bike
    addRestrictionPerimeter(ctx, -22, mats.trimMat, mats.barrierMat);
    const suv2 = addTacticalVehicle(ctx, {
      x: 0,
      z: -27.2,
      rotY: Math.PI * 0.42,
      variant: 'suv',
      bodyColorHex: 0x1e242c,
      accentColorHex: 0xef4444,
      beaconColorHex: 0xef4444,
    });
    if (suv2.collider) {
      this.drivableVehicles.push({
        id: this.drivableVehicles.length + 1,
        group: suv2.group,
        wheels: suv2.wheels,
        kind: 'car',
        label: 'SECURITY SUV',
        halfX: 1.1,
        halfZ: 2.2,
        obstacle: suv2.collider,
        occupied: false,
      });
    }
    obsMark = this.obstacles.length;
    const bike3 = addTacticalMotorcycle(ctx, -9.5, -28.0, 2.55, 0x1f2937, 0xef4444);
    this.drivableVehicles.push({
      id: this.drivableVehicles.length + 1,
      group: bike3,
      wheels: [],
      kind: 'bike',
      label: 'DIRT BIKE',
      halfX: 0.55,
      halfZ: 1.3,
      obstacle: this.obstacles[obsMark] ?? null,
      occupied: false,
    });
  }

  // =========================================================================
  // MAP 1: SECTOR 09 — DUSK YARD (Multi-Level Containers, Catwalks & Crane)
  // =========================================================================
  private buildDuskYard(): void {
    const horizonColor = new THREE.Color(0x212836);
    this.scene.background = horizonColor;
    this.scene.fog = new THREE.FogExp2(0x212836, 0.014);

    this.buildSkyDome(0x0b1120, 0x28324a, 0x6e473b, new THREE.Vector3(0.55, 0.22, -0.78), [1.0, 0.56, 0.28], 0.48);
    const hemi = new THREE.HemisphereLight(0x7c97cc, 0x2b2522, 0.56);
    this.mapGroup.add(hemi);
    this.setupKeyLight(0xffb574, 1.48, [36, 28, -24]);
    this.addRimLight(0x38bdf8, 0.62, [-34, 18, 28]);

    this.addVolumetricBeam(-10, 8.5, -18, 0.32, 0.22, 1.4, 5.2, 17, 0xffaa5c, 0.12);
    this.addVolumetricBeam(11, 8.5, -24, 0.32, 0.22, 1.4, 5.0, 17, 0xffaa5c, 0.11);
    this.addVolumetricBeam(28, 8.5, 2, 0.26, 0.2, 1.4, 5.0, 17, 0xffb366, 0.1);

    const asphalt = this.texLib.createAsphaltSet(18);
    const groundGeo = new THREE.PlaneGeometry(160, 160);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: asphalt.map,
      normalMap: asphalt.normalMap,
      roughnessMap: asphalt.roughnessMap,
      roughness: 0.92,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.mapGroup.add(ground);
    this.raycastTargets.push(ground);
    this.mapDisposables.push(groundGeo, groundMat);

    const stripeGeo = new THREE.PlaneGeometry(0.28, 36);
    stripeGeo.rotateX(-Math.PI / 2);
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xd99b26,
      roughness: 0.85,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.mapDisposables.push(stripeGeo, stripeMat);
    for (const x of [-4.5, 4.5]) {
      const stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.position.set(x, 0.025, 0);
      stripe.receiveShadow = true;
      this.mapGroup.add(stripe);
    }

    const steelMat = new THREE.MeshStandardMaterial({ color: 0x383e47, roughness: 0.48, metalness: 0.78 });
    const concrete = this.texLib.createConcreteSet(4, 2);
    const concreteMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: concrete.map,
      normalMap: concrete.normalMap,
      roughnessMap: concrete.roughnessMap,
      roughness: 0.88,
      metalness: 0.05,
    });
    const trimMetalMat = new THREE.MeshStandardMaterial({ color: 0x262b33, roughness: 0.35, metalness: 0.85 });
    const catwalkDeckMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.55, metalness: 0.7 });
    const hazardRailMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.45, metalness: 0.55 });
    const crateTex = this.texLib.createMetalCrateSet();
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: crateTex.map,
      normalMap: crateTex.normalMap,
      roughnessMap: crateTex.roughnessMap,
      roughness: 0.6,
      metalness: 0.55,
    });
    this.mapDisposables.push(
      steelMat,
      concreteMat,
      trimMetalMat,
      catwalkDeckMat,
      hazardRailMat,
      crateMat,
    );

    // Warehouse canopy backstop & columns in North Restriction Area
    this.addStaticBox(0, 4.2, -45, 56, 8.4, 1.2, concreteMat, true);
    const colGeo = new THREE.BoxGeometry(0.55, 8.2, 0.55);
    const beamGeo = new THREE.BoxGeometry(34, 0.55, 0.6);
    const roofGeo = new THREE.BoxGeometry(36, 0.25, 21);
    this.mapDisposables.push(colGeo, beamGeo, roofGeo);
    for (const z of [-24, -33, -42]) {
      for (const x of [-16, 16]) {
        const col = new THREE.Mesh(colGeo, steelMat);
        col.position.set(x, 4.1, z);
        col.castShadow = true;
        col.receiveShadow = true;
        this.mapGroup.add(col);
        this.raycastTargets.push(col);
        this.obstacles.push({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35, maxY: 8.2 });
      }
      const truss = new THREE.Mesh(beamGeo, steelMat);
      truss.position.set(0, 8.2, z);
      truss.castShadow = true;
      this.mapGroup.add(truss);
    }
    const roof = new THREE.Mesh(roofGeo, steelMat);
    roof.position.set(0, 8.65, -33);
    roof.castShadow = true;
    roof.receiveShadow = true;
    this.mapGroup.add(roof);

    this.buildGantryCrane(0, -16, steelMat);

    // Shipping containers in Central Yard & Restriction Area (cleanly clear of Building, Forest & Helipad)
    const containerMats = [
      this.makeContainerMaterial([138, 52, 42], 301),
      this.makeContainerMaterial([64, 82, 62], 302),
      this.makeContainerMaterial([166, 118, 42], 303),
      this.makeContainerMaterial([56, 74, 96], 304),
    ];
    const containers = [
      { x: -12, y: 0, z: 12, rotY: 0, matIdx: 0 },
      { x: 12, y: 0, z: 12, rotY: 0, matIdx: 3 },
      { x: -12, y: 2.9, z: 12, rotY: 0.04, matIdx: 2 },
      { x: -7, y: 0, z: -1, rotY: Math.PI / 2, matIdx: 1 },
      { x: 8, y: 0, z: -2, rotY: Math.PI / 2, matIdx: 0 },
      { x: -11, y: 0, z: -13, rotY: Math.PI / 2, matIdx: 2 },
      { x: 11, y: 0, z: -14, rotY: Math.PI / 2, matIdx: 1 },
      { x: 0, y: 0, z: -36, rotY: Math.PI / 2, matIdx: 0 },
      { x: 0, y: 2.9, z: -36, rotY: Math.PI / 2 - 0.03, matIdx: 3 },
      { x: -24, y: 0, z: -30, rotY: 0, matIdx: 1 },
      { x: 24, y: 0, z: -30, rotY: 0, matIdx: 2 },
    ];
    for (const c of containers) {
      this.addShippingContainer(c.x, c.y, c.z, c.rotY, containerMats[c.matIdx], trimMetalMat);
    }

    // Elevated Steel Catwalks & Sloped Ramps onto container roofs
    this.addStaticBox(15.2, 2.75, 12.0, 3.2, 0.3, 4.2, catwalkDeckMat, true);
    this.addStaticBox(16.6, 1.35, 13.9, 0.28, 2.7, 0.28, steelMat, true);
    this.addStaticBox(16.6, 1.35, 10.1, 0.28, 2.7, 0.28, steelMat, true);
    this.addSlopedRamp({
      centerX: 15.2,
      centerZ: 18.6,
      width: 2.6,
      length: 8.6,
      lowY: 0,
      highY: 2.9,
      axis: 'z',
      dir: -1,
      mat: catwalkDeckMat,
      railMat: hazardRailMat,
      withRails: true,
    });

    const barriers = [
      { x: -3.2, z: 16.5, rotY: 0.12 },
      { x: 3.4, z: 16.0, rotY: -0.1 },
      { x: 0, z: 5.5, rotY: 0 },
      { x: -15, z: -6, rotY: Math.PI / 2 },
      { x: 15, z: -6, rotY: Math.PI / 2 },
      { x: -7, z: -31, rotY: 0 },
      { x: 7, z: -31, rotY: 0 },
    ];
    for (const b of barriers) {
      this.addConcreteBarrier(b.x, b.z, b.rotY, concreteMat);
    }

    const crateClusters = [
      { x: -5.5, z: 9.5, stacked: true },
      { x: 6.2, z: 9.2, stacked: false },
      { x: -2.2, z: -9.5, stacked: false },
      { x: 3.0, z: -10.2, stacked: true },
      { x: -16, z: -34, stacked: true },
      { x: 16, z: -34, stacked: false },
    ];
    for (const cl of crateClusters) {
      this.addCrateCluster(cl.x, cl.z, cl.stacked, crateMat, trimMetalMat);
    }

    this.addIndustrialLamp(-17, 19, Math.PI * 0.25, trimMetalMat, 0xffa448, true);
    this.addIndustrialLamp(17, 19, -Math.PI * 0.25, trimMetalMat, 0xffa448, false);
    this.addIndustrialLamp(0, -33, 0, trimMetalMat, 0xffa448, true);

    this.addHazardBarrel(-7.5, 17, 0);
    this.addHazardBarrel(8.5, -7, 1.7);
    this.addHazardBarrel(-14, -30, 3.4);

    this.addDestructibleWoodCrate(-9.5, 18.0);
    this.addDestructibleWoodCrate(9.5, 18.0);
    this.addDestructibleWoodCrate(-28, -2.5); // inside Building Zone!
    this.addDestructibleWoodCrate(21, -2);
    this.addExplosiveBarrel(-3.8, 1.5);
    this.addExplosiveBarrel(13.0, -7.5);
    this.addExplosiveBarrel(0, -24.5);

    this.buildSharedZonesAndVehicles('dusk_yard', {
      wallMat: concreteMat,
      roofMat: catwalkDeckMat,
      trimMat: trimMetalMat,
      rampMat: catwalkDeckMat,
      barrierMat: concreteMat,
    });

    this.buildPerimeterWalls(concreteMat, trimMetalMat);
    this.buildDistantSkyline(0x1a202c);
    this.buildAtmosphericParticles('embers', 110, 0xffb366, 0.14, 0.55);

    this.waypoints.push(
      new THREE.Vector3(0, 0, 14),
      new THREE.Vector3(-12, 0, 5),
      new THREE.Vector3(12, 0, 5),
      new THREE.Vector3(0, 0, -6),
      new THREE.Vector3(-17, 0, -10),
      new THREE.Vector3(17, 0, -10),
      new THREE.Vector3(-25, 0, -1),
      new THREE.Vector3(27, 0, 1),
      new THREE.Vector3(-10, 0, -25),
      new THREE.Vector3(10, 0, -25),
      new THREE.Vector3(0, 0, -32),
    );
    this.spawnPoints.push(
      new THREE.Vector3(-16, 0, -26),
      new THREE.Vector3(16, 0, -26),
      new THREE.Vector3(0, 0, -32),
      new THREE.Vector3(-17, 0, -8),
      new THREE.Vector3(18, 0, -8),
      new THREE.Vector3(-25, 0, 2),
      new THREE.Vector3(27, 0, 4),
      new THREE.Vector3(-10, 0, -38),
      new THREE.Vector3(10, 0, -38),
    );
  }

  // =========================================================================
  // MAP 2: ARCTIC OUTPOST — BLIZZARD (Radar Domes, Snowbanks/Ramps & Bunkers)
  // =========================================================================
  private buildArcticOutpost(): void {
    const horizonColor = new THREE.Color(0x1b2c42);
    this.scene.background = horizonColor;
    this.scene.fog = new THREE.FogExp2(0x1b2c42, 0.0175);

    this.buildSkyDome(0x091322, 0x1a304d, 0x5178a0, new THREE.Vector3(-0.5, 0.28, -0.82), [0.58, 0.85, 1.0], 0.42);
    const hemi = new THREE.HemisphereLight(0x9bc4f2, 0x3b4859, 0.52);
    this.mapGroup.add(hemi);
    this.setupKeyLight(0xa8d8ff, 1.28, [-30, 32, -26]);
    this.addRimLight(0xffcf99, 0.52, [32, 16, 26]);

    this.addVolumetricBeam(-14, 9.0, -8, 0.26, -0.22, 1.6, 5.8, 18, 0x7dd3fc, 0.11);
    this.addVolumetricBeam(12, 9.0, -14, 0.26, -0.22, 1.6, 5.5, 18, 0x7dd3fc, 0.1);

    const snow = this.texLib.createSnowSet(18);
    const groundGeo = new THREE.PlaneGeometry(160, 160);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: snow.map,
      normalMap: snow.normalMap,
      roughnessMap: snow.roughnessMap,
      roughness: 0.86,
      metalness: 0.04,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.mapGroup.add(ground);
    this.raycastTargets.push(ground);
    this.mapDisposables.push(groundGeo, groundMat);

    const concrete = this.texLib.createConcreteSet(3, 1);
    const bunkerMat = new THREE.MeshStandardMaterial({
      color: 0xb8c5d4,
      map: concrete.map,
      normalMap: concrete.normalMap,
      roughnessMap: concrete.roughnessMap,
      roughness: 0.88,
      metalness: 0.08,
    });
    const snowBankMat = new THREE.MeshStandardMaterial({
      color: 0xd8e4f0,
      map: snow.map,
      normalMap: snow.normalMap,
      roughness: 0.88,
      metalness: 0.03,
    });
    const frostMetalMat = new THREE.MeshStandardMaterial({
      color: 0x425469,
      roughness: 0.45,
      metalness: 0.72,
    });
    const crateTex = this.texLib.createMetalCrateSet();
    const frostCrateMat = new THREE.MeshStandardMaterial({
      color: 0xa6bdd4,
      map: crateTex.map,
      normalMap: crateTex.normalMap,
      roughnessMap: crateTex.roughnessMap,
      roughness: 0.68,
      metalness: 0.45,
    });
    const domeMat = new THREE.MeshStandardMaterial({
      color: 0xcbd8e6,
      roughness: 0.48,
      metalness: 0.14,
      flatShading: true,
    });
    const windowGlowMat = new THREE.MeshStandardMaterial({
      color: 0xffd180,
      emissive: 0xffa726,
      emissiveIntensity: 1.5,
    });
    this.mapDisposables.push(
      bunkerMat,
      snowBankMat,
      frostMetalMat,
      frostCrateMat,
      domeMat,
      windowGlowMat,
    );

    // Hero Landmarks: Geodesic Radar Domes inside North Restriction Area
    this.addRadarDome(-14, -33, bunkerMat, domeMat, frostMetalMat);
    this.addRadarDome(14, -33, bunkerMat, domeMat, frostMetalMat);

    // Arctic Research Bunkers in Central/North zones
    this.addArcticBunker(-13, -12, Math.PI / 2, bunkerMat, frostMetalMat, windowGlowMat);
    this.addArcticBunker(13, -12, -Math.PI / 2, bunkerMat, frostMetalMat, windowGlowMat);
    this.addArcticBunker(0, -37, 0, bunkerMat, frostMetalMat, windowGlowMat);

    // Central raised snow ridge & opposing twin snow ramps for high-ground duels
    this.addStaticBox(0, 0.8, -5.5, 4.6, 1.6, 4.4, snowBankMat, true);
    this.addSlopedRamp({
      centerX: 0,
      centerZ: -0.3,
      width: 4.2,
      length: 6.0,
      lowY: 0,
      highY: 1.6,
      axis: 'z',
      dir: -1,
      mat: snowBankMat,
    });
    this.addSlopedRamp({
      centerX: 0,
      centerZ: -10.7,
      width: 4.2,
      length: 6.0,
      lowY: 0,
      highY: 1.6,
      axis: 'z',
      dir: 1,
      mat: snowBankMat,
    });

    // Cryo fuel tanks in Restriction corners
    this.addCryoTank(-32, -32, frostMetalMat, domeMat);
    this.addCryoTank(32, -32, frostMetalMat, domeMat);

    // Concrete blast walls & frosted cargo crates
    const barriers = [
      { x: -4.2, z: 16.5, rotY: 0.14 },
      { x: 4.2, z: 16.5, rotY: -0.14 },
      { x: 0, z: 6.5, rotY: 0 },
      { x: -11, z: 1, rotY: 0.45 },
      { x: 11, z: 1, rotY: -0.45 },
    ];
    for (const b of barriers) {
      this.addConcreteBarrier(b.x, b.z, b.rotY, bunkerMat);
    }

    const crateClusters = [
      { x: -6.5, z: 10.5, stacked: true },
      { x: 6.5, z: 10.5, stacked: false },
      { x: -5.5, z: -26, stacked: true },
      { x: 5.5, z: -26, stacked: false },
    ];
    for (const cl of crateClusters) {
      this.addCrateCluster(cl.x, cl.z, cl.stacked, frostCrateMat, frostMetalMat);
    }

    this.addIndustrialLamp(-17, 19, Math.PI * 0.25, frostMetalMat, 0x67e8f9, false);
    this.addIndustrialLamp(17, 19, -Math.PI * 0.25, frostMetalMat, 0x67e8f9, true);
    this.addIndustrialLamp(0, -30, 0, frostMetalMat, 0x7dd3fc, false);

    this.addDestructibleWoodCrate(-9.5, 14.5);
    this.addDestructibleWoodCrate(9.5, 14.5);
    this.addDestructibleWoodCrate(-28, -2.5);
    this.addExplosiveBarrel(-6.5, -6.5);
    this.addExplosiveBarrel(7.5, -6.0);
    this.addExplosiveBarrel(0, -24.5);

    this.buildSharedZonesAndVehicles('arctic_outpost', {
      wallMat: bunkerMat,
      roofMat: frostMetalMat,
      trimMat: frostMetalMat,
      rampMat: snowBankMat,
      barrierMat: bunkerMat,
    });

    this.buildPerimeterWalls(bunkerMat, frostMetalMat);
    this.buildDistantSkyline(0x1f3045);
    this.buildAtmosphericParticles('snow', 390, 0xdbeafe, 0.18, 0.78);

    this.waypoints.push(
      new THREE.Vector3(0, 0, 13),
      new THREE.Vector3(-11, 0, 6),
      new THREE.Vector3(11, 0, 6),
      new THREE.Vector3(-5, 0, -5),
      new THREE.Vector3(5, 0, -5),
      new THREE.Vector3(-25, 0, -1),
      new THREE.Vector3(27, 0, 1),
      new THREE.Vector3(0, 0, -18),
      new THREE.Vector3(-10, 0, -26),
      new THREE.Vector3(10, 0, -26),
    );
    this.spawnPoints.push(
      new THREE.Vector3(-19, 0, -26),
      new THREE.Vector3(19, 0, -26),
      new THREE.Vector3(0, 0, -31),
      new THREE.Vector3(-18, 0, -5),
      new THREE.Vector3(18, 0, -5),
      new THREE.Vector3(-25, 0, 2),
      new THREE.Vector3(27, 0, 3),
      new THREE.Vector3(-8, 0, -39),
      new THREE.Vector3(8, 0, -39),
    );
  }

  private addRadarDome(
    x: number,
    z: number,
    baseMat: THREE.Material,
    domeMat: THREE.Material,
    metalMat: THREE.Material,
  ): void {
    const group = new THREE.Group();
    const pedGeo = new THREE.CylinderGeometry(3.4, 3.8, 3.2, 8);
    const collarGeo = new THREE.CylinderGeometry(3.55, 3.55, 0.35, 8);
    const domeGeo = new THREE.IcosahedronGeometry(3.2, 2);
    const dishMastGeo = new THREE.CylinderGeometry(0.14, 0.18, 1.8, 8);
    const dishGeo = new THREE.BoxGeometry(2.8, 0.65, 0.2);

    const ped = new THREE.Mesh(pedGeo, baseMat);
    ped.position.y = 1.6;
    ped.castShadow = true;
    ped.receiveShadow = true;
    const collar = new THREE.Mesh(collarGeo, metalMat);
    collar.position.y = 3.25;
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.y = 4.6;
    dome.castShadow = true;
    dome.receiveShadow = true;

    const rotator = new THREE.Group();
    rotator.position.y = 8.1;
    const mast = new THREE.Mesh(dishMastGeo, metalMat);
    const dish = new THREE.Mesh(dishGeo, metalMat);
    dish.position.y = 0.7;
    rotator.add(mast, dish);
    this.radarRotators.push(rotator);

    group.add(ped, collar, dome, rotator);
    group.position.set(x, 0, z);
    this.mapGroup.add(group);
    this.raycastTargets.push(ped, dome);
    this.mapDisposables.push(pedGeo, collarGeo, domeGeo, dishMastGeo, dishGeo);

    this.obstacles.push({
      minX: x - 3.6,
      maxX: x + 3.6,
      minZ: z - 3.6,
      maxZ: z + 3.6,
      maxY: 7.5,
    });
  }

  private addArcticBunker(
    x: number,
    z: number,
    rotY: number,
    wallMat: THREE.Material,
    metalMat: THREE.Material,
    windowMat: THREE.Material,
  ): void {
    const group = new THREE.Group();
    const bodyGeo = new THREE.BoxGeometry(7.2, 3.2, 4.6);
    const roofGeo = new THREE.BoxGeometry(7.8, 0.45, 5.2);
    const winGeo = new THREE.BoxGeometry(4.0, 0.42, 0.14);
    const frameGeo = new THREE.BoxGeometry(4.3, 0.6, 0.2);

    const body = new THREE.Mesh(bodyGeo, wallMat);
    body.position.y = 1.6;
    body.castShadow = true;
    body.receiveShadow = true;
    const roof = new THREE.Mesh(roofGeo, metalMat);
    roof.position.y = 3.42;
    roof.castShadow = true;
    const frame = new THREE.Mesh(frameGeo, metalMat);
    frame.position.set(0, 2.15, 2.32);
    const win = new THREE.Mesh(winGeo, windowMat);
    win.position.set(0, 2.15, 2.36);

    group.add(body, roof, frame, win);
    group.position.set(x, 0, z);
    group.rotation.y = rotY;
    this.mapGroup.add(group);
    this.raycastTargets.push(body, roof);
    this.mapDisposables.push(bodyGeo, roofGeo, winGeo, frameGeo);

    const halfX = Math.abs(Math.cos(rotY)) * 3.7 + Math.abs(Math.sin(rotY)) * 2.45;
    const halfZ = Math.abs(Math.sin(rotY)) * 3.7 + Math.abs(Math.cos(rotY)) * 2.45;
    this.obstacles.push({
      minX: x - halfX,
      maxX: x + halfX,
      minZ: z - halfZ,
      maxZ: z + halfZ,
      maxY: 3.65,
    });
  }

  private addCryoTank(x: number, z: number, metalMat: THREE.Material, shellMat: THREE.Material): void {
    const group = new THREE.Group();
    const cylGeo = new THREE.CylinderGeometry(1.4, 1.4, 4.4, 14);
    const capGeo = new THREE.SphereGeometry(1.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const bandGeo = new THREE.CylinderGeometry(1.46, 1.46, 0.22, 14);

    const cyl = new THREE.Mesh(cylGeo, shellMat);
    cyl.position.y = 2.2;
    cyl.castShadow = true;
    const cap = new THREE.Mesh(capGeo, metalMat);
    cap.position.y = 4.4;
    const b1 = new THREE.Mesh(bandGeo, metalMat);
    b1.position.y = 1.2;
    const b2 = new THREE.Mesh(bandGeo, metalMat);
    b2.position.y = 3.4;

    group.add(cyl, cap, b1, b2);
    group.position.set(x, 0, z);
    this.mapGroup.add(group);
    this.raycastTargets.push(cyl);
    this.mapDisposables.push(cylGeo, capGeo, bandGeo);
    this.obstacles.push({ minX: x - 1.45, maxX: x + 1.45, minZ: z - 1.45, maxZ: z + 1.45, maxY: 5.5 });
  }

  // =========================================================================
  // MAP 3: DESERT COMPOUND — HIGH NOON (Sandstone Arches, Ramps & Perches)
  // =========================================================================
  private buildDesertCompound(): void {
    const horizonColor = new THREE.Color(0xc59f6e);
    this.scene.background = horizonColor;
    this.scene.fog = new THREE.FogExp2(0xc59f6e, 0.013);

    this.buildSkyDome(0x3a6ea5, 0x9cb9cf, 0xe3be8d, new THREE.Vector3(0.35, 0.72, -0.58), [1.0, 0.88, 0.65], 0.34);
    const hemi = new THREE.HemisphereLight(0xfde8c8, 0x8c643c, 0.54);
    this.mapGroup.add(hemi);
    this.setupKeyLight(0xffe0ad, 1.52, [24, 48, -22]);
    this.addRimLight(0x8ec5fc, 0.48, [-28, 22, 30]);

    this.addVolumetricBeam(-12, 7.5, 6, 0.22, 0.16, 1.5, 4.8, 15, 0xffe0a3, 0.08);
    this.addVolumetricBeam(12, 7.5, 6, 0.22, 0.16, 1.5, 4.8, 15, 0xffe0a3, 0.08);

    const sand = this.texLib.createDesertSandSet(18);
    const groundGeo = new THREE.PlaneGeometry(160, 160);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: sand.map,
      normalMap: sand.normalMap,
      roughnessMap: sand.roughnessMap,
      roughness: 0.94,
      metalness: 0.02,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.mapGroup.add(ground);
    this.raycastTargets.push(ground);
    this.mapDisposables.push(groundGeo, groundMat);

    const sandstone = this.texLib.createSandstoneSet(2, 1);
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: sandstone.map,
      normalMap: sandstone.normalMap,
      roughnessMap: sandstone.roughnessMap,
      roughness: 0.9,
      metalness: 0.03,
    });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6e4e34, roughness: 0.85, metalness: 0.05 });
    const sandbagMat = new THREE.MeshStandardMaterial({ color: 0xb79f78, roughness: 0.92, metalness: 0.02 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0x5c4733, roughness: 0.55, metalness: 0.6 });
    this.mapDisposables.push(stoneMat, woodMat, sandbagMat, brassMat);

    // Rooftop Sniper Perches with sloped sandstone ramps in Central/Restriction flank
    this.addSniperPerchTower(-12, -13, 1, stoneMat, woodMat);
    this.addSniperPerchTower(12, -13, -1, stoneMat, woodMat);

    // Arched Sandstone Fortress Colonnade Walls
    this.addSandstoneArchWall(-12, 8, 0, stoneMat);
    this.addSandstoneArchWall(12, 8, 0, stoneMat);
    this.addSandstoneArchWall(0, -34, 0, stoneMat);
    this.addSandstoneArchWall(-22, -31, Math.PI / 2, stoneMat);
    this.addSandstoneArchWall(22, -31, Math.PI / 2, stoneMat);

    // Central Ruined Obelisk Courtyard Cover
    this.addStaticBox(0, 1.4, -5, 4.2, 2.8, 3.2, stoneMat, true);
    this.addStaticBox(0, 3.6, -5, 2.2, 1.8, 2.2, stoneMat, true);

    // Layered Sandbag Barricades
    const sandbags = [
      { x: -4.2, z: 16.5, rotY: 0.15 },
      { x: 4.2, z: 16.5, rotY: -0.15 },
      { x: 0, z: 6.5, rotY: 0 },
      { x: -8, z: -2, rotY: 0.5 },
      { x: 8, z: -2, rotY: -0.5 },
      { x: -8, z: -29, rotY: 0 },
      { x: 8, z: -29, rotY: 0 },
    ];
    for (const sb of sandbags) {
      this.addSandbagBarricade(sb.x, sb.z, sb.rotY, sandbagMat);
    }

    const clusters = [
      { x: -6.5, z: 11, stacked: true },
      { x: 6.5, z: 10.5, stacked: false },
      { x: -14, z: -32, stacked: true },
      { x: 14, z: -32, stacked: true },
    ];
    for (const cl of clusters) {
      this.addCrateCluster(cl.x, cl.z, cl.stacked, woodMat, brassMat);
    }

    this.addWindTurbine(-34, -32, brassMat);
    this.addWindTurbine(34, -32, brassMat);

    this.addDestructibleWoodCrate(-10, 14.5);
    this.addDestructibleWoodCrate(10, 14.5);
    this.addDestructibleWoodCrate(-28, -2.5);
    this.addExplosiveBarrel(-5.5, -1.5);
    this.addExplosiveBarrel(5.5, -1.5);
    this.addExplosiveBarrel(0, -24.5);

    this.buildSharedZonesAndVehicles('desert_compound', {
      wallMat: stoneMat,
      roofMat: stoneMat,
      trimMat: brassMat,
      rampMat: stoneMat,
      barrierMat: stoneMat,
    });

    this.buildPerimeterWalls(stoneMat, brassMat);
    this.buildDistantSkyline(0x9f7e58);
    this.buildAtmosphericParticles('dust', 140, 0xffe4b8, 0.14, 0.42);

    this.waypoints.push(
      new THREE.Vector3(0, 0, 12),
      new THREE.Vector3(-12, 0, 12),
      new THREE.Vector3(12, 0, 12),
      new THREE.Vector3(-5, 0, -2),
      new THREE.Vector3(5, 0, -2),
      new THREE.Vector3(-25, 0, -1),
      new THREE.Vector3(27, 0, 1),
      new THREE.Vector3(0, 0, -18),
      new THREE.Vector3(-10, 0, -26),
      new THREE.Vector3(10, 0, -26),
    );
    this.spawnPoints.push(
      new THREE.Vector3(-18, 0, -26),
      new THREE.Vector3(18, 0, -26),
      new THREE.Vector3(0, 0, -31),
      new THREE.Vector3(-17, 0, -6),
      new THREE.Vector3(17, 0, -6),
      new THREE.Vector3(-25, 0, 2),
      new THREE.Vector3(27, 0, 3),
      new THREE.Vector3(-9, 0, -38),
      new THREE.Vector3(9, 0, -38),
    );
  }


  private addSandstoneArchWall(
    x: number,
    z: number,
    rotY: number,
    stoneMat: THREE.Material,
  ): void {
    const group = new THREE.Group();
    const pillarGeo = new THREE.BoxGeometry(2.2, 4.2, 1.4);
    const lintelGeo = new THREE.BoxGeometry(8.6, 1.4, 1.4);
    const crenelGeo = new THREE.BoxGeometry(1.1, 0.65, 1.3);

    const lp = new THREE.Mesh(pillarGeo, stoneMat);
    lp.position.set(-3.2, 2.1, 0);
    lp.castShadow = true;
    lp.receiveShadow = true;
    const rp = new THREE.Mesh(pillarGeo, stoneMat);
    rp.position.set(3.2, 2.1, 0);
    rp.castShadow = true;
    rp.receiveShadow = true;
    const lintel = new THREE.Mesh(lintelGeo, stoneMat);
    lintel.position.set(0, 4.6, 0);
    lintel.castShadow = true;
    lintel.receiveShadow = true;

    group.add(lp, rp, lintel);
    for (const cx of [-3.4, -1.1, 1.1, 3.4]) {
      const c = new THREE.Mesh(crenelGeo, stoneMat);
      c.position.set(cx, 5.6, 0);
      c.castShadow = true;
      group.add(c);
    }

    group.position.set(x, 0, z);
    group.rotation.y = rotY;
    this.mapGroup.add(group);
    this.raycastTargets.push(lp, rp, lintel);
    this.mapDisposables.push(pillarGeo, lintelGeo, crenelGeo);

    const offsetL = new THREE.Vector3(-3.2, 0, 0).applyAxisAngle(_up, rotY);
    const offsetR = new THREE.Vector3(3.2, 0, 0).applyAxisAngle(_up, rotY);
    const halfX = Math.abs(Math.cos(rotY)) * 1.1 + Math.abs(Math.sin(rotY)) * 0.7;
    const halfZ = Math.abs(Math.sin(rotY)) * 1.1 + Math.abs(Math.cos(rotY)) * 0.7;
    const lHalfX = Math.abs(Math.cos(rotY)) * 4.3 + Math.abs(Math.sin(rotY)) * 0.7;
    const lHalfZ = Math.abs(Math.sin(rotY)) * 4.3 + Math.abs(Math.cos(rotY)) * 0.7;
    this.obstacles.push(
      {
        minX: x + offsetL.x - halfX,
        maxX: x + offsetL.x + halfX,
        minZ: z + offsetL.z - halfZ,
        maxZ: z + offsetL.z + halfZ,
        maxY: 5.8,
      },
      {
        minX: x + offsetR.x - halfX,
        maxX: x + offsetR.x + halfX,
        minZ: z + offsetR.z - halfZ,
        maxZ: z + offsetR.z + halfZ,
        maxY: 5.8,
      },
      // Overhead lintel collider (walkable underneath since minY = 3.9m!)
      {
        minX: x - lHalfX,
        maxX: x + lHalfX,
        minZ: z - lHalfZ,
        maxZ: z + lHalfZ,
        minY: 3.9,
        maxY: 5.8,
      },
    );
  }

  private addSandbagBarricade(x: number, z: number, rotY: number, bagMat: THREE.Material): void {
    const group = new THREE.Group();
    const bagGeo = new THREE.CapsuleGeometry(0.22, 0.62, 4, 8);
    bagGeo.rotateZ(Math.PI / 2);
    this.mapDisposables.push(bagGeo);

    for (let row = 0; row < 3; row++) {
      const count = row === 2 ? 2 : 3;
      for (let col = 0; col < count; col++) {
        const bag = new THREE.Mesh(bagGeo, bagMat);
        const bx = (col - (count - 1) / 2) * 0.96 + (row % 2) * 0.12;
        const by = 0.2 + row * 0.34;
        bag.position.set(bx, by, 0);
        bag.castShadow = true;
        bag.receiveShadow = true;
        group.add(bag);
        this.raycastTargets.push(bag);
      }
    }

    group.position.set(x, 0, z);
    group.rotation.y = rotY;
    this.mapGroup.add(group);

    const halfX = Math.abs(Math.cos(rotY)) * 1.55 + Math.abs(Math.sin(rotY)) * 0.35;
    const halfZ = Math.abs(Math.sin(rotY)) * 1.55 + Math.abs(Math.cos(rotY)) * 0.35;
    this.obstacles.push({
      minX: x - halfX,
      maxX: x + halfX,
      minZ: z - halfZ,
      maxZ: z + halfZ,
      maxY: 1.05,
    });
  }

  private addSniperPerchTower(
    x: number,
    z: number,
    stepDir: number,
    stoneMat: THREE.Material,
    woodMat: THREE.Material,
  ): void {
    // Elevated sandstone rooftop sniper deck (y = 2.4m) + waist-high parapet
    this.addStaticBox(x, 1.2, z, 5.2, 2.4, 5.2, stoneMat, true);
    this.addStaticBox(x, 2.85, z + 2.35, 5.2, 0.9, 0.45, stoneMat, true);
    // Shade awning posts (registered with collision!)
    this.addStaticBox(x - 2.3, 3.6, z - 2.3, 0.24, 2.4, 0.24, woodMat, true);
    this.addStaticBox(x + 2.3, 3.6, z - 2.3, 0.24, 2.4, 0.24, woodMat, true);
    this.addStaticBox(x, 4.85, z - 1.4, 5.0, 0.14, 2.2, woodMat, false);

    // Flush continuous sloped sandstone ramp ascending smoothly from y=0 to y=2.4m
    const rampLen = 5.6;
    const rampCenterX = x + stepDir * (2.6 + rampLen / 2);
    this.addSlopedRamp({
      centerX: rampCenterX,
      centerZ: z,
      width: 2.6,
      length: rampLen,
      lowY: 0,
      highY: 2.4,
      axis: 'x',
      dir: stepDir === 1 ? -1 : 1,
      mat: stoneMat,
    });
  }

  // =========================================================================
  // SHARED COMPOSITE PROP HELPERS
  // =========================================================================
  private buildGantryCrane(x: number, z: number, steelMat: THREE.MeshStandardMaterial): void {
    const craneGroup = new THREE.Group();
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.42, metalness: 0.65 });
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xff5a1f,
      emissive: 0xff4500,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });
    this.mapDisposables.push(accentMat, beaconMat);

    const legGeo = new THREE.BoxGeometry(0.65, 11.5, 0.65);
    const spanGeo = new THREE.BoxGeometry(24, 0.9, 1.1);
    const trolleyGeo = new THREE.BoxGeometry(2.6, 0.85, 1.5);
    const beaconGeo = new THREE.SphereGeometry(0.24, 10, 8);
    this.mapDisposables.push(legGeo, spanGeo, trolleyGeo, beaconGeo);

    for (const lx of [-11, 11]) {
      const leg = new THREE.Mesh(legGeo, accentMat);
      leg.position.set(lx, 5.75, 0);
      leg.castShadow = true;
      leg.receiveShadow = true;
      craneGroup.add(leg);
      this.raycastTargets.push(leg);
      this.obstacles.push({ minX: x + lx - 0.4, maxX: x + lx + 0.4, minZ: z - 0.4, maxZ: z + 0.4, maxY: 11.5 });
    }

    const span = new THREE.Mesh(spanGeo, accentMat);
    span.position.set(0, 11.4, 0);
    span.castShadow = true;
    const trolley = new THREE.Mesh(trolleyGeo, steelMat);
    trolley.position.set(2.5, 10.6, 0);
    craneGroup.add(span, trolley);

    for (const lx of [-11, 11]) {
      const b = new THREE.Mesh(beaconGeo, beaconMat);
      b.position.set(lx, 12.1, 0);
      craneGroup.add(b);
    }
    craneGroup.position.set(x, 0, z);
    this.mapGroup.add(craneGroup);
  }

  private makeContainerMaterial(rgb: [number, number, number], seed: number): THREE.MeshStandardMaterial {
    const tex = this.texLib.createContainerSet(rgb, seed);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex.map,
      normalMap: tex.normalMap,
      roughnessMap: tex.roughnessMap,
      roughness: 0.78,
      metalness: 0.42,
    });
    this.mapDisposables.push(mat);
    return mat;
  }

  private addShippingContainer(
    x: number,
    y: number,
    z: number,
    rotY: number,
    bodyMat: THREE.MeshStandardMaterial,
    trimMat: THREE.MeshStandardMaterial,
  ): void {
    const group = new THREE.Group();
    const w = 2.6;
    const h = 2.9;
    const len = 6.2;

    const hullGeo = new THREE.BoxGeometry(w, h, len);
    const hull = new THREE.Mesh(hullGeo, bodyMat);
    hull.position.y = h / 2;
    hull.castShadow = true;
    hull.receiveShadow = true;
    group.add(hull);
    this.raycastTargets.push(hull);

    const railGeo = new THREE.BoxGeometry(w + 0.08, 0.14, len + 0.08);
    const topRail = new THREE.Mesh(railGeo, trimMat);
    topRail.position.y = h - 0.06;
    const botRail = new THREE.Mesh(railGeo, trimMat);
    botRail.position.y = 0.06;
    group.add(topRail, botRail);

    const barGeo = new THREE.CylinderGeometry(0.032, 0.032, h - 0.3, 6);
    for (const bx of [-0.45, -0.18, 0.18, 0.45]) {
      const bar = new THREE.Mesh(barGeo, trimMat);
      bar.position.set(bx, h / 2, len / 2 + 0.04);
      group.add(bar);
    }

    const ribGeo = new THREE.BoxGeometry(w - 0.15, 0.06, 0.18);
    for (let rz = -2.4; rz <= 2.4; rz += 1.2) {
      const rib = new THREE.Mesh(ribGeo, bodyMat);
      rib.position.set(0, h + 0.02, rz);
      group.add(rib);
    }

    group.position.set(x, y, z);
    group.rotation.y = rotY;
    this.mapGroup.add(group);
    this.mapDisposables.push(hullGeo, railGeo, barGeo, ribGeo);

    const halfX = Math.abs(Math.cos(rotY)) * (w / 2) + Math.abs(Math.sin(rotY)) * (len / 2);
    const halfZ = Math.abs(Math.sin(rotY)) * (w / 2) + Math.abs(Math.cos(rotY)) * (len / 2);
    this.obstacles.push({
      minX: x - halfX,
      maxX: x + halfX,
      minZ: z - halfZ,
      maxZ: z + halfZ,
      minY: y,
      maxY: y + h,
    });
  }

  private addConcreteBarrier(x: number, z: number, rotY: number, concreteMat: THREE.MeshStandardMaterial): void {
    const group = new THREE.Group();
    const baseGeo = new THREE.BoxGeometry(3.2, 0.35, 0.72);
    const topGeo = new THREE.BoxGeometry(3.2, 0.65, 0.38);
    const base = new THREE.Mesh(baseGeo, concreteMat);
    base.position.y = 0.175;
    base.castShadow = true;
    base.receiveShadow = true;
    const top = new THREE.Mesh(topGeo, concreteMat);
    top.position.y = 0.675;
    top.castShadow = true;
    top.receiveShadow = true;
    group.add(base, top);

    group.position.set(x, 0, z);
    group.rotation.y = rotY;
    this.mapGroup.add(group);
    this.raycastTargets.push(base, top);
    this.mapDisposables.push(baseGeo, topGeo);

    const halfX = Math.abs(Math.cos(rotY)) * 1.6 + Math.abs(Math.sin(rotY)) * 0.36;
    const halfZ = Math.abs(Math.sin(rotY)) * 1.6 + Math.abs(Math.cos(rotY)) * 0.36;
    this.obstacles.push({ minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ, maxY: 1.0 });
  }

  private addCrateCluster(
    x: number,
    z: number,
    stacked: boolean,
    crateMat: THREE.MeshStandardMaterial,
    trimMat: THREE.MeshStandardMaterial,
  ): void {
    const group = new THREE.Group();
    const c1Geo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
    const c2Geo = new THREE.BoxGeometry(1.15, 1.15, 1.15);
    const braceGeo = new THREE.BoxGeometry(1.44, 0.1, 1.44);

    const c1 = new THREE.Mesh(c1Geo, crateMat);
    c1.position.set(0, 0.7, 0);
    c1.castShadow = true;
    c1.receiveShadow = true;
    const brace = new THREE.Mesh(braceGeo, trimMat);
    brace.position.set(0, 1.36, 0);
    group.add(c1, brace);
    this.raycastTargets.push(c1);

    const c2 = new THREE.Mesh(c2Geo, crateMat);
    c2.position.set(1.38, 0.575, 0.25);
    c2.rotation.y = 0.22;
    c2.castShadow = true;
    c2.receiveShadow = true;
    group.add(c2);
    this.raycastTargets.push(c2);

    this.obstacles.push({ minX: x - 0.72, maxX: x + 0.72, minZ: z - 0.72, maxZ: z + 0.72, maxY: stacked ? 2.55 : 1.4 });
    this.obstacles.push({ minX: x + 0.75, maxX: x + 2.0, minZ: z - 0.4, maxZ: z + 0.9, maxY: 1.15 });

    if (stacked) {
      const c3 = new THREE.Mesh(c2Geo, crateMat);
      c3.position.set(0.05, 1.975, -0.05);
      c3.rotation.y = -0.18;
      c3.castShadow = true;
      c3.receiveShadow = true;
      group.add(c3);
      this.raycastTargets.push(c3);
    }

    group.position.set(x, 0, z);
    this.mapGroup.add(group);
    this.mapDisposables.push(c1Geo, c2Geo, braceGeo);
  }

  private addIndustrialLamp(
    x: number,
    z: number,
    rotY: number,
    metalMat: THREE.MeshStandardMaterial,
    lightColorHex: number,
    flicker = false,
  ): void {
    const group = new THREE.Group();
    const poleGeo = new THREE.CylinderGeometry(0.11, 0.16, 7.6, 8);
    const armGeo = new THREE.BoxGeometry(0.14, 0.14, 1.6);
    const hoodGeo = new THREE.BoxGeometry(0.7, 0.18, 0.45);
    const bulbGeo = new THREE.BoxGeometry(0.55, 0.08, 0.3);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: lightColorHex,
      emissive: lightColorHex,
      emissiveIntensity: 2.6,
      roughness: 0.2,
    });

    const pole = new THREE.Mesh(poleGeo, metalMat);
    pole.position.y = 3.8;
    pole.castShadow = true;
    const arm = new THREE.Mesh(armGeo, metalMat);
    arm.position.set(0, 7.5, -0.7);
    const hood = new THREE.Mesh(hoodGeo, metalMat);
    hood.position.set(0, 7.45, -1.4);
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(0, 7.34, -1.4);

    group.add(pole, arm, hood, bulb);
    group.position.set(x, 0, z);
    group.rotation.y = rotY;
    this.mapGroup.add(group);
    this.raycastTargets.push(pole);
    this.mapDisposables.push(poleGeo, armGeo, hoodGeo, bulbGeo, bulbMat);

    const pt = new THREE.PointLight(lightColorHex, 10, 22, 1.8);
    const worldOffset = new THREE.Vector3(0, 7.0, -1.4).applyAxisAngle(_up, rotY);
    pt.position.set(x + worldOffset.x, worldOffset.y, z + worldOffset.z);
    this.mapGroup.add(pt);
    if (flicker) {
      this.flickerLamps.push({
        light: pt,
        bulbMat,
        baseIntensity: 10,
        phase: Math.abs(x * 0.7 + z * 0.3),
      });
    }

    this.obstacles.push({ minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25, maxY: 7.6 });
  }

  private addWindTurbine(x: number, z: number, metalMat: THREE.Material): void {
    const group = new THREE.Group();
    const mastGeo = new THREE.CylinderGeometry(0.18, 0.35, 11.5, 8);
    const hubGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.7, 10);
    hubGeo.rotateX(Math.PI / 2);
    const bladeGeo = new THREE.BoxGeometry(0.24, 3.2, 0.06);

    const mast = new THREE.Mesh(mastGeo, metalMat);
    mast.position.y = 5.75;
    mast.castShadow = true;
    const hub = new THREE.Mesh(hubGeo, metalMat);
    hub.position.y = 11.5;

    const rotor = new THREE.Group();
    rotor.position.set(0, 11.5, 0.42);
    for (let i = 0; i < 3; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i / 3) * Math.PI * 2;
      const blade = new THREE.Mesh(bladeGeo, metalMat);
      blade.position.y = 1.6;
      arm.add(blade);
      rotor.add(arm);
    }
    this.radarRotators.push(rotor);
    group.add(mast, hub, rotor);
    group.position.set(x, 0, z);
    this.mapGroup.add(group);
    this.mapDisposables.push(mastGeo, hubGeo, bladeGeo);
    this.obstacles.push({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4, maxY: 11.5 });
  }

  private addDestructibleWoodCrate(x: number, z: number): void {
    const tex = this.texLib.createWoodCrateSet();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex.map,
      normalMap: tex.normalMap,
      roughnessMap: tex.roughnessMap,
      roughness: 0.85,
      metalness: 0.08,
    });
    const geo = new THREE.BoxGeometry(1.15, 1.15, 1.15);
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.575;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const propId = this.nextPropId++;
    mesh.userData.propId = propId;

    group.add(mesh);
    group.position.set(x, 0, z);
    this.mapGroup.add(group);
    this.raycastTargets.push(mesh);
    this.mapDisposables.push(mat, geo);

    const obstacle: AABB2D = {
      minX: x - 0.6,
      maxX: x + 0.6,
      minZ: z - 0.6,
      maxZ: z + 0.6,
      maxY: 1.15,
    };
    this.obstacles.push(obstacle);

    this.destructibleProps.push({
      id: propId,
      kind: 'crate',
      group,
      hitMesh: mesh,
      obstacle,
      position: new THREE.Vector3(x, 0.58, z),
      hp: 45,
      alive: true,
    });
  }

  private addExplosiveBarrel(x: number, z: number): void {
    const tex = this.texLib.createPressurizedBarrelSet();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex.map,
      normalMap: tex.normalMap,
      roughnessMap: tex.roughnessMap,
      roughness: 0.52,
      metalness: 0.55,
    });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.4, metalness: 0.8 });
    const geo = new THREE.CylinderGeometry(0.42, 0.42, 1.18, 14);
    const ringGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.07, 14);

    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.59;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const topRing = new THREE.Mesh(ringGeo, capMat);
    topRing.position.y = 1.16;
    const botRing = new THREE.Mesh(ringGeo, capMat);
    botRing.position.y = 0.05;

    const propId = this.nextPropId++;
    mesh.userData.propId = propId;

    group.add(mesh, topRing, botRing);
    group.position.set(x, 0, z);
    this.mapGroup.add(group);
    this.raycastTargets.push(mesh);
    this.mapDisposables.push(mat, capMat, geo, ringGeo);

    const obstacle: AABB2D = {
      minX: x - 0.46,
      maxX: x + 0.46,
      minZ: z - 0.46,
      maxZ: z + 0.46,
      maxY: 1.18,
    };
    this.obstacles.push(obstacle);

    this.destructibleProps.push({
      id: propId,
      kind: 'barrel',
      group,
      hitMesh: mesh,
      obstacle,
      position: new THREE.Vector3(x, 0.6, z),
      hp: 18,
      alive: true,
    });
  }

  damageProp(object: THREE.Object3D, damage: number): PropDamageOutcome | null {
    const propId = object.userData?.propId as number | undefined;
    if (!propId) return null;
    const prop = this.destructibleProps.find((p) => p.id === propId);
    if (!prop || !prop.alive) return null;

    prop.hp -= damage;
    if (prop.hp > 0) {
      return {
        destroyed: false,
        kind: prop.kind,
        position: prop.position,
        explosionRadius: 0,
        explosionDamage: 0,
      };
    }

    prop.alive = false;
    prop.group.visible = false;
    prop.obstacle.maxY = -10;
    const rIdx = this.raycastTargets.indexOf(prop.hitMesh);
    if (rIdx >= 0) this.raycastTargets.splice(rIdx, 1);
    if (prop.fireLight) {
      this.mapGroup.remove(prop.fireLight);
      prop.fireLight.intensity = 0;
      const lightIdx = this.fireLights.findIndex((fl) => fl.light === prop.fireLight);
      if (lightIdx >= 0) this.fireLights.splice(lightIdx, 1);
      prop.fireLight = undefined;
    }

    if (prop.kind === 'crate') {
      this.spawnSparks(prop.position, _up, 16);
      this.spawnSmokeWisp(prop.position, 6);
      this.spawnPickup(prop.position, Math.random() < 0.42 ? 'health' : 'ammo');
      return {
        destroyed: true,
        kind: 'crate',
        position: prop.position,
        explosionRadius: 0,
        explosionDamage: 0,
      };
    }

    this.triggerExplosionFX(prop.position);
    return {
      destroyed: true,
      kind: 'barrel',
      position: prop.position,
      explosionRadius: 8.2,
      explosionDamage: 145,
    };
  }

  damagePropsInRadius(origin: THREE.Vector3, radius: number, maxDamage: number): PropDamageOutcome[] {
    const outcomes: PropDamageOutcome[] = [];
    for (let i = 0; i < this.destructibleProps.length; i++) {
      const p = this.destructibleProps[i];
      if (!p.alive) continue;
      const d = origin.distanceTo(p.position);
      if (d < radius) {
        const out = this.damageProp(p.hitMesh, maxDamage * (1 - d / radius));
        if (out) outcomes.push(out);
      }
    }
    return outcomes;
  }

  private triggerExplosionFX(pos: THREE.Vector3): void {
    this.spawnSparks(pos, _up, 42);
    this.spawnSmokeWisp(pos, 16);
    this.spawnShockwave(pos);
    this.spawnFireball(pos);
    this.explosionFlashLight.position.set(pos.x, pos.y + 1.4, pos.z);
    this.explosionFlashLight.intensity = 46;
  }

  spawnFragGrenade(origin: THREE.Vector3, velocity: THREE.Vector3): void {
    const group = new THREE.Group();
    const hull = new THREE.Mesh(this.grenadeBodyGeo, this.grenadeBodyMat);
    const spoon = new THREE.Mesh(this.grenadeSpoonGeo, this.grenadeTrimMat);
    const collar = new THREE.Mesh(this.grenadeCollarGeo, this.grenadeTrimMat);
    collar.position.y = 0.068;
    const ring = new THREE.Mesh(this.grenadeRingGeo, this.grenadeTrimMat);
    ring.position.set(-0.02, 0.072, 0);
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0xff2d2d,
      emissive: 0xff1e1e,
      emissiveIntensity: 3.0,
      roughness: 0.2,
    });
    const led = new THREE.Mesh(this.grenadeLedGeo, ledMat);
    led.position.set(0, 0.082, 0.014);

    group.add(hull, spoon, collar, ring, led);
    group.scale.setScalar(1.35);
    group.position.copy(origin);
    this.scene.add(group);

    this.activeGrenades.push({
      group,
      ledMat,
      pos: origin.clone(),
      vel: velocity.clone(),
      spin: new THREE.Vector3(10, 7, 13),
      fuse: FRAG_GRENADE_SPEC.fuseTime,
      beepTimer: 0.32,
    });
  }

  private addHazardBarrel(x: number, z: number, phase: number): void {
    const group = new THREE.Group();
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x993822, roughness: 0.65, metalness: 0.45 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.4, metalness: 0.8 });
    const emberMat = new THREE.MeshStandardMaterial({
      color: 0xff6a1a,
      emissive: 0xff5500,
      emissiveIntensity: 2.8,
      roughness: 0.4,
    });

    const cylGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.15, 14);
    const bandGeo = new THREE.CylinderGeometry(0.435, 0.435, 0.08, 14);
    const emberGeo = new THREE.CylinderGeometry(0.36, 0.32, 0.14, 12);

    const cyl = new THREE.Mesh(cylGeo, barrelMat);
    cyl.position.y = 0.575;
    cyl.castShadow = true;
    cyl.receiveShadow = true;
    const b1 = new THREE.Mesh(bandGeo, bandMat);
    b1.position.y = 0.35;
    const b2 = new THREE.Mesh(bandGeo, bandMat);
    b2.position.y = 0.82;
    const embers = new THREE.Mesh(emberGeo, emberMat);
    embers.position.y = 1.12;

    const propId = this.nextPropId++;
    cyl.userData.propId = propId;

    group.add(cyl, b1, b2, embers);
    group.position.set(x, 0, z);
    this.mapGroup.add(group);
    this.raycastTargets.push(cyl);
    this.mapDisposables.push(barrelMat, bandMat, emberMat, cylGeo, bandGeo, emberGeo);

    const light = new THREE.PointLight(0xff6b26, 6.5, 13, 1.8);
    light.position.set(x, 1.45, z);
    this.mapGroup.add(light);
    this.fireLights.push({ light, baseIntensity: 6.5, phase });

    const obstacle: AABB2D = { minX: x - 0.46, maxX: x + 0.46, minZ: z - 0.46, maxZ: z + 0.46, maxY: 1.15 };
    this.obstacles.push(obstacle);
    this.destructibleProps.push({
      id: propId,
      kind: 'barrel',
      group,
      hitMesh: cyl,
      obstacle,
      position: new THREE.Vector3(x, 0.6, z),
      hp: 18,
      alive: true,
      fireLight: light,
    });
  }

  // =========================================================================
  // MAP 4: NEON DOCKS — RAIN-SLICKED NIGHT HARBOR (Crane Beacons & Container Alleys)
  // =========================================================================
  private buildNeonDocks(): void {
    const horizonColor = new THREE.Color(0x070d1a);
    this.scene.background = horizonColor;
    this.scene.fog = new THREE.FogExp2(0x0a1424, 0.02);

    this.buildSkyDome(
      0x02060d,
      0x0b1c33,
      0x1d3a5e,
      new THREE.Vector3(0.35, 0.55, -0.75),
      [0.55, 0.72, 1.0],
      0.5,
    );
    const hemi = new THREE.HemisphereLight(0x33507e, 0x05070c, 0.55);
    this.mapGroup.add(hemi);
    this.setupKeyLight(0x9dbdff, 0.95, [-26, 36, -20]);
    this.addRimLight(0x22d3ee, 0.75, [30, 14, 24]);
    this.addRimLight(0xf472b6, 0.4, [-30, 10, 20]);

    this.addVolumetricBeam(-12, 9.5, -14, 0.3, -0.2, 1.5, 5.4, 19, 0x22d3ee, 0.1);
    this.addVolumetricBeam(14, 9.5, -22, 0.3, 0.18, 1.5, 5.2, 19, 0xf472b6, 0.09);

    const asphalt = this.texLib.createAsphaltSet(18);
    const groundGeo = new THREE.PlaneGeometry(160, 160);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: asphalt.map,
      normalMap: asphalt.normalMap,
      roughnessMap: asphalt.roughnessMap,
      roughness: 0.34,
      metalness: 0.55,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.mapGroup.add(ground);
    this.raycastTargets.push(ground);
    this.mapDisposables.push(groundGeo, groundMat);

    // Harbor water strip along the north edge
    const waterGeo = new THREE.PlaneGeometry(160, 26);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x081826,
      roughness: 0.12,
      metalness: 0.9,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.set(0, 0.02, -52);
    this.mapGroup.add(water);
    this.mapDisposables.push(waterGeo, waterMat);

    const steelMat = new THREE.MeshStandardMaterial({ color: 0x1c2430, roughness: 0.4, metalness: 0.82 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x2a3442, roughness: 0.5, metalness: 0.7 });
    const neonCyan = new THREE.MeshStandardMaterial({
      color: 0x0e7490,
      emissive: 0x22d3ee,
      emissiveIntensity: 2.4,
      roughness: 0.3,
    });
    const neonMagenta = new THREE.MeshStandardMaterial({
      color: 0x9d174d,
      emissive: 0xf472b6,
      emissiveIntensity: 2.2,
      roughness: 0.3,
    });
    const neonAmber = new THREE.MeshStandardMaterial({
      color: 0x92400e,
      emissive: 0xfbbf24,
      emissiveIntensity: 2.0,
      roughness: 0.3,
    });
    const crateTex = this.texLib.createMetalCrateSet();
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: crateTex.map,
      normalMap: crateTex.normalMap,
      roughnessMap: crateTex.roughnessMap,
      roughness: 0.62,
      metalness: 0.5,
    });
    this.mapDisposables.push(steelMat, deckMat, neonCyan, neonMagenta, neonAmber, crateMat);

    // Illuminated shipping cranes
    this.buildGantryCrane(0, -30, steelMat);
    this.buildGantryCrane(-24, -6, steelMat);

    // Container alleyways — tight north-south lanes
    const containerMats = [
      this.makeContainerMaterial([16, 42, 66], 401),
      this.makeContainerMaterial([52, 20, 58], 402),
      this.makeContainerMaterial([24, 58, 48], 403),
      this.makeContainerMaterial([64, 44, 20], 404),
    ];
    const containers = [
      { x: -9, y: 0, z: 6, rotY: 0, matIdx: 0 },
      { x: -9, y: 0, z: -2, rotY: 0, matIdx: 2 },
      { x: -9, y: 0, z: -10, rotY: Math.PI / 2, matIdx: 1 },
      { x: -9, y: 2.9, z: -6, rotY: 0.03, matIdx: 3 },
      { x: 9, y: 0, z: 8, rotY: 0, matIdx: 1 },
      { x: 9, y: 0, z: 0, rotY: 0, matIdx: 3 },
      { x: 9, y: 0, z: -8, rotY: Math.PI / 2, matIdx: 0 },
      { x: 9, y: 2.9, z: -4, rotY: -0.04, matIdx: 2 },
      { x: -20, y: 0, z: -16, rotY: Math.PI / 2, matIdx: 2 },
      { x: -14, y: 0, z: -16, rotY: Math.PI / 2, matIdx: 0 },
      { x: 20, y: 0, z: -14, rotY: Math.PI / 2, matIdx: 3 },
      { x: 26, y: 0, z: -14, rotY: Math.PI / 2, matIdx: 1 },
      { x: -26, y: 0, z: 14, rotY: 0, matIdx: 1 },
      { x: 26, y: 0, z: 16, rotY: 0, matIdx: 0 },
    ];
    for (const c of containers) {
      this.addShippingContainer(c.x, c.y, c.z, c.rotY, containerMats[c.matIdx], steelMat);
    }

    // Neon edge strips marking the alley lanes & dock edge
    const strips: Array<[number, number, number, number, number, THREE.Material]> = [
      [-6.4, 0.06, 2, 24, 0.12, neonCyan],
      [6.4, 0.06, 2, 24, 0.12, neonMagenta],
      [-15, 0.06, -14, 0.14, 18, neonAmber],
      [23, 0.06, 0, 0.14, 22, neonCyan],
      [0, 0.06, -38, 30, 0.14, neonAmber],
    ];
    const stripGeoCache = new Map<string, THREE.BoxGeometry>();
    for (const [x, y, z, w, d, mat] of strips) {
      const key = `${w.toFixed(1)}x${d.toFixed(1)}`;
      let geo = stripGeoCache.get(key);
      if (!geo) {
        geo = new THREE.BoxGeometry(w, 0.1, d);
        this.mapDisposables.push(geo);
        stripGeoCache.set(key, geo);
      }
      const strip = new THREE.Mesh(geo, mat);
      strip.position.set(x, y, z);
      this.mapGroup.add(strip);
    }

    // Docked patrol boats along the waterline
    const boatMat = new THREE.MeshStandardMaterial({ color: 0x22384e, roughness: 0.45, metalness: 0.7 });
    const boatDeckMat = new THREE.MeshStandardMaterial({
      color: 0x2e4a66,
      emissive: 0x0e7490,
      emissiveIntensity: 0.5,
      roughness: 0.4,
      metalness: 0.6,
    });
    this.mapDisposables.push(boatMat, boatDeckMat);
    this.addPatrolBoat(-24, -38, 0.15, boatMat, boatDeckMat);
    this.addPatrolBoat(18, -40, -0.1, boatMat, boatDeckMat);
    this.addPatrolBoat(34, -20, Math.PI / 2, boatMat, boatDeckMat);

    // Elevated container catwalk with neon-lit access ramp
    this.addStaticBox(14.4, 2.85, -12, 3.0, 0.3, 5.2, deckMat, true);
    this.addStaticBox(15.8, 1.4, -10.4, 0.26, 2.8, 0.26, steelMat, true);
    this.addStaticBox(15.8, 1.4, -13.6, 0.26, 2.8, 0.26, steelMat, true);
    this.addSlopedRamp({
      centerX: 14.4,
      centerZ: -6.4,
      width: 2.4,
      length: 8.4,
      lowY: 0,
      highY: 2.9,
      axis: 'z',
      dir: -1,
      mat: deckMat,
      railMat: neonCyan,
      withRails: true,
    });

    const barriers = [
      { x: -4, z: 18, rotY: 0.1 },
      { x: 4, z: 18, rotY: -0.1 },
      { x: 0, z: 8, rotY: 0 },
      { x: -16, z: -2, rotY: Math.PI / 2 },
      { x: 16, z: -2, rotY: Math.PI / 2 },
      { x: -8, z: -24, rotY: 0.4 },
      { x: 10, z: -26, rotY: -0.3 },
    ];
    for (const b of barriers) {
      this.addConcreteBarrier(b.x, b.z, b.rotY, deckMat);
    }

    const crateClusters = [
      { x: -5, z: 12, stacked: true },
      { x: 5.4, z: 13, stacked: false },
      { x: -14, z: -20, stacked: true },
      { x: 16, z: -18, stacked: false },
      { x: 0, z: -30, stacked: true },
    ];
    for (const cl of crateClusters) {
      this.addCrateCluster(cl.x, cl.z, cl.stacked, crateMat, steelMat);
    }

    this.addIndustrialLamp(-18, 20, Math.PI * 0.25, steelMat, 0x22d3ee, true);
    this.addIndustrialLamp(18, 20, -Math.PI * 0.25, steelMat, 0xf472b6, false);
    this.addIndustrialLamp(0, -18, 0, steelMat, 0xfbbf24, true);

    this.addHazardBarrel(-7, 16, 0);
    this.addHazardBarrel(8, -6, 1.7);
    this.addHazardBarrel(-18, -22, 3.4);

    this.addDestructibleWoodCrate(-10, 14);
    this.addDestructibleWoodCrate(11, 12);
    this.addDestructibleWoodCrate(24, -10);
    this.addDestructibleWoodCrate(-24, 6);
    this.addExplosiveBarrel(-3, 4);
    this.addExplosiveBarrel(14, -14);
    this.addExplosiveBarrel(-12, -28);

    this.buildSharedZonesAndVehicles('neon_docks', {
      wallMat: deckMat,
      roofMat: deckMat,
      trimMat: steelMat,
      rampMat: deckMat,
      barrierMat: deckMat,
    });

    this.buildPerimeterWalls(steelMat, steelMat);
    this.buildDistantSkyline(0x0a101d);
    this.buildAtmosphericParticles('rain', 520, 0x8fb8e8, 0.055, 0.42);

    this.waypoints.push(
      new THREE.Vector3(0, 0, 14),
      new THREE.Vector3(-9, 0, 2),
      new THREE.Vector3(9, 0, 4),
      new THREE.Vector3(0, 0, -8),
      new THREE.Vector3(-18, 0, -14),
      new THREE.Vector3(20, 0, -10),
      new THREE.Vector3(-14, 0, -24),
      new THREE.Vector3(16, 0, -22),
      new THREE.Vector3(0, 0, -32),
      new THREE.Vector3(-24, 0, 10),
      new THREE.Vector3(24, 0, 12),
    );
    this.spawnPoints.push(
      new THREE.Vector3(-14, 0, -24),
      new THREE.Vector3(14, 0, -24),
      new THREE.Vector3(0, 0, -30),
      new THREE.Vector3(-22, 0, -6),
      new THREE.Vector3(22, 0, -8),
      new THREE.Vector3(-20, 0, 14),
      new THREE.Vector3(20, 0, 16),
      new THREE.Vector3(-6, 0, -34),
      new THREE.Vector3(8, 0, -34),
    );
  }

  // =========================================================================
  // MAP 5: HIGHLAND RIDGE — GOLDEN-HOUR RELAY OUTPOST (Towers, Dishes & Pines)
  // =========================================================================
  private buildHighlandRidge(): void {
    const horizonColor = new THREE.Color(0xd9a86a);
    this.scene.background = horizonColor;
    this.scene.fog = new THREE.FogExp2(0xc99a63, 0.0085);

    this.buildSkyDome(
      0x2e4a7a,
      0xc98d54,
      0xf2c078,
      new THREE.Vector3(0.5, 0.16, -0.8),
      [1.0, 0.72, 0.4],
      0.6,
    );
    const hemi = new THREE.HemisphereLight(0xd8b98a, 0x44523c, 0.6);
    this.mapGroup.add(hemi);
    this.setupKeyLight(0xffd9a0, 1.6, [30, 18, -28]);
    this.addRimLight(0x7dd3fc, 0.5, [-32, 20, 26]);

    const sand = this.texLib.createDesertSandSet(18);
    const groundGeo = new THREE.PlaneGeometry(160, 160);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x9aa06a,
      map: sand.map,
      normalMap: sand.normalMap,
      roughnessMap: sand.roughnessMap,
      roughness: 0.9,
      metalness: 0.04,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.mapGroup.add(ground);
    this.raycastTargets.push(ground);
    this.mapDisposables.push(groundGeo, groundMat);

    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x7d7468,
      roughness: 0.92,
      metalness: 0.06,
      flatShading: true,
    });
    const pineMat = new THREE.MeshStandardMaterial({
      color: 0x2f5233,
      roughness: 0.88,
      metalness: 0.03,
      flatShading: true,
    });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 0.55, metalness: 0.6 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5d4a33, roughness: 0.85, metalness: 0.05 });
    const crateTex = this.texLib.createMetalCrateSet();
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: crateTex.map,
      normalMap: crateTex.normalMap,
      roughnessMap: crateTex.roughnessMap,
      roughness: 0.7,
      metalness: 0.3,
    });
    this.mapDisposables.push(rockMat, pineMat, steelMat, woodMat, crateMat);

    // Rocky ridges & pine clusters framing the lanes
    const rocks: Array<[number, number, number]> = [
      [-30, -20, 3.4], [-34, 4, 2.6], [-26, 22, 3.0], [-12, -32, 2.4],
      [30, -18, 3.2], [34, 6, 2.4], [26, 24, 3.0], [12, -30, 2.2],
      [-18, 34, 2.8], [18, 34, 3.4], [0, 40, 2.6],
    ];
    for (const [x, z, s] of rocks) {
      this.addRockOutcrop(x, z, s, rockMat);
    }
    const pines: Array<[number, number, number]> = [
      [-22, -28, 1.2], [-28, -10, 1.0], [-20, 8, 1.15], [-14, 26, 0.95],
      [22, -26, 1.25], [28, -8, 1.0], [20, 10, 1.1], [14, 28, 0.9],
      [-8, -36, 1.0], [8, -38, 1.1], [-32, 16, 0.9], [32, 18, 1.0],
    ];
    for (const [x, z, s] of pines) {
      this.addPineTree(x, z, s, pineMat, woodMat);
    }

    // Elevated watchtowers with radar dishes overlooking mid lanes
    this.addWatchtower(-22, -14, steelMat, woodMat, rockMat);
    this.addWatchtower(22, -16, steelMat, woodMat, rockMat);
    this.addWatchtower(0, -36, steelMat, woodMat, rockMat);

    // Supply depots & fuel drums
    const crateClusters = [
      { x: -8, z: 14, stacked: true },
      { x: 9, z: 15, stacked: false },
      { x: -16, z: -2, stacked: true },
      { x: 16, z: -4, stacked: false },
      { x: -6, z: -24, stacked: true },
      { x: 8, z: -26, stacked: false },
    ];
    for (const cl of crateClusters) {
      this.addCrateCluster(cl.x, cl.z, cl.stacked, crateMat, steelMat);
    }
    const barriers = [
      { x: -4, z: 18, rotY: 0.12 },
      { x: 4, z: 18, rotY: -0.12 },
      { x: 0, z: 8, rotY: 0 },
      { x: -14, z: -18, rotY: Math.PI / 2 },
      { x: 14, z: -18, rotY: Math.PI / 2 },
      { x: -10, z: -32, rotY: 0.3 },
      { x: 10, z: -32, rotY: -0.3 },
    ];
    for (const b of barriers) {
      this.addConcreteBarrier(b.x, b.z, b.rotY, rockMat);
    }

    this.addIndustrialLamp(-18, 22, Math.PI * 0.25, steelMat, 0xffd9a0, true);
    this.addIndustrialLamp(18, 22, -Math.PI * 0.25, steelMat, 0xffd9a0, false);
    this.addHazardBarrel(-7, 17, 0);
    this.addHazardBarrel(8, -8, 1.7);
    this.addHazardBarrel(-18, -28, 3.4);
    this.addDestructibleWoodCrate(-12, 16);
    this.addDestructibleWoodCrate(13, 14);
    this.addDestructibleWoodCrate(26, -16);
    this.addDestructibleWoodCrate(-26, -4);
    this.addExplosiveBarrel(-3, 2);
    this.addExplosiveBarrel(12, -12);
    this.addExplosiveBarrel(0, -30);

    // Distant mountain silhouettes ringing the horizon
    this.addMountainRing(rockMat);

    this.buildSharedZonesAndVehicles('highland_ridge', {
      wallMat: rockMat,
      roofMat: steelMat,
      trimMat: steelMat,
      rampMat: steelMat,
      barrierMat: rockMat,
    });

    this.buildPerimeterWalls(rockMat, steelMat);
    this.buildAtmosphericParticles('dust', 170, 0xffd9a0, 0.09, 0.4);

    this.waypoints.push(
      new THREE.Vector3(0, 0, 14),
      new THREE.Vector3(-10, 0, 6),
      new THREE.Vector3(10, 0, 6),
      new THREE.Vector3(0, 0, -6),
      new THREE.Vector3(-20, 0, -12),
      new THREE.Vector3(20, 0, -14),
      new THREE.Vector3(-14, 0, -26),
      new THREE.Vector3(14, 0, -26),
      new THREE.Vector3(0, 0, -34),
      new THREE.Vector3(-26, 0, 6),
      new THREE.Vector3(26, 0, 8),
    );
    this.spawnPoints.push(
      new THREE.Vector3(-16, 0, -26),
      new THREE.Vector3(16, 0, -26),
      new THREE.Vector3(0, 0, -32),
      new THREE.Vector3(-22, 0, -4),
      new THREE.Vector3(22, 0, -6),
      new THREE.Vector3(-24, 0, 14),
      new THREE.Vector3(24, 0, 16),
      new THREE.Vector3(-8, 0, -38),
      new THREE.Vector3(8, 0, -38),
    );
  }

  // =========================================================================
  // MAP 6: SUNKEN FOUNDRY — MOLTEN WORKS (Catwalks, Vats & Furnace Glow)
  // =========================================================================
  private buildSunkenFoundry(): void {
    const horizonColor = new THREE.Color(0x160c06);
    this.scene.background = horizonColor;
    this.scene.fog = new THREE.FogExp2(0x1c0f07, 0.022);

    this.buildSkyDome(
      0x080402,
      0x241108,
      0x8a3a12,
      new THREE.Vector3(0.1, 0.12, -0.9),
      [1.0, 0.55, 0.2],
      0.8,
    );
    const hemi = new THREE.HemisphereLight(0x8a4a26, 0x140b06, 0.5);
    this.mapGroup.add(hemi);
    this.setupKeyLight(0x9db4ff, 0.55, [-20, 42, -18]);
    this.addRimLight(0xfb923c, 0.8, [28, 10, 24]);

    const concrete = this.texLib.createConcreteSet(6, 3);
    const groundGeo = new THREE.PlaneGeometry(160, 160);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x6b5a4c,
      map: concrete.map,
      normalMap: concrete.normalMap,
      roughnessMap: concrete.roughnessMap,
      roughness: 0.55,
      metalness: 0.45,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.mapGroup.add(ground);
    this.raycastTargets.push(ground);
    this.mapDisposables.push(groundGeo, groundMat);

    // Molten cracks — emissive seams scattered across the floor
    const crackMat = new THREE.MeshStandardMaterial({
      color: 0x431407,
      emissive: 0xff5a00,
      emissiveIntensity: 2.2,
      roughness: 0.6,
      metalness: 0.2,
    });
    const crackGeo = new THREE.PlaneGeometry(1, 1);
    crackGeo.rotateX(-Math.PI / 2);
    this.mapDisposables.push(crackMat, crackGeo);
    for (const [x, z, sx, sz] of [
      [-6, 6, 6, 0.4], [7, 2, 8, 0.35], [-12, -14, 5, 0.5],
      [12, -18, 6, 0.4], [0, -26, 7, 0.45], [-18, 18, 4, 0.4],
      [20, 8, 5, 0.35],
    ] as Array<[number, number, number, number]>) {
      const crack = new THREE.Mesh(crackGeo, crackMat);
      crack.position.set(x, 0.03, z);
      crack.scale.set(sx, 1, sz);
      crack.rotation.y = (x + z) * 0.7;
      this.mapGroup.add(crack);
    }

    const ironMat = new THREE.MeshStandardMaterial({ color: 0x3a3230, roughness: 0.5, metalness: 0.75 });
    const rustMat = new THREE.MeshStandardMaterial({ color: 0x6e3b1e, roughness: 0.8, metalness: 0.35 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x4a423c, roughness: 0.55, metalness: 0.7 });
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xff6a00,
      emissive: 0xff4400,
      emissiveIntensity: 3.0,
      roughness: 0.4,
    });
    const crateTex = this.texLib.createMetalCrateSet();
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: crateTex.map,
      normalMap: crateTex.normalMap,
      roughnessMap: crateTex.roughnessMap,
      roughness: 0.7,
      metalness: 0.4,
    });
    this.mapDisposables.push(ironMat, rustMat, deckMat, glowMat, crateMat);

    // Furnace stacks with flickering glow — the map's light anchors
    this.addFurnaceStack(-16, -30, ironMat, rustMat, glowMat);
    this.addFurnaceStack(16, -30, ironMat, rustMat, glowMat);
    this.addFurnaceStack(-28, 6, ironMat, rustMat, glowMat);
    this.addFurnaceStack(28, 6, ironMat, rustMat, glowMat);

    // Cooling vats — glowing molten tops
    this.addMoltenVat(-8, -16, ironMat, glowMat);
    this.addMoltenVat(8, -16, ironMat, glowMat);
    this.addMoltenVat(-8, 20, ironMat, glowMat);
    this.addMoltenVat(8, 20, ironMat, glowMat);

    // Elevated catwalk bridges crossing the central lanes
    this.addCatwalkSpan(-18, -4, 18, -4, deckMat, ironMat);
    this.addCatwalkSpan(-18, -22, 18, -22, deckMat, ironMat);

    // Heavy machinery blocks
    const machineGeo = new THREE.BoxGeometry(3.4, 2.4, 2.2);
    const pressGeo = new THREE.CylinderGeometry(1.1, 1.4, 3.2, 10);
    this.mapDisposables.push(machineGeo, pressGeo);
    for (const [x, z, rot] of [[-14, 8, 0.3], [14, 10, -0.4], [-24, -16, 1.1], [24, -14, -0.9]] as Array<[number, number, number]>) {
      const isPress = Math.abs(rot) > 0.7;
      const m = new THREE.Mesh(isPress ? pressGeo : machineGeo, isPress ? rustMat : ironMat);
      m.position.set(x, isPress ? 1.6 : 1.2, z);
      m.rotation.y = rot;
      m.castShadow = true;
      m.receiveShadow = true;
      this.mapGroup.add(m);
      this.raycastTargets.push(m);
      const r = isPress ? 1.5 : 1.9;
      this.obstacles.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, maxY: 3.4 });
    }

    const crateClusters = [
      { x: -4, z: 10, stacked: true },
      { x: 5, z: 11, stacked: false },
      { x: -13, z: -8, stacked: false },
      { x: 13, z: -8, stacked: true },
      { x: 0, z: -32, stacked: true },
    ];
    for (const cl of crateClusters) {
      this.addCrateCluster(cl.x, cl.z, cl.stacked, crateMat, ironMat);
    }
    const barriers = [
      { x: -4, z: 20, rotY: 0.1 },
      { x: 4, z: 20, rotY: -0.1 },
      { x: 0, z: 6, rotY: 0 },
      { x: -12, z: 0, rotY: Math.PI / 2 },
      { x: 12, z: 0, rotY: Math.PI / 2 },
    ];
    for (const b of barriers) {
      this.addConcreteBarrier(b.x, b.z, b.rotY, ironMat);
    }

    this.addIndustrialLamp(-18, 24, Math.PI * 0.25, ironMat, 0xffb36b, true);
    this.addIndustrialLamp(18, 24, -Math.PI * 0.25, ironMat, 0xffb36b, false);
    this.addHazardBarrel(-7, 18, 0);
    this.addHazardBarrel(8, -4, 1.7);
    this.addHazardBarrel(-18, -24, 3.4);
    this.addDestructibleWoodCrate(-10, 18);
    this.addDestructibleWoodCrate(11, 16);
    this.addDestructibleWoodCrate(22, -10);
    this.addDestructibleWoodCrate(-22, -6);
    this.addExplosiveBarrel(-3, 0);
    this.addExplosiveBarrel(14, -20);
    this.addExplosiveBarrel(-14, -34);

    this.buildSharedZonesAndVehicles('sunken_foundry', {
      wallMat: ironMat,
      roofMat: deckMat,
      trimMat: ironMat,
      rampMat: deckMat,
      barrierMat: ironMat,
    });

    this.buildPerimeterWalls(ironMat, ironMat);
    this.buildAtmosphericParticles('embers', 220, 0xff8a3a, 0.11, 0.5);

    this.waypoints.push(
      new THREE.Vector3(0, 0, 14),
      new THREE.Vector3(-8, 0, 6),
      new THREE.Vector3(8, 0, 6),
      new THREE.Vector3(0, 0, -2),
      new THREE.Vector3(-14, 0, -12),
      new THREE.Vector3(14, 0, -12),
      new THREE.Vector3(-10, 0, -24),
      new THREE.Vector3(10, 0, -24),
      new THREE.Vector3(0, 0, -32),
      new THREE.Vector3(-20, 0, 10),
      new THREE.Vector3(20, 0, 12),
    );
    this.spawnPoints.push(
      new THREE.Vector3(-14, 0, -24),
      new THREE.Vector3(14, 0, -24),
      new THREE.Vector3(0, 0, -30),
      new THREE.Vector3(-20, 0, -2),
      new THREE.Vector3(20, 0, -4),
      new THREE.Vector3(-18, 0, 16),
      new THREE.Vector3(18, 0, 18),
      new THREE.Vector3(-6, 0, -36),
      new THREE.Vector3(6, 0, -36),
    );
  }

  // =========================================================================
  // MAP-SPECIFIC PROP HELPERS
  // =========================================================================
  private addPatrolBoat(
    x: number,
    z: number,
    rotY: number,
    hullMat: THREE.MeshStandardMaterial,
    deckGlowMat: THREE.MeshStandardMaterial,
  ): void {
    const group = new THREE.Group();
    const hullGeo = new THREE.BoxGeometry(2.4, 1.1, 7.5);
    const bowGeo = new THREE.ConeGeometry(1.2, 2.2, 4);
    bowGeo.rotateX(Math.PI / 2);
    bowGeo.rotateY(Math.PI / 4);
    const cabinGeo = new THREE.BoxGeometry(1.6, 1.2, 2.2);
    const mastGeo = new THREE.CylinderGeometry(0.06, 0.09, 2.4, 6);
    const stripeGeo = new THREE.BoxGeometry(2.5, 0.16, 7.4);

    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.y = 0.55;
    hull.castShadow = true;
    hull.receiveShadow = true;
    const bow = new THREE.Mesh(bowGeo, hullMat);
    bow.position.set(0, 0.55, 4.7);
    const cabin = new THREE.Mesh(cabinGeo, hullMat);
    cabin.position.set(0, 1.6, -0.6);
    cabin.castShadow = true;
    const mast = new THREE.Mesh(mastGeo, hullMat);
    mast.position.set(0, 2.6, -1.6);
    const stripe = new THREE.Mesh(stripeGeo, deckGlowMat);
    stripe.position.y = 1.1;

    group.add(hull, bow, cabin, mast, stripe);
    group.position.set(x, 0.35, z);
    group.rotation.y = rotY;
    group.rotation.z = 0.02;
    this.mapGroup.add(group);
    this.raycastTargets.push(hull, cabin);
    this.mapDisposables.push(hullGeo, bowGeo, cabinGeo, mastGeo, stripeGeo);

    this.obstacles.push({
      minX: x - 1.5,
      maxX: x + 1.5,
      minZ: z - 4.2,
      maxZ: z + 4.2,
      maxY: 2.4,
    });
  }

  private addWatchtower(
    x: number,
    z: number,
    steelMat: THREE.Material,
    woodMat: THREE.Material,
    rockMat: THREE.Material,
  ): void {
    const group = new THREE.Group();
    const legGeo = new THREE.BoxGeometry(0.22, 3.6, 0.22);
    const deckGeo = new THREE.BoxGeometry(4.2, 0.3, 4.2);
    const railGeo = new THREE.BoxGeometry(4.2, 0.7, 0.12);
    const roofGeo = new THREE.BoxGeometry(4.6, 0.18, 4.6);
    const roofPostGeo = new THREE.BoxGeometry(0.14, 1.6, 0.14);

    for (const [lx, lz] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]] as Array<[number, number]>) {
      const leg = new THREE.Mesh(legGeo, steelMat);
      leg.position.set(lx, 1.8, lz);
      leg.castShadow = true;
      group.add(leg);
    }
    const deck = new THREE.Mesh(deckGeo, woodMat);
    deck.position.y = 3.65;
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);
    for (const [rx, rz, ry] of [[0, -2.05, 0], [0, 2.05, 0], [-2.05, 0, Math.PI / 2], [2.05, 0, Math.PI / 2]] as Array<[number, number, number]>) {
      const rail = new THREE.Mesh(railGeo, steelMat);
      rail.position.set(rx, 4.2, rz);
      rail.rotation.y = ry;
      group.add(rail);
    }
    for (const [px, pz] of [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]] as Array<[number, number]>) {
      const post = new THREE.Mesh(roofPostGeo, steelMat);
      post.position.set(px, 4.9, pz);
      group.add(post);
    }
    const roof = new THREE.Mesh(roofGeo, rockMat);
    roof.position.y = 5.75;
    roof.castShadow = true;
    group.add(roof);

    // Radar dish on the roof
    const dishGeo = new THREE.SphereGeometry(0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.6);
    const dish = new THREE.Mesh(dishGeo, steelMat);
    dish.position.y = 6.1;
    dish.rotation.x = Math.PI / 2.4;
    group.add(dish);

    group.position.set(x, 0, z);
    this.mapGroup.add(group);
    this.raycastTargets.push(deck, roof);
    this.mapDisposables.push(legGeo, deckGeo, railGeo, roofGeo, roofPostGeo, dishGeo);

    this.obstacles.push({ minX: x - 2.1, maxX: x + 2.1, minZ: z - 2.1, maxZ: z + 2.1, minY: 0, maxY: 3.8 });

    // Access ramp up to the deck
    this.addSlopedRamp({
      centerX: x + 3.4,
      centerZ: z,
      width: 1.8,
      length: 5.6,
      lowY: 0,
      highY: 3.6,
      axis: 'x',
      dir: -1,
      mat: woodMat,
      railMat: steelMat,
      withRails: true,
    });
  }

  private addRadarDish(x: number, y: number, z: number, mat: THREE.Material): void {
    const group = new THREE.Group();
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 3.4, 8);
    const dishGeo = new THREE.SphereGeometry(1.0, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.4);
    const pole = new THREE.Mesh(poleGeo, mat);
    pole.position.y = 1.7;
    pole.castShadow = true;
    const dish = new THREE.Mesh(dishGeo, mat);
    dish.position.y = 3.4;
    dish.rotation.x = Math.PI / 2.2;
    dish.castShadow = true;
    group.add(pole, dish);
    group.position.set(x, y, z);
    this.mapGroup.add(group);
    this.mapDisposables.push(poleGeo, dishGeo);
    this.obstacles.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, maxY: 3.6 });
  }

  private addRockOutcrop(x: number, z: number, scale: number, mat: THREE.Material): void {
    const geo = new THREE.IcosahedronGeometry(scale, 0);
    const rock = new THREE.Mesh(geo, mat);
    rock.position.set(x, scale * 0.42, z);
    rock.rotation.set(Math.random() * 0.6, Math.random() * Math.PI, Math.random() * 0.6);
    rock.scale.y = 0.72;
    rock.castShadow = true;
    rock.receiveShadow = true;
    this.mapGroup.add(rock);
    this.raycastTargets.push(rock);
    this.mapDisposables.push(geo);
    const r = scale * 0.85;
    this.obstacles.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, maxY: scale * 1.1 });
  }

  private addPineTree(x: number, z: number, scale: number, foliageMat: THREE.Material, trunkMat: THREE.Material): void {
    const group = new THREE.Group();
    const trunkGeo = new THREE.CylinderGeometry(0.14 * scale, 0.22 * scale, 1.6 * scale, 6);
    const coneGeo = new THREE.ConeGeometry(1.15 * scale, 2.6 * scale, 7);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.8 * scale;
    trunk.castShadow = true;
    const c1 = new THREE.Mesh(coneGeo, foliageMat);
    c1.position.y = 2.2 * scale;
    c1.castShadow = true;
    const c2 = new THREE.Mesh(coneGeo, foliageMat);
    c2.position.y = 3.4 * scale;
    c2.scale.setScalar(0.72);
    c2.castShadow = true;
    const c3 = new THREE.Mesh(coneGeo, foliageMat);
    c3.position.y = 4.4 * scale;
    c3.scale.setScalar(0.5);
    c3.castShadow = true;
    group.add(trunk, c1, c2, c3);
    group.position.set(x, 0, z);
    this.mapGroup.add(group);
    this.raycastTargets.push(trunk, c1, c2, c3);
    this.mapDisposables.push(trunkGeo, coneGeo);
    const r = 0.5 * scale;
    this.obstacles.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, maxY: 4.5 * scale });
  }

  private addMountainRing(mat: THREE.Material): void {
    const coneGeo = new THREE.ConeGeometry(18, 34, 7);
    this.mapDisposables.push(coneGeo);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const r = 88 + (i % 3) * 10;
      const m = new THREE.Mesh(coneGeo, mat);
      m.position.set(Math.cos(a) * r, 8, Math.sin(a) * r);
      m.scale.set(1 + (i % 3) * 0.5, 0.8 + (i % 4) * 0.35, 1);
      m.rotation.y = a;
      this.mapGroup.add(m);
    }
  }

  private addMoltenVat(x: number, z: number, vatMat: THREE.Material, glowMat: THREE.Material): void {
    const group = new THREE.Group();
    const bodyGeo = new THREE.CylinderGeometry(1.7, 1.9, 2.3, 14);
    const rimGeo = new THREE.TorusGeometry(1.68, 0.12, 8, 18);
    rimGeo.rotateX(Math.PI / 2);
    const meltGeo = new THREE.CylinderGeometry(1.55, 1.55, 0.1, 14);
    const legGeo = new THREE.BoxGeometry(0.3, 0.5, 0.3);

    const body = new THREE.Mesh(bodyGeo, vatMat);
    body.position.y = 1.35;
    body.castShadow = true;
    body.receiveShadow = true;
    const rim = new THREE.Mesh(rimGeo, vatMat);
    rim.position.y = 2.5;
    const melt = new THREE.Mesh(meltGeo, glowMat);
    melt.position.y = 2.42;
    group.add(body, rim, melt);
    for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]] as Array<[number, number]>) {
      const leg = new THREE.Mesh(legGeo, vatMat);
      leg.position.set(lx, 0.25, lz);
      group.add(leg);
    }

    group.position.set(x, 0, z);
    this.mapGroup.add(group);
    this.raycastTargets.push(body);
    this.mapDisposables.push(bodyGeo, rimGeo, meltGeo, legGeo);
    this.obstacles.push({ minX: x - 1.95, maxX: x + 1.95, minZ: z - 1.95, maxZ: z + 1.95, maxY: 2.6 });

    const light = new THREE.PointLight(0xff5a1a, 7.5, 15, 1.8);
    light.position.set(x, 3.0, z);
    this.mapGroup.add(light);
    this.fireLights.push({ light, baseIntensity: 7.5, phase: x * 0.7 + z });
  }

  private addFurnaceStack(x: number, z: number, bodyMat: THREE.Material, rustMat: THREE.Material, glowMat: THREE.Material): void {
    const group = new THREE.Group();
    const stackGeo = new THREE.BoxGeometry(3.2, 6.4, 3.2);
    const mouthGeo = new THREE.BoxGeometry(1.6, 1.4, 0.4);
    const pipeGeo = new THREE.CylinderGeometry(0.28, 0.28, 4.4, 8);
    const stack = new THREE.Mesh(stackGeo, bodyMat);
    stack.position.y = 3.2;
    stack.castShadow = true;
    stack.receiveShadow = true;
    const mouth = new THREE.Mesh(mouthGeo, glowMat);
    mouth.position.set(0, 1.6, 1.62);
    const pipe = new THREE.Mesh(pipeGeo, rustMat);
    pipe.position.set(1.0, 5.4, -0.6);
    pipe.rotation.z = 0.5;
    group.add(stack, mouth, pipe);
    group.position.set(x, 0, z);
    group.rotation.y = Math.atan2(-x, -z) + Math.PI;
    this.mapGroup.add(group);
    this.raycastTargets.push(stack);
    this.mapDisposables.push(stackGeo, mouthGeo, pipeGeo);
    this.obstacles.push({ minX: x - 1.8, maxX: x + 1.8, minZ: z - 1.8, maxZ: z + 1.8, maxY: 6.6 });

    const light = new THREE.PointLight(0xff6a22, 9.0, 20, 1.7);
    light.position.set(x, 2.2, z);
    this.mapGroup.add(light);
    this.fireLights.push({ light, baseIntensity: 9.0, phase: z * 0.9 });
  }

  private addCatwalkSpan(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    deckMat: THREE.Material,
    railMat: THREE.Material,
  ): void {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx);
    const deckY = 3.1;

    const deckGeo = new THREE.BoxGeometry(len, 0.22, 2.2);
    const railGeo = new THREE.BoxGeometry(len, 0.7, 0.1);
    const supGeo = new THREE.BoxGeometry(0.4, deckY, 0.4);
    this.mapDisposables.push(deckGeo, railGeo, supGeo);

    const group = new THREE.Group();
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.y = deckY;
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(0, deckY + 0.45, side * 1.05);
      group.add(rail);
    }
    // support columns at quarter points
    for (const t of [0.25, 0.5, 0.75]) {
      const sup = new THREE.Mesh(supGeo, railMat);
      sup.position.set(-len / 2 + len * t, deckY / 2, 0);
      sup.castShadow = true;
      group.add(sup);
      const px = x1 + dx * t;
      const pz = z1 + dz * t;
      this.obstacles.push({ minX: px - 0.3, maxX: px + 0.3, minZ: pz - 0.3, maxZ: pz + 0.3, maxY: deckY });
    }
    group.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2);
    group.rotation.y = -angle;
    this.mapGroup.add(group);
    this.raycastTargets.push(deck);

    // Ground ramps up to both ends of the span
    this.addSlopedRamp({
      centerX: x1,
      centerZ: z1,
      width: 2.0,
      length: 6.0,
      lowY: 0,
      highY: deckY,
      axis: 'x',
      dir: angle > 0 ? -1 : 1,
      mat: deckMat,
      railMat: railMat,
      withRails: true,
    });
    this.addSlopedRamp({
      centerX: x2,
      centerZ: z2,
      width: 2.0,
      length: 6.0,
      lowY: 0,
      highY: deckY,
      axis: 'x',
      dir: angle > 0 ? 1 : -1,
      mat: deckMat,
      railMat: railMat,
      withRails: true,
    });
  }

  private buildDistantSkyline(colorHex: number): void {
    const silMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.92, metalness: 0.15 });
    const tankGeo = new THREE.CylinderGeometry(5, 5, 16, 12);
    const towerGeo = new THREE.BoxGeometry(10, 22, 10);
    this.mapDisposables.push(silMat, tankGeo, towerGeo);

    const outerBuildings = [
      { x: -64, z: -55, type: 'tower' },
      { x: 62, z: -58, type: 'tank' },
      { x: 74, z: -36, type: 'tank' },
      { x: -72, z: 18, type: 'tower' },
      { x: 68, z: 26, type: 'tower' },
      { x: 0, z: -76, type: 'tower' },
    ];
    for (const ob of outerBuildings) {
      const m = new THREE.Mesh(ob.type === 'tank' ? tankGeo : towerGeo, silMat);
      m.position.set(ob.x, ob.type === 'tank' ? 8 : 11, ob.z);
      this.mapGroup.add(m);
    }
  }

  spawnTracer(start: THREE.Vector3, end: THREE.Vector3): void {
    const entry = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % MAX_TRACERS;

    _dir.subVectors(end, start);
    const dist = Math.max(0.2, _dir.length());
    _dir.divideScalar(dist);
    _mid.addVectors(start, end).multiplyScalar(0.5);

    entry.mesh.position.copy(_mid);
    entry.mesh.lookAt(end);
    entry.mesh.scale.set(1, 1, dist);
    entry.mesh.visible = true;
    entry.life = 0.065;
    entry.maxLife = 0.065;
  }

  spawnSparks(point: THREE.Vector3, normal: THREE.Vector3, count = 8): void {
    for (let i = 0; i < count; i++) {
      const s = this.sparks[this.sparkCursor];
      this.sparkCursor = (this.sparkCursor + 1) % MAX_SPARKS;
      s.active = true;
      s.pos.copy(point).addScaledVector(normal, 0.04);
      s.vel
        .copy(normal)
        .multiplyScalar(2.4 + Math.random() * 3.8)
        .add(
          _dir.set(
            (Math.random() - 0.5) * 4.5,
            Math.random() * 3.5,
            (Math.random() - 0.5) * 4.5,
          ),
        );
      s.maxLife = 0.18 + Math.random() * 0.16;
      s.life = s.maxLife;
    }
  }

  spawnBulletDecal(point: THREE.Vector3, normal: THREE.Vector3): void {
    const mesh = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % MAX_DECALS;
    mesh.position.copy(point).addScaledVector(normal, 0.015);
    _mid.copy(mesh.position).add(normal);
    mesh.lookAt(_mid);
    mesh.rotateZ(Math.random() * Math.PI * 2);
    mesh.visible = true;
  }

  spawnPickup(pos: THREE.Vector3, kind: 'ammo' | 'health'): void {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      this.pickupSharedGeos[0],
      kind === 'ammo' ? this.pickupAmmoMat : this.pickupHealthMat,
    );
    body.position.y = 0.24;
    const lid = new THREE.Mesh(
      this.pickupSharedGeos[1],
      kind === 'ammo' ? this.pickupAmmoMat : this.pickupHealthMat,
    );
    lid.position.y = 0.43;
    const badge = new THREE.Mesh(
      this.pickupSharedGeos[2],
      kind === 'ammo'
        ? this.pickupTrimMat
        : new THREE.MeshStandardMaterial({
            color: 0xef4444,
            emissive: 0x991b1b,
            emissiveIntensity: 0.9,
            roughness: 0.3,
          }),
    );
    badge.position.y = 0.25;
    const shadow = new THREE.Mesh(this.contactShadowGeo, this.contactShadowMat);
    shadow.position.y = 0.02;

    group.add(body, lid, badge, shadow);
    group.position.set(pos.x, 0, pos.z);
    this.scene.add(group);

    this.pickups.push({
      id: this.nextPickupId++,
      kind,
      mesh: group,
      position: group.position,
      baseY: 0,
      age: 0,
      active: true,
    });
  }

  spawnShellCasing(
    origin: THREE.Vector3,
    rightDir: THREE.Vector3,
    upDir: THREE.Vector3,
    forwardDir: THREE.Vector3,
  ): void {
    const s = this.shells[this.shellCursor];
    this.shellCursor = (this.shellCursor + 1) % MAX_SHELLS;
    s.active = true;
    s.bounced = false;
    s.pos.copy(origin);
    s.vel
      .copy(rightDir)
      .multiplyScalar(2.4 + Math.random() * 1.1)
      .addScaledVector(upDir, 1.8 + Math.random() * 0.7)
      .addScaledVector(forwardDir, -0.4 + (Math.random() - 0.5) * 0.6);
    s.rot.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    s.spin.set(14 + Math.random() * 10, 12 + Math.random() * 10, 18 + Math.random() * 12);
    s.life = 1.6;
  }

  spawnSmokeWisp(origin: THREE.Vector3, count = 1, baseScale = 1): void {
    for (let i = 0; i < count; i++) {
      const m = this.smokes[this.smokeCursor];
      this.smokeCursor = (this.smokeCursor + 1) % MAX_SMOKE;
      m.active = true;
      m.pos.copy(origin).add(
        _dir.set((Math.random() - 0.5) * 0.18, Math.random() * 0.12, (Math.random() - 0.5) * 0.18),
      );
      m.vel.set((Math.random() - 0.5) * 0.65, 0.75 + Math.random() * 0.7, (Math.random() - 0.5) * 0.65);
      m.maxLife = 0.5 + Math.random() * 0.35;
      m.life = m.maxLife;
      m.baseScale = baseScale * (0.7 + Math.random() * 0.6);
    }
  }

  spawnShockwave(origin: THREE.Vector3): void {
    const sw = this.shockwaves[this.shockwaveCursor];
    this.shockwaveCursor = (this.shockwaveCursor + 1) % MAX_SHOCKWAVES;
    sw.mesh.position.set(origin.x, origin.y + 0.1, origin.z);
    sw.mesh.scale.set(0.4, 1, 0.4);
    sw.mesh.visible = true;
    sw.mat.opacity = 0.9;
    sw.life = sw.maxLife;
  }

  spawnFireball(origin: THREE.Vector3): void {
    const fb = this.fireballs[this.fireballCursor];
    this.fireballCursor = (this.fireballCursor + 1) % MAX_FIREBALLS;
    fb.mesh.position.set(origin.x, origin.y + 0.35, origin.z);
    fb.mesh.scale.setScalar(0.5);
    fb.mesh.visible = true;
    fb.mat.opacity = 0.92;
    fb.life = fb.maxLife;
  }

  clearPickups(): void {
    for (const p of this.pickups) {
      this.scene.remove(p.mesh);
    }
    this.pickups.length = 0;
  }

  clearDecals(): void {
    for (const d of this.decals) {
      d.visible = false;
    }
    for (const t of this.tracers) {
      t.mesh.visible = false;
      t.life = 0;
    }
    for (const s of this.sparks) {
      s.active = false;
    }
    for (const c of this.shells) {
      c.active = false;
    }
    for (const m of this.smokes) {
      m.active = false;
    }
    for (const sw of this.shockwaves) {
      sw.mesh.visible = false;
      sw.life = 0;
    }
    for (const fb of this.fireballs) {
      fb.mesh.visible = false;
      fb.life = 0;
    }
    this.explosionFlashLight.intensity = 0;
    for (const g of this.activeGrenades) {
      this.scene.remove(g.group);
      g.ledMat.dispose();
    }
    this.activeGrenades.length = 0;
  }

  update(dt: number, elapsed: number, onFragDetonate?: (evt: FragDetonationEvent) => void): void {
    for (let i = 0; i < this.fireLights.length; i++) {
      const fl = this.fireLights[i];
      fl.light.intensity =
        fl.baseIntensity +
        Math.sin(elapsed * 9.5 + fl.phase) * 2.2 +
        Math.cos(elapsed * 17.3 + fl.phase) * 1.1;
    }

    for (let i = 0; i < this.flickerLamps.length; i++) {
      const lp = this.flickerLamps[i];
      const pulse = Math.sin(elapsed * 23 + lp.phase) * Math.sin(elapsed * 7.1 + lp.phase * 2);
      const dip = pulse > 0.86 ? 0.35 : 1.0;
      lp.light.intensity = lp.baseIntensity * dip;
      lp.bulbMat.emissiveIntensity = dip > 0.5 ? 2.6 : 0.9;
    }

    if (this.explosionFlashLight.intensity > 0.1) {
      this.explosionFlashLight.intensity = THREE.MathUtils.damp(
        this.explosionFlashLight.intensity,
        0,
        14,
        dt,
      );
    }

    for (let i = 0; i < this.radarRotators.length; i++) {
      const obj = this.radarRotators[i];
      if (obj.position.y > 10) {
        obj.rotation.z += dt * 1.8;
      } else {
        obj.rotation.y += dt * (i % 2 === 0 ? 0.9 : -0.7);
      }
    }

    for (let i = 0; i < this.animatedBeacons.length; i++) {
      const b = this.animatedBeacons[i];
      const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(elapsed * 4.5 + b.phase));
      b.mat.emissiveIntensity = b.baseIntensity * pulse;
    }

    for (const rf of this.radiationFx) {
      const pulse = 0.72 + 0.28 * Math.sin(elapsed * 3.2 + rf.phase);
      rf.ringMat.opacity = 0.55 + 0.4 * pulse;
      rf.discMat.opacity = 0.05 + 0.09 * pulse;
      rf.disc.rotation.z = elapsed * 0.22 + rf.phase;
      rf.ring.rotation.z = -elapsed * 0.35 + rf.phase;
    }

    for (let i = 0; i < this.windSocks.length; i++) {
      const ws = this.windSocks[i];
      ws.rotation.y = Math.sin(elapsed * 1.7 + i) * 0.25 + 0.35;
      ws.rotation.z = Math.sin(elapsed * 5.2 + i) * 0.08 - 0.14;
    }

    if (this.patrolVehicle) {
      const pv = this.patrolVehicle;
      pv.x += pv.dir * pv.speed * dt;
      if (pv.x >= pv.maxX) {
        pv.x = pv.maxX;
        pv.dir = -1;
        pv.group.rotation.y = -Math.PI / 2;
      } else if (pv.x <= pv.minX) {
        pv.x = pv.minX;
        pv.dir = 1;
        pv.group.rotation.y = Math.PI / 2;
      }
      pv.group.position.x = pv.x;
      pv.collider.minX = pv.x - 2.2;
      pv.collider.maxX = pv.x + 2.2;
      const wheelAngularVel = (pv.speed / 0.42) * dt;
      for (let w = 0; w < pv.wheels.length; w++) {
        pv.wheels[w].rotation.x += wheelAngularVel;
      }
    }

    if (this.atmosphericPoints) {
      const posAttr = this.atmosphericPoints.geometry.attributes.position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        if (this.particleMode === 'snow') {
          arr[i] += dt * 5.2;
          arr[i + 1] -= dt * 3.8;
          arr[i + 2] += dt * 1.8;
          if (arr[i] > 42) arr[i] = -42;
          if (arr[i + 1] < 0.2) arr[i + 1] = 14;
          if (arr[i + 2] > 42) arr[i + 2] = -42;
        } else if (this.particleMode === 'rain') {
          arr[i] += dt * 2.2;
          arr[i + 1] -= dt * 26;
          arr[i + 2] += dt * 1.2;
          if (arr[i] > 42) arr[i] = -42;
          if (arr[i + 1] < 0.1) arr[i + 1] = 15;
          if (arr[i + 2] > 42) arr[i + 2] = -42;
        } else if (this.particleMode === 'dust') {
          arr[i] += dt * 1.5;
          arr[i + 1] += Math.sin(elapsed * 0.8 + i) * dt * 0.25;
          if (arr[i] > 42) arr[i] = -42;
        } else {
          arr[i + 1] += dt * 0.42;
          arr[i] += Math.sin(elapsed * 0.6 + i) * dt * 0.15;
          if (arr[i + 1] > 12) arr[i + 1] = 0.5;
        }
      }
      posAttr.needsUpdate = true;
    }

    // Update active thrown Frag Grenades (parabolic gravity + floor/ramp/wall bounce + fuse)
    for (let i = this.activeGrenades.length - 1; i >= 0; i--) {
      const g = this.activeGrenades[i];
      g.fuse -= dt;
      g.beepTimer -= dt;
      const urgent = g.fuse < 0.65;
      if (g.beepTimer <= 0 && g.fuse > 0) {
        g.beepTimer = urgent ? 0.14 : 0.34;
        this.onGrenadeBeepSound?.(urgent);
      }
      g.ledMat.emissiveIntensity = Math.sin(elapsed * (urgent ? 38 : 16)) > 0 ? 4.2 : 0.4;

      g.vel.y -= FRAG_GRENADE_SPEC.gravity * dt;
      const prevX = g.pos.x;
      const prevZ = g.pos.z;
      g.pos.x += g.vel.x * dt;
      g.pos.y += g.vel.y * dt;
      g.pos.z += g.vel.z * dt;

      // Wall/container AABB bounce reflection
      const res = resolveCircleAABBs(
        { x: g.pos.x, y: g.pos.y, z: g.pos.z },
        0.14,
        0.24,
        this.obstacles,
      );
      if (res.collided) {
        const pushX = res.x - g.pos.x;
        const pushZ = res.z - g.pos.z;
        g.pos.x = res.x;
        g.pos.z = res.z;
        if (Math.abs(pushX) > Math.abs(pushZ)) {
          g.vel.x = -g.vel.x * FRAG_GRENADE_SPEC.restitution;
        } else {
          g.vel.z = -g.vel.z * FRAG_GRENADE_SPEC.restitution;
        }
        if (Math.hypot(g.pos.x - prevX, g.pos.z - prevZ) > 0.02) {
          this.onGrenadeBounceSound?.();
        }
      }

      // Floor / ramp bounce
      const floorY = getSurfaceFloorHeight(
        g.pos.x,
        g.pos.z,
        g.pos.y,
        0.14,
        this.obstacles,
        this.ramps,
      ) + 0.07;

      if (g.pos.y <= floorY) {
        g.pos.y = floorY;
        if (g.vel.y < -1.8) {
          this.onGrenadeBounceSound?.();
        }
        g.vel.y = -g.vel.y * FRAG_GRENADE_SPEC.restitution;
        g.vel.x *= 0.68;
        g.vel.z *= 0.68;
        g.spin.multiplyScalar(0.62);
      }

      g.group.position.copy(g.pos);
      g.group.rotation.x += g.spin.x * dt;
      g.group.rotation.y += g.spin.y * dt;
      g.group.rotation.z += g.spin.z * dt;

      if (g.fuse <= 0) {
        const blastPos = g.pos.clone();
        this.scene.remove(g.group);
        g.ledMat.dispose();
        this.activeGrenades.splice(i, 1);

        this.triggerExplosionFX(blastPos);
        onFragDetonate?.({
          position: blastPos,
          radius: FRAG_GRENADE_SPEC.radius,
          maxDamage: FRAG_GRENADE_SPEC.maxDamage,
        });
      }
    }

    for (let i = 0; i < MAX_TRACERS; i++) {
      const tr = this.tracers[i];
      if (tr.life > 0) {
        tr.life -= dt;
        if (tr.life <= 0) tr.mesh.visible = false;
      }
    }

    let dirtySparks = false;
    for (let i = 0; i < MAX_SPARKS; i++) {
      const s = this.sparks[i];
      if (!s.active) continue;
      dirtySparks = true;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        _mat4.makeScale(0, 0, 0);
        this.sparkInstanced.setMatrixAt(i, _mat4);
        continue;
      }
      s.vel.y -= 14 * dt;
      s.pos.addScaledVector(s.vel, dt);
      if (s.pos.y < 0.02) {
        s.pos.y = 0.02;
        s.vel.y *= -0.35;
      }
      const fade = s.life / s.maxLife;
      _dir.copy(s.vel).normalize();
      _quat.setFromUnitVectors(_up, _dir);
      _scale.set(fade, fade, fade * 1.4);
      _mat4.compose(s.pos, _quat, _scale);
      this.sparkInstanced.setMatrixAt(i, _mat4);
    }
    if (dirtySparks) {
      this.sparkInstanced.instanceMatrix.needsUpdate = true;
    }

    let dirtyShells = false;
    for (let i = 0; i < MAX_SHELLS; i++) {
      const c = this.shells[i];
      if (!c.active) continue;
      dirtyShells = true;
      c.life -= dt;
      if (c.life <= 0) {
        c.active = false;
        _mat4.makeScale(0, 0, 0);
        this.shellInstanced.setMatrixAt(i, _mat4);
        continue;
      }
      c.vel.y -= 15.5 * dt;
      c.pos.addScaledVector(c.vel, dt);
      c.rot.x += c.spin.x * dt;
      c.rot.y += c.spin.y * dt;
      c.rot.z += c.spin.z * dt;
      if (c.pos.y < 0.025) {
        c.pos.y = 0.025;
        if (Math.abs(c.vel.y) > 1.1 && !c.bounced) {
          c.bounced = true;
          this.onShellBounceSound?.();
        }
        c.vel.y *= -0.38;
        c.vel.x *= 0.62;
        c.vel.z *= 0.62;
        c.spin.multiplyScalar(0.5);
      }
      _quat.setFromEuler(c.rot);
      const shrink = c.life < 0.25 ? c.life / 0.25 : 1;
      _scale.set(shrink, shrink, shrink);
      _mat4.compose(c.pos, _quat, _scale);
      this.shellInstanced.setMatrixAt(i, _mat4);
    }
    if (dirtyShells) {
      this.shellInstanced.instanceMatrix.needsUpdate = true;
    }

    let dirtySmoke = false;
    for (let i = 0; i < MAX_SMOKE; i++) {
      const m = this.smokes[i];
      if (!m.active) continue;
      dirtySmoke = true;
      m.life -= dt;
      if (m.life <= 0) {
        m.active = false;
        _mat4.makeScale(0, 0, 0);
        this.smokeInstanced.setMatrixAt(i, _mat4);
        continue;
      }
      m.pos.addScaledVector(m.vel, dt);
      const t = 1 - m.life / m.maxLife;
      const sc = m.baseScale * (0.65 + t * 1.8) * (1 - t * 0.4);
      _quat.identity();
      _scale.set(sc, sc, sc);
      _mat4.compose(m.pos, _quat, _scale);
      this.smokeInstanced.setMatrixAt(i, _mat4);
    }
    if (dirtySmoke) {
      this.smokeInstanced.instanceMatrix.needsUpdate = true;
    }

    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      const sw = this.shockwaves[i];
      if (sw.life > 0) {
        sw.life -= dt;
        const progress = 1 - Math.max(0, sw.life / sw.maxLife);
        const rad = 0.6 + progress * 10.5;
        sw.mesh.scale.set(rad, 1, rad);
        sw.mat.opacity = (1 - progress) * 0.85;
        if (sw.life <= 0) sw.mesh.visible = false;
      }
    }

    for (let i = 0; i < MAX_FIREBALLS; i++) {
      const fb = this.fireballs[i];
      if (fb.life > 0) {
        fb.life -= dt;
        const progress = 1 - Math.max(0, fb.life / fb.maxLife);
        const sc = 0.65 + progress * 3.4;
        fb.mesh.scale.setScalar(sc);
        fb.mat.opacity = (1 - progress) * 0.9;
        if (fb.life <= 0) fb.mesh.visible = false;
      }
    }

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (!p.active) continue;
      p.age += dt;
      p.mesh.rotation.y += dt * 1.6;
      const bob = Math.sin(p.age * 3.2) * 0.08 + 0.08;
      for (let c = 0; c < p.mesh.children.length - 1; c++) {
        const baseOffset = c === 1 ? 0.43 : c === 2 ? 0.25 : 0.24;
        p.mesh.children[c].position.y = baseOffset + bob;
      }
    }
  }

  dispose(): void {
    this.clearMap();
    this.texLib.dispose();
    for (const d of this.sharedDisposables) {
      d.dispose();
    }
  }
}
