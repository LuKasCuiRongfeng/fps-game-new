import * as THREE from 'three';
import type { System, FrameContext } from '../core/engine/System';
import { Enemy } from '../enemy/Enemy';
import { EnemyTypesConfig, EnemyConfig, EffectConfig, LevelConfig } from '../core/GameConfig';
import type { EnemyType } from '../core/GameConfig';
import { GameStateService } from '../core/GameState';
import { SoundManager } from '../core/SoundManager';
import { getRandomEnemyWeaponId } from '../weapon/WeaponDefinitions';
import type { WeaponId } from '../weapon/WeaponTypes';
import type { Level } from '../level/Level';
import type { PhysicsSystem } from '../core/PhysicsSystem';
import type { Pathfinding } from '../core/Pathfinding';
import type { GPUComputeSystem } from '../shaders/GPUCompute';
import type { GPUParticleSystem } from '../shaders/GPUParticles';
import type { EnemyTrailSystem } from './EnemyTrailSystem';

export class EnemySystem implements System {
    public readonly name = 'enemies';

    private readonly scene: THREE.Scene;
    private readonly camera: THREE.PerspectiveCamera;
    private readonly objects: THREE.Object3D[];
    private readonly level: Level;
    private readonly physicsSystem: PhysicsSystem;
    private readonly pathfinding: Pathfinding;
    private readonly gpuCompute: GPUComputeSystem;
    private readonly particleSystem: GPUParticleSystem;
    private readonly trails: EnemyTrailSystem;
    private readonly setDamageFlashIntensity: (v: number) => void;

    private enemies: Enemy[] = [];
    private enemyPool: Map<string, Enemy[]> = new Map();
    private readonly enemyPoolMaxPerKey = 6;

    private readonly maxGpuEnemies: number;
    private nextGpuIndex = 0;
    private freeGpuIndices: number[] = [];

    private readonly tmpPlayerPos = new THREE.Vector3();

    private tmpMuzzlePos = new THREE.Vector3();
    private tmpTrailEnd = new THREE.Vector3();

    constructor(opts: {
        scene: THREE.Scene;
        camera: THREE.PerspectiveCamera;
        objects: THREE.Object3D[];
        level: Level;
        physicsSystem: PhysicsSystem;
        pathfinding: Pathfinding;
        gpuCompute: GPUComputeSystem;
        particleSystem: GPUParticleSystem;
        trails: EnemyTrailSystem;
        setDamageFlashIntensity: (v: number) => void;
        maxGpuEnemies: number;
    }) {
        this.scene = opts.scene;
        this.camera = opts.camera;
        this.objects = opts.objects;
        this.level = opts.level;
        this.physicsSystem = opts.physicsSystem;
        this.pathfinding = opts.pathfinding;
        this.gpuCompute = opts.gpuCompute;
        this.particleSystem = opts.particleSystem;
        this.trails = opts.trails;
        this.setDamageFlashIntensity = opts.setDamageFlashIntensity;
        this.maxGpuEnemies = opts.maxGpuEnemies;
    }

    get all(): Enemy[] {
        return this.enemies;
    }

    private enemyPoolKey(type: EnemyType, weaponId: WeaponId): string {
        return `${type}:${weaponId}`;
    }

    private getEnemyPool(key: string): Enemy[] {
        const existing = this.enemyPool.get(key);
        if (existing) return existing;
        const created: Enemy[] = [];
        this.enemyPool.set(key, created);
        return created;
    }

    takeEnemyFromPool(type: EnemyType, weaponId: WeaponId): Enemy | null {
        const key = this.enemyPoolKey(type, weaponId);
        const pool = this.enemyPool.get(key);
        if (!pool || pool.length === 0) return null;
        return pool.pop() ?? null;
    }

    returnEnemyToPool(enemy: Enemy): void {
        enemy.release();
        enemy.gpuIndex = -1;

        const key = enemy.getPoolKey();
        const pool = this.getEnemyPool(key);
        if (pool.length < this.enemyPoolMaxPerKey) {
            pool.push(enemy);
        } else {
            enemy.dispose();
        }
    }

    recycle(enemy: Enemy): void {
        this.returnEnemyToPool(enemy);
    }

    private allocateGpuIndex(): number {
        const idx = this.freeGpuIndices.pop();
        if (idx !== undefined) return idx;
        return this.nextGpuIndex++;
    }

    update(frame: FrameContext): void {
        const playerPos = this.tmpPlayerPos.set(
            frame.playerPos.x,
            frame.playerPos.y,
            frame.playerPos.z
        );

        const targetUpdateDist = EnemyConfig.gpuCompute.targetUpdateDistance;
        const targetUpdateDistSq = targetUpdateDist * targetUpdateDist;
        const meleeRangeSq = 1.0 * 1.0;

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            const distSq = enemy.mesh.position.distanceToSquared(playerPos);

            if (EnemyConfig.gpuCompute.enabled && enemy.gpuIndex >= 0) {
                if (distSq <= targetUpdateDistSq) {
                    this.gpuCompute.setEnemyTarget(enemy.gpuIndex, playerPos);
                }
            }

            const shootResult = enemy.update(playerPos, frame.delta, this.objects, this.pathfinding);

            if (shootResult.fired) {
                const muzzlePos = enemy.getMuzzleWorldPosition(this.tmpMuzzlePos);
                const trailEnd = this.tmpTrailEnd;
                if (shootResult.hit) {
                    trailEnd.copy(playerPos);
                } else {
                    trailEnd.copy(muzzlePos).addScaledVector(enemy.lastShotDirection, 50);
                }

                this.trails.spawnTrail(muzzlePos, trailEnd);

                if (shootResult.hit) {
                    GameStateService.getInstance().updateHealth(-shootResult.damage);
                    this.setDamageFlashIntensity(EffectConfig.damageFlash.intensity);
                    SoundManager.getInstance().playDamage();

                    this.particleSystem.emit({
                        type: 'spark',
                        position: playerPos.clone().add(new THREE.Vector3(0, 1, 0)),
                        direction: enemy.lastShotDirection.clone().negate(),
                        count: 5,
                        speed: { min: 1, max: 3 },
                        spread: 0.5,
                        color: {
                            start: new THREE.Color(1, 0.1, 0.05),
                            end: new THREE.Color(0.3, 0.02, 0.01),
                        },
                        size: { start: 0.03, end: 0.01 },
                        lifetime: { min: 0.2, max: 0.4 },
                        gravity: -5,
                        drag: 0.95,
                    });
                }
            }

            if (distSq < meleeRangeSq) {
                GameStateService.getInstance().updateHealth(-10 * frame.delta);
                if (Math.random() < 0.1) {
                    this.setDamageFlashIntensity(EffectConfig.damageFlash.intensity * 0.7);
                    SoundManager.getInstance().playDamage();
                }
            }

            if (enemy.isDead) {
                this.particleSystem.emitBlood(enemy.mesh.position, new THREE.Vector3(0, 1, 0), 20);
                this.scene.remove(enemy.mesh);

                if (EnemyConfig.gpuCompute.enabled && enemy.gpuIndex >= 0) {
                    this.gpuCompute.setEnemyActive(enemy.gpuIndex, false);
                    this.freeGpuIndices.push(enemy.gpuIndex);
                }

                this.returnEnemyToPool(enemy);
                this.enemies.splice(i, 1);
            }
        }
    }

    spawnEnemy(): void {
        const angle = Math.random() * Math.PI * 2;
        const minRadius = Math.max(
            LevelConfig.enemySpawn.spawnRadius.min,
            LevelConfig.safeZoneRadius + 5
        );
        const radius =
            minRadius +
            Math.random() * (LevelConfig.enemySpawn.spawnRadius.max - minRadius);

        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        const types = Object.keys(EnemyTypesConfig) as EnemyType[];
        const type = types[Math.floor(Math.random() * types.length)];

        const enemyWeapon = getRandomEnemyWeaponId();
        const pooled = this.takeEnemyFromPool(type, enemyWeapon);
        const enemy = pooled ?? new Enemy(new THREE.Vector3(x, 0, z), type, enemyWeapon);
        if (pooled) {
            enemy.respawn(new THREE.Vector3(x, 0, z));
        }

        enemy.onGetGroundHeight = (hx, hz) => this.level.getTerrainHeight(hx, hz);
        enemy.setPhysicsSystem(this.physicsSystem);

        const gpuIndex = this.allocateGpuIndex();
        if (EnemyConfig.gpuCompute.enabled && gpuIndex >= this.maxGpuEnemies) {
            // Should not happen (spawn cap should stay below GPU capacity).
            // Fail-safe: don't spawn if we'd index out of bounds.
            this.returnEnemyToPool(enemy);
            return;
        }

        enemy.gpuIndex = gpuIndex;

        this.scene.add(enemy.mesh);
        this.enemies.push(enemy);

        if (EnemyConfig.gpuCompute.enabled) {
            this.gpuCompute.setEnemyData(
                enemy.gpuIndex,
                enemy.mesh.position,
                this.camera.position,
                EnemyConfig.speed,
                EnemyConfig.health
            );
        }
    }

    dispose(): void {
        for (const e of this.enemies) {
            this.scene.remove(e.mesh);
            e.dispose();
        }
        this.enemies = [];

        for (const pool of this.enemyPool.values()) {
            for (const e of pool) {
                this.scene.remove(e.mesh);
                e.dispose();
            }
        }
        this.enemyPool.clear();
    }
}
