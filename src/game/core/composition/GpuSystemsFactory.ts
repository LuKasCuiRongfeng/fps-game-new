// @ts-ignore - WebGPU types not fully available
import type { WebGPURenderer } from 'three/webgpu';
import type * as THREE from 'three';

import { GPUComputeSystem } from '../../shaders/GPUCompute';
import { GPUParticleSystem } from '../../shaders/GPUParticles';

export function createGpuSystems(opts: {
    renderer: WebGPURenderer;
    scene: THREE.Scene;
    gpuCompute: { gridSize: number; maxEnemies: number };
    particles: { maxParticles: number };
}): {
    gpuCompute: GPUComputeSystem;
    particleSystem: GPUParticleSystem;
} {
    const gpuCompute = new GPUComputeSystem(
        opts.renderer,
        opts.gpuCompute.gridSize,
        opts.gpuCompute.maxEnemies
    );

    const particleSystem = new GPUParticleSystem(
        opts.renderer,
        opts.scene,
        opts.particles.maxParticles
    );

    return { gpuCompute, particleSystem };
}
