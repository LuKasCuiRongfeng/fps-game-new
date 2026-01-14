import * as THREE from 'three';
import type { FrameContext, System } from '../core/engine/System';
import { MapConfig } from '../core/GameConfig';

export class ShadowSystem implements System {
    public readonly name = 'shadows';

    private readonly sunLight: THREE.DirectionalLight;

    private shadowUpdateAccumulator = 0;
    private lastShadowSnapX = Number.NaN;
    private lastShadowSnapZ = Number.NaN;
    private debugDidUpdateThisFrame = 0;
    private debugSnapChangedThisFrame = 0;

    public getHitchDebugCounters?(): Record<string, number> {
        return {
            updated: this.debugDidUpdateThisFrame,
            snapChanged: this.debugSnapChangedThisFrame,
        };
    }

    constructor(sunLight: THREE.DirectionalLight) {
        this.sunLight = sunLight;
    }

    update(frame: FrameContext): void {
        const sunLight = this.sunLight;
        if (!sunLight) return;

        // Snap directional light to shadow texel grid to reduce swimming.
        const shadowSize = 80 * 2; // right - left
        const mapSize = 1024;
        const texelSize = shadowSize / mapSize;

        // IMPORTANT: snapping to *every* texel causes constant shadow updates while walking.
        // Snap to a multi-texel grid to keep shadows stable and avoid frequent expensive shadow renders.
        const baseSnapTexels = Math.max(1, Math.floor(MapConfig.shadowSnapTexels ?? 8));
        const baseInterval = Math.max(0.05, MapConfig.shadowUpdateIntervalSeconds ?? 0.2);

        const snapTexels = baseSnapTexels;
        const snapSize = texelSize * snapTexels;
        const interval = baseInterval;

        const playerX = frame.playerPos.x;
        const playerZ = frame.playerPos.z;

        const x = Math.floor(playerX / snapSize) * snapSize;
        const z = Math.floor(playerZ / snapSize) * snapSize;

        this.debugDidUpdateThisFrame = 0;
        this.debugSnapChangedThisFrame = 0;
        this.shadowUpdateAccumulator += frame.delta;
        const snapChanged = x !== this.lastShadowSnapX || z !== this.lastShadowSnapZ;
        if (snapChanged) this.debugSnapChangedThisFrame = 1;

        // Shadow updates are GPU-expensive (extra render pass + PCF filtering).
        // In large worlds we follow the player, but we must rate-limit updates so running doesn't
        // trigger a shadow re-render every frame.
        const shouldUpdateShadow = snapChanged && this.shadowUpdateAccumulator >= interval;

        if (!shouldUpdateShadow) return;

        this.lastShadowSnapX = x;
        this.lastShadowSnapZ = z;
        this.shadowUpdateAccumulator = 0;

        // Keep relative offset (15, 30, 15)
        sunLight.position.set(x + 15, 30, z + 15);
        sunLight.target.position.set(x, 0, z);
        sunLight.target.updateMatrixWorld();

        sunLight.shadow.needsUpdate = true;
        this.debugDidUpdateThisFrame = 1;
    }
}
