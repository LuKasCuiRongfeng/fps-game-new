import type * as THREE from 'three';
import type { Enemy } from '../enemy/Enemy';
import type { TreeType } from '../core/GameConfig';

export interface GameUserData {
    // Entity tagging
    isEnemy?: boolean;
    entity?: Enemy;

    // Raycast/collision filters
    noRaycast?: boolean;
    noGrenadeCollision?: boolean;
    noPhysics?: boolean;

    // Scene tagging
    isWayPoint?: boolean;
    type?: string;
    id?: number;
    isGround?: boolean;
    isStair?: boolean;
    isPlatform?: boolean;
    isSkybox?: boolean;
    isDust?: boolean;
    isWeatherParticle?: boolean;
    isEffect?: boolean;
    isBulletTrail?: boolean;
    isGrenade?: boolean;
    isEnemyWeapon?: boolean;

    // GPU-driven enemy impostors (InstancedMesh)
    isEnemyImpostorMesh?: boolean;
    _enemyByInstanceId?: Array<Enemy | null>;

    // Environment / pickups
    isPickup?: boolean;
    pickupType?: string;
    isObstacleBatch?: boolean;
    isRock?: boolean;
    isRuin?: boolean;
    isCover?: boolean;
    isBarrel?: boolean;
    isTree?: boolean;
    isGrass?: boolean;
    treePart?: string;
    treeType?: TreeType;

    // Instanced batch metadata
    chunkCenterX?: number;
    chunkCenterZ?: number;

    // Instanced vegetation metadata
    treePositionsXZ?: Float32Array;
    grassPositionsXZ?: Float32Array;
    pairedMesh?: THREE.InstancedMesh;

    // Cached traversal targets
    _hitscanTargets?: THREE.Object3D[];
    _meleeTargets?: THREE.Object3D[];
}

export const getUserData = (obj: THREE.Object3D): GameUserData => obj.userData as GameUserData;
