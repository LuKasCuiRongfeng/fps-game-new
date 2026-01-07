import * as THREE from 'three';
import { MapConfig } from './GameConfig';

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
    private grid: Map<string, Array<{ box: THREE.Box3, object: THREE.Object3D }>> = new Map();
    
    // 所有的静态碰撞体 (备用)
    private staticColliders: Array<{ box: THREE.Box3, object: THREE.Object3D }> = [];

    constructor() {
        // Singleton or Instance per Level
    }

    /**
     * 添加静态碰撞体
     * 会计算包围盒并添加到对应的网格中
     */
    public addStaticObject(object: THREE.Object3D) {
        // 计算精确的世界坐标包围盒
        const box = new THREE.Box3().setFromObject(object);
        
        // 如果包围盒无效，跳过
        if (box.isEmpty()) return;
        
        const entry = { box, object };
        this.staticColliders.push(entry);
        
        // 将物体添加到覆盖的所有网格中
        const minX = Math.floor(box.min.x / this.cellSize);
        const maxX = Math.floor(box.max.x / this.cellSize);
        const minZ = Math.floor(box.min.z / this.cellSize);
        const maxZ = Math.floor(box.max.z / this.cellSize);
        
        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                const key = `${x}_${z}`;
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
    public getNearbyObjects(position: THREE.Vector3, radius: number = 2.0): Array<{ box: THREE.Box3, object: THREE.Object3D }> {
        // 计算查询范围覆盖的网格
        const minX = Math.floor((position.x - radius) / this.cellSize);
        const maxX = Math.floor((position.x + radius) / this.cellSize);
        const minZ = Math.floor((position.z - radius) / this.cellSize);
        const maxZ = Math.floor((position.z + radius) / this.cellSize);
        
        const result: Array<{ box: THREE.Box3, object: THREE.Object3D }> = [];
        const processed = new Set<THREE.Object3D>(); // 防止由于跨网格导致的重复
        
        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                const key = `${x}_${z}`;
                const cellObjects = this.grid.get(key);
                if (cellObjects) {
                    for (const entry of cellObjects) {
                        if (!processed.has(entry.object)) {
                            // 简单的距离裁剪 (可选，Box3 Intersects Box3 已经很快了)
                            // 这里我们直接返回所有候选者，交给调用者做精确的 AABB 测试
                            result.push(entry);
                            processed.add(entry.object);
                        }
                    }
                }
            }
        }
        
        return result;
    }
    
    /**
     * 清理
     */
    public clear() {
        this.grid.clear();
        this.staticColliders = [];
    }

    /**
     * 射线检测 - 获取射线路径上的所有候选物体 (Broad Phase)
     * 使用网格遍历算法 (Grid Traversal) 快速筛选
     * @param origin 射线起点
     * @param direction 射线方向 (主要是 X Z 平面)
     * @param maxDistance 最大检测距离
     */
    public getRaycastCandidates(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): THREE.Object3D[] {
        const candidates: THREE.Object3D[] = [];
        // 优化: 使用 Set 会有 GC 开销，对于小范围查询，直接遍历数组去重或者不完全去重可能更快
        // 考虑到 static staticColliders 不会动，且网格划分合理，重复率不高。
        // 这里改用 ID 标记法或简单的 includes Check (如果数量少)
        // 但为了通用性，还是保留 Set，但将其作为类成员复用? 不，Set clear 也需要时间
        // 暂时保持 Set，因为正确性优先
        const processed = new Set<number>(); // 存储 Object ID 而不是对象本身引用 (稍微快一点?)

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
            const key = `${currentX}_${currentZ}`;
            const cellObjects = this.grid.get(key);
            
            if (cellObjects) {
                for (const entry of cellObjects) {
                    if (!processed.has(entry.object.id)) {
                        candidates.push(entry.object);
                        processed.add(entry.object.id);
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
        
        return candidates;
    }
}
