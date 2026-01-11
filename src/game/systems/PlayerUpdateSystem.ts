import type * as THREE from 'three';
import type { FrameContext, System } from '../core/engine/System';
import type { PlayerController } from '../player/PlayerController';

type NumberUniform = { value: number };

export class PlayerUpdateSystem implements System {
    public readonly name = 'player';

    private readonly player: PlayerController;
    private readonly camera: THREE.PerspectiveCamera;
    private readonly scopeAimProgress: NumberUniform;

    constructor(opts: {
        player: PlayerController;
        camera: THREE.PerspectiveCamera;
        scopeAimProgress: NumberUniform;
    }) {
        this.player = opts.player;
        this.camera = opts.camera;
        this.scopeAimProgress = opts.scopeAimProgress;
    }

    update(frame: FrameContext): void {
        this.player.update(frame.delta);

        const aimProgress = this.player.getAimProgress();
        this.scopeAimProgress.value = aimProgress;

        // Keep references stable: systems can read camera.position directly.
        frame.playerPos = this.camera.position;
        frame.aimProgress = aimProgress;
    }
}
