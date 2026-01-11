import type * as THREE from 'three';

import type { System } from '../engine/System';
import type { SystemManager } from '../engine/SystemManager';

import { PlayerUpdateSystem } from '../../systems/PlayerUpdateSystem';
import { UniformUpdateSystem } from '../../systems/UniformUpdateSystem';
import { GPUComputeUpdateSystem } from '../../systems/GPUComputeUpdateSystem';
import { ParticleUpdateSystem } from '../../systems/ParticleUpdateSystem';
import { LevelUpdateSystem } from '../../systems/LevelUpdateSystem';

import type { PlayerController } from '../../player/PlayerController';
import type { UniformManager } from '../../shaders/TSLMaterials';
import type { GpuSimulationFacade } from '../gpu/GpuSimulationFacade';
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

export type SystemGraphPhases = {
    preSim: System[];
    sim: System[];
    postSim: System[];
    render: System[];
};

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
    simulation: GpuSimulationFacade;
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

    /**
     * Optional extension hook to inject additional systems into well-defined phases.
     * This preserves the default order while keeping feature additions low-coupled.
     */
    extendPhases?: (phases: SystemGraphPhases) => void;
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
        enemies: opts.simulation.enemies,
        cameraPosition: opts.camera.position,
        enemyConfig: opts.enemyConfig as any,
    });

    const particleUpdateSystem = new ParticleUpdateSystem(opts.simulation.particles);

    const levelUpdateSystem = new LevelUpdateSystem({
        level: opts.level,
        cameraPosition: opts.camera.position,
    });

    // Declarative phases (keeps the exact default order but makes extensions explicit).
    const phases: SystemGraphPhases = {
        // input/player state -> uniforms
        preSim: [playerUpdateSystem, uniformUpdateSystem],
        // compute + particle sim + world env updates
        sim: [gpuComputeUpdateSystem, particleUpdateSystem, opts.weatherSystem, levelUpdateSystem],
        // gameplay/domain
        postSim: [
            opts.enemySystem,
            opts.enemyTrailSystem,
            opts.grenadeSystem,
            opts.pickupSystem,
            opts.spawnSystem,
            opts.audioSystem,
        ],
        // rendering last
        render: [opts.shadowSystem, opts.renderSystem],
    };

    opts.extendPhases?.(phases);

    // Register in order
    const ordered: System[] = [...phases.preSim, ...phases.sim, ...phases.postSim, ...phases.render];
    for (const system of ordered) {
        opts.systemManager.add(system);
    }

    return {
        playerUpdateSystem,
        uniformUpdateSystem,
        gpuComputeUpdateSystem,
        particleUpdateSystem,
        levelUpdateSystem,
    };
}
