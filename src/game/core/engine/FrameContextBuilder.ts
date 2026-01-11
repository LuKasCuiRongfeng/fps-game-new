import type * as THREE from 'three';
import type { FrameContext } from './System';

export function fillFrameContext(opts: {
    frame: FrameContext;
    delta: number;
    cameraPosition: THREE.Vector3;
    health: number;
}): void {
    opts.frame.delta = opts.delta;
    opts.frame.health = opts.health;

    // Default to camera.position; PlayerUpdateSystem will refresh aim/playerPos.
    opts.frame.playerPos = opts.cameraPosition;
}
