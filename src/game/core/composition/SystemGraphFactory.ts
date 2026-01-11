import type * as THREE from 'three';

import type { SystemManager } from '../engine/SystemManager';

import { PlayerUpdateSystem } from '../../systems/PlayerUpdateSystem';
import { UniformUpdateSystem } from '../../systems/UniformUpdateSystem';
import { GPUComputeUpdateSystem } from '../../systems/GPUComputeUpdateSystem';
import { ParticleUpdateSystem } from '../../systems/ParticleUpdateSystem';
import { LevelUpdateSystem } from '../../systems/LevelUpdateSystem';

import type { PlayerController } from '../../player/PlayerController';
import type { UniformManager } from '../../shaders/TSLMaterials';
import type { GPUComputeSystem } from '../../shaders/GPUCompute';
import type { GPUParticleSystem } from '../../shaders/GPUParticles';
import type { WeatherSystem } from '../../level/WeatherSystem';
import type { Level } from '../../level/Level';

import type { EnemyTrailSystem } from '../../systems/EnemyTrailSystem';
import type { EnemySystem } from '../../systems/EnemySystem';
import type { PickupSystem } from '../../systems/PickupSystem';
import type { GrenadeSystem } from '../../systems/GrenadeSystem';
import type { SpawnSystem } from '../../systems/SpawnSystem';
import type { AudioSystem } from '../../systems/AudioSystem';
import type { ShadowSystem } from '../../systems/ShadowSystem';
import type { RenderSystem } from '../../systems/RenderSystem';

type NumberUniform = { value: number };

export type CoreUpdateSystems = {
    playerUpdateSystem: PlayerUpdateSystem;
    uniformUpdateSystem: UniformUpdateSystem;
    gpuComputeUpdateSystem: GPUComputeUpdateSystem;
    particleUpdateSystem: ParticleUpdateSystem;
    levelUpdateSystem: LevelUpdateSystem;
};

export function createAndRegisterSystemGraph(opts: {
    systemManager: SystemManager;

    // Core update system deps
    player: PlayerController;
    camera: THREE.PerspectiveCamera;
    scopeAimProgress: NumberUniform;

    uniforms: UniformManager;
    gpuCompute: GPUComputeSystem;
    particleSystem: GPUParticleSystem;
    level: Level;

    // Config deps
    enemyConfig: unknown;

    // Domain systems already constructed elsewhere
    weatherSystem: WeatherSystem;
    enemySystem: EnemySystem;
    enemyTrailSystem: EnemyTrailSystem;
    grenadeSystem: GrenadeSystem;
    pickupSystem: PickupSystem;
    spawnSystem: SpawnSystem;
    audioSystem: AudioSystem;

    // Render systems
    shadowSystem: ShadowSystem;
    renderSystem: RenderSystem;
}): CoreUpdateSystems {
    const playerUpdateSystem = new PlayerUpdateSystem({
        player: opts.player,
        camera: opts.camera,
        scopeAimProgress: opts.scopeAimProgress,
    });

    const uniformUpdateSystem = new UniformUpdateSystem({
        uniforms: opts.uniforms,
        cameraPosition: opts.camera.position,
    });

    const gpuComputeUpdateSystem = new GPUComputeUpdateSystem({
        gpu: opts.gpuCompute,
        cameraPosition: opts.camera.position,
        enemyConfig: opts.enemyConfig as any,
    });

    const particleUpdateSystem = new ParticleUpdateSystem(opts.particleSystem);

    const levelUpdateSystem = new LevelUpdateSystem({
        level: opts.level,
        cameraPosition: opts.camera.position,
    });

    // Keep the exact update order (some systems depend on previous writes).
    opts.systemManager
        .add(playerUpdateSystem)
        .add(uniformUpdateSystem)
        .add(gpuComputeUpdateSystem)
        .add(particleUpdateSystem)
        .add(opts.weatherSystem)
        .add(levelUpdateSystem)
        .add(opts.enemySystem)
        .add(opts.enemyTrailSystem)
        .add(opts.grenadeSystem)
        .add(opts.pickupSystem)
        .add(opts.spawnSystem)
        .add(opts.audioSystem)
        .add(opts.shadowSystem)
        .add(opts.renderSystem);

    return {
        playerUpdateSystem,
        uniformUpdateSystem,
        gpuComputeUpdateSystem,
        particleUpdateSystem,
        levelUpdateSystem,
    };
}
