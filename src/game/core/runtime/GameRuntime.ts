import type * as THREE from "three";
import type { WebGPURenderer, PostProcessing } from "three/webgpu";

import type { PlayerController } from "../../player/PlayerController";
import type { ExplosionManager } from "../../entities/ExplosionEffect";
import type { SoundManager } from "../SoundManager";
import type { Level } from "../../level/Level";
import type { Pathfinding } from "../Pathfinding";
import type { PhysicsSystem } from "../PhysicsSystem";
import type { UniformManager } from "../../shaders/TSLMaterials";
import type { GPUComputeSystem } from "../../shaders/GPUCompute";
import type { GPUParticleSystem } from "../../shaders/GPUParticles";
import type { GpuSimulationFacade } from "../gpu/GpuSimulationFacade";
import type { WeatherSystem } from "../../level/WeatherSystem";
import type { FrameContext } from "../engine/System";
import type { SystemManager } from "../engine/SystemManager";
import type { HitchProfiler } from "../perf/HitchProfiler";
import type { FpsCounter } from "../perf/FpsCounter";
import type { LoadedGate } from "../init/LoadedGate";
import type { NumberUniform } from "../render/PostFXPipeline";

import type { GameServices } from "../services/GameServices";
import type { GameEventBus } from "../events/GameEventBus";

import type { EnemyTrailSystem } from "../../systems/EnemyTrailSystem";
import type { EnemySystem } from "../../systems/EnemySystem";
import type { PickupSystem } from "../../systems/PickupSystem";
import type { GrenadeSystem } from "../../systems/GrenadeSystem";
import type { SpawnSystem } from "../../systems/SpawnSystem";
import type { AudioSystem } from "../../systems/AudioSystem";
import type { ShadowSystem } from "../../systems/ShadowSystem";
import type { RenderSystem } from "../../systems/RenderSystem";

export interface GameRuntime {
    container: HTMLElement;

    renderer: WebGPURenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    objects: THREE.Object3D[];

    uniforms: UniformManager;

    services: GameServices;
    events: GameEventBus;

    clock: THREE.Clock;
    fpsCounter: FpsCounter;
    hitchProfiler: HitchProfiler;

    systemManager: SystemManager;
    frameContext: FrameContext;
    systemTimings: Record<string, number>;

    loadedGate: LoadedGate;

    world: {
        physicsSystem: PhysicsSystem;
        level: Level;
        pathfinding: Pathfinding;
    };

    gpu: {
        gpuCompute: GPUComputeSystem;
        particleSystem: GPUParticleSystem;
        simulation: GpuSimulationFacade;
    };

    render: {
        postProcessing: PostProcessing;
        scopeAimProgress: NumberUniform;
        shadowSystem: ShadowSystem;
        renderSystem: RenderSystem;
        ambientLight: THREE.AmbientLight;
        sunLight: THREE.DirectionalLight;
    };

    gameplay: {
        explosionManager: ExplosionManager;
        weatherSystem: WeatherSystem;
        soundManager: SoundManager | null;

        enemyTrailSystem: EnemyTrailSystem;
        enemySystem: EnemySystem;
        pickupSystem: PickupSystem;
        grenadeSystem: GrenadeSystem;
        spawnSystem: SpawnSystem;
        audioSystem: AudioSystem;
    };

    player: {
        controller: PlayerController;
    };

    disposeDefaultEventHandlers: (() => void) | null;
}
