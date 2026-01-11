import type * as THREE from 'three';
import type { FrameContext, System } from '../core/engine/System';
import type { EnemyComputeSimulation } from '../core/gpu/GpuSimulationFacade';
import { EnemyConfig } from '../core/GameConfig';

export class GPUComputeUpdateSystem implements System {
    public readonly name = 'gpuCompute';

    private readonly enemies: EnemyComputeSimulation;
    private readonly cameraPosition: THREE.Vector3;
    private readonly enemyConfig: typeof EnemyConfig;

    constructor(opts: {
        enemies: EnemyComputeSimulation;
        cameraPosition: THREE.Vector3;
        enemyConfig: typeof EnemyConfig;
    }) {
        this.enemies = opts.enemies;
        this.cameraPosition = opts.cameraPosition;
        this.enemyConfig = opts.enemyConfig;
    }

    update(frame: FrameContext): void {
        if (!this.enemyConfig.gpuCompute.enabled) return;
        this.enemies.updateEnemies(frame.delta, this.cameraPosition);
    }
}
