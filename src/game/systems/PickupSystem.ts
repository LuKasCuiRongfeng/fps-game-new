import * as THREE from 'three';
import type { System, FrameContext } from '../core/engine/System';
import { Pickup } from '../entities/PickupTSL';
import { LevelConfig } from '../core/GameConfig';
import type { Level } from '../level/Level';

export class PickupSystem implements System {
    public readonly name = 'pickups';

    private readonly scene: THREE.Scene;
    private readonly level: Level;
    private pickups: Pickup[] = [];

    private readonly tmpPlayerPos = new THREE.Vector3();

    constructor(scene: THREE.Scene, level: Level) {
        this.scene = scene;
        this.level = level;
    }

    get all(): readonly Pickup[] {
        return this.pickups;
    }

    update(frame: FrameContext): void {
        const playerPos = this.tmpPlayerPos.set(
            frame.playerPos.x,
            frame.playerPos.y,
            frame.playerPos.z
        );

        for (let i = this.pickups.length - 1; i >= 0; i--) {
            const pickup = this.pickups[i];
            pickup.update(playerPos, frame.delta);

            if (pickup.isCollected) {
                this.scene.remove(pickup.mesh);
                pickup.dispose();
                this.pickups.splice(i, 1);
            }
        }
    }

    tryCollectOne(): boolean {
        for (const pickup of this.pickups) {
            if (pickup.tryCollect()) return true;
        }
        return false;
    }

    spawnPickup(): void {
        // Keep a hard safety cap to avoid runaway allocations.
        if (this.pickups.length >= LevelConfig.pickupSpawn.maxPickups * 2) return;

        const type = Math.random() > 0.5 ? 'health' : 'ammo';

        // Spawn in a local-ish radius but outside safe zone.
        let x = 0;
        let z = 0;
        let dist = 0;

        for (let i = 0; i < 10; i++) {
            x = (Math.random() - 0.5) * 150;
            z = (Math.random() - 0.5) * 150;
            dist = Math.sqrt(x * x + z * z);
            if (dist > LevelConfig.safeZoneRadius) break;
        }

        if (dist <= LevelConfig.safeZoneRadius) {
            const angle = Math.random() * Math.PI * 2;
            x = Math.cos(angle) * (LevelConfig.safeZoneRadius + 2);
            z = Math.sin(angle) * (LevelConfig.safeZoneRadius + 2);
        }

        const y = this.level.getTerrainHeight(x, z);
        const pickup = new Pickup(type, new THREE.Vector3(x, y, z));
        this.scene.add(pickup.mesh);
        this.pickups.push(pickup);
    }

    dispose(): void {
        for (const p of this.pickups) {
            this.scene.remove(p.mesh);
            p.dispose();
        }
        this.pickups = [];
    }
}
