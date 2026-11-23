import * as THREE from 'three';

export interface PBRTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

export interface FacialTextureSet extends PBRTextureSet {
  bumpMap: THREE.CanvasTexture;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildNormalFromHeight(
  height: Float32Array,
  size: number,
  strength: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const sample = (x: number, y: number) => {
    const wx = ((x % size) + size) % size;
    const wy = ((y % size) + size) % size;
    return height[wy * size + wx];
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dX = tr + 2 * r + br - (tl + 2 * l + bl);
      const dY = bl + 2 * b + br - (tl + 2 * t + tr);

      let nx = -dX * strength;
      let ny = -dY * strength;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;

      const idx = (y * size + x) * 4;
      data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function finalizeSet(
  albedoCanvas: HTMLCanvasElement,
  roughCanvas: HTMLCanvasElement,
  heightField: Float32Array,
  size: number,
  normalStrength: number,
  maxAnisotropy: number,
  repeatX = 1,
  repeatY = 1,
): PBRTextureSet {
  const map = new THREE.CanvasTexture(albedoCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeatX, repeatY);
  map.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(repeatX, repeatY);
  roughnessMap.anisotropy = maxAnisotropy;

  const normalMap = buildNormalFromHeight(heightField, size, normalStrength);
  normalMap.repeat.set(repeatX, repeatY);
  normalMap.anisotropy = maxAnisotropy;

  return { map, normalMap, roughnessMap };
}

export class ProceduralTextureLibrary {
  private disposables: THREE.Texture[] = [];

  constructor(private readonly maxAnisotropy: number) {}

  private trackSet(set: PBRTextureSet): PBRTextureSet {
    this.disposables.push(set.map, set.normalMap, set.roughnessMap);
    return set;
  }

  private trackFacialSet(set: FacialTextureSet): FacialTextureSet {
    this.disposables.push(set.map, set.normalMap, set.roughnessMap, set.bumpMap);
    return set;
  }

  createAsphaltSet(repeat = 16): PBRTextureSet {
    const size = 256;
    const rng = mulberry32(101);
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;

    const aImg = actx.createImageData(size, size);
    const rImg = rctx.createImageData(size, size);
    const height = new Float32Array(size * size);

    const k = (2 * Math.PI) / size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const grain = rng();
        const warp = Math.sin(x * k * 2 + y * k) * 0.8 + Math.cos(y * k * 2 - x * k) * 0.7;
        const macro =
          Math.sin(x * k * 1 + warp) * Math.cos(y * k * 1 - warp * 0.5) * 0.55 +
          Math.sin((x + y) * k * 2) * 0.25 +
          Math.cos((x - y) * k * 3) * 0.2;
        const dampRaw = Math.max(0, macro - 0.12) / 0.88;
        const damp = dampRaw * dampRaw * (3 - 2 * dampRaw); // smoothstep C1 continuous
        const oilPatch = Math.max(0, Math.sin(x * k * 3 + 1.1) * Math.sin(y * k * 2 - 0.7) - 0.45);

        const base = 37 + grain * 16 - damp * 11 - oilPatch * 9;
        const idx = i * 4;
        aImg.data[idx] = Math.max(12, Math.min(255, base + rng() * 4));
        aImg.data[idx + 1] = Math.max(12, Math.min(255, base + rng() * 4));
        aImg.data[idx + 2] = Math.max(14, Math.min(255, base + 4 + rng() * 4 + damp * 5));
        aImg.data[idx + 3] = 255;

        // Smooth organic damp patches (low roughness ~72) vs dry aggregate (~218)
        const roughVal = Math.max(
          64,
          Math.min(248, 218 - damp * 138 - oilPatch * 70 + (grain - 0.5) * 28),
        );
        rImg.data[idx] = roughVal;
        rImg.data[idx + 1] = roughVal;
        rImg.data[idx + 2] = roughVal;
        rImg.data[idx + 3] = 255;

        // Water/moisture fills low aggregate pores flatly without artificial crater rims
        height[i] = grain * 0.48 * (1 - damp * 0.88);
      }
    }

    actx.putImageData(aImg, 0, 0);
    rctx.putImageData(rImg, 0, 0);

    // Subtle hairline asphalt cracks
    actx.strokeStyle = 'rgba(18, 20, 24, 0.7)';
    actx.lineWidth = 1.4;
    for (let c = 0; c < 4; c++) {
      actx.beginPath();
      let cx = rng() * size;
      let cy = rng() * size;
      actx.moveTo(cx, cy);
      for (let s = 0; s < 10; s++) {
        cx += (rng() - 0.5) * 30;
        cy += (rng() - 0.5) * 30;
        actx.lineTo(cx, cy);
      }
      actx.stroke();
    }

    return this.trackSet(
      finalizeSet(albedo, rough, height, size, 1.35, this.maxAnisotropy, repeat, repeat),
    );
  }

  createConcreteSet(repeatX = 2, repeatY = 1): PBRTextureSet {
    const size = 256;
    const rng = mulberry32(202);
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;

    const aImg = actx.createImageData(size, size);
    const rImg = rctx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const noise = rng();
        const grime = Math.pow(y / size, 1.8) * 32; // darker near bottom
        const panelSeam = x % 128 < 3 || y % 128 < 3 ? -26 : 0;
        const val = 104 + noise * 22 - grime + panelSeam;

        const idx = i * 4;
        aImg.data[idx] = Math.max(20, Math.min(255, val + 3));
        aImg.data[idx + 1] = Math.max(20, Math.min(255, val + 1));
        aImg.data[idx + 2] = Math.max(20, Math.min(255, val - 3));
        aImg.data[idx + 3] = 255;

        const rVal = Math.max(150, Math.min(248, 210 + (noise - 0.5) * 30));
        rImg.data[idx] = rVal;
        rImg.data[idx + 1] = rVal;
        rImg.data[idx + 2] = rVal;
        rImg.data[idx + 3] = 255;

        height[i] = noise * 0.45 + (panelSeam < 0 ? -0.5 : 0);
      }
    }

    actx.putImageData(aImg, 0, 0);
    rctx.putImageData(rImg, 0, 0);

    // Formwork tie holes
    actx.fillStyle = 'rgba(32, 34, 38, 0.75)';
    for (const px of [32, 96, 160, 224]) {
      for (const py of [40, 200]) {
        actx.beginPath();
        actx.arc(px, py, 3, 0, Math.PI * 2);
        actx.fill();
      }
    }

    return this.trackSet(
      finalizeSet(albedo, rough, height, size, 1.6, this.maxAnisotropy, repeatX, repeatY),
    );
  }

  createContainerSet(
    baseRgb: [number, number, number],
    seed: number,
  ): PBRTextureSet {
    const size = 256;
    const rng = mulberry32(seed);
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;

    const aImg = actx.createImageData(size, size);
    const rImg = rctx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        // Vertical corrugated steel ribs
        const rib = Math.sin((x / size) * Math.PI * 2 * 14);
        const ribShade = rib * 16;
        const grit = (rng() - 0.5) * 14;
        const rustMask =
          Math.max(
            0,
            Math.sin(x * 0.07 + seed) * Math.cos(y * 0.055) +
              (y > size * 0.75 ? 0.45 : -0.15),
          ) * 0.85;

        const chipEdge = (x < 12 || x > size - 12 || y < 12 || y > size - 12) && rng() > 0.55;
        const r = chipEdge ? 142 : baseRgb[0] + ribShade + grit;
        const g = chipEdge ? 148 : baseRgb[1] + ribShade + grit;
        const b = chipEdge ? 155 : baseRgb[2] + ribShade + grit;

        // Blend toward oxidized rust (#7a3b1e)
        const idx = i * 4;
        aImg.data[idx] = Math.max(15, Math.min(255, r * (1 - rustMask) + 124 * rustMask));
        aImg.data[idx + 1] = Math.max(15, Math.min(255, g * (1 - rustMask) + 58 * rustMask));
        aImg.data[idx + 2] = Math.max(15, Math.min(255, b * (1 - rustMask) + 32 * rustMask));
        aImg.data[idx + 3] = 255;

        // Paint is semi-matte (140), exposed steel chips smooth (75), rust very rough (240)
        const roughVal = chipEdge
          ? 78
          : Math.max(95, Math.min(250, 140 + rustMask * 100 + grit));
        rImg.data[idx] = roughVal;
        rImg.data[idx + 1] = roughVal;
        rImg.data[idx + 2] = roughVal;
        rImg.data[idx + 3] = 255;

        height[i] = rib * 0.55 + grit * 0.015 + rustMask * 0.25 + (chipEdge ? -0.18 : 0);
      }
    }

    actx.putImageData(aImg, 0, 0);
    rctx.putImageData(rImg, 0, 0);

    // Scratched metal streaks + industrial stencil marking
    actx.strokeStyle = 'rgba(195, 204, 214, 0.28)';
    actx.lineWidth = 1.2;
    for (let s = 0; s < 8; s++) {
      const sx = rng() * size;
      const sy = rng() * size;
      actx.beginPath();
      actx.moveTo(sx, sy);
      actx.lineTo(sx + 18 + rng() * 24, sy + (rng() - 0.5) * 8);
      actx.stroke();
    }
    actx.fillStyle = 'rgba(230, 226, 214, 0.36)';
    actx.font = 'bold 14px monospace';
    actx.fillText('SEC-09 // 45G1', 18, 42);

    return this.trackSet(
      finalizeSet(albedo, rough, height, size, 2.2, this.maxAnisotropy, 1, 1),
    );
  }

  createMetalCrateSet(): PBRTextureSet {
    const size = 256;
    const rng = mulberry32(404);
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;

    const aImg = actx.createImageData(size, size);
    const rImg = rctx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const border = x < 16 || x > size - 16 || y < 16 || y > size - 16;
        const diag = Math.abs(x - y) < 8 || Math.abs(x + y - size) < 8;
        const noise = (rng() - 0.5) * 14;
        const scratch = border && rng() > 0.8 ? 42 : 0;
        const base = (border || diag ? 76 : 58) + scratch;
        const idx = i * 4;
        aImg.data[idx] = Math.min(255, base + noise);
        aImg.data[idx + 1] = Math.min(255, base + 3 + noise);
        aImg.data[idx + 2] = Math.min(255, base + 7 + noise);
        aImg.data[idx + 3] = 255;

        const rVal = scratch > 0 ? 70 : border || diag ? 110 : 155;
        rImg.data[idx] = rVal;
        rImg.data[idx + 1] = rVal;
        rImg.data[idx + 2] = rVal;
        rImg.data[idx + 3] = 255;

        height[i] = (border || diag ? 0.5 : 0.1) + noise * 0.01;
      }
    }

    actx.putImageData(aImg, 0, 0);
    rctx.putImageData(rImg, 0, 0);

    // Chipped hazard stripe accent
    actx.fillStyle = 'rgba(217, 119, 6, 0.72)';
    actx.fillRect(24, size - 36, size - 48, 10);

    return this.trackSet(
      finalizeSet(albedo, rough, height, size, 1.8, this.maxAnisotropy, 1, 1),
    );
  }

  createContactShadowTexture(): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(
      size / 2,
      size / 2,
      size * 0.08,
      size / 2,
      size / 2,
      size * 0.48,
    );
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.75)');
    grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.35)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(tex);
    return tex;
  }

  createBulletHoleTexture(): THREE.CanvasTexture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);

    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 26);
    grad.addColorStop(0, 'rgba(5, 5, 6, 0.96)');
    grad.addColorStop(0.32, 'rgba(20, 18, 16, 0.85)');
    grad.addColorStop(0.58, 'rgba(70, 62, 54, 0.35)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(15, 14, 14, 0.65)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      ctx.beginPath();
      ctx.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6);
      ctx.lineTo(32 + Math.cos(a) * 19, 32 + Math.sin(a) * 19);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(tex);
    return tex;
  }

  createSnowSet(repeat = 16): PBRTextureSet {
    const size = 256;
    const rng = mulberry32(505);
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;

    const aImg = actx.createImageData(size, size);
    const rImg = rctx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const drift =
          Math.sin(x * 0.049 + Math.sin(y * 0.025) * 1.6) * 0.5 +
          Math.cos(y * 0.049) * 0.3;
        const sparkle = rng();
        const icePatch = drift < -0.35 ? 1 : 0;

        const base = 172 + drift * 16 + (sparkle - 0.5) * 10;
        const idx = i * 4;
        aImg.data[idx] = Math.min(225, Math.max(125, base - (icePatch ? 18 : 0)));
        aImg.data[idx + 1] = Math.min(232, Math.max(140, base + 6));
        aImg.data[idx + 2] = Math.min(242, Math.max(160, base + 18));
        aImg.data[idx + 3] = 255;

        const rVal = icePatch ? 115 + sparkle * 35 : 210 + sparkle * 32;
        rImg.data[idx] = rVal;
        rImg.data[idx + 1] = rVal;
        rImg.data[idx + 2] = rVal;
        rImg.data[idx + 3] = 255;

        height[i] = drift * 0.5 + sparkle * 0.15;
      }
    }
    actx.putImageData(aImg, 0, 0);
    rctx.putImageData(rImg, 0, 0);

    return this.trackSet(
      finalizeSet(albedo, rough, height, size, 1.15, this.maxAnisotropy, repeat, repeat),
    );
  }

  createDesertSandSet(repeat = 16): PBRTextureSet {
    const size = 256;
    const rng = mulberry32(606);
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;

    const aImg = actx.createImageData(size, size);
    const rImg = rctx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const ripple = Math.sin(y * 0.147 + Math.sin(x * 0.049) * 2.2) * 0.5;
        const grit = (rng() - 0.5) * 16;
        const idx = i * 4;
        aImg.data[idx] = Math.min(230, Math.max(110, 176 + ripple * 16 + grit));
        aImg.data[idx + 1] = Math.min(195, Math.max(90, 138 + ripple * 14 + grit));
        aImg.data[idx + 2] = Math.min(145, Math.max(60, 92 + ripple * 10 + grit));
        aImg.data[idx + 3] = 255;

        const rVal = 222 + grit;
        rImg.data[idx] = rVal;
        rImg.data[idx + 1] = rVal;
        rImg.data[idx + 2] = rVal;
        rImg.data[idx + 3] = 255;

        height[i] = ripple * 0.55 + grit * 0.02;
      }
    }
    actx.putImageData(aImg, 0, 0);
    rctx.putImageData(rImg, 0, 0);

    return this.trackSet(
      finalizeSet(albedo, rough, height, size, 1.3, this.maxAnisotropy, repeat, repeat),
    );
  }

  createSandstoneSet(repeatX = 2, repeatY = 1): PBRTextureSet {
    const size = 256;
    const rng = mulberry32(707);
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;

    const aImg = actx.createImageData(size, size);
    const rImg = rctx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const row = Math.floor(y / 64);
      const xShift = (row % 2) * 64;
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const mortar = y % 64 < 3 || (x + xShift) % 128 < 3;
        const blockTint = ((Math.floor((x + xShift) / 128) * 13 + row * 7) % 5) * 4 - 8;
        const grain = (rng() - 0.5) * 18;
        const strata = Math.sin(y * 0.25) * 6;
        const delta = mortar ? -36 : blockTint + grain + strata;

        const idx = i * 4;
        aImg.data[idx] = Math.min(255, Math.max(60, 188 + delta));
        aImg.data[idx + 1] = Math.min(255, Math.max(50, 146 + delta * 0.85));
        aImg.data[idx + 2] = Math.min(255, Math.max(40, 100 + delta * 0.7));
        aImg.data[idx + 3] = 255;

        const rVal = mortar ? 240 : Math.min(245, Math.max(175, 212 + grain));
        rImg.data[idx] = rVal;
        rImg.data[idx + 1] = rVal;
        rImg.data[idx + 2] = rVal;
        rImg.data[idx + 3] = 255;

        height[i] = mortar ? -0.6 : grain * 0.025 + strata * 0.03;
      }
    }
    actx.putImageData(aImg, 0, 0);
    rctx.putImageData(rImg, 0, 0);

    return this.trackSet(
      finalizeSet(albedo, rough, height, size, 1.75, this.maxAnisotropy, repeatX, repeatY),
    );
  }

  createArcticCamoSet(): PBRTextureSet {
    const size = 256;
    const rng = mulberry32(808);
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;
    actx.fillStyle = '#cbd5e1';
    actx.fillRect(0, 0, size, size);

    const colors = ['#64748b', '#1e293b', '#94a3b8', '#334155', '#e2e8f0'];
    for (let p = 0; p < 62; p++) {
      actx.fillStyle = colors[p % colors.length];
      actx.beginPath();
      const cx = rng() * size;
      const cy = rng() * size;
      actx.moveTo(cx, cy);
      for (let v = 0; v < 4; v++) {
        actx.lineTo(cx + (rng() - 0.5) * 62, cy + (rng() - 0.5) * 42);
      }
      actx.closePath();
      actx.fill();
    }

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;
    rctx.fillStyle = 'rgb(205, 205, 205)';
    rctx.fillRect(0, 0, size, size);

    const height = new Float32Array(size * size);
    for (let i = 0; i < height.length; i++) {
      height[i] = (rng() - 0.5) * 0.28;
    }

    return this.trackSet(finalizeSet(albedo, rough, height, size, 0.85, this.maxAnisotropy, 5, 5));
  }

  createCarbonFiberSet(): PBRTextureSet {
    const size = 256;
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;

    const aImg = actx.createImageData(size, size);
    const rImg = rctx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const cellX = Math.floor(x / 8);
        const cellY = Math.floor(y / 8);
        const twill = (cellX + cellY) % 4 < 2;
        const lx = (x % 8) / 8;
        const ly = (y % 8) / 8;
        const strand = twill ? Math.sin(ly * Math.PI) : Math.sin(lx * Math.PI);
        const val = (twill ? 18 : 42) + strand * 26;

        const idx = i * 4;
        aImg.data[idx] = val;
        aImg.data[idx + 1] = val + 2;
        aImg.data[idx + 2] = val + 6;
        aImg.data[idx + 3] = 255;

        const rVal = twill ? 72 : 145;
        rImg.data[idx] = rVal;
        rImg.data[idx + 1] = rVal;
        rImg.data[idx + 2] = rVal;
        rImg.data[idx + 3] = 255;

        height[i] = strand * (twill ? 0.55 : -0.4);
      }
    }
    actx.putImageData(aImg, 0, 0);
    rctx.putImageData(rImg, 0, 0);

    return this.trackSet(finalizeSet(albedo, rough, height, size, 1.7, this.maxAnisotropy, 8, 8));
  }

  createCamoFabricSet(baseHex: [number, number, number], seed: number): PBRTextureSet {
    const size = 128;
    const rng = mulberry32(seed);
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;
    actx.fillStyle = `rgb(${baseHex[0]}, ${baseHex[1]}, ${baseHex[2]})`;
    actx.fillRect(0, 0, size, size);

    for (let p = 0; p < 28; p++) {
      const shade = p % 2 === 0 ? 0.72 : 1.18;
      actx.fillStyle = `rgba(${Math.min(255, Math.round(baseHex[0] * shade))}, ${Math.min(255, Math.round(baseHex[1] * shade))}, ${Math.min(255, Math.round(baseHex[2] * shade))}, 0.75)`;
      actx.beginPath();
      actx.ellipse(rng() * size, rng() * size, 8 + rng() * 14, 5 + rng() * 9, rng() * Math.PI, 0, Math.PI * 2);
      actx.fill();
    }

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;
    rctx.fillStyle = 'rgb(220, 220, 220)';
    rctx.fillRect(0, 0, size, size);

    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        height[y * size + x] = ((x % 4 === 0 || y % 4 === 0) ? -0.3 : 0.2) + (rng() - 0.5) * 0.1;
      }
    }

    return this.trackSet(finalizeSet(albedo, rough, height, size, 0.9, this.maxAnisotropy, 2, 2));
  }

  createWoodCrateSet(): PBRTextureSet {
    const size = 256;
    const rng = mulberry32(911);
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;

    const aImg = actx.createImageData(size, size);
    const rImg = rctx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const plankIdx = Math.floor(y / 64);
      const seam = y % 64 < 3;
      const plankTone = ((plankIdx * 7) % 3 - 1) * 7;
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const border = x < 18 || x > size - 18 || y < 18 || y > size - 18;
        const borderEdge = x === 18 || x === size - 19 || y === 18 || y === size - 19;
        const diag = Math.abs(x - y) < 11 && !border;
        const grain = Math.sin(y * 0.24 + Math.sin(x * 0.03 + plankIdx * 1.9) * 0.9) * 4.5;
        const noise = (rng() - 0.5) * 10;
        const trim = border ? 14 : diag ? 10 : 0;
        const delta = (seam || borderEdge ? -38 : grain + plankTone) + noise + trim;

        const idx = i * 4;
        aImg.data[idx] = Math.min(255, Math.max(36, 148 + delta));
        aImg.data[idx + 1] = Math.min(255, Math.max(28, 108 + delta * 0.85));
        aImg.data[idx + 2] = Math.min(255, Math.max(18, 66 + delta * 0.65));
        aImg.data[idx + 3] = 255;

        const rVal = seam || borderEdge ? 245 : Math.min(242, Math.max(178, 212 + noise));
        rImg.data[idx] = rVal;
        rImg.data[idx + 1] = rVal;
        rImg.data[idx + 2] = rVal;
        rImg.data[idx + 3] = 255;

        height[i] = seam || borderEdge ? -0.55 : (border || diag ? 0.32 : 0.05) + noise * 0.008;
      }
    }
    actx.putImageData(aImg, 0, 0);
    rctx.putImageData(rImg, 0, 0);

    // Corner nail rivets & crisp ammo stencil
    actx.fillStyle = 'rgba(28, 30, 34, 0.85)';
    for (const nx of [10, size - 10]) {
      for (const ny of [10, 64, 128, 192, size - 10]) {
        actx.beginPath();
        actx.arc(nx, ny, 2.2, 0, Math.PI * 2);
        actx.fill();
      }
    }
    actx.fillStyle = 'rgba(245, 158, 11, 0.85)';
    actx.font = 'bold 16px monospace';
    actx.fillText('SUPPLY', 94, 134);

    return this.trackSet(finalizeSet(albedo, rough, height, size, 1.35, this.maxAnisotropy, 1, 1));
  }

  createPressurizedBarrelSet(): PBRTextureSet {
    const size = 256;
    const rng = mulberry32(977);
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;

    const aImg = actx.createImageData(size, size);
    const rImg = rctx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const band = Math.abs(y - 128) < 18;
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const chevron = band && ((Math.floor((x + y) / 16) % 2) === 0);
        const scratch = rng() > 0.96 ? 1 : 0;
        const grit = (rng() - 0.5) * 14;
        const idx = i * 4;
        if (scratch) {
          aImg.data[idx] = 175;
          aImg.data[idx + 1] = 180;
          aImg.data[idx + 2] = 186;
        } else if (band) {
          aImg.data[idx] = chevron ? 235 : 28;
          aImg.data[idx + 1] = chevron ? 165 : 28;
          aImg.data[idx + 2] = chevron ? 24 : 30;
        } else {
          aImg.data[idx] = Math.min(255, Math.max(40, 178 + grit));
          aImg.data[idx + 1] = Math.min(255, Math.max(20, 42 + grit * 0.4));
          aImg.data[idx + 2] = Math.min(255, Math.max(18, 32 + grit * 0.4));
        }
        aImg.data[idx + 3] = 255;

        const rVal = scratch ? 75 : 128 + grit;
        rImg.data[idx] = rVal;
        rImg.data[idx + 1] = rVal;
        rImg.data[idx + 2] = rVal;
        rImg.data[idx + 3] = 255;
        height[i] = band ? 0.15 : grit * 0.015;
      }
    }
    actx.putImageData(aImg, 0, 0);
    rctx.putImageData(rImg, 0, 0);

    return this.trackSet(finalizeSet(albedo, rough, height, size, 1.2, this.maxAnisotropy, 1, 1));
  }

  createHelipadTexture(): THREE.CanvasTexture {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#272d36';
    ctx.fillRect(0, 0, size, size);

    // Concrete deck grid joints
    ctx.strokeStyle = 'rgba(14, 17, 22, 0.55)';
    ctx.lineWidth = 3;
    for (let g = 64; g < size; g += 64) {
      ctx.beginPath();
      ctx.moveTo(g, 0);
      ctx.lineTo(g, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, g);
      ctx.lineTo(size, g);
      ctx.stroke();
    }

    // Outer dashed safety ring
    ctx.save();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 10;
    ctx.setLineDash([28, 18]);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 204, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Inner solid landing circle
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 162, 0, Math.PI * 2);
    ctx.stroke();

    // Bold 'H' helipad emblem
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(184, 152, 34, 208);
    ctx.fillRect(294, 152, 34, 208);
    ctx.fillRect(184, 238, 144, 36);

    // Corner caution markings
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 24px monospace';
    ctx.fillText('LZ-01', 28, 44);
    ctx.fillText('LANDING AREA', 308, 484);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.maxAnisotropy;
    this.disposables.push(tex);
    return tex;
  }

  createRestrictedSignTexture(): THREE.CanvasTexture {
    const w = 256;
    const h = 128;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#181c24';
    ctx.fillRect(0, 0, w, h);

    // Top red & white hazard stripe banner
    ctx.fillStyle = '#b91c1c';
    ctx.fillRect(0, 0, w, 34);
    ctx.fillStyle = '#f8fafc';
    for (let sx = -32; sx < w + 32; sx += 28) {
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx + 14, 0);
      ctx.lineTo(sx + 2, 34);
      ctx.lineTo(sx - 12, 34);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    ctx.fillStyle = '#ef4444';
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px monospace';
    ctx.fillText('RESTRICTED AREA', w / 2, 64);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('AUTHORIZED SEC-09 ONLY', w / 2, 92);
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('DEADLY FORCE AUTHORIZED', w / 2, 112);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.maxAnisotropy;
    this.disposables.push(tex);
    return tex;
  }

  createTireTreadTexture(): PBRTextureSet {
    const size = 128;
    const rng = mulberry32(733);
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;

    const aImg = actx.createImageData(size, size);
    const rImg = rctx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const dx = Math.abs(x - size / 2);
        const chevron = ((y + Math.floor(dx * 0.7)) % 16) < 7;
        const groove = Math.abs(x - size / 2) < 4 || Math.abs(x - size * 0.25) < 3 || Math.abs(x - size * 0.75) < 3;
        const val = (chevron && !groove ? 36 : 20) + (rng() - 0.5) * 6;
        const idx = i * 4;
        aImg.data[idx] = val;
        aImg.data[idx + 1] = val + 1;
        aImg.data[idx + 2] = val + 3;
        aImg.data[idx + 3] = 255;

        const rVal = chevron && !groove ? 215 : 235;
        rImg.data[idx] = rVal;
        rImg.data[idx + 1] = rVal;
        rImg.data[idx + 2] = rVal;
        rImg.data[idx + 3] = 255;

        height[i] = chevron && !groove ? 0.55 : -0.35;
      }
    }
    actx.putImageData(aImg, 0, 0);
    rctx.putImageData(rImg, 0, 0);

    return this.trackSet(finalizeSet(albedo, rough, height, size, 1.9, this.maxAnisotropy, 6, 1));
  }

  createBarkSet(baseRgb: [number, number, number] = [84, 62, 46]): PBRTextureSet {
    const size = 128;
    const rng = mulberry32(419);
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;

    const aImg = actx.createImageData(size, size);
    const rImg = rctx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const furrow = Math.sin(x * 0.35 + Math.sin(y * 0.08) * 1.4);
        const grain = (rng() - 0.5) * 18;
        const delta = furrow * 18 + grain;
        const idx = i * 4;
        aImg.data[idx] = Math.min(240, Math.max(20, baseRgb[0] + delta));
        aImg.data[idx + 1] = Math.min(240, Math.max(20, baseRgb[1] + delta * 0.85));
        aImg.data[idx + 2] = Math.min(240, Math.max(20, baseRgb[2] + delta * 0.7));
        aImg.data[idx + 3] = 255;

        const rVal = Math.min(250, Math.max(190, 224 + grain));
        rImg.data[idx] = rVal;
        rImg.data[idx + 1] = rVal;
        rImg.data[idx + 2] = rVal;
        rImg.data[idx + 3] = 255;

        height[i] = furrow * 0.55 + grain * 0.02;
      }
    }
    actx.putImageData(aImg, 0, 0);
    rctx.putImageData(rImg, 0, 0);

    return this.trackSet(finalizeSet(albedo, rough, height, size, 1.8, this.maxAnisotropy, 2, 3));
  }

  createSkinSurfaceSet(seed = 1201): FacialTextureSet {
    const size = 512;
    const rng = mulberry32(seed);
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;

    const aImg = actx.createImageData(size, size);
    const rImg = rctx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const pore = rng();
        const micro = rng();
        const blotch =
          Math.sin(x * 0.018 + Math.sin(y * 0.011) * 2.0) * 0.5 +
          Math.cos(y * 0.016 - x * 0.007) * 0.35 +
          Math.sin((x + y) * 0.006) * 0.25;
        const poreMask = pore > 0.965 ? 1 : 0;
        const wrinkle = Math.sin(y * 0.11 + Math.sin(x * 0.04) * 2.4) * 0.5;
        const oilTZone = v < 0.34 ? -7 : v > 0.78 ? 5 : 0;

        const idx = i * 4;
        const base = 242 + blotch * 7 + (micro - 0.5) * 9 + oilTZone - poreMask * 26;
        aImg.data[idx] = Math.max(205, Math.min(255, base));
        aImg.data[idx + 1] = Math.max(198, Math.min(255, base - 5));
        aImg.data[idx + 2] = Math.max(190, Math.min(255, base - 12));
        aImg.data[idx + 3] = 255;

        const roughVal = Math.max(
          120,
          Math.min(242, 188 + blotch * 18 + (rng() - 0.5) * 34 + poreMask * 18 - oilTZone * 0.6),
        );
        rImg.data[idx] = roughVal;
        rImg.data[idx + 1] = roughVal;
        rImg.data[idx + 2] = roughVal;
        rImg.data[idx + 3] = 255;

        height[i] =
          (poreMask ? -0.85 : pore * 0.18) +
          micro * 0.12 +
          wrinkle * 0.08 +
          blotch * 0.05;
      }
    }
    actx.putImageData(aImg, 0, 0);
    rctx.putImageData(rImg, 0, 0);

    actx.save();
    actx.globalCompositeOperation = 'multiply';
    for (const [cx, cy, r, alpha] of [
      [0.24, 0.42, 0.22, 0.055],
      [0.76, 0.42, 0.22, 0.055],
      [0.5, 0.12, 0.42, 0.045],
    ] as const) {
      const grad = actx.createRadialGradient(
        size * cx,
        size * cy,
        0,
        size * cx,
        size * cy,
        size * r,
      );
      grad.addColorStop(0, `rgba(178, 112, 82, ${alpha})`);
      grad.addColorStop(1, 'rgba(178, 112, 82, 0)');
      actx.fillStyle = grad;
      actx.fillRect(0, 0, size, size);
    }
    actx.restore();

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = size;
    bumpCanvas.height = size;
    const bctx = bumpCanvas.getContext('2d')!;
    const bImg = bctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const v = Math.max(0, Math.min(255, Math.round(128 + height[i] * 72)));
      const idx = i * 4;
      bImg.data[idx] = v;
      bImg.data[idx + 1] = v;
      bImg.data[idx + 2] = v;
      bImg.data[idx + 3] = 255;
    }
    bctx.putImageData(bImg, 0, 0);
    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.anisotropy = this.maxAnisotropy;

    const pbr = finalizeSet(albedo, rough, height, size, 1.25, this.maxAnisotropy, 1, 1);
    return this.trackFacialSet({ ...pbr, bumpMap });
  }

  createTacticalWeaveSet(
    baseRgb: [number, number, number],
    seed: number,
    repeat = 6,
  ): PBRTextureSet {
    const size = 256;
    const rng = mulberry32(seed);
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;

    const aImg = actx.createImageData(size, size);
    const rImg = rctx.createImageData(size, size);
    const height = new Float32Array(size * size);
    const cell = 5;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const cx = Math.floor(x / cell);
        const cy = Math.floor(y / cell);
        const warp = (cx + cy) % 2 === 0;
        const thread = warp ? (y % cell) / cell : (x % cell) / cell;
        const crown = Math.sin(thread * Math.PI);
        const noise = (rng() - 0.5) * 12;
        const shade = warp ? 1.08 : 0.9;
        const idx = i * 4;
        aImg.data[idx] = Math.min(255, Math.max(8, baseRgb[0] * shade * crown + noise));
        aImg.data[idx + 1] = Math.min(255, Math.max(8, baseRgb[1] * shade * crown + noise));
        aImg.data[idx + 2] = Math.min(255, Math.max(8, baseRgb[2] * shade * crown + noise));
        aImg.data[idx + 3] = 255;

        const rVal = Math.min(248, Math.max(120, 205 + noise + crown * 18));
        rImg.data[idx] = rVal;
        rImg.data[idx + 1] = rVal;
        rImg.data[idx + 2] = rVal;
        rImg.data[idx + 3] = 255;

        height[i] = crown * (warp ? 0.45 : -0.35) + noise * 0.008;
      }
    }
    actx.putImageData(aImg, 0, 0);
    rctx.putImageData(rImg, 0, 0);
    return this.trackSet(finalizeSet(albedo, rough, height, size, 1.45, this.maxAnisotropy, repeat, repeat));
  }

  createStubbleHairSet(seed = 1502): PBRTextureSet {
    const size = 256;
    const rng = mulberry32(seed);
    const albedo = document.createElement('canvas');
    albedo.width = size;
    albedo.height = size;
    const actx = albedo.getContext('2d')!;

    const rough = document.createElement('canvas');
    rough.width = size;
    rough.height = size;
    const rctx = rough.getContext('2d')!;

    const aImg = actx.createImageData(size, size);
    const rImg = rctx.createImageData(size, size);
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const strand = Math.sin(y * 0.82 + Math.sin(x * 0.09) * 2.2) > -0.15;
        const density = rng();
        const shade = strand && density > 0.28 ? 1 : 0.55;
        const idx = i * 4;
        aImg.data[idx] = Math.min(255, Math.max(10, 48 * shade + (rng() - 0.5) * 14));
        aImg.data[idx + 1] = Math.min(255, Math.max(8, 39 * shade + (rng() - 0.5) * 12));
        aImg.data[idx + 2] = Math.min(255, Math.max(8, 33 * shade + (rng() - 0.5) * 10));
        aImg.data[idx + 3] = 255;

        const rVal = Math.min(250, Math.max(190, 232 + (rng() - 0.5) * 18));
        rImg.data[idx] = rVal;
        rImg.data[idx + 1] = rVal;
        rImg.data[idx + 2] = rVal;
        rImg.data[idx + 3] = 255;

        height[i] = strand ? 0.45 + density * 0.2 : -0.25;
      }
    }
    actx.putImageData(aImg, 0, 0);
    rctx.putImageData(rImg, 0, 0);
    return this.trackSet(finalizeSet(albedo, rough, height, size, 1.9, this.maxAnisotropy, 4, 4));
  }

  dispose(): void {
    for (const tex of this.disposables) {
      tex.dispose();
    }
    this.disposables = [];
  }
}
