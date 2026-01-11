import type * as THREE from 'three';
// @ts-ignore - WebGPU types not fully available
import type { WebGPURenderer } from 'three/webgpu';

import { ExplosionManager } from '../../entities/ExplosionEffect';
import { SoundManager } from '../SoundManager';
import type { UniformManager } from '../../shaders/TSLMaterials';
import type { GPUComputeSystem } from '../../shaders/GPUCompute';
import type { GPUParticleSystem } from '../../shaders/GPUParticles';
import type { PhysicsSystem } from '../PhysicsSystem';
import type { Pathfinding } from '../Pathfinding';
import type { Level } from '../../level/Level';
import { WeatherSystem } from '../../level/WeatherSystem';

import { EnemyTrailSystem } from '../../systems/EnemyTrailSystem';
import { EnemySystem } from '../../systems/EnemySystem';
import { PickupSystem } from '../../systems/PickupSystem';
import { GrenadeSystem } from '../../systems/GrenadeSystem';
import { SpawnSystem } from '../../systems/SpawnSystem';
import { AudioSystem } from '../../systems/AudioSystem';

export type GameplayComposition = {
    explosionManager: ExplosionManager;
    weatherSystem: WeatherSystem;
    soundManager: SoundManager;

    enemyTrailSystem: EnemyTrailSystem;
    enemySystem: EnemySystem;
    pickupSystem: PickupSystem;
    grenadeSystem: GrenadeSystem;
    spawnSystem: SpawnSystem;
    audioSystem: AudioSystem;
};

export function createGameplayComposition(opts: {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: WebGPURenderer;
    objects: THREE.Object3D[];

    level: Level;
    physicsSystem: PhysicsSystem;
    pathfinding: Pathfinding;
    gpuCompute: GPUComputeSystem;
    particleSystem: GPUParticleSystem;
    uniforms: UniformManager;

    ambientLight: THREE.AmbientLight;
    sunLight: THREE.DirectionalLight;

    maxGpuEnemies: number;
}): GameplayComposition {
    const explosionManager = new ExplosionManager(opts.scene);

    const weatherSystem = new WeatherSystem(opts.scene, opts.camera, opts.renderer);
    weatherSystem.setLights(opts.ambientLight, opts.sunLight);
    weatherSystem.setWeather('sunny', true);

    const soundManager = SoundManager.getInstance();

    const enemyTrailSystem = new EnemyTrailSystem(opts.scene);
    const enemySystem = new EnemySystem({
        scene: opts.scene,
        camera: opts.camera,
        objects: opts.objects,
        level: opts.level,
        physicsSystem: opts.physicsSystem,
        pathfinding: opts.pathfinding,
        gpuCompute: opts.gpuCompute,
        particleSystem: opts.particleSystem,
        trails: enemyTrailSystem,
        setDamageFlashIntensity: (v) => {
            opts.uniforms.damageFlash.value = v;
        },
        maxGpuEnemies: opts.maxGpuEnemies,
    });

    const pickupSystem = new PickupSystem(opts.scene, opts.level);

    const grenadeSystem = new GrenadeSystem({
        scene: opts.scene,
        objects: opts.objects,
        cameraPos: opts.camera.position,
        particleSystem: opts.particleSystem,
        explosionManager,
        enemies: enemySystem.all,
        physicsSystem: opts.physicsSystem,
        level: opts.level,
    });

    const spawnSystem = new SpawnSystem(enemySystem, pickupSystem);

    const audioSystem = new AudioSystem({
        sound: soundManager,
        weather: weatherSystem,
        level: opts.level,
        enemies: enemySystem.all,
    });

    return {
        explosionManager,
        weatherSystem,
        soundManager,
        enemyTrailSystem,
        enemySystem,
        pickupSystem,
        grenadeSystem,
        spawnSystem,
        audioSystem,
    };
}
