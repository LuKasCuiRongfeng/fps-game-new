import type { Node } from 'three/webgpu';
import {
    cos,
    float,
    length,
    max,
    min,
    sin,
    step,
    vec2,
    mix,
} from 'three/tsl';

import { MapConfig } from '../core/GameConfig';
import { terrainHeightCpu } from './TerrainHeight';

/**
 * Shared terrain height function used by both CPU gameplay queries and GPU rendering.
 * Keep this file as the single source of truth so terrain visuals and physics stay aligned.
 */

export { terrainHeightCpu };

/**
 * TSL version of terrainHeightCpu.
 * @param worldXZ world-space XZ position (meters)
 */
export function terrainHeightNode(worldXZ: Node): Node {
    const x = worldXZ.x;
    const z = worldXZ.y;

    const scale1 = float(0.015);
    const scale2 = float(0.04);

    const distFromCenter = length(vec2(x, z));

    // centerFlatten = clamp((dist-10)/40, 0.2..1)
    const centerFlatten = max(float(0.2), min(float(1.0), distFromCenter.sub(10.0).div(40.0)));

    const noise1 = sin(x.mul(scale1).mul(1.1).add(0.5)).mul(cos(z.mul(scale1).mul(0.9).add(0.3)));
    const noise2 = sin(x.mul(scale2).mul(1.3).add(1.2))
        .mul(cos(z.mul(scale2).mul(1.1).add(0.7)))
        .mul(0.5);

    const baseHeight = noise1.add(noise2).mul(float(MapConfig.terrainHeight)).mul(centerFlatten);

    const islandRadius = float(MapConfig.boundaryRadius);
    const coastStart = islandRadius.sub(100.0);
    const coastEnd = islandRadius.add(50.0);
    const coastRange = coastEnd.sub(coastStart).max(1e-6);

    const t = distFromCenter.sub(coastStart).div(coastRange).clamp(0.0, 1.0);
    const falloff = t.mul(t).mul(float(3.0).sub(t.mul(2.0)));

    // Only apply the falloff outside the coastline start.
    const mask = step(coastStart, distFromCenter);
    const w = falloff.mul(mask);

    const seaFloorDepth = float(MapConfig.waterLevel - 15.0);
    return mix(baseHeight, seaFloorDepth, w);
}
