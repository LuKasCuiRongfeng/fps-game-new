import type * as THREE from 'three';
import type { FrameContext, System } from '../core/engine/System';
import type { Level } from '../level/Level';

export class LevelUpdateSystem implements System {
    public readonly name = 'level';

    private readonly level: Level;
    private readonly cameraPosition: THREE.Vector3;

    constructor(opts: { level: Level; cameraPosition: THREE.Vector3 }) {
        this.level = opts.level;
        this.cameraPosition = opts.cameraPosition;
    }

    update(frame: FrameContext): void {
        this.level.update(frame.delta, this.cameraPosition);
    }
}
