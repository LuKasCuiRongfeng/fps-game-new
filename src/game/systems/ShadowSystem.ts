import * as THREE from 'three';
import type { FrameContext, System } from '../core/engine/System';

export class ShadowSystem implements System {
    public readonly name = 'shadows';

    private readonly sunLight: THREE.DirectionalLight;

    private shadowUpdateAccumulator = 0;
    private lastShadowSnapX = Number.NaN;
    private lastShadowSnapZ = Number.NaN;

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

        const playerX = frame.playerPos.x;
        const playerZ = frame.playerPos.z;

        const x = Math.floor(playerX / texelSize) * texelSize;
        const z = Math.floor(playerZ / texelSize) * texelSize;

        this.shadowUpdateAccumulator += frame.delta;
        const snapChanged = x !== this.lastShadowSnapX || z !== this.lastShadowSnapZ;
        const shouldUpdateShadow = snapChanged || this.shadowUpdateAccumulator >= 0.1;

        if (!shouldUpdateShadow) return;

        this.lastShadowSnapX = x;
        this.lastShadowSnapZ = z;
        this.shadowUpdateAccumulator = 0;

        // Keep relative offset (15, 30, 15)
        sunLight.position.set(x + 15, 30, z + 15);
        sunLight.target.position.set(x, 0, z);
        sunLight.target.updateMatrixWorld();

        sunLight.shadow.needsUpdate = true;
    }
}
