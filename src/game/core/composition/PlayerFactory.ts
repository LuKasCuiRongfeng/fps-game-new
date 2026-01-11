import type * as THREE from 'three';

import { PlayerController } from '../../player/PlayerController';
import type { GPUParticleSystem } from '../../shaders/GPUParticles';
import type { PhysicsSystem } from '../PhysicsSystem';
import type { Level } from '../../level/Level';
import type { Enemy } from '../../enemy/Enemy';
import type { GrenadeSystem } from '../../systems/GrenadeSystem';
import type { PickupSystem } from '../../systems/PickupSystem';
import type { WeatherSystem } from '../../level/WeatherSystem';

export function createPlayerController(opts: {
    camera: THREE.PerspectiveCamera;
    container: HTMLElement;
    scene: THREE.Scene;
    objects: THREE.Object3D[];
    physicsSystem: PhysicsSystem;

    level: Level;
    particleSystem: GPUParticleSystem;
    enemies: Enemy[];

    pickups: PickupSystem;
    grenades: GrenadeSystem;
    weather: WeatherSystem;

    spawn?: { x: number; z: number };
}): PlayerController {
    const player = new PlayerController(
        opts.camera,
        opts.container,
        opts.scene,
        opts.objects,
        opts.physicsSystem
    );

    player.setGroundHeightCallback((x, z) => opts.level.getTerrainHeight(x, z));
    player.setWeaponGroundHeightCallback((x, z) => opts.level.getTerrainHeight(x, z));

    player.setParticleSystem(opts.particleSystem);
    player.setEnemies(opts.enemies);

    player.setPickupCallback(() => {
        opts.pickups.tryCollectOne();
    });

    player.setGrenadeThrowCallback((position, direction) => {
        opts.grenades.throwGrenade(position, direction);
    });

    player.setWeatherCycleCallback(() => {
        opts.weather.cycleWeather();
    });

    const spawnX = opts.spawn?.x ?? 0;
    const spawnZ = opts.spawn?.z ?? 0;
    const spawnHeight = opts.level.getTerrainHeight(spawnX, spawnZ);
    opts.camera.position.set(spawnX, spawnHeight + 2.0, spawnZ);

    player.resetPhysics();

    return player;
}
