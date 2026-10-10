import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Form } from '../lib/categories';

/**
 * 3D forms for the category grammar. All share one scale (~0.35 units), one material and
 * the same silhouettes as the 2D glyphs, so a category reads the same everywhere.
 * Built once per scene and disposed with it.
 */
function at(g: THREE.BufferGeometry, x: number, y: number, z = 0) {
  return g.translate(x, y, z);
}

function merged(parts: THREE.BufferGeometry[]) {
  // mergeGeometries needs identical attribute sets; drop uvs (unused by our material).
  parts.forEach((p) => p.deleteAttribute('uv'));
  const m = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  return m;
}

export function buildFormGeometries(): Record<Form, THREE.BufferGeometry> {
  const g: Record<Form, THREE.BufferGeometry> = {
    module: new THREE.BoxGeometry(0.3, 0.3, 0.3),
    layers: merged([at(new THREE.BoxGeometry(0.4, 0.06, 0.4), 0, -0.12), at(new THREE.BoxGeometry(0.4, 0.06, 0.4), 0, 0), at(new THREE.BoxGeometry(0.4, 0.06, 0.4), 0, 0.12)]),
    cluster: merged([at(new THREE.BoxGeometry(0.17, 0.17, 0.17), -0.1, -0.09), at(new THREE.BoxGeometry(0.17, 0.17, 0.17), 0.1, -0.09), at(new THREE.BoxGeometry(0.17, 0.17, 0.17), 0, 0.1)]),
    ring: new THREE.TorusGeometry(0.17, 0.04, 10, 36),
    signal: merged([at(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 10), 0, -0.04), at(new THREE.SphereGeometry(0.075, 14, 10), 0, 0.22)]),
    vector: new THREE.ConeGeometry(0.17, 0.38, 3).rotateZ(-Math.PI / 2),
    constellation: merged([at(new THREE.SphereGeometry(0.065, 12, 8), -0.14, -0.08), at(new THREE.SphereGeometry(0.065, 12, 8), 0, 0.14), at(new THREE.SphereGeometry(0.065, 12, 8), 0.14, -0.06)]),
    assembly: new THREE.OctahedronGeometry(0.24, 0),
    point: new THREE.IcosahedronGeometry(0.14, 1),
  };
  for (const geo of Object.values(g)) geo.computeBoundingSphere();
  return g;
}
