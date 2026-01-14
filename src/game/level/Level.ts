/**
 * Level - 使用 TSL 材质增强的关卡系统
 * 所有地形材质使用程序化生成的 shader 纹理
 * 支持大地图和性能优化
 */
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { MapConfig, EnvironmentConfig, LevelConfig } from '../core/GameConfig';
import { TreeSystem } from './TreeSystem';
import { GrassSystem } from './GrassSystem';
import { PhysicsSystem } from '../core/PhysicsSystem';
import { WaterSystem } from './WaterSystem';
import { getUserData } from '../types/GameUserData';
import { EnvironmentSystem } from './EnvironmentSystem';
import { LevelMaterials } from './LevelMaterials';
import { terrainHeightCpu } from '../shaders/TerrainHeight';
import { packChunkKey } from '../core/util/SeededRandom';

export class Level {
    private scene: THREE.Scene;
    private objects: THREE.Object3D[];
    private physicsSystem: PhysicsSystem;
    
    // 子系统
    private treeSystem: TreeSystem | null = null;
    private grassSystem: GrassSystem | null = null;
    private waterSystem: WaterSystem | null = null;
    private environmentSystem: EnvironmentSystem | null = null;

    private readonly treeExcludeAreas: Array<{ x: number; z: number; radius: number }> = [];
    private readonly grassExcludeAreas: Array<{ x: number; z: number; radius: number }> = [];

    private lastVegetationChunkX = Number.NaN;
    private lastVegetationChunkZ = Number.NaN;
    private readonly keepTreeChunks = new Set<number>();
    private readonly keepGrassChunks = new Set<number>();
    
    // 材质
    private floorMaterial!: MeshStandardNodeMaterial;

    private terrainMesh: THREE.Mesh | null = null;
    private readonly terrainWorldOffset = uniform(new THREE.Vector2(0, 0));
    
    // 全局环境 Uniforms
    public rainIntensity = uniform(0); // 0 = 晴天, 1 = 暴雨

    /**
     * Lightweight counters for correlating hitches with streaming.
     * Read by HitchProfiler; avoid heavy allocations or scene traversal here.
     */
    public getHitchDebugCounters?(): {
        trees?: Record<string, number>;
        grass?: Record<string, number>;
    };

    constructor(scene: THREE.Scene, objects: THREE.Object3D[], physicsSystem: PhysicsSystem) {
        this.scene = scene;
        this.objects = objects;
        this.physicsSystem = physicsSystem;
        
        // 预创建共享材质 (GPU-displaced terrain)
        this.floorMaterial = LevelMaterials.createFloorMaterial({ worldOffset: this.terrainWorldOffset });
        
        // 1. 创建地形渲染表面 (GPU-first)
        this.createTerrainSurface();
        
        // 2. 初始化环境系统
        this.environmentSystem = new EnvironmentSystem(
            this.scene, 
            this.objects, 
            (x, z) => this.getTerrainHeight(x, z),
            this.physicsSystem
        );
        
        // 3. 创建环境物体
        this.createEnvironment();

        // 4. 初始化植被系统（实际实例按 chunk 流式生成）
        this.initVegetation();
        
        // 5. 创建水体
        this.waterSystem = new WaterSystem(this.scene);
        this.waterSystem.createWater(this.rainIntensity);
    }
    
    public update(deltaTime: number, playerPos: THREE.Vector3) {
        // Keep the terrain mesh centered around the player (bounded vertex count as map grows).
        // Snap to a grid to avoid sub-pixel jitter in the far field.
        if (!this.terrainMesh) return;

        const snap = Math.max(1, MapConfig.terrainFollowSnap ?? 25);
        const cx = Math.floor(playerPos.x / snap) * snap;
        const cz = Math.floor(playerPos.z / snap) * snap;

        if (this.terrainMesh.position.x !== cx || this.terrainMesh.position.z !== cz) {
            this.terrainMesh.position.set(cx, 0, cz);
            this.terrainWorldOffset.value.set(cx, cz);
        }

        // Vegetation streaming is disabled by default because background chunk generation can tank FPS.
        // When enabled explicitly, we request chunks around the player and process them with a tiny budget.
        if (MapConfig.vegetationStreamingEnabled) {
            this.updateVegetation(playerPos);

            // Strict per-frame time budgets to avoid hitches when crossing chunk boundaries.
            // Worker generation is async; the expensive part is applying results + pruning on the main thread.
            const budgetMs = deltaTime < 0.02 ? 1.2 : deltaTime < 0.033 ? 0.7 : 0.35;
            const treeApplyMs = budgetMs * 0.45;
            const grassApplyMs = budgetMs * 0.55;

            // Deletions are now cheap (remove + return-to-pool). Drain more aggressively to keep pools warm.
            const treeDeleteMs = Math.max(1.5, treeApplyMs * 2.0);
            const grassDeleteMs = Math.max(1.2, grassApplyMs * 2.0);

            if ((this.treeSystem?.getPendingCount() ?? 0) > 0) {
                this.treeSystem?.processPending(1, { applyMs: treeApplyMs, deleteMs: treeDeleteMs });
            } else {
                // Still drain deletions even if no pending generation.
                this.treeSystem?.processPending(0, { applyMs: 0, deleteMs: treeDeleteMs });
            }

            if ((this.grassSystem?.getPendingCount() ?? 0) > 0) {
                this.grassSystem?.processPending(1, { applyMs: grassApplyMs, deleteMs: grassDeleteMs });
            } else {
                this.grassSystem?.processPending(0, { applyMs: 0, deleteMs: grassDeleteMs });
            }
        }
    }

    /**
     * Preload near-field vegetation during loading/warmup so gameplay doesn't stutter.
     */
    public async preloadVegetation(params?: {
        updateProgress?: (percent: number, description: string) => void;
        center?: THREE.Vector3;
    }): Promise<void> {
        if (!MapConfig.vegetationPreloadEnabled) return;
        const treeSystem = this.treeSystem;
        const grassSystem = this.grassSystem;
        if (!treeSystem && !grassSystem) return;

        const center = params?.center ?? new THREE.Vector3(0, 0, 0);
        const updateProgress = params?.updateProgress;

        const chunkSize = MapConfig.chunkSize;
        const treeRadius = Math.max(0, MapConfig.vegetationStreamRadiusChunks);
        const grassRadius = Math.max(0, MapConfig.grassStreamRadiusChunks ?? treeRadius);

        const ix0 = Math.floor((center.x + chunkSize / 2) / chunkSize);
        const iz0 = Math.floor((center.z + chunkSize / 2) / chunkSize);

        this.keepTreeChunks.clear();
        this.keepGrassChunks.clear();

        for (let dz = -treeRadius; dz <= treeRadius; dz++) {
            for (let dx = -treeRadius; dx <= treeRadius; dx++) {
                const ix = ix0 + dx;
                const iz = iz0 + dz;
                const key = packChunkKey(ix, iz);
                this.keepTreeChunks.add(key);
                const cx = ix * chunkSize;
                const cz = iz * chunkSize;
                treeSystem?.requestChunk(cx, cz, (x, z) => terrainHeightCpu(x, z), this.treeExcludeAreas, center.x, center.z);
            }
        }

        for (let dz = -grassRadius; dz <= grassRadius; dz++) {
            for (let dx = -grassRadius; dx <= grassRadius; dx++) {
                const ix = ix0 + dx;
                const iz = iz0 + dz;
                const key = packChunkKey(ix, iz);
                this.keepGrassChunks.add(key);
                const cx = ix * chunkSize;
                const cz = iz * chunkSize;
                grassSystem?.requestChunk(cx, cz, (x, z) => terrainHeightCpu(x, z), this.grassExcludeAreas, center.x, center.z);
            }
        }

        // Ensure we don't keep stale chunks if the level was reloaded.
        treeSystem?.pruneChunks(this.keepTreeChunks);
        grassSystem?.pruneChunks(this.keepGrassChunks);

        const totalTree = this.keepTreeChunks.size;
        const totalGrass = this.keepGrassChunks.size;
        const total = Math.max(1, totalTree + totalGrass);

        // Ensure model geometries are ready before prewarming pools.
        // Otherwise we'd allocate WebGPU buffers for placeholder geometries and throw them away.
        await treeSystem?.ensureModelsReady?.();
        await grassSystem?.ensureModelsReady?.();

        // Prewarm streaming pools during loading to avoid runtime WebGPU buffer allocations
        // (poolMiss tends to correlate with render hitches).
        // Worst case: one mesh (per grass type) per chunk, and one trunk/leaves pair (per tree type) per chunk.
        treeSystem?.prewarmPool?.({ perTypePairs: totalTree });
        grassSystem?.prewarmPool?.({ perTypeMeshes: totalGrass });

        // Time-sliced drain: keep UI responsive and avoid long tasks.
        const sliceMs = 10;
        for (;;) {
            const pendingTrees = treeSystem?.getPendingCount() ?? 0;
            const pendingGrass = grassSystem?.getPendingCount() ?? 0;
            const pendingTotal = pendingTrees + pendingGrass;
            if (pendingTotal <= 0) break;

            const start = performance.now();
            while (performance.now() - start < sliceMs) {
                treeSystem?.processPending(1);
                grassSystem?.processPending(1);

                const pt = treeSystem?.getPendingCount() ?? 0;
                const pg = grassSystem?.getPendingCount() ?? 0;
                if (pt + pg <= 0) break;
            }

            if (updateProgress) {
                const loaded = (treeSystem?.getLoadedChunkCount() ?? 0) + (grassSystem?.getLoadedChunkCount() ?? 0);
                // Keep progress monotonic with shader warmup (which starts at 92).
                const percent = Math.min(92, Math.floor(91 + (loaded / total) * 1));
                updateProgress(percent, "i18n:loading.stage.vegetation");
            }

            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
    }

    /**
     * 创建环境物体
     */
    private createEnvironment() {
        if (!this.environmentSystem) return;

        // 记录环境中新增物体的起始索引
        const startIndex = this.objects.length;

        // 天空和大气
        this.environmentSystem.createSkybox();
        this.environmentSystem.createAtmosphere();
        
        // 边界墙
        this.environmentSystem.createWalls();
        
        // 障碍物和装饰
        this.environmentSystem.createObstacles();
        
        // 复杂地形特征
        const mapRadius = MapConfig.size / 2;
        this.environmentSystem.createRockFormations(mapRadius);
        this.environmentSystem.createRuins(mapRadius);
        this.environmentSystem.createSandbagCovers(mapRadius);
        this.environmentSystem.createCoverObjects();
        this.environmentSystem.createStairs();

        // 将新增的环境物体注册到物理系统
        if (this.physicsSystem) {
            for (let i = startIndex; i < this.objects.length; i++) {
                const obj = this.objects[i];
                // 排除不需要物理碰撞的物体 (如路径点)
                if (getUserData(obj).isWayPoint) continue;
                // 某些批处理渲染对象会自己注册 per-instance 碰撞体
                if (getUserData(obj).noPhysics) continue;
                
                this.physicsSystem.addStaticObject(obj);
            }
        }
    }
    
    /**
     * 创建植被
     */
    private initVegetation() {
        this.treeSystem = new TreeSystem(this.scene);
        this.grassSystem = new GrassSystem(this.scene);

        // Expose debug counters for hitch correlation (opt-in, cheap).
        this.getHitchDebugCounters = () => ({
            trees: this.treeSystem?.getHitchDebugCounters?.(),
            grass: this.grassSystem?.getHitchDebugCounters?.(),
        });

        // Exclude areas (spawn/safe zone, plus a couple of sample clearings near origin).
        this.treeExcludeAreas.push(
            { x: 0, z: 0, radius: LevelConfig.safeZoneRadius },
        );
        this.grassExcludeAreas.push(
            { x: 0, z: 0, radius: LevelConfig.safeZoneRadius },
            { x: 30, z: 30, radius: EnvironmentConfig.grass.placement.excludeRadius.default },
            { x: -30, z: -30, radius: EnvironmentConfig.grass.placement.excludeRadius.default },
        );
    }

    private updateVegetation(playerPos: THREE.Vector3) {
        const treeSystem = this.treeSystem;
        const grassSystem = this.grassSystem;
        if (!treeSystem && !grassSystem) return;

        const chunkSize = MapConfig.chunkSize;
        const treeRadius = Math.max(0, MapConfig.vegetationStreamRadiusChunks);
        const grassRadius = Math.max(0, MapConfig.grassStreamRadiusChunks ?? treeRadius);

        // Chunk indices centered around origin (symmetric around 0)
        const ix0 = Math.floor((playerPos.x + chunkSize / 2) / chunkSize);
        const iz0 = Math.floor((playerPos.z + chunkSize / 2) / chunkSize);

        // Streaming is only needed when crossing chunk boundaries.
        if (ix0 === this.lastVegetationChunkX && iz0 === this.lastVegetationChunkZ) return;
        this.lastVegetationChunkX = ix0;
        this.lastVegetationChunkZ = iz0;

        this.keepTreeChunks.clear();
        this.keepGrassChunks.clear();

        for (let dz = -treeRadius; dz <= treeRadius; dz++) {
            for (let dx = -treeRadius; dx <= treeRadius; dx++) {
                const ix = ix0 + dx;
                const iz = iz0 + dz;
                const key = packChunkKey(ix, iz);
                this.keepTreeChunks.add(key);

                const cx = ix * chunkSize;
                const cz = iz * chunkSize;

                treeSystem?.requestChunk(cx, cz, (x, z) => terrainHeightCpu(x, z), this.treeExcludeAreas, playerPos.x, playerPos.z);
            }
        }

        for (let dz = -grassRadius; dz <= grassRadius; dz++) {
            for (let dx = -grassRadius; dx <= grassRadius; dx++) {
                const ix = ix0 + dx;
                const iz = iz0 + dz;
                const key = packChunkKey(ix, iz);
                this.keepGrassChunks.add(key);

                const cx = ix * chunkSize;
                const cz = iz * chunkSize;

                grassSystem?.requestChunk(cx, cz, (x, z) => terrainHeightCpu(x, z), this.grassExcludeAreas, playerPos.x, playerPos.z);
            }
        }

        treeSystem?.pruneChunks(this.keepTreeChunks);
        grassSystem?.pruneChunks(this.keepGrassChunks);
    }

    private createTerrainSurface() {
        const size = MapConfig.terrainRenderSize ?? (MapConfig.maxViewDistance * 2 + 400);
        const segments = MapConfig.terrainRenderSegments ?? 512;

        const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
        geometry.rotateX(-Math.PI / 2);

        const mesh = new THREE.Mesh(geometry, this.floorMaterial);
        mesh.receiveShadow = true;
        getUserData(mesh).isGround = true;

        this.scene.add(mesh);
        this.terrainMesh = mesh;
    }

    /**
     * 获取地形高度 (外部查询用，基于实际网格插值)
     */
    public getTerrainHeight(x: number, z: number): number {
        return terrainHeightCpu(x, z);
    }
}
