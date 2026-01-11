import type * as THREE from 'three';

import type { GPUComputeSystem } from '../../shaders/GPUCompute';
import type { GPUParticleSystem, EmitterConfig } from '../../shaders/GPUParticles';

export interface EnemyComputeSimulation {
    updateEnemies(delta: number, playerPos: THREE.Vector3): void;
    setEnemyData(index: number, position: THREE.Vector3, target: THREE.Vector3, speed: number, health: number): void;
    setEnemyTarget(index: number, target: THREE.Vector3): void;
    setEnemyActive(index: number, active: boolean): void;
}

export interface ParticleSimulation {
    update(delta: number): void;
    emit(config: EmitterConfig): void;
    emitBlood(position: THREE.Vector3, direction: THREE.Vector3, count: number): void;
    emitSparks(position: THREE.Vector3, normal: THREE.Vector3, count: number): void;
    emitMuzzleFlash(position: THREE.Vector3, direction: THREE.Vector3): void;
}

export type GpuSimulationFacade = {
    enemies: EnemyComputeSimulation;
    particles: ParticleSimulation;
};

export function createWebGpuSimulationFacade(opts: {
    gpuCompute: GPUComputeSystem;
    particleSystem: GPUParticleSystem;
}): GpuSimulationFacade {
    return {
        enemies: opts.gpuCompute,
        particles: opts.particleSystem,
    };
}
