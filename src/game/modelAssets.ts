import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const templateCache = new Map<string, Promise<THREE.Object3D | null>>();

// Optional external GLB/GLTF upgrades are opt-in: set VITE_EXTERNAL_MODELS=true
// and drop the files into public/models/ to enable them. When disabled the path
// list is empty so no asset URLs are emitted (keeps portal asset checks clean).
const EXTERNAL_MODELS_ENABLED = import.meta.env.VITE_EXTERNAL_MODELS === 'true';

export function modelPaths(...names: string[]): string[] {
  return EXTERNAL_MODELS_ENABLED ? names.map((n) => `/models/${n}`) : [];
}

function isProbablyGlbResponse(response: Response): boolean {
  if (!response.ok) return false;
  const contentType = response.headers.get('content-type') || '';
  return !contentType.includes('text/html');
}

async function loadTemplate(url: string): Promise<THREE.Object3D | null> {
  try {
    const probe = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!isProbablyGlbResponse(probe)) return null;
  } catch {
    // Some static hosts reject HEAD; let GLTFLoader attempt the real request.
  }

  try {
    const gltf = await loader.loadAsync(url);
    return gltf.scene;
  } catch {
    return null;
  }
}

/**
 * Loads an optional local GLB/GLTF template. Missing files, HTML fallbacks,
 * parse failures, and CORS/network failures all resolve to null so callers can
 * keep their procedural fallback without surfacing errors.
 */
export function loadOptionalModel(paths: readonly string[]): Promise<THREE.Object3D | null> {
  const key = paths.join('|');
  let cached = templateCache.get(key);
  if (!cached) {
    cached = (async () => {
      for (const path of paths) {
        const model = await loadTemplate(path);
        if (model) return model;
      }
      return null;
    })();
    templateCache.set(key, cached);
  }
  return cached;
}

export function findNamedDescendant(
  root: THREE.Object3D,
  pattern: RegExp,
): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((child) => {
    if (!found && child.name && pattern.test(child.name)) {
      found = child;
    }
  });
  return found;
}

export function normalizeModelHeight(
  source: THREE.Object3D,
  targetHeight: number,
  targetCenterY: number,
): THREE.Group | null {
  const box = new THREE.Box3().setFromObject(source);
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  if (size.y <= 0.0001) return null;

  const wrapper = new THREE.Group();
  wrapper.add(source);
  const scale = targetHeight / size.y;
  wrapper.scale.setScalar(scale);
  wrapper.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(wrapper);
  const center = scaledBox.getCenter(new THREE.Vector3());
  wrapper.position.set(-center.x, targetCenterY - center.y, -center.z);
  return wrapper;
}

export function normalizeVehicleModel(
  source: THREE.Object3D,
  targetLength: number,
): THREE.Group | null {
  const box = new THREE.Box3().setFromObject(source);
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  const horizontalLength = Math.max(size.x, size.z);
  if (horizontalLength <= 0.0001) return null;

  const wrapper = new THREE.Group();
  wrapper.add(source);
  const scale = targetLength / horizontalLength;
  wrapper.scale.setScalar(scale);
  wrapper.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(wrapper);
  const center = scaledBox.getCenter(new THREE.Vector3());
  const min = scaledBox.min;
  wrapper.position.set(-center.x, -min.y, -center.z);
  return wrapper;
}
