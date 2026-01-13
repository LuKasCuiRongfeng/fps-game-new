import * as THREE from 'three';

import { MapConfig } from '../core/GameConfig';

/**
 * CPU terrain height function used for gameplay queries and procedural generation.
 * Keep in sync with the GPU node version in `TerrainTSL.ts`.
 */
export function terrainHeightCpu(x: number, z: number): number {
    // Match the shader constants below.
    const scale1 = 0.015;
    const scale2 = 0.04;

    const distFromCenter = Math.sqrt(x * x + z * z);
    const centerFlatten = Math.max(0.2, Math.min(1, (distFromCenter - 10) / 40));

    const noise1 = Math.sin(x * scale1 * 1.1 + 0.5) * Math.cos(z * scale1 * 0.9 + 0.3);
    const noise2 =
        Math.sin(x * scale2 * 1.3 + 1.2) * Math.cos(z * scale2 * 1.1 + 0.7) * 0.5;

    let height = (noise1 + noise2) * MapConfig.terrainHeight * centerFlatten;

    // Island mask: sink terrain outside coastline.
    const islandRadius = MapConfig.boundaryRadius;
    const coastStart = islandRadius - 100;
    const coastEnd = islandRadius + 50;

    if (distFromCenter > coastStart) {
        let t = (distFromCenter - coastStart) / (coastEnd - coastStart);
        t = Math.max(0, Math.min(1, t));
        const falloff = t * t * (3 - 2 * t);
        const seaFloorDepth = MapConfig.waterLevel - 15.0;
        height = THREE.MathUtils.lerp(height, seaFloorDepth, falloff);
    }

    return height;
}
