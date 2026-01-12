import * as THREE from 'three';
import type { System, FrameContext } from '../core/engine/System';
import { LevelConfig } from '../core/GameConfig';
import type { EnemySystem } from './EnemySystem';
import type { PickupSystem } from './PickupSystem';

export class SpawnSystem implements System {
    public readonly name = 'spawns';

    private readonly enemies: EnemySystem;
    private readonly pickups: PickupSystem;

    private spawnTimer = 0;
    private pickupSpawnTimer = 0;
    private initialPickupsSpawned = false;
    private pendingInitialPickupSpawns = 0;
    private pendingInitialPickupCooldown = 0;

    constructor(enemies: EnemySystem, pickups: PickupSystem) {
        this.enemies = enemies;
        this.pickups = pickups;

        this.spawnTimer = -LevelConfig.enemySpawn.initialDelay / 1000;
        this.pickupSpawnTimer = -LevelConfig.pickupSpawn.initialDelay / 1000;
    }

    update(frame: FrameContext): void {
        const delta = frame.delta;

        // Enemy spawn
        this.spawnTimer += delta;
        if (
            LevelConfig.enemySpawn.enabled &&
            this.spawnTimer > 3.0 &&
            this.enemies.all.length < LevelConfig.enemySpawn.maxEnemies
        ) {
            this.enemies.spawnEnemy();
            this.spawnTimer = 0;
        }

        // Pickup spawn
        this.pickupSpawnTimer += delta;

        if (!this.initialPickupsSpawned && this.pickupSpawnTimer > 0) {
            this.pendingInitialPickupSpawns = 5;
            this.initialPickupsSpawned = true;
            this.pickupSpawnTimer = 0;
        }

        if (
            this.initialPickupsSpawned &&
            this.pickupSpawnTimer > LevelConfig.pickupSpawn.spawnInterval / 1000
        ) {
            if (this.pickups.all.length < LevelConfig.pickupSpawn.maxPickups) {
                this.pickups.spawnPickup();
            }
            this.pickupSpawnTimer = 0;
        }

        if (this.pendingInitialPickupSpawns > 0) {
            this.pendingInitialPickupCooldown = Math.max(
                0,
                this.pendingInitialPickupCooldown - delta
            );
            if (this.pendingInitialPickupCooldown <= 0) {
                this.pickups.spawnPickup();
                this.pendingInitialPickupSpawns--;
                this.pendingInitialPickupCooldown = 0.3;
            }
        }

        void THREE; // keep import for future spawn shaping
    }
}
