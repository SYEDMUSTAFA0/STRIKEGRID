import * as THREE from 'three';
import { ProceduralTextureLibrary } from './textures';
import type { AABB2D, RampCollider } from './types';

export interface WorldBuildContext {
  mapGroup: THREE.Group;
  obstacles: AABB2D[];
  ramps: RampCollider[];
  raycastTargets: THREE.Object3D[];
  disposables: Array<{ dispose: () => void }>;
  texLib: ProceduralTextureLibrary;
  beacons: Array<{ mat: THREE.MeshStandardMaterial; light?: THREE.PointLight; phase: number; baseIntensity: number }>;
  windSocks: THREE.Object3D[];
  wheels: THREE.Object3D[];
}

function makeBeveledBox(
  pts: ReadonlyArray<readonly [number, number]>,
  depth: number,
  bevelThickness = 0.03,
  bevelSize = 0.03,
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

function addPart(
  ctx: WorldBuildContext,
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  raycast = false,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  ctx.disposables.push(geo);
  if (raycast) ctx.raycastTargets.push(m);
  return m;
}

function addStaticBox(
  ctx: WorldBuildContext,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  registerCollision: boolean,
  raycast = true,
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  ctx.mapGroup.add(mesh);
  if (raycast) ctx.raycastTargets.push(mesh);
  ctx.disposables.push(geo);

  if (registerCollision) {
    ctx.obstacles.push({
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
 * Multi-part 3D Tactical / Recon Motorcycle (Bike) with spinning wheels, forks, fairing, exhaust & lights.
 */
export function addTacticalMotorcycle(
  ctx: WorldBuildContext,
  x: number,
  z: number,
  rotY: number,
  bodyColorHex: number,
  accentColorHex = 0xf59e0b,
): THREE.Group {
  const group = new THREE.Group();
  const tireTex = ctx.texLib.createTireTreadTexture();

  const paintMat = new THREE.MeshStandardMaterial({
    color: bodyColorHex,
    roughness: 0.34,
    metalness: 0.55,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x1e232b,
    roughness: 0.45,
    metalness: 0.8,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: tireTex.map,
    normalMap: tireTex.normalMap,
    roughnessMap: tireTex.roughnessMap,
    roughness: 0.88,
    metalness: 0.08,
  });
  const alloyMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.24,
    metalness: 0.9,
  });
  const seatMat = new THREE.MeshStandardMaterial({
    color: 0x16181d,
    roughness: 0.82,
    metalness: 0.08,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColorHex,
    roughness: 0.38,
    metalness: 0.42,
  });
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xfff8e7,
    emissive: 0xffe4b5,
    emissiveIntensity: 2.0,
    roughness: 0.15,
  });
  const tailLightMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xdc2626,
    emissiveIntensity: 1.8,
    roughness: 0.2,
  });
  const shadowMat = new THREE.MeshBasicMaterial({
    map: ctx.texLib.createContactShadowTexture(),
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
  });
  ctx.disposables.push(
    paintMat,
    frameMat,
    tireMat,
    alloyMat,
    seatMat,
    accentMat,
    headlightMat,
    tailLightMat,
    shadowMat,
  );

  // Contact shadow
  const shadowGeo = new THREE.PlaneGeometry(1.5, 2.7);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.position.y = 0.02;
  group.add(shadow);
  ctx.disposables.push(shadowGeo);

  // Front & Rear Wheel Assemblies (radius ~0.34m)
  const buildWheel = (wz: number) => {
    const wheelGroup = new THREE.Group();
    wheelGroup.position.set(0, 0.34, wz);

    const tireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.16, 18);
    tireGeo.rotateZ(Math.PI / 2);
    addPart(ctx, wheelGroup, tireGeo, tireMat, 0, 0, 0);

    const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.17, 14);
    rimGeo.rotateZ(Math.PI / 2);
    addPart(ctx, wheelGroup, rimGeo, alloyMat, 0, 0, 0);

    const discGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.19, 12);
    discGeo.rotateZ(Math.PI / 2);
    addPart(ctx, wheelGroup, discGeo, frameMat, 0, 0, 0);

    for (let s = 0; s < 5; s++) {
      const spokeGeo = new THREE.BoxGeometry(0.175, 0.032, 0.42);
      addPart(ctx, wheelGroup, spokeGeo, frameMat, 0, 0, 0, (s / 5) * Math.PI, 0, 0);
    }
    group.add(wheelGroup);
    ctx.wheels.push(wheelGroup);
  };
  buildWheel(0.76);
  buildWheel(-0.78);

  // Sculpted chassis, fuel tank & tail cowl silhouette
  const bodyGeo = makeBeveledBox(
    [
      [-0.72, 0.34],
      [-0.2, 0.3],
      [0.45, 0.34],
      [0.72, 0.62],
      [0.52, 0.88],
      [0.14, 0.92],
      [-0.22, 0.72],
      [-0.84, 0.86],
      [-0.92, 0.74],
    ],
    0.34,
    0.035,
    0.035,
  );
  bodyGeo.rotateY(Math.PI / 2);
  addPart(ctx, group, bodyGeo, paintMat, 0, 0, 0, 0, 0, 0, true);

  // Engine block & radiator core
  const engineGeo = new THREE.BoxGeometry(0.36, 0.34, 0.56);
  addPart(ctx, group, engineGeo, frameMat, 0, 0.46, 0.02, 0, 0, 0, true);

  // Contoured Rider Saddle
  const seatGeo = new THREE.BoxGeometry(0.32, 0.1, 0.62);
  addPart(ctx, group, seatGeo, seatMat, 0, 0.78, -0.34, -0.08, 0, 0);

  // Accent Tank Stripe
  const stripeGeo = new THREE.BoxGeometry(0.37, 0.06, 0.46);
  addPart(ctx, group, stripeGeo, accentMat, 0, 0.84, 0.24, 0.12, 0, 0);

  // Twin Angled Front Forks & Handlebars
  const forkGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.78, 10);
  for (const sx of [-0.12, 0.12]) {
    addPart(ctx, group, forkGeo, alloyMat, sx, 0.68, 0.63, -0.34, 0, 0);
  }
  const barGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.76, 10);
  barGeo.rotateZ(Math.PI / 2);
  addPart(ctx, group, barGeo, frameMat, 0, 1.0, 0.48);

  const gripGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.14, 8);
  gripGeo.rotateZ(Math.PI / 2);
  addPart(ctx, group, gripGeo, seatMat, -0.34, 1.0, 0.48);
  addPart(ctx, group, gripGeo, seatMat, 0.34, 1.0, 0.48);

  // Front Windscreen & Headlight / Taillight
  const screenGeo = new THREE.BoxGeometry(0.34, 0.26, 0.03);
  addPart(ctx, group, screenGeo, frameMat, 0, 0.98, 0.62, -0.58, 0, 0);

  const headGeo = new THREE.BoxGeometry(0.24, 0.1, 0.08);
  addPart(ctx, group, headGeo, headlightMat, 0, 0.76, 0.74);

  const tailGeo = new THREE.BoxGeometry(0.18, 0.07, 0.07);
  addPart(ctx, group, tailGeo, tailLightMat, 0, 0.8, -0.94);

  // Upswept Exhaust Muffler & Chrome Tip
  const exhaustGeo = new THREE.CylinderGeometry(0.045, 0.038, 0.72, 10);
  exhaustGeo.rotateX(Math.PI / 2 - 0.16);
  addPart(ctx, group, exhaustGeo, alloyMat, 0.21, 0.38, -0.52);

  // Kickstand tilt subtly (~4 deg) for realism
  group.position.set(x, 0, z);
  group.rotation.set(0, rotY, 0.05);
  ctx.mapGroup.add(group);

  const halfX = Math.abs(Math.cos(rotY)) * 0.44 + Math.abs(Math.sin(rotY)) * 1.12;
  const halfZ = Math.abs(Math.sin(rotY)) * 0.44 + Math.abs(Math.cos(rotY)) * 1.12;
  ctx.obstacles.push({
    minX: x - halfX,
    maxX: x + halfX,
    minZ: z - halfZ,
    maxZ: z + halfZ,
    minY: 0,
    maxY: 1.22,
  });

  return group;
}

/**
 * Multi-part 3D Tactical SUV or Pickup Truck with beveled body, tinted cabin glass,
 * 4 rotating treaded wheel+alloy-rim assemblies, roof lightbar, bullbar & headlights.
 */
export function addTacticalVehicle(
  ctx: WorldBuildContext,
  opts: {
    x: number;
    z: number;
    rotY: number;
    variant: 'suv' | 'pickup';
    bodyColorHex: number;
    accentColorHex?: number;
    beaconColorHex?: number;
    registerStaticCollision?: boolean;
  },
): { group: THREE.Group; wheels: THREE.Object3D[]; collider?: AABB2D } {
  const {
    x,
    z,
    rotY,
    variant,
    bodyColorHex,
    accentColorHex = 0xf59e0b,
    beaconColorHex = 0x38bdf8,
    registerStaticCollision = true,
  } = opts;
  const group = new THREE.Group();
  const tireTex = ctx.texLib.createTireTreadTexture();

  const paintMat = new THREE.MeshStandardMaterial({
    color: bodyColorHex,
    roughness: 0.42,
    metalness: 0.48,
  });
  const chassisMat = new THREE.MeshStandardMaterial({
    color: 0x1b1f26,
    roughness: 0.56,
    metalness: 0.72,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.1,
    metalness: 0.45,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: tireTex.map,
    normalMap: tireTex.normalMap,
    roughnessMap: tireTex.roughnessMap,
    roughness: 0.88,
    metalness: 0.08,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.25,
    metalness: 0.88,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColorHex,
    roughness: 0.45,
    metalness: 0.35,
  });
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xfff8e7,
    emissive: 0xffe4b5,
    emissiveIntensity: 1.9,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xdc2626,
    emissiveIntensity: 1.7,
  });
  const beaconMat = new THREE.MeshStandardMaterial({
    color: beaconColorHex,
    emissive: beaconColorHex,
    emissiveIntensity: 2.0,
    roughness: 0.2,
  });
  const shadowMat = new THREE.MeshBasicMaterial({
    map: ctx.texLib.createContactShadowTexture(),
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  ctx.disposables.push(
    paintMat,
    chassisMat,
    glassMat,
    tireMat,
    rimMat,
    accentMat,
    headlightMat,
    tailMat,
    beaconMat,
    shadowMat,
  );

  // Contact shadow under truck/SUV
  const shadowGeo = new THREE.PlaneGeometry(2.7, 5.1);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.position.y = 0.025;
  group.add(shadow);
  ctx.disposables.push(shadowGeo);

  // Lower Chassis Frame & Skid Plate
  const frameGeo = new THREE.BoxGeometry(1.76, 0.24, 4.28);
  addPart(ctx, group, frameGeo, chassisMat, 0, 0.4, 0, 0, 0, 0, true);

  // Sculpted Lower Body Hull (wheel-arch flared silhouette)
  const lowerHullGeo = makeBeveledBox(
    [
      [-2.14, 0.44],
      [2.12, 0.44],
      [2.16, 0.86],
      [1.98, 1.08],
      [1.05, 1.12],
      [-2.14, 1.1],
    ],
    1.9,
    0.04,
    0.04,
  );
  lowerHullGeo.rotateY(Math.PI / 2);
  addPart(ctx, group, lowerHullGeo, paintMat, 0, 0, 0, 0, 0, 0, true);

  if (variant === 'suv') {
    // Full SUV Cabin
    const cabinGeo = makeBeveledBox(
      [
        [-1.92, 1.06],
        [0.95, 1.08],
        [0.52, 1.76],
        [-1.78, 1.76],
      ],
      1.7,
      0.04,
      0.04,
    );
    cabinGeo.rotateY(Math.PI / 2);
    addPart(ctx, group, cabinGeo, paintMat, 0, 0, 0, 0, 0, 0, true);

    // Tinted Windshield, Rear & Side Windows
    const windGeo = new THREE.BoxGeometry(1.56, 0.54, 0.06);
    addPart(ctx, group, windGeo, glassMat, 0, 1.4, 0.73, -0.54, 0, 0);
    const sideGlassGeo = new THREE.BoxGeometry(1.75, 0.48, 1.95);
    addPart(ctx, group, sideGlassGeo, glassMat, 0, 1.4, -0.62);
    const rearGlassGeo = new THREE.BoxGeometry(1.48, 0.48, 0.08);
    addPart(ctx, group, rearGlassGeo, glassMat, 0, 1.42, -1.85, 0.2, 0, 0);

    // Roof Rack & Tactical Beacon Bar
    const rackGeo = new THREE.BoxGeometry(1.44, 0.08, 1.65);
    addPart(ctx, group, rackGeo, chassisMat, 0, 1.81, -0.68);
    const barGeo = new THREE.BoxGeometry(1.18, 0.12, 0.24);
    addPart(ctx, group, barGeo, beaconMat, 0, 1.86, 0.26);
  } else {
    // Crew-Cab Pickup Cabin + Open Cargo Bed with Rollbar & Supply Crate
    const cabGeo = makeBeveledBox(
      [
        [-0.36, 1.06],
        [0.96, 1.08],
        [0.54, 1.76],
        [-0.36, 1.76],
      ],
      1.7,
      0.04,
      0.04,
    );
    cabGeo.rotateY(Math.PI / 2);
    addPart(ctx, group, cabGeo, paintMat, 0, 0, 0, 0, 0, 0, true);

    const windGeo = new THREE.BoxGeometry(1.56, 0.54, 0.06);
    addPart(ctx, group, windGeo, glassMat, 0, 1.4, 0.73, -0.54, 0, 0);
    const sideGlassGeo = new THREE.BoxGeometry(1.75, 0.46, 0.72);
    addPart(ctx, group, sideGlassGeo, glassMat, 0, 1.4, 0.1);

    // Bed rails & Rollbar
    const bedSideGeo = new THREE.BoxGeometry(0.14, 0.34, 1.68);
    addPart(ctx, group, bedSideGeo, paintMat, -0.88, 1.24, -1.25);
    addPart(ctx, group, bedSideGeo, paintMat, 0.88, 1.24, -1.25);
    const tailgateGeo = new THREE.BoxGeometry(1.88, 0.34, 0.14);
    addPart(ctx, group, tailgateGeo, paintMat, 0, 1.24, -2.06);

    const rollBarGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.66, 8);
    addPart(ctx, group, rollBarGeo, chassisMat, -0.78, 1.44, -0.48);
    addPart(ctx, group, rollBarGeo, chassisMat, 0.78, 1.44, -0.48);
    const rollTopGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.62, 8);
    rollTopGeo.rotateZ(Math.PI / 2);
    addPart(ctx, group, rollTopGeo, chassisMat, 0, 1.77, -0.48);

    const beaconGeo = new THREE.BoxGeometry(0.95, 0.1, 0.2);
    addPart(ctx, group, beaconGeo, beaconMat, 0, 1.84, -0.48);

    // Cargo load in bed
    const cargoGeo = new THREE.BoxGeometry(1.1, 0.48, 0.92);
    addPart(ctx, group, cargoGeo, accentMat, 0, 1.24, -1.32);
  }

  ctx.beacons.push({ mat: beaconMat, phase: Math.abs(x * 0.4 + z * 0.7), baseIntensity: 2.0 });

  // Side accent stripe + Front Grille & Steel Bullbar + Rear Bumper
  const stripeGeo = new THREE.BoxGeometry(1.96, 0.1, 3.6);
  addPart(ctx, group, stripeGeo, accentMat, 0, 0.82, -0.04);

  const grilleGeo = new THREE.BoxGeometry(1.3, 0.32, 0.08);
  addPart(ctx, group, grilleGeo, chassisMat, 0, 0.76, 2.15);

  const bullBarGeo = new THREE.BoxGeometry(1.78, 0.24, 0.18);
  addPart(ctx, group, bullBarGeo, chassisMat, 0, 0.56, 2.22);
  const rearBumperGeo = new THREE.BoxGeometry(1.88, 0.2, 0.16);
  addPart(ctx, group, rearBumperGeo, chassisMat, 0, 0.52, -2.2);

  // Twin Headlights & Taillights
  const hlGeo = new THREE.BoxGeometry(0.28, 0.14, 0.08);
  const tlGeo = new THREE.BoxGeometry(0.22, 0.18, 0.08);
  for (const sx of [-0.66, 0.66]) {
    addPart(ctx, group, hlGeo, headlightMat, sx, 0.84, 2.14);
    addPart(ctx, group, tlGeo, tailMat, sx, 0.84, -2.14);
  }

  // Side Mirrors
  const mirrorGeo = new THREE.BoxGeometry(0.18, 0.12, 0.14);
  addPart(ctx, group, mirrorGeo, chassisMat, -1.0, 1.24, 0.55);
  addPart(ctx, group, mirrorGeo, chassisMat, 1.0, 1.24, 0.55);

  // 4 Rotating Wheel Assemblies (radius 0.42m)
  const localWheels: THREE.Object3D[] = [];
  const wheelCoords: Array<[number, number]> = [
    [-0.94, 1.36],
    [0.94, 1.36],
    [-0.94, -1.36],
    [0.94, -1.36],
  ];
  for (const [wx, wz] of wheelCoords) {
    const wg = new THREE.Group();
    wg.position.set(wx, 0.42, wz);

    const tireGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 20);
    tireGeo.rotateZ(Math.PI / 2);
    addPart(ctx, wg, tireGeo, tireMat, 0, 0, 0);

    const rimGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.31, 14);
    rimGeo.rotateZ(Math.PI / 2);
    addPart(ctx, wg, rimGeo, rimMat, 0, 0, 0);

    const hubGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.34, 10);
    hubGeo.rotateZ(Math.PI / 2);
    addPart(ctx, wg, hubGeo, chassisMat, 0, 0, 0);

    for (let s = 0; s < 5; s++) {
      const spGeo = new THREE.BoxGeometry(0.32, 0.045, 0.46);
      addPart(ctx, wg, spGeo, chassisMat, 0, 0, 0, (s / 5) * Math.PI, 0, 0);
    }

    group.add(wg);
    localWheels.push(wg);
    ctx.wheels.push(wg);
  }

  group.position.set(x, 0, z);
  group.rotation.y = rotY;
  ctx.mapGroup.add(group);

  let collider: AABB2D | undefined;
  if (registerStaticCollision) {
    const halfX = Math.abs(Math.cos(rotY)) * 1.04 + Math.abs(Math.sin(rotY)) * 2.18;
    const halfZ = Math.abs(Math.sin(rotY)) * 1.04 + Math.abs(Math.cos(rotY)) * 2.18;
    collider = {
      minX: x - halfX,
      maxX: x + halfX,
      minZ: z - halfZ,
      maxZ: z + halfZ,
      minY: 0,
      maxY: 1.9,
    };
    ctx.obstacles.push(collider);
  }

  return { group, wheels: localWheels, collider };
}

/**
 * Multi-part 3D Composite Tree for Forest Area across all 3 map biomes.
 */
export function addCompositeTree(
  ctx: WorldBuildContext,
  opts: {
    x: number;
    z: number;
    scale?: number;
    style: 'pine' | 'spruce_snow' | 'acacia_desert';
    barkMat: THREE.Material;
    foliageMat: THREE.Material;
    capMat?: THREE.Material;
  },
): void {
  const { x, z, scale = 1, style, barkMat, foliageMat, capMat } = opts;
  const group = new THREE.Group();

  // Root flare + main tapered trunk
  const rootGeo = new THREE.CylinderGeometry(0.3 * scale, 0.48 * scale, 0.75 * scale, 8);
  addPart(ctx, group, rootGeo, barkMat, 0, 0.37 * scale, 0, 0, 0, 0, true);

  const trunkH = (style === 'acacia_desert' ? 4.4 : 3.8) * scale;
  const trunkGeo = new THREE.CylinderGeometry(0.2 * scale, 0.33 * scale, trunkH, 9);
  addPart(ctx, group, trunkGeo, barkMat, 0, trunkH * 0.5 + 0.3 * scale, 0, 0, 0, 0, true);

  if (style === 'acacia_desert') {
    // Branching desert acacia / palm limbs with wide layered umbrella canopies
    const branchOffsets: Array<[number, number, number, number]> = [
      [0.65, 4.1, 0.35, -0.55],
      [-0.65, 4.3, -0.45, 0.52],
      [0.15, 4.5, -0.65, -0.2],
    ];
    for (const [bx, by, bz, rz] of branchOffsets) {
      const bGeo = new THREE.CylinderGeometry(0.09 * scale, 0.14 * scale, 2.1 * scale, 7);
      addPart(ctx, group, bGeo, barkMat, bx * scale, by * scale, bz * scale, bz * 0.4, 0, rz);

      const discGeo = new THREE.CylinderGeometry(1.75 * scale, 1.35 * scale, 0.55 * scale, 9);
      addPart(ctx, group, discGeo, foliageMat, bx * 2.1 * scale, (by + 1.0) * scale, bz * 2.1 * scale);
    }
    const crownGeo = new THREE.CylinderGeometry(2.3 * scale, 1.7 * scale, 0.65 * scale, 10);
    addPart(ctx, group, crownGeo, foliageMat, 0, 5.5 * scale, 0);
  } else {
    // Tiered conifer pine / arctic snow-capped spruce
    const tiers = [
      { y: 3.1, r: 2.05, h: 2.3 },
      { y: 4.5, r: 1.62, h: 2.1 },
      { y: 5.8, r: 1.18, h: 1.85 },
      { y: 6.9, r: 0.72, h: 1.4 },
    ];
    for (let t = 0; t < tiers.length; t++) {
      const tier = tiers[t];
      const coneGeo = new THREE.ConeGeometry(tier.r * scale, tier.h * scale, 9);
      addPart(ctx, group, coneGeo, foliageMat, 0, tier.y * scale, 0, 0, t * 0.45, 0);
      if (style === 'spruce_snow' && capMat) {
        const snowCapGeo = new THREE.ConeGeometry(tier.r * 0.88 * scale, tier.h * 0.42 * scale, 9);
        addPart(
          ctx,
          group,
          snowCapGeo,
          capMat,
          0,
          (tier.y + tier.h * 0.24) * scale,
          0,
          0,
          t * 0.45,
          0,
        );
      }
    }
  }

  group.position.set(x, 0, z);
  group.rotation.y = (x * 0.7 + z * 1.1) % (Math.PI * 2);
  ctx.mapGroup.add(group);

  const r = 0.48 * scale;
  ctx.obstacles.push({
    minX: x - r,
    maxX: x + r,
    minZ: z - r,
    maxZ: z + r,
    minY: 0,
    maxY: 5.0 * scale,
  });
}

/**
 * Low-profile forest fern/shrub clusters & fallen timber logs (logs act as low cover).
 */
export function addForestUndergrowth(
  ctx: WorldBuildContext,
  x: number,
  z: number,
  rotY: number,
  barkMat: THREE.Material,
  fernMat: THREE.Material,
  withLog: boolean,
): void {
  const group = new THREE.Group();

  const bushGeo = new THREE.DodecahedronGeometry(0.55, 0);
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2;
    addPart(
      ctx,
      group,
      bushGeo,
      fernMat,
      Math.cos(ang) * 0.42,
      0.28,
      Math.sin(ang) * 0.42,
      0.2,
      ang,
      0,
    );
  }

  if (withLog) {
    const logGeo = new THREE.CylinderGeometry(0.32, 0.36, 3.2, 10);
    logGeo.rotateZ(Math.PI / 2);
    addPart(ctx, group, logGeo, barkMat, 0, 0.32, 0, 0, 0, 0, true);
    const halfX = Math.abs(Math.cos(rotY)) * 1.6 + Math.abs(Math.sin(rotY)) * 0.38;
    const halfZ = Math.abs(Math.sin(rotY)) * 1.6 + Math.abs(Math.cos(rotY)) * 0.38;
    ctx.obstacles.push({
      minX: x - halfX,
      maxX: x + halfX,
      minZ: z - halfZ,
      maxZ: z + halfZ,
      minY: 0,
      maxY: 0.72,
    });
  }

  group.position.set(x, 0, z);
  group.rotation.y = rotY;
  ctx.mapGroup.add(group);
}

/**
 * Landing Area Helipad (LZ-01) with H marking texture, 4 pulsing corner beacons & animated Wind Sock.
 */
export function addLandingHelipad(
  ctx: WorldBuildContext,
  x: number,
  z: number,
  padMat: THREE.Material,
  metalMat: THREE.Material,
): void {
  const heliTex = ctx.texLib.createHelipadTexture();
  const deckMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: heliTex,
    roughness: 0.85,
    metalness: 0.08,
  });
  ctx.disposables.push(deckMat);

  // Raised concrete apron (walkable y = 0.08m)
  addStaticBox(ctx, x, 0.04, z, 11.4, 0.08, 11.4, padMat, true, true);

  const topGeo = new THREE.PlaneGeometry(10.6, 10.6);
  topGeo.rotateX(-Math.PI / 2);
  const topMesh = new THREE.Mesh(topGeo, deckMat);
  topMesh.position.set(x, 0.092, z);
  topMesh.receiveShadow = true;
  ctx.mapGroup.add(topMesh);
  ctx.disposables.push(topGeo);

  // 4 Corner Perimeter Landing Beacons
  const beaconBaseGeo = new THREE.CylinderGeometry(0.18, 0.24, 0.18, 8);
  const beaconOrbGeo = new THREE.SphereGeometry(0.13, 10, 8);
  ctx.disposables.push(beaconBaseGeo, beaconOrbGeo);

  const corners: Array<[number, number]> = [
    [x - 5.1, z - 5.1],
    [x + 5.1, z - 5.1],
    [x - 5.1, z + 5.1],
    [x + 5.1, z + 5.1],
  ];
  corners.forEach(([bx, bz], idx) => {
    const bMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 2.0,
      roughness: 0.2,
    });
    ctx.disposables.push(bMat);
    const base = new THREE.Mesh(beaconBaseGeo, metalMat);
    base.position.set(bx, 0.17, bz);
    const orb = new THREE.Mesh(beaconOrbGeo, bMat);
    orb.position.set(bx, 0.3, bz);
    ctx.mapGroup.add(base, orb);
    ctx.beacons.push({ mat: bMat, phase: idx * 1.4, baseIntensity: 2.0 });
  });

  // Animated Wind Sock Tower on NW corner of Landing Pad
  const wx = x - 6.6;
  const wz = z - 4.2;
  const mastGeo = new THREE.CylinderGeometry(0.08, 0.12, 5.2, 8);
  const mast = new THREE.Mesh(mastGeo, metalMat);
  mast.position.set(wx, 2.6, wz);
  mast.castShadow = true;
  ctx.mapGroup.add(mast);
  ctx.disposables.push(mastGeo);
  ctx.obstacles.push({
    minX: wx - 0.25,
    maxX: wx + 0.25,
    minZ: wz - 0.25,
    maxZ: wz + 0.25,
    minY: 0,
    maxY: 5.2,
  });

  const sockPivot = new THREE.Group();
  sockPivot.position.set(wx, 5.05, wz);
  const sockMat1 = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.72 });
  const sockMat2 = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.72 });
  const cone1Geo = new THREE.CylinderGeometry(0.24, 0.18, 0.65, 10, 1, true);
  cone1Geo.rotateZ(-Math.PI / 2);
  const cone2Geo = new THREE.CylinderGeometry(0.18, 0.11, 0.65, 10, 1, true);
  cone2Geo.rotateZ(-Math.PI / 2);
  const s1 = new THREE.Mesh(cone1Geo, sockMat1);
  s1.position.x = 0.45;
  const s2 = new THREE.Mesh(cone2Geo, sockMat2);
  s2.position.x = 1.08;
  sockPivot.add(s1, s2);
  ctx.mapGroup.add(sockPivot);
  ctx.windSocks.push(sockPivot);
  ctx.disposables.push(sockMat1, sockMat2, cone1Geo, cone2Geo);
}

/**
 * Enterable Multi-Room Tactical Building in the Building Zone (West side)
 * with >= 2.8m wide doorways, embrasure windows, interior ops lighting, roof deck & sloped ramp.
 */
export function addEnterableTacticalBuilding(
  ctx: WorldBuildContext,
  opts: {
    centerX: number;
    centerZ: number;
    wallMat: THREE.Material;
    roofMat: THREE.Material;
    trimMat: THREE.Material;
    rampMat: THREE.Material;
    accentColorHex: number;
    addSlopedRamp: (cfg: {
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
    }) => void;
  },
): void {
  const { centerX, centerZ, wallMat, roofMat, trimMat, rampMat, accentColorHex, addSlopedRamp } =
    opts;
  // Footprint: 11m wide (X) x 14m deep (Z), walls height = 3.3m, roof y = 3.45m
  const hw = 5.5;
  const hd = 7.0;
  const wallH = 3.3;
  const t = 0.45;

  // Walkable ground floor pad (y = 0.08m)
  addStaticBox(ctx, centerX, 0.04, centerZ, 11.4, 0.08, 14.4, roofMat, true);

  // East wall (x = centerX + hw): 3.2m wide main doorway centered at z = centerZ
  addStaticBox(ctx, centerX + hw, wallH / 2, centerZ - 4.3, t, wallH, 5.4, wallMat, true);
  addStaticBox(ctx, centerX + hw, wallH / 2, centerZ + 4.3, t, wallH, 5.4, wallMat, true);
  // Header lintel above doorway (minY = 2.65m so player walks under freely!)
  addStaticBox(ctx, centerX + hw, 3.0, centerZ, t, 0.7, 3.2, trimMat, true);

  // North wall (z = centerZ - hd): 3.0m wide doorway centered at x = centerX
  addStaticBox(ctx, centerX - 3.5, wallH / 2, centerZ - hd, 4.0, wallH, t, wallMat, true);
  addStaticBox(ctx, centerX + 3.5, wallH / 2, centerZ - hd, 4.0, wallH, t, wallMat, true);
  addStaticBox(ctx, centerX, 3.0, centerZ - hd, 3.0, 0.7, t, trimMat, true);

  // South wall (z = centerZ + hd): 3.0m wide doorway centered at x = centerX
  addStaticBox(ctx, centerX - 3.5, wallH / 2, centerZ + hd, 4.0, wallH, t, wallMat, true);
  addStaticBox(ctx, centerX + 3.5, wallH / 2, centerZ + hd, 4.0, wallH, t, wallMat, true);
  addStaticBox(ctx, centerX, 3.0, centerZ + hd, 3.0, 0.7, t, trimMat, true);

  // West wall (x = centerX - hw): twin embrasure windows (low sill 1.1m, header 2.3..3.3m)
  addStaticBox(ctx, centerX - hw, 0.55, centerZ, t, 1.1, 14.0, wallMat, true);
  addStaticBox(ctx, centerX - hw, 2.8, centerZ, t, 1.0, 14.0, wallMat, true);
  addStaticBox(ctx, centerX - hw, wallH / 2, centerZ - 5.2, t, wallH, 3.6, wallMat, true);
  addStaticBox(ctx, centerX - hw, wallH / 2, centerZ, t, wallH, 1.6, wallMat, true);
  addStaticBox(ctx, centerX - hw, wallH / 2, centerZ + 5.2, t, wallH, 3.6, wallMat, true);

  // Interior room partition wall dividing Ops Bay (north) and Armory (south) with 2.8m interior doorway
  addStaticBox(ctx, centerX - 3.4, wallH / 2, centerZ + 1.2, 4.2, wallH, 0.32, wallMat, true);
  addStaticBox(ctx, centerX + 3.4, wallH / 2, centerZ + 1.2, 4.2, wallH, 0.32, wallMat, true);

  // Solid walkable roof slab (y = 3.3 .. 3.56, minY = 3.3 so player walks underneath!)
  addStaticBox(ctx, centerX, 3.43, centerZ, 11.6, 0.26, 14.6, roofMat, true);

  // Rooftop waist-high tactical parapet on East & North sides (leaving South ramp landing open)
  addStaticBox(ctx, centerX + hw, 3.92, centerZ, 0.28, 0.72, 14.2, trimMat, true);
  addStaticBox(ctx, centerX, 3.92, centerZ - hd, 11.2, 0.72, 0.28, trimMat, true);

  // Exterior sloped ramp along East-South side ascending smoothly to roof deck (y=3.56m)
  addStaticBox(ctx, centerX + hw + 1.5, 3.43, centerZ + 4.8, 2.8, 0.26, 3.8, roofMat, true);
  addSlopedRamp({
    centerX: centerX + hw + 1.5,
    centerZ: centerZ - 0.8,
    width: 2.6,
    length: 7.4,
    lowY: 0,
    highY: 3.56,
    axis: 'z',
    dir: 1,
    mat: rampMat,
    railMat: trimMat,
    withRails: true,
  });

  // Interior Ops Comms Console + Glowing Monitor + Warm Interior Ceiling Lamp
  addStaticBox(ctx, centerX - 3.2, 0.55, centerZ - 4.0, 2.4, 0.95, 0.9, trimMat, true);
  const screenMat = new THREE.MeshStandardMaterial({
    color: accentColorHex,
    emissive: accentColorHex,
    emissiveIntensity: 1.5,
    roughness: 0.2,
  });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffd599,
    emissive: 0xffb347,
    emissiveIntensity: 1.8,
    roughness: 0.2,
  });
  ctx.disposables.push(screenMat, bulbMat);
  addStaticBox(ctx, centerX - 3.2, 1.32, centerZ - 4.2, 1.4, 0.52, 0.1, screenMat, false, false);
  addStaticBox(ctx, centerX, 3.22, centerZ - 2.6, 2.2, 0.08, 0.35, bulbMat, false, false);
  addStaticBox(ctx, centerX, 3.22, centerZ + 4.0, 2.2, 0.08, 0.35, bulbMat, false, false);

  const interiorLight = new THREE.PointLight(0xffcb80, 7.5, 16, 1.8);
  interiorLight.position.set(centerX, 2.95, centerZ - 2.2);
  ctx.mapGroup.add(interiorLight);
}

/**
 * High-security Restriction Area Perimeter (z = -22) with steel posts, fencing,
 * two 6m clear entry gates, pulsing red security beacons, and procedural RESTRICTED AREA signage.
 */
export function addRestrictionPerimeter(
  ctx: WorldBuildContext,
  zLine: number,
  steelMat: THREE.Material,
  barrierMat: THREE.Material,
): void {
  const signTex = ctx.texLib.createRestrictedSignTexture();
  const signMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: signTex,
    roughness: 0.45,
    metalness: 0.35,
  });
  ctx.disposables.push(signMat);

  // Fence segments across X leaving two clear 6.0m wide gates: [-13..-7] and [+7..+13]
  const segments: Array<[number, number]> = [
    [-44, -14],
    [-6, 6],
    [14, 44],
  ];

  const postGeo = new THREE.CylinderGeometry(0.09, 0.11, 2.8, 8);
  const railGeo = new THREE.BoxGeometry(1, 0.08, 0.08);
  const meshBarGeo = new THREE.BoxGeometry(0.06, 2.35, 0.06);
  const beaconGeo = new THREE.SphereGeometry(0.16, 10, 8);
  const signGeo = new THREE.BoxGeometry(2.4, 1.2, 0.08);
  ctx.disposables.push(postGeo, railGeo, meshBarGeo, beaconGeo, signGeo);

  for (const [xStart, xEnd] of segments) {
    const len = xEnd - xStart;
    const midX = (xStart + xEnd) / 2;

    // Solid waist-high concrete base + steel fence posts & top/mid rails
    addStaticBox(ctx, midX, 0.35, zLine, len, 0.7, 0.45, barrierMat, true);

    // Upper fence collision above concrete curb
    ctx.obstacles.push({
      minX: xStart,
      maxX: xEnd,
      minZ: zLine - 0.16,
      maxZ: zLine + 0.16,
      minY: 0,
      maxY: 2.8,
    });

    const topRail = new THREE.Mesh(railGeo, steelMat);
    topRail.scale.x = len;
    topRail.position.set(midX, 2.65, zLine);
    const midRail = new THREE.Mesh(railGeo, steelMat);
    midRail.scale.x = len;
    midRail.position.set(midX, 1.65, zLine);
    ctx.mapGroup.add(topRail, midRail);

    for (let px = xStart; px <= xEnd; px += 3.0) {
      const post = new THREE.Mesh(postGeo, steelMat);
      post.position.set(px, 1.4, zLine);
      post.castShadow = true;
      ctx.mapGroup.add(post);
    }
    for (let bx = xStart + 0.6; bx < xEnd; bx += 0.9) {
      const bar = new THREE.Mesh(meshBarGeo, steelMat);
      bar.position.set(bx, 1.55, zLine);
      ctx.mapGroup.add(bar);
    }
  }

  // Gate stanchions with pulsing red security beacons + RESTRICTED AREA signs
  const gatePosts = [-14, -6, 6, 14];
  gatePosts.forEach((gx, idx) => {
    addStaticBox(ctx, gx, 1.55, zLine, 0.65, 3.1, 0.65, steelMat, true);
    const bMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xdc2626,
      emissiveIntensity: 2.4,
      roughness: 0.2,
    });
    ctx.disposables.push(bMat);
    const orb = new THREE.Mesh(beaconGeo, bMat);
    orb.position.set(gx, 3.24, zLine);
    ctx.mapGroup.add(orb);
    ctx.beacons.push({ mat: bMat, phase: idx * 1.1, baseIntensity: 2.4 });
  });

  for (const sx of [0, -18, 18]) {
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.position.set(sx, 1.95, zLine + 0.3);
    sign.castShadow = true;
    ctx.mapGroup.add(sign);
  }
}
