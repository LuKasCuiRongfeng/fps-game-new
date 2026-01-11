import * as THREE from 'three';
import { buildBVHForObject } from './BVH';

/**
 * 物理系统 - 使用空间划分 (Spatial Partitioning) 优化碰撞检测
 * 使用 Grid (网格) 索引静态物体，避免 O(N) 遍历
 */
export class PhysicsSystem {
    private static instance: PhysicsSystem;
    
    // 网格大小 (米)
    // 玩家移动速度约 6m/s ~ 12m/s
    // 10m 的网格比较合适，每次查询周围 3x3 个网格
    private cellSize: number = 20; 
    
    // 空间哈希表: Key = "x_z", Value = colliders list
    private grid: Map<number, Array<{ box: THREE.Box3; object: THREE.Object3D; colliderId: number }>> = new Map();
    
    // 所有的静态碰撞体 (备用)
    private staticColliders: Array<{ box: THREE.Box3; object: THREE.Object3D; colliderId: number }> = [];

    // Avoid per-query Set allocations by using an ever-increasing stamp.
    // Note: AABB broadphase needs to de-dupe by colliderId (InstancedMesh uses per-instance colliders),
    // while raycast candidate collection should de-dupe by object.id.
    private visitStampCollider = 1;
    private visitedColliderIds: Map<number, number> = new Map();

    private visitStampObject = 1;
    private visitedObjectIds: Map<number, number> = new Map();

    private nextColliderId = 1;

    // Packed grid key (x,z) -> uint32 in JS number.
    // With current map sizes, 16-bit signed cell indices are plenty.
    private readonly keyOffset = 32768;
    private packKey(x: number, z: number): number {
        const xx = (x + this.keyOffset) & 0xffff;
        const zz = (z + this.keyOffset) & 0xffff;
        return (xx << 16) | zz;
    }

    private beginVisitColliders() {
        this.visitStampCollider++;
        if (this.visitStampCollider >= Number.MAX_SAFE_INTEGER) {
            this.visitStampCollider = 1;
            this.visitedColliderIds.clear();
        }
    }

    private isColliderVisited(id: number): boolean {
        return this.visitedColliderIds.get(id) === this.visitStampCollider;
    }

    private markColliderVisited(id: number) {
        this.visitedColliderIds.set(id, this.visitStampCollider);
    }

    private beginVisitObjects() {
        this.visitStampObject++;
        if (this.visitStampObject >= Number.MAX_SAFE_INTEGER) {
            this.visitStampObject = 1;
            this.visitedObjectIds.clear();
        }
    }

    private isObjectVisited(id: number): boolean {
        return this.visitedObjectIds.get(id) === this.visitStampObject;
    }

    private markObjectVisited(id: number) {
        this.visitedObjectIds.set(id, this.visitStampObject);
    }

    constructor() {
        // Singleton or Instance per Level
    }

    /**
     * 添加静态碰撞体
     * 会计算包围盒并添加到对应的网格中
     */
    public addStaticObject(object: THREE.Object3D) {
        this.prepareStaticObject(object);

        // 计算精确的世界坐标包围盒
        const box = new THREE.Box3().setFromObject(object);
        
        // 如果包围盒无效，跳过
        if (box.isEmpty()) return;
        
        // Use object.id as colliderId for normal objects
        this.addStaticBoxCollider(box, object, object.id);
    }

    /**
     * Prepare an object for raycasts / BVH (without registering its AABB into the grid).
     * Useful when the render object is an InstancedMesh but collision is registered per-instance.
     */
    public prepareStaticObject(object: THREE.Object3D) {
        // IMPORTANT:
        // Many environment obstacles are Meshes parented under a transformed Group (stairs, sandbags, etc.).
        // Before the first render, their `matrixWorld` may still be stale, causing Box3 to be computed at the
        // origin and resulting in "no collision" even though the mesh is visible elsewhere.
        // Force-update the full transform chain so the cached Box3 is correct.
        object.updateWorldMatrix(true, true);

        // Build BVH for meshes under this object so later raycasts are fast.
        // (Done once at registration time; safe for static geometry)
        buildBVHForObject(object);

        // Precompute raycast mesh targets for weapons/LOS so the first shot doesn't
        // traverse complex object hierarchies at runtime.
        const ud = (object.userData ?? (object.userData = {})) as any;
        if (!ud._hitscanTargets || !ud._meleeTargets) {
            const targets: THREE.Object3D[] = [];
            object.traverse((obj) => {
                const anyObj = obj as any;
                if (!anyObj.isMesh) return;
                const userData = obj.userData;
                if (userData?.noRaycast) return;
                if (userData?.isWayPoint) return;
                if (userData?.isDust) return;
                if (userData?.isSkybox) return;
                if (userData?.isWeatherParticle) return;
                if (userData?.isEffect) return;
                if (userData?.isBulletTrail) return;
                if (userData?.isGrenade) return;
                targets.push(obj);
            });
            ud._hitscanTargets = targets;
            ud._meleeTargets = targets;
        }
    }

    /**
     * Register a precomputed world-space AABB collider into the spatial grid.
     * If colliderId is not provided, an internal unique id is generated.
     */
    public addStaticBoxCollider(box: THREE.Box3, object: THREE.Object3D, colliderId?: number) {
        if (box.isEmpty()) return;

        const id = colliderId ?? this.nextColliderId++;
        const entry = { box, object, colliderId: id };
        this.staticColliders.push(entry);

        // 将物体添加到覆盖的所有网格中
        const minX = Math.floor(box.min.x / this.cellSize);
        const maxX = Math.floor(box.max.x / this.cellSize);
        const minZ = Math.floor(box.min.z / this.cellSize);
        const maxZ = Math.floor(box.max.z / this.cellSize);

        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                const key = this.packKey(x, z);
                if (!this.grid.has(key)) {
                    this.grid.set(key, []);
                }
                this.grid.get(key)!.push(entry);
            }
        }
    }
    
    /**
     * 获取指定区域附近的碰撞体
     * @param position 中心位置
     * @param radius 查询半径
     */
    public getNearbyObjectsInto(
        position: THREE.Vector3,
        radius: number,
        out: Array<{ box: THREE.Box3; object: THREE.Object3D }>
    ): Array<{ box: THREE.Box3; object: THREE.Object3D }> {
        this.beginVisitColliders();
        out.length = 0;
        // 计算查询范围覆盖的网格
        const minX = Math.floor((position.x - radius) / this.cellSize);
        const maxX = Math.floor((position.x + radius) / this.cellSize);
        const minZ = Math.floor((position.z - radius) / this.cellSize);
        const maxZ = Math.floor((position.z + radius) / this.cellSize);

        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                const key = this.packKey(x, z);
                const cellObjects = this.grid.get(key);
                if (cellObjects) {
                    for (const entry of cellObjects) {
                        if (this.isColliderVisited(entry.colliderId)) continue;
                        // 简单的距离裁剪 (可选，Box3 Intersects Box3 已经很快了)
                        // 这里我们直接返回所有候选者，交给调用者做精确的 AABB 测试
                        out.push(entry);
                        this.markColliderVisited(entry.colliderId);
                    }
                }
            }
        }

        return out;
    }

    public getNearbyObjects(position: THREE.Vector3, radius: number = 2.0): Array<{ box: THREE.Box3, object: THREE.Object3D }> {
        return this.getNearbyObjectsInto(position, radius, []);
    }
    
    /**
     * 清理
     */
    public clear() {
        this.grid.clear();
        this.staticColliders = [];
        this.nextColliderId = 1;
    }

    /**
     * 射线检测 - 获取射线路径上的所有候选物体 (Broad Phase)
     * 使用网格遍历算法 (Grid Traversal) 快速筛选
     * @param origin 射线起点
     * @param direction 射线方向 (主要是 X Z 平面)
     * @param maxDistance 最大检测距离
     */
    public getRaycastCandidates(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): THREE.Object3D[] {
        return this.getRaycastCandidatesInto(origin, direction, maxDistance, []);
    }

    public getRaycastCandidatesInto(
        origin: THREE.Vector3,
        direction: THREE.Vector3,
        maxDistance: number,
        out: THREE.Object3D[],
    ): THREE.Object3D[] {
        this.beginVisitObjects();
        out.length = 0;

        // 2D DDA Algorithm (Amanatides & Woo) on XZ plane
        // Normalize direction for 2D
        const dirX = direction.x;
        const dirZ = direction.z;
        
        // Ray start in grid coords
        let currentX = Math.floor(origin.x / this.cellSize);
        let currentZ = Math.floor(origin.z / this.cellSize);
        
        // Step direction
        const stepX = Math.sign(dirX);
        const stepZ = Math.sign(dirZ);
        
        // Delta distance (distance to travel one cell on that axis)
        const tDeltaX = Math.abs(this.cellSize / dirX);
        const tDeltaZ = Math.abs(this.cellSize / dirZ);
        
        // Initial distance to next boundary
        let tMaxX = 0;
        let tMaxZ = 0;
        
        if (dirX > 0) {
            tMaxX = ((currentX + 1) * this.cellSize - origin.x) / dirX;
        } else if (dirX < 0) {
            tMaxX = (currentX * this.cellSize - origin.x) / dirX;
        } else {
            tMaxX = Infinity;
        }
        
        if (dirZ > 0) {
            tMaxZ = ((currentZ + 1) * this.cellSize - origin.z) / dirZ;
        } else if (dirZ < 0) {
            tMaxZ = (currentZ * this.cellSize - origin.z) / dirZ;
        } else {
            tMaxZ = Infinity;
        }
        
        // Walk the grid
        let tCurrent = 0;
        
        // Safety Break
        let iterations = 0;
        const maxSteps = Math.ceil(maxDistance / this.cellSize) * 2 + 5;

        while (tCurrent < maxDistance && iterations < maxSteps) {
            // Check current cell
            const key = this.packKey(currentX, currentZ);
            const cellObjects = this.grid.get(key);
            
            if (cellObjects) {
                for (const entry of cellObjects) {
                    if (!this.isObjectVisited(entry.object.id)) {
                        const ud = entry.object.userData;
                        if (ud?.noRaycast || ud?.isWayPoint) {
                            this.markObjectVisited(entry.object.id);
                            continue;
                        }
                        out.push(entry.object);
                        this.markObjectVisited(entry.object.id);
                    }
                }
            }
            
            // Move to next cell
            if (tMaxX < tMaxZ) {
                tCurrent = tMaxX;
                tMaxX += tDeltaX;
                currentX += stepX;
            } else {
                tCurrent = tMaxZ;
                tMaxZ += tDeltaZ;
                currentZ += stepZ;
            }
            
            iterations++;
        }
        
        return out;
    }
}
