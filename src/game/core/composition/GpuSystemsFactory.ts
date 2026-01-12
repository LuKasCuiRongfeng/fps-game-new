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
        opts.gpuCompute.maxEnemies,
        opts.particles.maxParticles
    );

    const particleSystem = new GPUParticleSystem(
        opts.renderer,
        opts.scene,
        opts.particles.maxParticles
    );

    // Quick sanity log to confirm capacities match config (helps catch arg-order bugs).
    try {
        console.info('[gpu]', {
            gpuCompute: gpuCompute.getDebugInfo(),
            particles: { maxParticles: opts.particles.maxParticles },
        });
    } catch {
        // ignore
    }

    return { gpuCompute, particleSystem };
}
