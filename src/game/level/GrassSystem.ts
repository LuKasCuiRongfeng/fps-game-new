import * as THREE from 'three';
import { createGrassMaterial } from '../shaders/GrassTSL';
import { EnvironmentConfig, MapConfig } from '../core/GameConfig';
import { getUserData } from '../types/GameUserData';
import { hash2iToU32, mulberry32, packChunkKey, type RandomFn } from '../core/util/SeededRandom';
import { loadGrassModelGeometry } from '../core/assets/ModelGeometryCache';

type WorkerGrassChunkResult = {
    id: 'tall' | 'shrub' | 'dry';
    count: number;
    transforms: Float32Array;
    positionsXZ: Float32Array;
};

type WorkerGrassChunkResponse = {
    kind: 'grass';
    requestId: number;
    key: number;
    cx: number;
    cz: number;
    viewerX: number;
    viewerZ: number;
    results: WorkerGrassChunkResult[];
};

/**
 * 草丛系统 - 管理多种地被植物
 * 使用 Chunk (分块) + InstancedMesh 进行性能优化
 */
export class GrassSystem {
    private scene: THREE.Scene;
    // Streaming chunks keyed by packed chunk coords.
    private chunksByKey: Map<number, THREE.InstancedMesh[]> = new Map();
    // Chunk generation can be expensive; amortize work across frames.
    private pending: Array<{
        key: number;
        cx: number;
        cz: number;
        getHeightAt: (x: number, z: number) => number;
        excludeAreas: Array<{ x: number; z: number; radius: number }>;
        viewerX: number;
        viewerZ: number;
    }> = [];
    private pendingKeys = new Set<number>();

    private worker: Worker | null = null;
    private nextRequestId = 1;
    private readonly requestIdToKey = new Map<number, number>();
    private readonly inflight = new Map<number, { viewerX: number; viewerZ: number }>();
    private readonly ready: WorkerGrassChunkResponse[] = [];

    // Chunk removal can be expensive (scene graph + GPU buffer cleanup). Drain incrementally to avoid hitches.
    private deleteQueue: number[] = [];
    private readonly deleteKeys = new Set<number>();

    // Reuse InstancedMesh objects to avoid WebGPU buffer allocation/free stalls during streaming.
    // Pool keys are per grass type + near/far variant + capacity + receiveShadow.
    private readonly meshPool = new Map<string, THREE.InstancedMesh[]>();

    private debugFrame = {
        applyResponses: 0,
        applyMeshes: 0,
        releaseMeshes: 0,
        poolHit: 0,
        poolMiss: 0,
        uploadedInstanceFloats: 0,
    };

    private modelsReady = false;
    private readonly modelsReadyPromise: Promise<void>;

    public getHitchDebugCounters(): Record<string, number> {
        return {
            pending: this.pendingKeys.size,
            loadedChunks: this.chunksByKey.size,
            ready: this.ready.length,
            inflight: this.inflight.size,
            deleteQueue: this.deleteQueue.length,
            applyResponses: this.debugFrame.applyResponses,
            applyMeshes: this.debugFrame.applyMeshes,
            releaseMeshes: this.debugFrame.releaseMeshes,
            poolHit: this.debugFrame.poolHit,
            poolMiss: this.debugFrame.poolMiss,
            uploadedInstanceFloats: this.debugFrame.uploadedInstanceFloats,
        };
    }

    public getPendingCount(): number {
        return this.pendingKeys.size;
    }

    public getLoadedChunkCount(): number {
        return this.chunksByKey.size;
    }

    public prewarmPool(opts?: { perTypeMeshes?: number }): void {
        const perTypeMeshes = Math.max(0, Math.floor(opts?.perTypeMeshes ?? 0));
        if (perTypeMeshes <= 0) return;

        const capNear = Math.max(0, MapConfig.grassMaxInstancesPerTypeNear ?? 3500);
        const capFar = Math.max(0, MapConfig.grassMaxInstancesPerTypeFar ?? 1000);
        const nearCapacity = this.pickInstanceCapacity(capNear);
        const farCapacity = this.pickInstanceCapacity(capFar);

        for (const type of this.grassTypes) {
            // Near
            this.ensurePoolSize({
                typeId: type.id,
                geometry: type.geometryNear,
                material: type.material,
                capacity: nearCapacity,
                target: perTypeMeshes,
            });

            // Far
            this.ensurePoolSize({
                typeId: type.id,
                geometry: type.geometryFar,
                material: type.material,
                capacity: farCapacity,
                target: perTypeMeshes,
            });
        }
    }
    // Legacy full-map generation path keeps a flat list for disposal.
    private chunkMeshesLegacy: THREE.InstancedMesh[] = [];
    private dummy = new THREE.Object3D();
    
    // 草的类型定义 (几何体、材质、配置)
    private grassTypes: Array<{
        id: string;
        geometryNear: THREE.BufferGeometry;
        geometryFar: THREE.BufferGeometry;
        material: THREE.Material;
        baseCount: number; // 原始配置的数量 (基于小地图)
        scaleRange: { min: number, max: number };
        colorBase: THREE.Color;
        colorTip: THREE.Color;
    }> = [];

    private static readonly EXCLUDE_AREA_DEFAULT: Array<{ x: number; z: number; radius: number }> = [];

    // Convert legacy "total count" tuning into a stable per-area density.
    private readonly grassDensityByType = new Map<string, number>();

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.initGrassTypes();
        this.initDensities();

        // Load model geometry asynchronously. Chunk generation is gated on this.
        this.modelsReadyPromise = this.initModelGeometries();
    }

    public async ensureModelsReady(): Promise<void> {
        await this.modelsReadyPromise;
    }

    private async initModelGeometries(): Promise<void> {
        try {
            const tallGeom = await loadGrassModelGeometry('weed_plant_02_1k', { targetHeight: EnvironmentConfig.grass.tall.height });
            const shrubGeom = await loadGrassModelGeometry('weed_plant_02_1k', { targetHeight: EnvironmentConfig.grass.shrub.height });
            const dryGeom = await loadGrassModelGeometry('weed_plant_02_1k', { targetHeight: EnvironmentConfig.grass.dry.height });

            // Use the same base model, baked to the intended type height.
            // Future expansion: map grass type -> model id(s) + per-type LOD geometries.
            for (const t of this.grassTypes) {
                const g = t.id === 'tall' ? tallGeom : t.id === 'shrub' ? shrubGeom : dryGeom;
                t.geometryNear = g;
                // Keep far geometry cheap to avoid triangle explosions.
            }

            // Pools must not be created until after we have final base geometries.
            this.meshPool.clear();
            this.modelsReady = true;
        } catch (err) {
            console.warn('Failed to load grass model geometry; using procedural fallback.', err);
            this.modelsReady = true;
        }
    }

    /**
     * Ensure a chunk exists for the given chunk center (world-space, meters).
     * Generation is deterministic per chunk via MapConfig.worldSeed.
     */
    public ensureChunk(
        cx: number,
        cz: number,
        getHeightAt: (x: number, z: number) => number,
        excludeAreas: Array<{ x: number; z: number; radius: number }> = GrassSystem.EXCLUDE_AREA_DEFAULT,
        viewerX: number = cx,
        viewerZ: number = cz
    ): void {
        // Legacy API: ensure the chunk is scheduled. Actual generation is amortized via processPending.
        this.requestChunk(cx, cz, getHeightAt, excludeAreas, viewerX, viewerZ);
    }

    /** Queue a chunk for generation (deduped). */
    public requestChunk(
        cx: number,
        cz: number,
        getHeightAt: (x: number, z: number) => number,
        excludeAreas: Array<{ x: number; z: number; radius: number }> = GrassSystem.EXCLUDE_AREA_DEFAULT,
        viewerX: number = cx,
        viewerZ: number = cz
    ): void {
        const chunkSize = MapConfig.chunkSize;
        const ix = Math.round(cx / chunkSize);
        const iz = Math.round(cz / chunkSize);
        const key = packChunkKey(ix, iz);
        if (this.chunksByKey.has(key)) return;
        if (this.pendingKeys.has(key)) return;
        this.pendingKeys.add(key);
        this.pending.push({ key, cx, cz, getHeightAt, excludeAreas, viewerX, viewerZ });
    }

    /** Execute up to maxChunks queued chunk generations. Call every frame with a small budget. */
    public processPending(
        maxChunks: number,
        opts?: {
            /** Time budget (ms) for applying worker results (main thread). */
            applyMs?: number;
            /** Time budget (ms) for pruning/removing chunks (main thread). */
            deleteMs?: number;
        }
    ): void {
        // Best-effort: treat each call as a new "frame slice". This keeps counters fresh without extra plumbing.
        // (LevelUpdateSystem calls us at most once per frame for grass.)
        this.debugFrame.applyResponses = 0;
        this.debugFrame.applyMeshes = 0;
        this.debugFrame.releaseMeshes = 0;
        this.debugFrame.poolHit = 0;
        this.debugFrame.poolMiss = 0;
        this.debugFrame.uploadedInstanceFloats = 0;

        const budget = Math.max(0, Math.floor(maxChunks));

        const deleteMs = Math.max(0, opts?.deleteMs ?? 0);
        if (deleteMs > 0) this.drainDeleteQueue(deleteMs);

        // Prefer worker-based generation to avoid main-thread hitches.
        // If the worker fails (or is unavailable), we fall back to the synchronous path below.
        this.ensureWorker();

        if (this.worker) {
            if (budget > 0) this.dispatchToWorker(Math.max(1, budget));
            if (this.modelsReady && budget > 0) this.applyReady(Math.max(1, budget), opts?.applyMs);
            return;
        }

        if (!this.modelsReady) {
            // No worker, and we don't want to build chunks using placeholder geometry.
            return;
        }

        if (budget <= 0) {
            // Allow callers to only drain deletions.
            return;
        }

        const chunkSize = MapConfig.chunkSize;
        let done = 0;
        // Avoid spending an entire frame draining canceled work.
        const maxPops = budget * 12;
        let pops = 0;

        while (done < budget && this.pending.length > 0 && pops < maxPops) {
            const item = this.pending.pop();
            pops++;
            if (!item) break;
            if (!this.pendingKeys.has(item.key)) continue; // canceled
            this.pendingKeys.delete(item.key);
            if (this.chunksByKey.has(item.key)) continue;

            const ix = Math.round(item.cx / chunkSize);
            const iz = Math.round(item.cz / chunkSize);
            const seedU32 = hash2iToU32(ix, iz, MapConfig.worldSeed ^ 0x5a0f1a2b);
            const rng = mulberry32(seedU32);

            const meshes = this.generateChunkStreamed(item.cx, item.cz, chunkSize, item.getHeightAt, item.excludeAreas, rng, item.viewerX, item.viewerZ);
            if (meshes.length > 0) {
                this.chunksByKey.set(item.key, meshes);
            }
            done++;
        }
    }

    private ensureWorker(): void {
        if (this.worker) return;
        try {
            this.worker = new Worker(new URL('./VegetationWorker.ts', import.meta.url), { type: 'module' });
            this.worker.onmessage = (ev: MessageEvent<WorkerGrassChunkResponse>) => {
                const msg = ev.data;
                if (!msg || msg.kind !== 'grass') return;
                const key = this.requestIdToKey.get(msg.requestId);
                if (key == null) return;
                this.requestIdToKey.delete(msg.requestId);
                this.inflight.delete(key);

                // If chunk is no longer requested, drop it.
                if (!this.pendingKeys.has(key)) return;
                this.ready.push(msg);
            };
        } catch {
            this.worker = null;
        }
    }

    private dispatchToWorker(dispatchBudget: number): void {
        const chunkSize = MapConfig.chunkSize;
        const maxInflight = Math.max(2, dispatchBudget * 3);
        if (this.inflight.size >= maxInflight) return;

        // Dispatch newest requests first so the player sees vegetation in front of them quickly.
        let dispatched = 0;
        while (dispatched < dispatchBudget && this.pending.length > 0 && this.inflight.size < maxInflight) {
            const item = this.pending[this.pending.length - 1];
            if (!item) break;

            if (!this.pendingKeys.has(item.key)) {
                this.pending.pop();
                continue;
            }
            if (this.chunksByKey.has(item.key) || this.inflight.has(item.key)) {
                this.pending.pop();
                continue;
            }

            this.pending.pop();
            this.inflight.set(item.key, { viewerX: item.viewerX, viewerZ: item.viewerZ });

            const ix = Math.round(item.cx / chunkSize);
            const iz = Math.round(item.cz / chunkSize);
            const seedU32 = hash2iToU32(ix, iz, MapConfig.worldSeed ^ 0x5a0f1a2b);
            const requestId = this.nextRequestId++;
            this.requestIdToKey.set(requestId, item.key);

            const distCfg = EnvironmentConfig.grass.distribution;

            const densityByType = {
                tall: this.grassDensityByType.get('tall') ?? 0,
                shrub: this.grassDensityByType.get('shrub') ?? 0,
                dry: this.grassDensityByType.get('dry') ?? 0,
            };

            const grassTypes = this.grassTypes.map((t) => ({
                id: t.id as 'tall' | 'shrub' | 'dry',
                noiseScale: EnvironmentConfig.grass.noise.scale,
                noiseThreshold: EnvironmentConfig.grass.noise.threshold,
                scaleMin: t.scaleRange.min,
                scaleMax: t.scaleRange.max,
            }));

            this.worker?.postMessage({
                kind: 'grass',
                requestId,
                key: item.key,
                cx: item.cx,
                cz: item.cz,
                size: chunkSize,
                seedU32,
                viewerX: item.viewerX,
                viewerZ: item.viewerZ,
                excludeAreas: item.excludeAreas,
                grassDensityScale: Math.max(0, MapConfig.grassDensityScale ?? 1.0),
                grassFarDensityMultiplier: Math.min(1, Math.max(0, MapConfig.grassFarDensityMultiplier ?? 0.35)),
                grassDetailRadiusChunks: Math.max(0, MapConfig.grassDetailRadiusChunks ?? 1),
                // When near LOD uses model geometry, keep instance counts low.
                grassMaxInstancesPerTypeNear: this.modelsReady
                    ? Math.min(Math.max(0, MapConfig.grassMaxInstancesPerTypeNear ?? 3500), 80)
                    : Math.max(0, MapConfig.grassMaxInstancesPerTypeNear ?? 3500),
                grassMaxInstancesPerTypeFar: Math.max(0, MapConfig.grassMaxInstancesPerTypeFar ?? 1000),
                waterLevel: EnvironmentConfig.water.level,
                distribution: {
                    macroWeight: distCfg.macroWeight,
                    denseFactor: distCfg.denseFactor,
                    shoreFade: distCfg.shoreFade,
                    microThresholdShift: distCfg.microThresholdShift,
                },
                grassTypes,
                densityByType,
            });

            dispatched++;
        }
    }

    private applyReady(applyBudget: number, applyMs?: number): void {
        let applied = 0;
        const deadline = applyMs != null && applyMs > 0 ? performance.now() + applyMs : Number.POSITIVE_INFINITY;
        while (applied < applyBudget && this.ready.length > 0 && performance.now() < deadline) {
            const res = this.ready.shift();
            if (!res) break;

            this.debugFrame.applyResponses++;

            // If chunk is no longer needed, drop it.
            if (!this.pendingKeys.has(res.key)) {
                applied++;
                continue;
            }

            // Mark as satisfied.
            this.pendingKeys.delete(res.key);
            if (this.chunksByKey.has(res.key)) {
                applied++;
                continue;
            }

            const meshes = this.buildChunkFromWorker(res);
            if (meshes.length > 0) this.chunksByKey.set(res.key, meshes);
            this.debugFrame.applyMeshes += meshes.length;
            applied++;
        }
    }

    private buildChunkFromWorker(res: WorkerGrassChunkResponse): THREE.InstancedMesh[] {
        const created: THREE.InstancedMesh[] = [];
        if (res.results.length <= 0) return created;

        const chunkSize = MapConfig.chunkSize;
        const detailRadiusChunks = Math.max(0, MapConfig.grassDetailRadiusChunks ?? 1);
        const detailRadius = detailRadiusChunks * chunkSize;
        const ddx = res.cx - res.viewerX;
        const ddz = res.cz - res.viewerZ;
        const isNear = ddx * ddx + ddz * ddz <= detailRadius * detailRadius;

        const capNear = Math.max(0, MapConfig.grassMaxInstancesPerTypeNear ?? 3500);
        const capFar = Math.max(0, MapConfig.grassMaxInstancesPerTypeFar ?? 1000);
        const receiveShadows = (MapConfig.grassReceiveShadows ?? false) && isNear;

        for (const r of res.results) {
            const type = this.grassTypes.find((t) => t.id === r.id);
            if (!type) continue;
            const count = Math.max(0, Math.floor(r.count));
            if (count <= 0) continue;

            const capacity = this.pickInstanceCapacity(isNear ? capNear : capFar);
            const mesh = this.acquireGrassMesh({
                typeId: type.id,
                geometry: isNear ? type.geometryNear : type.geometryFar,
                material: type.material,
                capacity,
                receiveShadow: receiveShadows,
            });
            mesh.castShadow = false;
            mesh.receiveShadow = receiveShadows;

            const ud = getUserData(mesh);
            ud.isGrass = true;
            ud.chunkCenterX = res.cx;
            ud.chunkCenterZ = res.cz;
            ud.grassPositionsXZ = r.positionsXZ;
            // Used for pooling.
            (mesh.userData as any).grassTypeId = type.id;

            // Keep instanceMatrix buffer stable to avoid GPU buffer churn; only update the used range.
            const instanceTransform = mesh.geometry.getAttribute('instanceTransform') as THREE.InstancedBufferAttribute;
            (instanceTransform.array as Float32Array).set(r.transforms, 0);
            instanceTransform.clearUpdateRanges();
            instanceTransform.addUpdateRange(0, count * 4);
            instanceTransform.needsUpdate = true;

            const instanceYOffset = mesh.geometry.getAttribute('instanceYOffset') as THREE.InstancedBufferAttribute | undefined;
            if (instanceYOffset) {
                (instanceYOffset.array as Float32Array).fill(0, 0, count);
                instanceYOffset.clearUpdateRanges();
                instanceYOffset.addUpdateRange(0, count);
                instanceYOffset.needsUpdate = true;
            }
            mesh.count = count;

            // Reset per-instance cut mask for the used range.
            const instanceMask = mesh.geometry.getAttribute('instanceMask') as THREE.InstancedBufferAttribute | undefined;
            if (instanceMask) {
                (instanceMask.array as Float32Array).fill(1, 0, count);
                instanceMask.clearUpdateRanges();
                instanceMask.addUpdateRange(0, count);
                instanceMask.needsUpdate = true;
            }

            this.debugFrame.uploadedInstanceFloats += count * 4;

            // Avoid O(N) bounding-sphere computation over all instances.
            // Use a conservative chunk-sized sphere so frustum culling stays stable without hitches.
            const rY = Math.max(0, MapConfig.terrainHeight ?? 0) + 30;
            const radius = Math.sqrt(2) * (chunkSize * 0.5) + rY;
            mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(res.cx, 0, res.cz), radius);

            this.scene.add(mesh);
            created.push(mesh);
        }

        return created;
    }

    private pickInstanceCapacity(maxCap: number): number {
        // Use a stable per-band capacity (derived from config) so pool keys don't
        // fragment across many slightly different counts.
        const target = Math.max(1, Math.floor(maxCap));
        let cap = 256;
        while (cap < target) cap *= 2;
        return cap;
    }

    /**
     * Remove chunks not in the keep set.
     */
    public pruneChunks(keep: Set<number>): void {
        // Cancel pending work for chunks that are no longer needed.
        const pendingToCancel: number[] = [];
        for (const key of this.pendingKeys) {
            if (!keep.has(key)) pendingToCancel.push(key);
        }
        for (const key of pendingToCancel) this.pendingKeys.delete(key);

        // Compact pending queue so processPending doesn't repeatedly scan canceled items.
        if (pendingToCancel.length > 0 && this.pending.length > 0) {
            this.pending = this.pending.filter((p) => this.pendingKeys.has(p.key));
        }

        // Note: inflight worker tasks can't be canceled; responses will be dropped when they arrive.

        // Cancel queued deletions for chunks that became relevant again.
        if (this.deleteKeys.size > 0) {
            let changed = false;
            for (const key of keep) {
                if (this.deleteKeys.delete(key)) changed = true;
            }
            if (changed && this.deleteQueue.length > 0) {
                this.deleteQueue = this.deleteQueue.filter((k) => !keep.has(k));
            }
        }

        for (const key of this.chunksByKey.keys()) {
            if (keep.has(key)) continue;
            if (this.deleteKeys.has(key)) continue;
            this.deleteKeys.add(key);
            this.deleteQueue.push(key);
        }
    }

    private drainDeleteQueue(maxMs: number): void {
        const deadline = performance.now() + Math.max(0, maxMs);
        while (this.deleteQueue.length > 0 && performance.now() < deadline) {
            const key = this.deleteQueue.shift();
            if (key == null) continue;

            const meshes = this.chunksByKey.get(key);
            if (meshes) {
                for (const mesh of meshes) {
                    this.releaseGrassMesh(mesh);
                }
                this.chunksByKey.delete(key);
            }

            this.deleteKeys.delete(key);
        }
    }

    private acquireGrassMesh(opts: {
        typeId: string;
        geometry: THREE.BufferGeometry;
        material: THREE.Material;
        capacity: number;
        receiveShadow: boolean;
    }): THREE.InstancedMesh {
        const key = `${opts.typeId}|${opts.geometry.uuid}|${opts.material.uuid}|${opts.capacity}`;
        const pool = this.meshPool.get(key);
        const existing = pool && pool.length > 0 ? pool.pop() : undefined;
        if (existing) {
            this.debugFrame.poolHit++;
            existing.visible = true;
            existing.receiveShadow = opts.receiveShadow;
            return existing;
        }

        this.debugFrame.poolMiss++;

        return this.createGrassMesh({
            typeId: opts.typeId,
            geometry: opts.geometry,
            material: opts.material,
            capacity: opts.capacity,
            receiveShadow: opts.receiveShadow,
        });
    }

    private ensurePoolSize(opts: {
        typeId: string;
        geometry: THREE.BufferGeometry;
        material: THREE.Material;
        capacity: number;
        target: number;
    }): void {
        const key = `${opts.typeId}|${opts.geometry.uuid}|${opts.material.uuid}|${opts.capacity}`;
        const pool = this.meshPool.get(key);
        const have = pool?.length ?? 0;
        const need = Math.max(0, opts.target - have);
        if (need <= 0) return;

        const next = pool ?? [];
        for (let i = 0; i < need; i++) {
            next.push(
                this.createGrassMesh({
                    typeId: opts.typeId,
                    geometry: opts.geometry,
                    material: opts.material,
                    capacity: opts.capacity,
                    receiveShadow: false,
                })
            );
        }
        if (!pool) this.meshPool.set(key, next);
    }

    private createGrassMesh(opts: {
        typeId: string;
        geometry: THREE.BufferGeometry;
        material: THREE.Material;
        capacity: number;
        receiveShadow: boolean;
    }): THREE.InstancedMesh {
        // IMPORTANT: we need per-mesh instanced attributes (instanceTransform), so the geometry must be unique.
        // We clone once per pooled mesh to keep the attribute storage attached and stable.
        const geom = opts.geometry.clone();
        const mesh = new THREE.InstancedMesh(geom, opts.material, Math.max(1, opts.capacity));
        mesh.castShadow = false;
        mesh.receiveShadow = opts.receiveShadow;
        mesh.frustumCulled = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // Keep instanceMatrix around but do not stream matrices anymore.
        // Rendering uses instanceTransform (x,z,rotY,scale) + GPU terrain height.
        mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, opts.capacity) * 16), 16);
        mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

        const instanceTransform = new THREE.InstancedBufferAttribute(
            new Float32Array(Math.max(1, opts.capacity) * 4),
            4
        );
        instanceTransform.setUsage(THREE.DynamicDrawUsage);
        geom.setAttribute('instanceTransform', instanceTransform);

        const instanceYOffset = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, opts.capacity)), 1);
        instanceYOffset.setUsage(THREE.DynamicDrawUsage);
        geom.setAttribute('instanceYOffset', instanceYOffset);

        // Per-instance visibility mask (0..1), stored as a compact float attribute.
        const instanceMask = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, opts.capacity)).fill(1), 1);
        instanceMask.setUsage(THREE.DynamicDrawUsage);
        geom.setAttribute('instanceMask', instanceMask);

        // Used for pooling/release.
        (mesh.userData as any).grassTypeId = opts.typeId;
        (mesh.userData as any).baseGeometryUuid = opts.geometry.uuid;
        (mesh.userData as any).poolCapacity = Math.max(1, opts.capacity);
        mesh.visible = false;
        return mesh;
    }

    private releaseGrassMesh(mesh: THREE.InstancedMesh): void {
        this.scene.remove(mesh);
        mesh.visible = false;

        this.debugFrame.releaseMeshes++;

        const typeId = (mesh.userData as any).grassTypeId as string | undefined;
        const capacity =
            ((mesh.userData as any).poolCapacity as number | undefined) ??
            ((mesh.geometry.getAttribute('instanceTransform') as THREE.InstancedBufferAttribute).array.length / 4);
        const key = `${typeId ?? 'unknown'}|${(mesh.userData as any).baseGeometryUuid ?? mesh.geometry.uuid}|${(mesh.material as THREE.Material).uuid}|${capacity}`;
        const pool = this.meshPool.get(key);
        if (pool) pool.push(mesh);
        else this.meshPool.set(key, [mesh]);
    }

    private initDensities() {
        const refR = MapConfig.vegetationDensityReferenceRadius;
        const refArea = Math.max(1, Math.PI * refR * refR);
        for (const t of this.grassTypes) {
            this.grassDensityByType.set(t.id, t.baseCount / refArea);
        }
    }
    
    private initGrassTypes() {
        // Near uses model geometry (loaded async). Far stays procedural/cheap.
        const placeholderNear = new THREE.PlaneGeometry(1, 1, 1, 1);

        // 1. 高草 (Tall Grass)
        const tall = EnvironmentConfig.grass.tall;
        const tallGeoNear = placeholderNear;
        const tallGeoFar = this.createMultipleBladeGeometry(
            tall.height,
            tall.width,
            Math.max(2, Math.floor(tall.bladeCount * 0.35)),
            1
        );
        const tallMat = createGrassMaterial(new THREE.Color(tall.colorBase), new THREE.Color(tall.colorTip));
        
        this.grassTypes.push({
            id: 'tall',
            geometryNear: tallGeoNear,
            geometryFar: tallGeoFar,
            material: tallMat,
            baseCount: tall.count,
            scaleRange: tall.scale,
            colorBase: new THREE.Color(tall.colorBase),
            colorTip: new THREE.Color(tall.colorTip)
        });
        
        // 2. 灌木丛 (Shrub)
        const shrub = EnvironmentConfig.grass.shrub;
        const shrubGeoNear = placeholderNear;
        const shrubGeoFar = this.createBushGeometry(Math.max(3, Math.floor(shrub.segments * 0.5)));
        const shrubMat = createGrassMaterial(new THREE.Color(shrub.colorBase), new THREE.Color(shrub.colorTip));
        
        this.grassTypes.push({
            id: 'shrub',
            geometryNear: shrubGeoNear,
            geometryFar: shrubGeoFar,
            material: shrubMat,
            baseCount: shrub.count,
            scaleRange: shrub.scale,
            colorBase: new THREE.Color(shrub.colorBase),
            colorTip: new THREE.Color(shrub.colorTip)
        });
        
        // 3. 枯草 (Dry Grass)
        const dry = EnvironmentConfig.grass.dry;
        const dryGeoNear = placeholderNear;
        const dryGeoFar = this.createMultipleBladeGeometry(
            dry.height,
            dry.width,
            Math.max(2, Math.floor(dry.bladeCount * 0.35)),
            1
        );
        const dryMat = createGrassMaterial(new THREE.Color(dry.colorBase), new THREE.Color(dry.colorTip));
        
        this.grassTypes.push({
            id: 'dry',
            geometryNear: dryGeoNear,
            geometryFar: dryGeoFar,
            material: dryMat,
            baseCount: dry.count,
            scaleRange: dry.scale,
            colorBase: new THREE.Color(dry.colorBase),
            colorTip: new THREE.Color(dry.colorTip)
        });
    }

    /**
     * 放置草丛 (Chunked)
     */
    public placeGrass(
        mapSize: number, 
        getHeightAt: (x: number, z: number) => number,
        excludeAreas: Array<{ x: number; z: number; radius: number }> = GrassSystem.EXCLUDE_AREA_DEFAULT
    ) {
        this.dispose();

        const chunkSize = MapConfig.chunkSize;
        const chunksPerRow = Math.ceil(mapSize / chunkSize);
        const halfSize = mapSize / 2;
        
        // 配置中的 count 代表“全图总量”（小地图时代的经验值）。
        // 在大地图 + Chunk 方案下，如果仍按“每 chunk”生成会导致实例数爆炸。
        // 这里将总量按有效 chunk 数均摊，保证视觉密度合理且性能可控。
        const countMultiplier = 1.0;

        // 性能优化：严格限制生成范围，仅在岛屿上生成
        const maxGrassDist = MapConfig.boundaryRadius + 50;
        const maxGrassDistSq = (maxGrassDist + chunkSize / 2) * (maxGrassDist + chunkSize / 2);

        // Low-frequency macro noise (0..1) to create natural "patches": dense areas + sparse clearings.
        const hash2 = (x: number, z: number) => {
            const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
            return s - Math.floor(s);
        };
        const macroNoise = (x: number, z: number) => {
            const s1 = 0.0012;
            const s2 = 0.0027;
            const s3 = 0.006;
            let n = 0;
            n += (Math.sin(x * s1) * Math.sin(z * s1) + 1) * 0.5;
            n += (Math.sin(x * s2 + 1.7) * Math.sin(z * s2 + 2.1) + 1) * 0.5 * 0.6;
            n += (Math.sin(x * s3 + 3.9) * Math.sin(z * s3 + 4.2) + 1) * 0.5 * 0.25;
            // jitter to break symmetry
            n = n * 0.85 + hash2(x * 0.2, z * 0.2) * 0.15;
            return Math.min(1, Math.max(0, n / (1 + 0.6 + 0.25)));
        };

        // 预先计算有效 chunks（中心点在岛屿范围内）+ 权重（用于非均匀分布）
        const activeChunks: Array<{ cx: number; cz: number; weight: number }> = [];
        let weightSum = 0;

        const distCfg = EnvironmentConfig.grass.distribution;
        const wCfg = distCfg.macroWeight;
        const shoreCfg = distCfg.shoreFade;
        for (let x = 0; x < chunksPerRow; x++) {
            for (let z = 0; z < chunksPerRow; z++) {
                const chunkCX = (x * chunkSize) - halfSize + chunkSize / 2;
                const chunkCZ = (z * chunkSize) - halfSize + chunkSize / 2;
                if (chunkCX * chunkCX + chunkCZ * chunkCZ <= maxGrassDistSq) {
                    const d = Math.sqrt(chunkCX * chunkCX + chunkCZ * chunkCZ);
                    // slightly reduce density near shoreline to create more believable gradients
                    const shoreFade = Math.min(1, Math.max(0, 1 - (d - shoreCfg.startDistance) / Math.max(1, (MapConfig.boundaryRadius - shoreCfg.startDistance))));
                    const m = macroNoise(chunkCX, chunkCZ);
                    // Strong contrast: push most instances into dense patches (forest-floor look).
                    // This does NOT increase total counts; it reallocates the budget across chunks.
                    const w = (wCfg.base + Math.pow(m, wCfg.exponent) * wCfg.amplitude) * (shoreCfg.min + shoreCfg.max * shoreFade);
                    activeChunks.push({ cx: chunkCX, cz: chunkCZ, weight: w });
                    weightSum += w;
                }
            }
        }

        const activeChunkCount = Math.max(1, activeChunks.length);
        console.log(
            `Generating Grass: Map=${mapSize}, Chunk=${chunkSize}, ActiveChunks=${activeChunkCount}, Multiplier=${countMultiplier}`
        );

        // 计算每个 chunk 的目标数量：按 macro 权重分配（非均匀），同时尽量保持总量不变。
        // perChunkCountsByChunk[i] = Map<typeId, count>
        const perChunkCountsByChunk: Array<Map<string, number>> = [];
        const totalsByType = new Map<string, number>();
        for (const type of this.grassTypes) {
            totalsByType.set(type.id, Math.max(0, Math.floor(type.baseCount * countMultiplier)));
        }

        for (let i = 0; i < activeChunks.length; i++) {
            perChunkCountsByChunk.push(new Map());
        }

        for (const type of this.grassTypes) {
            const total = totalsByType.get(type.id) ?? 0;
            if (total <= 0) continue;

            // First pass: floor allocation
            let allocated = 0;
            const remainders: Array<{ i: number; frac: number }> = [];
            for (let i = 0; i < activeChunks.length; i++) {
                const exact = (total * (activeChunks[i].weight / Math.max(1e-6, weightSum)));
                const flo = Math.max(0, Math.floor(exact));
                perChunkCountsByChunk[i].set(type.id, flo);
                allocated += flo;
                remainders.push({ i, frac: exact - flo });
            }

            // Second pass: distribute remainder to highest fractional weights
            let remaining = total - allocated;
            remainders.sort((a, b) => b.frac - a.frac);
            for (let k = 0; k < remainders.length && remaining > 0; k++) {
                const idx = remainders[k].i;
                perChunkCountsByChunk[idx].set(type.id, (perChunkCountsByChunk[idx].get(type.id) ?? 0) + 1);
                remaining--;
            }
        }

        for (let i = 0; i < activeChunks.length; i++) {
            const c = activeChunks[i];
            const m = macroNoise(c.cx, c.cz);
            // 0..1 with extra emphasis on the top end.
            const dfCfg = distCfg.denseFactor;
            const denseFactor = Math.pow(
                Math.min(1, Math.max(0, (m - dfCfg.start) / Math.max(1e-6, dfCfg.range))),
                dfCfg.power
            );
            this.generateChunkLegacy(c.cx, c.cz, chunkSize, perChunkCountsByChunk[i], getHeightAt, excludeAreas, denseFactor);
        }
    }
    
    private generateChunkLegacy(
        cx: number, cz: number, size: number, 
        perChunkCounts: Map<string, number>,
        getHeightAt: (x: number, z: number) => number,
        excludeAreas: Array<{ x: number; z: number; radius: number }>,
        denseFactor: number = 0
    ) {
        // Legacy full-map generation path (non-deterministic).
        const created = this.generateChunkWithRng(cx, cz, size, perChunkCounts, getHeightAt, excludeAreas, denseFactor, Math.random, true);
        for (const mesh of created) {
            this.chunkMeshesLegacy.push(mesh);
        }
    }

    private generateChunkStreamed(
        cx: number,
        cz: number,
        size: number,
        getHeightAt: (x: number, z: number) => number,
        excludeAreas: Array<{ x: number; z: number; radius: number }>,
        rand: RandomFn,
        viewerX: number,
        viewerZ: number,
    ): THREE.InstancedMesh[] {
        // Only generate within island bounds.
        const maxGrassDist = MapConfig.boundaryRadius + 50;
        const maxGrassDistSq = (maxGrassDist + size / 2) * (maxGrassDist + size / 2);
        if (cx * cx + cz * cz > maxGrassDistSq) return [];

        const distCfg = EnvironmentConfig.grass.distribution;
        const wCfg = distCfg.macroWeight;
        const dfCfg = distCfg.denseFactor;
        const shoreCfg = distCfg.shoreFade;

        const hash2 = (x: number, z: number) => {
            const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
            return s - Math.floor(s);
        };
        const macroNoise = (x: number, z: number) => {
            const s1 = 0.0012;
            const s2 = 0.0027;
            const s3 = 0.006;
            let n = 0;
            n += (Math.sin(x * s1) * Math.sin(z * s1) + 1) * 0.5;
            n += (Math.sin(x * s2 + 1.7) * Math.sin(z * s2 + 2.1) + 1) * 0.5 * 0.6;
            n += (Math.sin(x * s3 + 3.9) * Math.sin(z * s3 + 4.2) + 1) * 0.5 * 0.25;
            n = n * 0.85 + hash2(x * 0.2, z * 0.2) * 0.15;
            return Math.min(1, Math.max(0, n / (1 + 0.6 + 0.25)));
        };

        const m = macroNoise(cx, cz);
        const patchRaw = wCfg.base + Math.pow(m, wCfg.exponent) * wCfg.amplitude;
        const patchNorm = patchRaw / Math.max(1e-6, (wCfg.base + wCfg.amplitude));

        const d = Math.sqrt(cx * cx + cz * cz);
        const shoreFade = Math.min(
            1,
            Math.max(0, 1 - (d - shoreCfg.startDistance) / Math.max(1, (MapConfig.boundaryRadius - shoreCfg.startDistance)))
        );
        const localMultiplier = (0.35 + 1.35 * patchNorm) * (shoreCfg.min + shoreCfg.max * shoreFade);

        const denseFactor = Math.pow(
            Math.min(1, Math.max(0, (m - dfCfg.start) / Math.max(1e-6, dfCfg.range))),
            dfCfg.power
        );

        // LOD: far chunks get cheaper geometry + fewer instances to avoid GPU overdraw/triangle explosions.
        const detailRadiusChunks = Math.max(0, MapConfig.grassDetailRadiusChunks ?? 1);
        const farDensityMul = Math.min(1, Math.max(0, MapConfig.grassFarDensityMultiplier ?? 0.35));
        const ddx = cx - viewerX;
        const ddz = cz - viewerZ;
        const distSq = ddx * ddx + ddz * ddz;
        const detailRadius = detailRadiusChunks * size;
        const isNear = distSq <= detailRadius * detailRadius;
        const lodDensityMul = isNear ? 1.0 : farDensityMul;

        const chunkArea = size * size;
        const perChunkCounts = new Map<string, number>();
        const densityScale = Math.max(0, MapConfig.grassDensityScale ?? 1.0);
        const maxNear = Math.max(0, MapConfig.grassMaxInstancesPerTypeNear ?? 3500);
        const maxFar = Math.max(0, MapConfig.grassMaxInstancesPerTypeFar ?? 1000);
        const maxPerType = isNear ? maxNear : maxFar;
        for (const type of this.grassTypes) {
            const density = this.grassDensityByType.get(type.id) ?? 0;
            const base = Math.floor(density * chunkArea);
            const target = Math.max(0, Math.floor(base * localMultiplier * lodDensityMul * densityScale));
            perChunkCounts.set(type.id, Math.min(maxPerType, target));
        }

        return this.generateChunkWithRng(cx, cz, size, perChunkCounts, getHeightAt, excludeAreas, denseFactor, rand, isNear);
    }

    private generateChunkWithRng(
        cx: number,
        cz: number,
        size: number,
        perChunkCounts: Map<string, number>,
        getHeightAt: (x: number, z: number) => number,
        excludeAreas: Array<{ x: number; z: number; radius: number }>,
        denseFactor: number,
        rand: RandomFn,
        isNear: boolean,
    ): THREE.InstancedMesh[] {
        const created: THREE.InstancedMesh[] = [];

        // 对每种草类型生成一个 Mesh
        this.grassTypes.forEach(type => {
            const targetCount = perChunkCounts.get(type.id) ?? 0;
            if (targetCount <= 0) return;

            // 由于噪声/排除区/水位会剔除大量候选点，如果仅尝试 targetCount 次会导致实际生成很稀疏。
            // 这里对候选点做 oversample，并在达到目标数量后提前停止。
            const oversample = isNear ? 3.0 : 2.0;
            const attemptCount = Math.max(targetCount, Math.floor(targetCount * oversample));

            const baseGeo = isNear ? type.geometryNear : type.geometryFar;
            const geom = baseGeo.clone();
            const mesh = new THREE.InstancedMesh(geom, type.material, attemptCount);
            // 草投射阴影代价很大（尤其在 WebGPU 阴影 pass），且视觉收益有限。
            // 保留 receiveShadow 让草与环境融合，但禁用 castShadow。
            mesh.castShadow = false;
            mesh.receiveShadow = (MapConfig.grassReceiveShadows ?? false) && isNear;
            // 标记 + 位置缓存（用于近战/镰刀快速割草，避免昂贵的 InstancedMesh raycast）
            // grassPositionsXZ: [x,z] * instanceCount (world space)
            const grassPositionsXZ = new Float32Array(attemptCount * 2);

            const instanceTransform = new THREE.InstancedBufferAttribute(new Float32Array(attemptCount * 4), 4);
            instanceTransform.setUsage(THREE.DynamicDrawUsage);
            geom.setAttribute('instanceTransform', instanceTransform);

            const instanceYOffset = new THREE.InstancedBufferAttribute(new Float32Array(attemptCount), 1);
            instanceYOffset.setUsage(THREE.DynamicDrawUsage);
            geom.setAttribute('instanceYOffset', instanceYOffset);

            // Per-instance visibility mask.
            const instanceMask = new THREE.InstancedBufferAttribute(new Float32Array(attemptCount).fill(1), 1);
            instanceMask.setUsage(THREE.DynamicDrawUsage);
            geom.setAttribute('instanceMask', instanceMask);
            const ud = getUserData(mesh);
            ud.isGrass = true;
            ud.grassPositionsXZ = grassPositionsXZ;
            ud.chunkCenterX = cx;
            ud.chunkCenterZ = cz;
            
            let validCount = 0;
            
            // 预先缓存噪声参数以减少对象访问开销
            const noiseScale = EnvironmentConfig.grass.noise.scale;
            const noiseThreshold = EnvironmentConfig.grass.noise.threshold;
            // Dense chunks accept more candidates; sparse chunks accept fewer.
            // Keeps total budget stable (counts are allocated above), but increases visual contrast.
            const tCfg = EnvironmentConfig.grass.distribution.microThresholdShift;
            const thresholdShift = (1 - denseFactor) * tCfg.sparseBoost - denseFactor * tCfg.denseReduce;
            const effectiveThreshold = Math.min(0.98, Math.max(0.02, noiseThreshold + thresholdShift));
            
            for (let i = 0; i < attemptCount; i++) {
                const rx = (rand() - 0.5) * size;
                const rz = (rand() - 0.5) * size;
                const wx = cx + rx;
                const wz = cz + rz;

                // --- 1. 密度噪声剔除 (Clustering) ---
                // 使用简单的正弦波叠加模拟噪声 (必须快速)
                // 不同类型的草可以使用稍微不同的偏移，避免所有草长在完全一样的位置
                const typeOffset = type.id === 'dry' ? 100 : 0;
                let n = Math.sin((wx + typeOffset) * noiseScale) * Math.sin((wz + typeOffset) * noiseScale);
                n += Math.sin(wx * noiseScale * 2.3) * Math.sin(wz * noiseScale * 2.3) * 0.5;
                // 归一化后剔除
                if (((n/1.5 + 1) * 0.5) < effectiveThreshold + (rand() * 0.15 - 0.075)) {
                    continue;
                }
                
                // 排除检查
                 // 检查排除区域 (稍微宽松一点，草可以靠近一点路)
                 let valid = true;
                 for (const area of excludeAreas) {
                     const dx = wx - area.x;
                     const dz = wz - area.z;
                     if (dx * dx + dz * dz < (area.radius * 0.8) ** 2) {
                         valid = false;
                         break;
                     }
                 }
                 if (!valid) continue;
                 
                 const y = getHeightAt(wx, wz);
                 // 水位检查
                 if (y < EnvironmentConfig.water.level + 0.5) continue;

                 // cache world-space position for fast queries
                 const pi = validCount * 2;
                 grassPositionsXZ[pi] = wx;
                 grassPositionsXZ[pi + 1] = wz;
                 
                 this.dummy.position.set(wx, y, wz);
                 this.dummy.rotation.set(0, rand() * Math.PI * 2, 0);
                 
                 const s = type.scaleRange.min + rand() * (type.scaleRange.max - type.scaleRange.min);
                 this.dummy.scale.set(s, s, s);
                 const rotY = this.dummy.rotation.y;

                 const ti = validCount * 4;
                 (instanceTransform.array as Float32Array)[ti] = wx;
                 (instanceTransform.array as Float32Array)[ti + 1] = wz;
                 (instanceTransform.array as Float32Array)[ti + 2] = rotY;
                 (instanceTransform.array as Float32Array)[ti + 3] = s;
                 validCount++;

                 // 达到目标密度就停止，避免无意义的额外采样
                 if (validCount >= targetCount) break;
            }
            
            if (validCount > 0) {
                mesh.count = validCount;

                instanceTransform.clearUpdateRanges();
                instanceTransform.addUpdateRange(0, validCount * 4);
                instanceTransform.needsUpdate = true;

                instanceYOffset.clearUpdateRanges();
                instanceYOffset.addUpdateRange(0, validCount);
                instanceYOffset.needsUpdate = true;

                const instanceMask = mesh.geometry.getAttribute('instanceMask') as THREE.InstancedBufferAttribute | undefined;
                if (instanceMask) {
                    (instanceMask.array as Float32Array).fill(1, 0, validCount);
                    instanceMask.setUsage(THREE.DynamicDrawUsage);
                    instanceMask.clearUpdateRanges();
                    instanceMask.addUpdateRange(0, validCount);
                    instanceMask.needsUpdate = true;
                }

                // shrink cached positions to valid range
                mesh.userData.grassPositionsXZ = (mesh.userData.grassPositionsXZ as Float32Array).subarray(0, validCount * 2);
                
                // Culling
                mesh.computeBoundingSphere();
                
                this.scene.add(mesh);
                created.push(mesh);
            } else {
                mesh.dispose();
            }
        });

        return created;
    }
    
    public dispose() {
        // streamed
        const keys = Array.from(this.chunksByKey.keys());
        for (const key of keys) {
            const meshes = this.chunksByKey.get(key);
            if (!meshes) continue;
            for (const mesh of meshes) {
                this.scene.remove(mesh);
                mesh.dispose();
            }
            this.chunksByKey.delete(key);
        }

        // pooled
        for (const pool of this.meshPool.values()) {
            for (const mesh of pool) {
                this.scene.remove(mesh);
                mesh.dispose();
            }
        }
        this.meshPool.clear();

        // legacy
        for (const m of this.chunkMeshesLegacy) {
            this.scene.remove(m);
            m.dispose();
        }
        this.chunkMeshesLegacy = [];
    }

    /**
     * 生成复杂的单株草丛几何体 (由多根草叶组成)
     */
    private createMultipleBladeGeometry(height: number, width: number, bladeCount: number, heightSegments: number = 4): THREE.BufferGeometry {
        const geometries: THREE.BufferGeometry[] = [];
        
        for (let i = 0; i < bladeCount; i++) {
            // 每根草叶高度稍微随机
            const h = height * (0.8 + Math.random() * 0.4);
            
            // 使用细分平面作为草叶，方便风吹弯曲
            // widthSegments=1, heightSegments=heightSegments
            // 修正：确保顶部在 +y
            const geometry = new THREE.PlaneGeometry(width, h, 1, Math.max(1, Math.floor(heightSegments)));
            
            // 底部对齐 (PlaneGeometry 默认中心在 0,0,0)
            geometry.translate(0, h / 2, 0); 
            
            // 顶点操作：顶部变窄 + 弯曲
            const pos = geometry.attributes.position;
            for(let j=0; j<pos.count; j++) {
                const y = pos.getY(j);
                const t = y / h; // 0 (bottom) to 1 (top)
                
                // 宽度收缩
                const x = pos.getX(j);
                const scale = 1.0 - Math.pow(t, 2) * 0.9;
                pos.setX(j, x * scale);
                
                // 向后弯曲
                const curve = Math.pow(t, 2) * 0.2; 
                pos.setZ(j, pos.getZ(j) - curve);
            }
            geometry.computeVertexNormals();
            
            // 随机向外倾斜
            const tilt = Math.random() * 0.3 + 0.1; 
            geometry.rotateX(tilt); 
            
            // 随机偏移中心
            const offset = 0.1;
            geometry.translate(
                (Math.random() - 0.5) * offset,
                0,
                (Math.random() - 0.5) * offset
            );
            
            // 旋转分布
            const angle = (i / bladeCount) * Math.PI * 2 + (Math.random() - 0.5);
            geometry.rotateY(angle);
            
            geometries.push(geometry);
        }
        
        return this.mergeGeometries(geometries);
    }

    /**
     * 生成灌木几何体 (多个小平面球状分布)
     */
    private createBushGeometry(segments: number = 8): THREE.BufferGeometry {
        const geometries: THREE.BufferGeometry[] = [];
        const config = EnvironmentConfig.grass.shrub;
        const count = Math.max(3, Math.floor(segments));
        
        for (let i = 0; i < count; i++) {
            const w = config.width ?? 0.8;
            const h = config.height ?? 0.7;
            const geo = new THREE.PlaneGeometry(w, h, 1, 2);
            geo.translate(0, h/2, 0);
            
            // 随机旋转
            geo.rotateY((Math.PI * 2 * i) / count + Math.random() * 0.5);
            geo.rotateX((Math.random() - 0.5) * 0.5); 
            
            // 随机中心偏移
            geo.translate(
                 (Math.random() - 0.5) * 0.3,
                 (Math.random() - 0.5) * 0.1,
                 (Math.random() - 0.5) * 0.3
            );
            
            geometries.push(geo);
        }
        return this.mergeGeometries(geometries);
    }
    
    private mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        let offset = 0;
        
        geos.forEach(g => {
            const pos = g.attributes.position;
            const norm = g.attributes.normal;
            const uv = g.attributes.uv;
            const idx = g.index;
            
            for(let i=0; i<pos.count; i++) {
                positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
                normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
                uvs.push(uv.getX(i), uv.getY(i));
            }
            
            if(idx) {
                for(let i=0; i<idx.count; i++) {
                    indices.push(idx.getX(i) + offset);
                }
            } else {
                for(let i=0; i<pos.count; i++) indices.push(i + offset);
            }
            offset += pos.count;
        });
        
        const res = new THREE.BufferGeometry();
        res.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        res.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        res.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        res.setIndex(indices);
        return res;
    }
}
