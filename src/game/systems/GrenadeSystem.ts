import * as THREE from 'three';
import type { System, FrameContext } from '../core/engine/System';
import { Grenade } from '../entities/GrenadeTSL';
import { WeaponConfig } from '../core/GameConfig';
import type { GameEventBus } from '../core/events/GameEventBus';
import type { ExplosionManager } from '../entities/ExplosionEffect';
import type { GPUParticleSystem } from '../shaders/GPUParticles';
import type { PhysicsSystem } from '../core/PhysicsSystem';
import type { Level } from '../level/Level';
import type { Enemy } from '../enemy/Enemy';

export class GrenadeSystem implements System {
    public readonly name = 'grenades';

    private readonly scene: THREE.Scene;
    private readonly objects: THREE.Object3D[];
    private readonly cameraPos: THREE.Vector3;
    private readonly particleSystem: GPUParticleSystem;
    private readonly explosionManager: ExplosionManager;
    private readonly enemies: Enemy[];
    private readonly physicsSystem: PhysicsSystem;
    private readonly level: Level;
    private readonly events: GameEventBus;

    private grenades: Grenade[] = [];
    private grenadePool: Grenade[] = [];
    private readonly grenadePoolMax = 24;

    constructor(opts: {
        events: GameEventBus;
        scene: THREE.Scene;
        objects: THREE.Object3D[];
        cameraPos: THREE.Vector3;
        particleSystem: GPUParticleSystem;
        explosionManager: ExplosionManager;
        enemies: Enemy[];
        physicsSystem: PhysicsSystem;
        level: Level;
    }) {
        this.events = opts.events;
        this.scene = opts.scene;
        this.objects = opts.objects;
        this.cameraPos = opts.cameraPos;
        this.particleSystem = opts.particleSystem;
        this.explosionManager = opts.explosionManager;
        this.enemies = opts.enemies;
        this.physicsSystem = opts.physicsSystem;
        this.level = opts.level;
    }

    get activeCount(): number {
        return this.grenades.length;
    }

    update(frame: FrameContext): void {
        this.explosionManager.update(frame.delta);

        for (let i = this.grenades.length - 1; i >= 0; i--) {
            const grenade = this.grenades[i];
            grenade.update(frame.delta);

            if (!grenade.isActive) {
                grenade.release();
                this.grenades.splice(i, 1);

                if (this.grenadePool.length < this.grenadePoolMax) {
                    this.grenadePool.push(grenade);
                } else {
                    grenade.dispose();
                }
            }
        }
    }

    throwGrenade(position: THREE.Vector3, direction: THREE.Vector3): void {
        const throwStrength = WeaponConfig.grenade.throwStrength;

        let grenade: Grenade;
        if (this.grenadePool.length > 0) {
            grenade = this.grenadePool.pop()!;
            grenade.reset(position, direction, throwStrength);
        } else {
            grenade = new Grenade(
                position,
                direction,
                throwStrength,
                this.scene,
                this.objects,
                this.cameraPos,
                this.events
            );
        }

        grenade.setParticleSystem(this.particleSystem);
        grenade.setExplosionManager(this.explosionManager);
        grenade.setEnemies(this.enemies);
        grenade.setPhysicsSystem(this.physicsSystem);
        grenade.setGroundHeightCallback((x, z) => this.level.getTerrainHeight(x, z));

        this.grenades.push(grenade);
        this.events.emit({ type: 'sound:play', sound: 'grenadeThrow' });
    }

    dispose(): void {
        for (const g of this.grenades) g.dispose();
        for (const g of this.grenadePool) g.dispose();
        this.grenades = [];
        this.grenadePool = [];
        Grenade.disposeSharedResources();
    }
}
