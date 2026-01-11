import type * as THREE from 'three';
import type { FrameContext, System } from '../core/engine/System';
import type { GPUComputeSystem } from '../shaders/GPUCompute';
import { EnemyConfig } from '../core/GameConfig';

export class GPUComputeUpdateSystem implements System {
    public readonly name = 'gpuCompute';

    private readonly gpu: GPUComputeSystem;
    private readonly cameraPosition: THREE.Vector3;
    private readonly enemyConfig: typeof EnemyConfig;

    constructor(opts: {
        gpu: GPUComputeSystem;
        cameraPosition: THREE.Vector3;
        enemyConfig: typeof EnemyConfig;
    }) {
        this.gpu = opts.gpu;
        this.cameraPosition = opts.cameraPosition;
        this.enemyConfig = opts.enemyConfig;
    }

    update(frame: FrameContext): void {
        if (!this.enemyConfig.gpuCompute.enabled) return;
        this.gpu.updateEnemies(frame.delta, this.cameraPosition);
    }
}
