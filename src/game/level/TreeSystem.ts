import * as THREE from 'three';
import { createTrunkMaterial, createLeavesMaterial } from '../shaders/TreeTSL';
import { EnvironmentConfig, MapConfig, TreeType } from '../core/GameConfig';
import { getUserData } from '../types/GameUserData';
import { hash2iToU32, mulberry32, packChunkKey, type RandomFn } from '../core/util/SeededRandom';

type WorkerTreeTypeResult = {
    type: TreeType;
    count: number;
    transforms: Float32Array;
    positionsXZ: Float32Array;
};

type WorkerTreeChunkResponse = {
    kind: 'trees';
    requestId: number;
    key: number;
    cx: number;
    cz: number;
    results: WorkerTreeTypeResult[];
};

interface TreeDefinition {
    type: TreeType;
    trunkGeo: THREE.BufferGeometry;
    leavesGeo: THREE.BufferGeometry;
    trunkMat: ReturnType<typeof createTrunkMaterial>;
    leavesMat: ReturnType<typeof createLeavesMaterial>;
    probability: number;
    scaleRange: { min: number, max: number };
}

type TreeGeometryConfig = (typeof EnvironmentConfig.trees.types)[number]['geometry'];

type ExcludeArea = { x: number; z: number; radius: number };

/**
 * 树木系统 - 管理多种树木的生成和渲染
 * 使用 Chunk (分块) + InstancedMesh 进行性能优化
 */
export class TreeSystem {
    private scene: THREE.Scene;
    // Streaming chunks keyed by packed chunk coords.
    private chunksByKey: Map<number, Array<{ trunk: THREE.InstancedMesh; leaves: THREE.InstancedMesh }>> = new Map();

    // Chunk generation can be expensive; amortize work across frames.
    private pending: Array<{ key: number; cx: number; cz: number; getHeightAt: (x: number, z: number) => number; excludeAreas: ExcludeArea[] }> = [];
    private pendingKeys = new Set<number>();

    private worker: Worker | null = null;
    private nextRequestId = 1;
    private readonly requestIdToKey = new Map<number, number>();
    private readonly inflight = new Set<number>();
    private readonly ready: WorkerTreeChunkResponse[] = [];

    // Chunk removal can be expensive (scene graph + GPU buffer cleanup). Drain incrementally to avoid hitches.
    private deleteQueue: number[] = [];
    private readonly deleteKeys = new Set<number>();

    // Reuse InstancedMesh objects to avoid WebGPU buffer allocation/free stalls during streaming.
    // Pool keys are per tree type + capacity.
    private readonly meshPool = new Map<string, Array<{ trunk: THREE.InstancedMesh; leaves: THREE.InstancedMesh }>>();

    private debugFrame = {
        applyResponses: 0,
        applyPairs: 0,
        releasePairs: 0,
        poolHit: 0,
        poolMiss: 0,
        uploadedInstanceFloats: 0,
    };

    public getHitchDebugCounters(): Record<string, number> {
        return {
            pending: this.pendingKeys.size,
            loadedChunks: this.chunksByKey.size,
            ready: this.ready.length,
            inflight: this.inflight.size,
            deleteQueue: this.deleteQueue.length,
            applyResponses: this.debugFrame.applyResponses,
            applyPairs: this.debugFrame.applyPairs,
            releasePairs: this.debugFrame.releasePairs,
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

    public prewarmPool(opts?: { perTypePairs?: number }): void {
        const perTypePairs = Math.max(0, Math.floor(opts?.perTypePairs ?? 0));
        if (perTypePairs <= 0) return;

        const fixedCap = Math.max(1, Math.floor(MapConfig.treeMaxInstancesPerChunkPerType ?? 256));
        for (const def of this.definitions) {
            const key = this.poolKey(def.type, fixedCap);
            const pool = this.meshPool.get(key);
            const have = pool?.length ?? 0;
            const need = perTypePairs - have;
            if (need <= 0) continue;

            const target = pool ?? [];
            for (let i = 0; i < need; i++) {
                target.push(this.createTreeMeshPair(def, fixedCap));
            }
            if (!pool) this.meshPool.set(key, target);
        }
    }
    
    // 用于坐标转换的辅助对象
    private dummy = new THREE.Object3D();
    
    private definitions: TreeDefinition[] = [];

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.initTreeDefinitions();
    }

    private initTreeDefinitions() {
        // 从配置中获取定义
        const configs = EnvironmentConfig.trees.types;
        
        // --- 1. 松树 (Pine) ---
        const pineConfig = configs.find(c => c.type === TreeType.Pine)!;
        
        // 树干需适配新的细树冠
        // 树干高度约占总高度的 40%
        const pineTrunkHei = pineConfig.geometry.height * 0.45;
        // 半径大幅减小: 顶部 0.1, 底部 0.25 (配合 baseRadius 0.8)
        const pineTrunkGeo = new THREE.CylinderGeometry(0.1, 0.25, pineTrunkHei, 7);
        pineTrunkGeo.translate(0, pineTrunkHei / 2, 0); 
        
        const pineLeavesGeo = this.createPineLeavesGeometry(pineConfig.geometry, pineTrunkHei);
        
        this.definitions.push({
            type: TreeType.Pine,
            trunkGeo: pineTrunkGeo,
            leavesGeo: pineLeavesGeo,
            trunkMat: createTrunkMaterial(new THREE.Color(pineConfig.colors.trunk)),
            leavesMat: createLeavesMaterial(new THREE.Color(pineConfig.colors.leavesDeep), new THREE.Color(pineConfig.colors.leavesLight)), 
            probability: pineConfig.probability,
            scaleRange: pineConfig.scale
        });
        
        // --- 2. 橡树 (Oak) ---
        const oakConfig = configs.find(c => c.type === TreeType.Oak)!;
        const oakHeight = oakConfig.geometry.height || 5.0;

        // 粗短树干，适度变细
        const oakTrunkHei = oakHeight * 0.6; 
        // 半径适配小树冠: 0.15 -> 0.3
        const oakTrunkGeo = new THREE.CylinderGeometry(0.15, 0.3, oakTrunkHei, 8);
        oakTrunkGeo.translate(0, oakTrunkHei / 2, 0);
        
        const oakLeavesGeo = this.createOakLeavesGeometry(oakConfig.geometry, oakTrunkHei);
        
        this.definitions.push({
            type: TreeType.Oak,
            trunkGeo: oakTrunkGeo,
            leavesGeo: oakLeavesGeo,
            trunkMat: createTrunkMaterial(new THREE.Color(oakConfig.colors.trunk)),
            leavesMat: createLeavesMaterial(new THREE.Color(oakConfig.colors.leavesDeep), new THREE.Color(oakConfig.colors.leavesLight)), 
            probability: oakConfig.probability,
            scaleRange: oakConfig.scale 
        });

        // --- 3. 白桦 (Birch) ---
        const birchConfig = configs.find(c => c.type === TreeType.Birch)!;
        const birchHeight = birchConfig.geometry.height || 7.0;

        // 细高树干
        const birchTrunkHei = birchHeight * 0.8; 
        // 极细风格: 0.05 -> 0.12
        const birchTrunkGeo = new THREE.CylinderGeometry(0.05, 0.12, birchTrunkHei, 6);
        birchTrunkGeo.translate(0, birchTrunkHei / 2, 0);
        
        const birchLeavesGeo = this.createBirchLeavesGeometry(birchConfig.geometry, birchTrunkHei);
        
        this.definitions.push({
            type: TreeType.Birch,
            trunkGeo: birchTrunkGeo,
            leavesGeo: birchLeavesGeo,
            trunkMat: createTrunkMaterial(new THREE.Color(birchConfig.colors.trunk)),
            leavesMat: createLeavesMaterial(new THREE.Color(birchConfig.colors.leavesDeep), new THREE.Color(birchConfig.colors.leavesLight)), 
            probability: birchConfig.probability,
            scaleRange: birchConfig.scale 
        });

        // No per-type chunk arrays needed anymore; we stream chunks keyed by coordinate.
    }

    /**
     * Ensure a chunk exists for the given chunk center (world-space, meters).
     * Generation is deterministic per chunk via MapConfig.worldSeed.
     */
    public ensureChunk(
        cx: number,
        cz: number,
        getHeightAt: (x: number, z: number) => number,
        excludeAreas: ExcludeArea[] = [],
    ): void {
        // Legacy API: ensure the chunk is scheduled. Actual generation is amortized via processPending.
        this.requestChunk(cx, cz, getHeightAt, excludeAreas);
    }

    /**
     * Queue a chunk for generation (deduped). Actual work is done by processPending.
     */
    public requestChunk(
        cx: number,
        cz: number,
        getHeightAt: (x: number, z: number) => number,
        excludeAreas: ExcludeArea[] = [],
    ): void {
        const chunkSize = MapConfig.chunkSize;
        const ix = Math.round(cx / chunkSize);
        const iz = Math.round(cz / chunkSize);
        const key = packChunkKey(ix, iz);
        if (this.chunksByKey.has(key)) return;
        if (this.pendingKeys.has(key)) return;
        this.pendingKeys.add(key);
        this.pending.push({ key, cx, cz, getHeightAt, excludeAreas });
    }

    /**
     * Execute up to maxChunks queued chunk generations.
     * Call this every frame with a small budget to avoid hitches.
     */
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
        this.debugFrame.applyResponses = 0;
        this.debugFrame.applyPairs = 0;
        this.debugFrame.releasePairs = 0;
        this.debugFrame.poolHit = 0;
        this.debugFrame.poolMiss = 0;
        this.debugFrame.uploadedInstanceFloats = 0;

        const budget = Math.max(0, Math.floor(maxChunks));

        const deleteMs = Math.max(0, opts?.deleteMs ?? 0);
        if (deleteMs > 0) this.drainDeleteQueue(deleteMs);

        if (budget <= 0) {
            // Allow callers to only drain deletions.
            return;
        }

        this.ensureWorker();
        if (this.worker) {
            this.dispatchToWorker(Math.max(1, budget));
            this.applyReady(Math.max(1, budget), opts?.applyMs);
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
            if (!this.pendingKeys.has(item.key)) continue; // pruned while pending
            this.pendingKeys.delete(item.key);
            if (this.chunksByKey.has(item.key)) continue;

            const ix = Math.round(item.cx / chunkSize);
            const iz = Math.round(item.cz / chunkSize);
            const seedU32 = hash2iToU32(ix, iz, MapConfig.worldSeed);
            const rng = mulberry32(seedU32);

            const meshes = this.generateChunk(item.cx, item.cz, chunkSize, item.getHeightAt, item.excludeAreas, rng);
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
            this.worker.onmessage = (ev: MessageEvent<WorkerTreeChunkResponse>) => {
                const msg = ev.data;
                if (!msg || msg.kind !== 'trees') return;
                const key = this.requestIdToKey.get(msg.requestId);
                if (key == null) return;
                this.requestIdToKey.delete(msg.requestId);
                this.inflight.delete(key);
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
            this.inflight.add(item.key);

            const ix = Math.round(item.cx / chunkSize);
            const iz = Math.round(item.cz / chunkSize);
            const seedU32 = hash2iToU32(ix, iz, MapConfig.worldSeed);
            const requestId = this.nextRequestId++;
            this.requestIdToKey.set(requestId, item.key);

            const tCfg = EnvironmentConfig.trees;
            const distCfg = tCfg.distribution;

            const types = this.definitions.map((d) => ({
                type: d.type as 0 | 1 | 2,
                probability: d.probability,
                scaleMin: d.scaleRange.min,
                scaleMax: d.scaleRange.max,
            }));

            this.worker?.postMessage({
                kind: 'trees',
                requestId,
                key: item.key,
                cx: item.cx,
                cz: item.cz,
                size: chunkSize,
                seedU32,
                excludeAreas: item.excludeAreas,
                minAltitude: tCfg.placement.minAltitude,
                noise: tCfg.noise,
                distribution: {
                    macroWeight: distCfg.macroWeight,
                    denseFactor: distCfg.denseFactor,
                    shoreFade: distCfg.shoreFade,
                    microThresholdShift: distCfg.microThresholdShift,
                },
                density: tCfg.density,
                types,
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

            if (!this.pendingKeys.has(res.key)) {
                applied++;
                continue;
            }

            this.pendingKeys.delete(res.key);
            if (this.chunksByKey.has(res.key)) {
                applied++;
                continue;
            }

            const meshes = this.buildChunkFromWorker(res);
            if (meshes.length > 0) this.chunksByKey.set(res.key, meshes);
            this.debugFrame.applyPairs += meshes.length;
            applied++;
        }
    }

    private buildChunkFromWorker(res: WorkerTreeChunkResponse): Array<{ trunk: THREE.InstancedMesh; leaves: THREE.InstancedMesh }> {
        const created: Array<{ trunk: THREE.InstancedMesh; leaves: THREE.InstancedMesh }> = [];
        if (res.results.length <= 0) return created;

        const chunkSize = MapConfig.chunkSize;
        const rY = Math.max(0, MapConfig.terrainHeight ?? 0) + 80;
        const radius = Math.sqrt(2) * (chunkSize * 0.5) + rY;
        const chunkSphere = new THREE.Sphere(new THREE.Vector3(res.cx, 0, res.cz), radius);

        for (const r of res.results) {
            const def = this.definitions.find((d) => d.type === r.type);
            if (!def) continue;
            const count = Math.max(0, Math.floor(r.count));
            if (count <= 0) continue;

            const pair = this.acquireTreeMeshes(def, count);
            const trunkMesh = pair.trunk;
            const leavesMesh = pair.leaves;

            // Positions are shared for trunk/leaves for melee interactions.
            const positionsXZ = r.positionsXZ;

            {
                const ud = getUserData(trunkMesh);
                ud.isTree = true;
                ud.treeType = def.type;
                ud.treePart = 'trunk';
                ud.pairedMesh = leavesMesh;
                ud.treePositionsXZ = positionsXZ;
            }
            {
                const ud = getUserData(leavesMesh);
                ud.isTree = true;
                ud.treeType = def.type;
                ud.treePart = 'leaves';
                ud.pairedMesh = trunkMesh;
                ud.treePositionsXZ = positionsXZ;
            }

            trunkMesh.castShadow = true;
            trunkMesh.receiveShadow = true;
            leavesMesh.castShadow = count <= EnvironmentConfig.trees.distribution.leafShadowCutoff;
            leavesMesh.receiveShadow = true;

            // Keep instanceMatrix buffers stable to avoid GPU buffer churn; only update the used range.
            const trunkTransform = trunkMesh.geometry.getAttribute('instanceTransform') as THREE.InstancedBufferAttribute;
            (trunkTransform.array as Float32Array).set(r.transforms, 0);
            trunkTransform.clearUpdateRanges();
            trunkTransform.addUpdateRange(0, count * 4);
            trunkTransform.needsUpdate = true;

            const trunkYOffset = trunkMesh.geometry.getAttribute('instanceYOffset') as THREE.InstancedBufferAttribute | undefined;
            if (trunkYOffset) {
                (trunkYOffset.array as Float32Array).fill(0, 0, count);
                trunkYOffset.clearUpdateRanges();
                trunkYOffset.addUpdateRange(0, count);
                trunkYOffset.needsUpdate = true;
            }

            const trunkMask = trunkMesh.geometry.getAttribute('instanceMask') as THREE.InstancedBufferAttribute | undefined;
            if (trunkMask) {
                (trunkMask.array as Float32Array).fill(1, 0, count);
                trunkMask.clearUpdateRanges();
                trunkMask.addUpdateRange(0, count);
                trunkMask.needsUpdate = true;
            }

            this.debugFrame.uploadedInstanceFloats += count * 4;

            const leavesTransform = leavesMesh.geometry.getAttribute('instanceTransform') as THREE.InstancedBufferAttribute;
            (leavesTransform.array as Float32Array).set(r.transforms, 0);
            leavesTransform.clearUpdateRanges();
            leavesTransform.addUpdateRange(0, count * 4);
            leavesTransform.needsUpdate = true;

            const leavesYOffset = leavesMesh.geometry.getAttribute('instanceYOffset') as THREE.InstancedBufferAttribute | undefined;
            if (leavesYOffset) {
                (leavesYOffset.array as Float32Array).fill(0, 0, count);
                leavesYOffset.clearUpdateRanges();
                leavesYOffset.addUpdateRange(0, count);
                leavesYOffset.needsUpdate = true;
            }

            const leavesMask = leavesMesh.geometry.getAttribute('instanceMask') as THREE.InstancedBufferAttribute | undefined;
            if (leavesMask) {
                (leavesMask.array as Float32Array).fill(1, 0, count);
                leavesMask.clearUpdateRanges();
                leavesMask.addUpdateRange(0, count);
                leavesMask.needsUpdate = true;
            }

            this.debugFrame.uploadedInstanceFloats += count * 4;

            trunkMesh.count = count;
            leavesMesh.count = count;

            // Avoid O(N) bounding-sphere computation over all instances.
            trunkMesh.boundingSphere = chunkSphere.clone();
            leavesMesh.boundingSphere = chunkSphere.clone();

            this.scene.add(trunkMesh);
            this.scene.add(leavesMesh);
            created.push({ trunk: trunkMesh, leaves: leavesMesh });
        }

        return created;
    }

    /**
     * Remove chunks not in the keep set.
     */
    public pruneChunks(keep: Set<number>): void {
        // Cancel pending work for chunks that are no longer needed.
        // (We don't compact the array here; processPending skips canceled keys.)
        const pendingToCancel: number[] = [];
        for (const key of this.pendingKeys) {
            if (!keep.has(key)) pendingToCancel.push(key);
        }
        for (const key of pendingToCancel) this.pendingKeys.delete(key);

        // Compact pending queue so processPending doesn't repeatedly scan canceled items.
        if (pendingToCancel.length > 0 && this.pending.length > 0) {
            this.pending = this.pending.filter((p) => this.pendingKeys.has(p.key));
        }

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
                for (const m of meshes) {
                    this.releaseTreeMeshes(m);
                }
                this.chunksByKey.delete(key);
            }

            this.deleteKeys.delete(key);
        }
    }

    private roundCapacity(required: number): number {
        const r = Math.max(1, Math.floor(required));
        const step = 64;
        return Math.ceil(r / step) * step;
    }

    private poolKey(type: TreeType, capacity: number): string {
        return `${type}|${capacity}`;
    }

    private acquireTreeMeshes(def: TreeDefinition, requiredCount: number): { trunk: THREE.InstancedMesh; leaves: THREE.InstancedMesh } {
        const fixedCap = Math.max(1, Math.floor(MapConfig.treeMaxInstancesPerChunkPerType ?? 256));
        const capacity = requiredCount <= fixedCap ? fixedCap : this.roundCapacity(requiredCount);
        const key = this.poolKey(def.type, capacity);
        const pool = this.meshPool.get(key);
        const existing = pool && pool.length > 0 ? pool.pop() : undefined;
        if (existing) {
            this.debugFrame.poolHit++;
            existing.trunk.visible = true;
            existing.leaves.visible = true;
            // Materials can be swapped safely; geometry must remain per-mesh to keep instanced attributes attached.
            existing.trunk.material = def.trunkMat;
            existing.leaves.material = def.leavesMat;
            return existing;
        }

        this.debugFrame.poolMiss++;

        return this.createTreeMeshPair(def, capacity);
    }

    private createTreeMeshPair(def: TreeDefinition, capacity: number): { trunk: THREE.InstancedMesh; leaves: THREE.InstancedMesh } {
        // IMPORTANT: we need per-mesh instanced attributes (instanceTransform), so geometry must be unique.
        const trunkGeo = def.trunkGeo.clone();
        const leavesGeo = def.leavesGeo.clone();

        const trunk = new THREE.InstancedMesh(trunkGeo, def.trunkMat, capacity);
        const leaves = new THREE.InstancedMesh(leavesGeo, def.leavesMat, capacity);

        // Keep instanceMatrix around but we don't stream matrices anymore.
        trunk.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        leaves.instanceMatrix.setUsage(THREE.StaticDrawUsage);

        const trunkTransform = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
        const leavesTransform = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
        trunkTransform.setUsage(THREE.DynamicDrawUsage);
        leavesTransform.setUsage(THREE.DynamicDrawUsage);
        trunkGeo.setAttribute('instanceTransform', trunkTransform);
        leavesGeo.setAttribute('instanceTransform', leavesTransform);

        const trunkYOffset = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
        const leavesYOffset = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
        trunkYOffset.setUsage(THREE.DynamicDrawUsage);
        leavesYOffset.setUsage(THREE.DynamicDrawUsage);
        trunkGeo.setAttribute('instanceYOffset', trunkYOffset);
        leavesGeo.setAttribute('instanceYOffset', leavesYOffset);

        // Per-instance visibility mask (0..1), stored as a compact float attribute.
        const trunkMask = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1);
        const leavesMask = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1);
        trunkMask.setUsage(THREE.DynamicDrawUsage);
        leavesMask.setUsage(THREE.DynamicDrawUsage);
        trunkGeo.setAttribute('instanceMask', trunkMask);
        leavesGeo.setAttribute('instanceMask', leavesMask);

        trunk.frustumCulled = true;
        leaves.frustumCulled = true;

        // Used for pooling.
        (trunk.userData as any).treeTypeId = def.type;
        (leaves.userData as any).treeTypeId = def.type;
        (trunk.userData as any).poolCapacity = capacity;
        (leaves.userData as any).poolCapacity = capacity;

        trunk.visible = false;
        leaves.visible = false;

        return { trunk, leaves };
    }

    private releaseTreeMeshes(pair: { trunk: THREE.InstancedMesh; leaves: THREE.InstancedMesh }): void {
        this.scene.remove(pair.trunk);
        this.scene.remove(pair.leaves);
        pair.trunk.visible = false;
        pair.leaves.visible = false;

        this.debugFrame.releasePairs++;

        const type = ((pair.trunk.userData as any).treeTypeId as TreeType | undefined) ?? TreeType.Pine;
        const capacity =
            ((pair.trunk.userData as any).poolCapacity as number | undefined) ??
            (((pair.trunk.geometry.getAttribute('instanceTransform') as THREE.InstancedBufferAttribute | undefined)?.array.length ?? 0) / 4);
        const key = this.poolKey(type, capacity);
        const pool = this.meshPool.get(key);
        if (pool) pool.push(pair);
        else this.meshPool.set(key, [pair]);
    }

    public placeTrees(
        mapSize: number, 
        getHeightAt: (x: number, z: number) => number,
        excludeAreas: ExcludeArea[] = []
    ) {
        // 清理旧资源
        this.dispose();

        const chunkSize = MapConfig.chunkSize;
        const chunksPerRow = Math.ceil(mapSize / chunkSize);
        const halfSize = mapSize / 2;
        // 使用配置中的密度
        const density = EnvironmentConfig.trees.density;

        const distCfg = EnvironmentConfig.trees.distribution;
        const wCfg = distCfg.macroWeight;
        const dfCfg = distCfg.denseFactor;
        const shoreCfg = distCfg.shoreFade;
        
        // 计算每块(Chunk)的目标树木数量
        const treesPerChunk = Math.floor((chunkSize * chunkSize) * density);

        // 性能优化：严格限制生成范围（与 generateChunk 一致）
        const maxTreeDist = MapConfig.boundaryRadius + 50;
        const maxTreeDistSq = (maxTreeDist + chunkSize / 2) * (maxTreeDist + chunkSize / 2);

        // Macro noise for patchy distribution (0..1)
        const hash2 = (x: number, z: number) => {
            const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
            return s - Math.floor(s);
        };
        const macroNoise = (x: number, z: number) => {
            const s1 = 0.0009;
            const s2 = 0.0022;
            let n = 0;
            n += (Math.sin(x * s1) * Math.sin(z * s1) + 1) * 0.5;
            n += (Math.sin(x * s2 + 1.3) * Math.sin(z * s2 + 2.7) + 1) * 0.5 * 0.7;
            n = n * 0.85 + hash2(x * 0.15, z * 0.15) * 0.15;
            return Math.min(1, Math.max(0, n / (1 + 0.7)));
        };

        // Build active chunk list and allocate a fixed total budget across chunks.
        // This increases dense-area density without inflating overall tree counts.
        const activeChunks: Array<{ cx: number; cz: number; weight: number; denseFactor: number }> = [];
        let weightSum = 0;
        for (let x = 0; x < chunksPerRow; x++) {
            for (let z = 0; z < chunksPerRow; z++) {
                const chunkCX = (x * chunkSize) - halfSize + (chunkSize / 2);
                const chunkCZ = (z * chunkSize) - halfSize + (chunkSize / 2);
                if (chunkCX * chunkCX + chunkCZ * chunkCZ > maxTreeDistSq) continue;

                const d = Math.sqrt(chunkCX * chunkCX + chunkCZ * chunkCZ);
                const shoreFade = Math.min(1, Math.max(0, 1 - (d - shoreCfg.startDistance) / Math.max(1, (MapConfig.boundaryRadius - shoreCfg.startDistance))));
                const m = macroNoise(chunkCX, chunkCZ);
                // Strong contrast: concentrate trees into forest patches.
                const baseW = (wCfg.base + Math.pow(m, wCfg.exponent) * wCfg.amplitude) * (shoreCfg.min + shoreCfg.max * shoreFade);
                const denseFactor = Math.pow(
                    Math.min(1, Math.max(0, (m - dfCfg.start) / Math.max(1e-6, dfCfg.range))),
                    dfCfg.power
                );
                activeChunks.push({ cx: chunkCX, cz: chunkCZ, weight: baseW, denseFactor });
                weightSum += baseW;
            }
        }

        const activeChunkCount = Math.max(1, activeChunks.length);
        const totalTreesBudget = Math.max(0, Math.floor(treesPerChunk * activeChunkCount * distCfg.globalBudgetMultiplier));

        console.log(
            `Generating Trees: Map=${mapSize}, Chunk=${chunkSize}, ActiveChunks=${activeChunkCount}, PerChunkBase=${treesPerChunk} (Density: ${density}), TotalBudget=${totalTreesBudget}`
        );

        // Allocate integers by largest remainder method.
        const perChunkTargets: number[] = new Array(activeChunks.length).fill(0);
        let allocated = 0;
        const remainders: Array<{ i: number; frac: number }> = [];

        for (let i = 0; i < activeChunks.length; i++) {
            const exact = totalTreesBudget * (activeChunks[i].weight / Math.max(1e-6, weightSum));
            const flo = Math.max(0, Math.floor(exact));
            perChunkTargets[i] = flo;
            allocated += flo;
            remainders.push({ i, frac: exact - flo });
        }

        let remaining = totalTreesBudget - allocated;
        remainders.sort((a, b) => b.frac - a.frac);
        for (let k = 0; k < remainders.length && remaining > 0; k++) {
            perChunkTargets[remainders[k].i]++;
            remaining--;
        }

        for (let i = 0; i < activeChunks.length; i++) {
            const c = activeChunks[i];
            const target = perChunkTargets[i];
            if (target <= 0) continue;
            // Legacy full-map generation path (non-deterministic on purpose).
            // Use streaming APIs for large worlds.
            this.generateChunkLegacy(c.cx, c.cz, chunkSize, target, getHeightAt, excludeAreas, c.denseFactor);
        }
    }
    
    private generateChunkLegacy(
        cx: number, 
        cz: number, 
        size: number, 
        totalCount: number, 
        getHeightAt: (x: number, z: number) => number, 
        excludeAreas: ExcludeArea[],
        denseFactor: number = 0
    ) {
        const rand = Math.random;
        this.generateChunkInternal(cx, cz, size, totalCount, getHeightAt, excludeAreas, denseFactor, rand);
    }

    /**
     * Streaming generation: deterministic per chunk.
     * Returns the created meshes for bookkeeping.
     */
    private generateChunk(
        cx: number,
        cz: number,
        size: number,
        getHeightAt: (x: number, z: number) => number,
        excludeAreas: ExcludeArea[],
        rand: RandomFn,
    ): Array<{ trunk: THREE.InstancedMesh; leaves: THREE.InstancedMesh }> {
        // Per-chunk target derived from density to keep local look stable.
        const density = EnvironmentConfig.trees.density;
        const baseCount = Math.max(0, Math.floor(size * size * density));

        // Patchy distribution multiplier (0.4..1.6-ish)
        const distCfg = EnvironmentConfig.trees.distribution;
        const wCfg = distCfg.macroWeight;
        const dfCfg = distCfg.denseFactor;
        const shoreCfg = distCfg.shoreFade;

        const hash2 = (x: number, z: number) => {
            const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
            return s - Math.floor(s);
        };
        const macroNoise = (x: number, z: number) => {
            const s1 = 0.0009;
            const s2 = 0.0022;
            let n = 0;
            n += (Math.sin(x * s1) * Math.sin(z * s1) + 1) * 0.5;
            n += (Math.sin(x * s2 + 1.3) * Math.sin(z * s2 + 2.7) + 1) * 0.5 * 0.7;
            n = n * 0.85 + hash2(x * 0.15, z * 0.15) * 0.15;
            return Math.min(1, Math.max(0, n / (1 + 0.7)));
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
        const targetCount = Math.max(0, Math.floor(baseCount * localMultiplier));

        const denseFactor = Math.pow(
            Math.min(1, Math.max(0, (m - dfCfg.start) / Math.max(1e-6, dfCfg.range))),
            dfCfg.power
        );

        return this.generateChunkInternal(cx, cz, size, targetCount, getHeightAt, excludeAreas, denseFactor, rand);
    }

    private generateChunkInternal(
        cx: number,
        cz: number,
        size: number,
        totalCount: number,
        getHeightAt: (x: number, z: number) => number,
        excludeAreas: ExcludeArea[],
        denseFactor: number,
        rand: RandomFn,
    ): Array<{ trunk: THREE.InstancedMesh; leaves: THREE.InstancedMesh }> {
        // 性能优化：严格限制生成范围
        // 岛屿半径外是深海，不需要生成树木
        const maxTreeDist = MapConfig.boundaryRadius + 50; 
        
        // 如果整个 Chunk 的中心离原点太远，直接跳过
        if (cx * cx + cz * cz > (maxTreeDist + size/2) * (maxTreeDist + size/2)) {
            return [];
        }

        // Per-type compact transforms for GPU-driven instancing.
        // instanceTransform: [x, z, rotY, scale] per instance.
        const chunkTransforms: Map<TreeType, number[]> = new Map();
        // Cache per-instance world positions for melee/environment interactions.
        // treePositionsXZ: [x,z] * instanceCount (world space)
        const chunkPositionsXZ: Map<TreeType, number[]> = new Map();
        this.definitions.forEach(def => chunkTransforms.set(def.type, []));
        this.definitions.forEach(def => chunkPositionsXZ.set(def.type, []));
        
        let validCount = 0;

        // totalCount 表示“希望最终落地的树数量”。
        // 由于噪声阈值/排除区/水位会剔除大量候选点，如果仅尝试 totalCount 次会导致树过稀。
        // 这里 oversample 尝试次数，并在达到目标后提前结束。
        const oversample = 4;
        const attemptBudget = Math.max(totalCount, totalCount * oversample);

        // Dense chunks: relax threshold a bit to actually hit the target count.
        // Sparse chunks: slightly tighten it to keep clearings cleaner.
        const baseThreshold = EnvironmentConfig.trees.noise.threshold;
        const tCfg = EnvironmentConfig.trees.distribution.microThresholdShift;
        const thresholdShift = (1 - denseFactor) * tCfg.sparseBoost - denseFactor * tCfg.denseReduce;
        const effectiveThreshold = Math.min(0.98, Math.max(0.02, baseThreshold + thresholdShift));

        for (let i = 0; i < attemptBudget; i++) {
            // 在 Chunk 范围内随机生成
            const rx = (rand() - 0.5) * size;
            const rz = (rand() - 0.5) * size;
            
            const wx = cx + rx;
            const wz = cz + rz;
            
            // --- 密度分布控制 ---
            // 使用噪声剔除部分区域，形成聚集和空地
            const noiseVal = this.getNoise(wx, wz);
            // 加上一点随机抖动(-0.05 ~ 0.05)使边缘不那么生硬
            if (noiseVal < effectiveThreshold + (rand() * 0.1 - 0.05)) {
                continue;
            }

            // 检查排除区域
            let excluded = false;
            for (const area of excludeAreas) {
                const dx = wx - area.x;
                const dz = wz - area.z;
                if (dx * dx + dz * dz < area.radius * area.radius) {
                    excluded = true;
                    break;
                }
            }
            if (excluded) continue;

            const y = getHeightAt(wx, wz);
            
            // 避免水下生成
            const placeConfig = EnvironmentConfig.trees.placement;
            if (y < placeConfig.minAltitude) continue; 
            
            // 随机选择树种 (根据 probability)
            const rnd = rand();
            let accumulatedProb = 0;
            let selectedDef = this.definitions[0];
            
            // 简单轮盘赌选择
            for (const def of this.definitions) {
                accumulatedProb += def.probability;
                if (rnd <= accumulatedProb) {
                    selectedDef = def;
                    break;
                }
            }

            // 随机旋转和缩放
            const scale = selectedDef.scaleRange.min + rand() * (selectedDef.scaleRange.max - selectedDef.scaleRange.min);
            const rotationY = rand() * Math.PI * 2;

            const tArr = chunkTransforms.get(selectedDef.type)!;
            tArr.push(wx, wz, rotationY, scale);
            const posArr = chunkPositionsXZ.get(selectedDef.type)!;
            posArr.push(wx, wz);
            validCount++;

            if (validCount >= totalCount) break;
        }
        
        const created: Array<{ trunk: THREE.InstancedMesh; leaves: THREE.InstancedMesh }> = [];

        // 为该 Chunk 创建 InstancedMesh (只为有树的类型创建)
        this.definitions.forEach(def => {
            const transforms = chunkTransforms.get(def.type)!;
            const count = Math.floor(transforms.length / 4);
            if (count > 0) {
                const trunkGeo = def.trunkGeo.clone();
                const leavesGeo = def.leavesGeo.clone();

                const trunkMesh = new THREE.InstancedMesh(trunkGeo, def.trunkMat, count);
                const leavesMesh = new THREE.InstancedMesh(leavesGeo, def.leavesMat, count);

                const trunkTransform = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
                const leavesTransform = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
                trunkTransform.setUsage(THREE.DynamicDrawUsage);
                leavesTransform.setUsage(THREE.DynamicDrawUsage);
                (trunkTransform.array as Float32Array).set(transforms, 0);
                (leavesTransform.array as Float32Array).set(transforms, 0);
                trunkGeo.setAttribute('instanceTransform', trunkTransform);
                leavesGeo.setAttribute('instanceTransform', leavesTransform);

                const trunkYOffset = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
                const leavesYOffset = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
                trunkYOffset.setUsage(THREE.DynamicDrawUsage);
                leavesYOffset.setUsage(THREE.DynamicDrawUsage);
                trunkGeo.setAttribute('instanceYOffset', trunkYOffset);
                leavesGeo.setAttribute('instanceYOffset', leavesYOffset);

                const positionsXZ = new Float32Array(chunkPositionsXZ.get(def.type)!);

                // 标记为树木（用于近战斧头用途：砍树）
                {
                    const ud = getUserData(trunkMesh);
                    ud.isTree = true;
                    ud.treeType = def.type;
                    ud.treePart = 'trunk';
                    ud.pairedMesh = leavesMesh;
                    ud.treePositionsXZ = positionsXZ;
                }
                {
                    const ud = getUserData(leavesMesh);
                    ud.isTree = true;
                    ud.treeType = def.type;
                    ud.treePart = 'leaves';
                    ud.pairedMesh = trunkMesh;
                    ud.treePositionsXZ = positionsXZ;
                }
                
                trunkMesh.castShadow = true;
                trunkMesh.receiveShadow = true;
                // Shadow cost scales with instance count; in very dense forests we disable leaf casting
                // to keep performance stable while preserving trunk shadows and overall depth.
                leavesMesh.castShadow = count <= EnvironmentConfig.trees.distribution.leafShadowCutoff;
                leavesMesh.receiveShadow = true;

                const trunkMask = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1);
                const leavesMask = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1);
                trunkMask.setUsage(THREE.DynamicDrawUsage);
                leavesMask.setUsage(THREE.DynamicDrawUsage);
                trunkGeo.setAttribute('instanceMask', trunkMask);
                leavesGeo.setAttribute('instanceMask', leavesMask);

                trunkTransform.clearUpdateRanges();
                trunkTransform.addUpdateRange(0, count * 4);
                trunkTransform.needsUpdate = true;

                trunkYOffset.clearUpdateRanges();
                trunkYOffset.addUpdateRange(0, count);
                trunkYOffset.needsUpdate = true;

                leavesTransform.clearUpdateRanges();
                leavesTransform.addUpdateRange(0, count * 4);
                leavesTransform.needsUpdate = true;

                leavesYOffset.clearUpdateRanges();
                leavesYOffset.addUpdateRange(0, count);
                leavesYOffset.needsUpdate = true;

                trunkMask.clearUpdateRanges();
                trunkMask.addUpdateRange(0, count);
                trunkMask.needsUpdate = true;

                leavesMask.clearUpdateRanges();
                leavesMask.addUpdateRange(0, count);
                leavesMask.needsUpdate = true;
                
                // 重要：计算边界球以确保 Frustum Culling 工作正常
                trunkMesh.computeBoundingSphere();
                leavesMesh.computeBoundingSphere();

                this.scene.add(trunkMesh);
                this.scene.add(leavesMesh);

                created.push({ trunk: trunkMesh, leaves: leavesMesh });
            }
        });

        return created;
    }
    
    public dispose() {
        const keys = Array.from(this.chunksByKey.keys());
        for (const key of keys) {
            const meshes = this.chunksByKey.get(key);
            if (!meshes) continue;
            for (const c of meshes) {
                this.scene.remove(c.trunk);
                this.scene.remove(c.leaves);
                c.trunk.dispose();
                c.leaves.dispose();
            }
            this.chunksByKey.delete(key);
        }

        // pooled
        for (const pool of this.meshPool.values()) {
            for (const p of pool) {
                this.scene.remove(p.trunk);
                this.scene.remove(p.leaves);
                p.trunk.dispose();
                p.leaves.dispose();
            }
        }
        this.meshPool.clear();

        // Cancel any pending/inflight streaming work.
        this.pending.length = 0;
        this.pendingKeys.clear();
        this.ready.length = 0;
        this.inflight.clear();
        this.requestIdToKey.clear();

        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }

    /**
     * 获取基于坐标的伪随机噪声值 (0-1)
     * 用于生成不均匀分布的植被
     */
    private getNoise(x: number, z: number): number {
        const scale = EnvironmentConfig.trees.noise.scale; 
        
        // 简单的正弦波叠加模拟噪声
        let n = Math.sin(x * scale) * Math.sin(z * scale); 
        n += Math.sin(x * scale * 2.1 + 1.2) * Math.sin(z * scale * 2.1 + 2.3) * 0.5;
        n += Math.sin(x * scale * 4.3 + 3.4) * Math.sin(z * scale * 4.3 + 4.5) * 0.25;
        
        // 归一化到 roughly 0..1
        return (n / 1.75 + 1) * 0.5;
    }

    /**
     * 创建合并的树叶几何体 (多个圆锥体叠加) - 改进版松树
     */
    private createPineLeavesGeometry(config: TreeGeometryConfig, trunkHeight: number): THREE.BufferGeometry {
        const geometries: THREE.BufferGeometry[] = [];
        const layers = config.layers || 5;
        // 确保树叶覆盖住树干顶部
        const startHeight = trunkHeight * 0.6; // 从树干中部开始长叶子
        const totalHeight = config.height || 6.0;
        
        for (let i = 0; i < layers; i++) {
            const t = i / (layers - 1); // 0 -> 1
            const y = startHeight + t * (totalHeight - startHeight - 1.0);
            
            // 下面大，上面小
            const radius = (1.0 - t * 0.8) * (config.baseRadius || 2.5);
            const height = ((totalHeight - startHeight) / layers) * 1.5; 
            
            // 使用 Cone 模拟
            // 增加不规则性：可以稍微旋转或偏移中心
            const cone = new THREE.ConeGeometry(radius, height, 7);
            
            // 随机轻微偏移，看起来不那么像玩具
            const offsetX = (Math.random() - 0.5) * 0.1; // 较小的偏移
            const offsetZ = (Math.random() - 0.5) * 0.1;
            
            cone.translate(offsetX, y + height/2, offsetZ);
            
            // 随机旋转 Y 轴
            cone.rotateY(Math.random() * Math.PI);
            
            geometries.push(cone);
        }
        
        return this.mergeGeometries(geometries);
    }

    /**
     * 创建橡树叶子 - 改进版：更多随机Cluster
     */
    private createOakLeavesGeometry(config: TreeGeometryConfig, trunkHeight: number): THREE.BufferGeometry {
        const geometries: THREE.BufferGeometry[] = [];
        const clusters = config.clusters || 12;
        const mainSize = config.clusterSize || 0.6;
        const spread = config.spread || 1.0;
        
        // 核心树冠 - 确保接在树干顶端
        const center = new THREE.IcosahedronGeometry(mainSize * 1.2, 0); 
        const coreHeight = trunkHeight + mainSize * 0.5;
        center.translate(0, coreHeight, 0);
        geometries.push(center);
        
        // 周围随机分布
        for(let i=0; i<clusters; i++) {
            // 球坐标随机分布
            const phi = Math.acos( -1 + ( 2 * i ) / clusters ); // 均匀分布
            const theta = Math.sqrt( clusters * Math.PI ) * phi;
            
            const r = spread * (0.8 + Math.random() * 0.4);
            
            const x = r * Math.sin(phi) * Math.cos(theta);
            // 围绕核心高度分布
            const y = coreHeight + r * Math.sin(phi) * Math.sin(theta) * 0.8; 
            const z = r * Math.cos(phi);
            
            const size = mainSize * (0.6 + Math.random() * 0.6);
            
            // 使用 Dodecahedron 会比 Icosahedron 看起来稍微 "方" 一点，更有低模风格
            const leaf = new THREE.DodecahedronGeometry(size, 0);
            
            // 随机拉伸一点，不做正球体
            leaf.scale(1.0 + Math.random()*0.3, 0.8 + Math.random()*0.4, 1.0 + Math.random()*0.3);
            
            leaf.rotateX(Math.random() * Math.PI);
            leaf.rotateZ(Math.random() * Math.PI);
            
            leaf.translate(x, y, z);
            geometries.push(leaf);
        }
         
        return this.mergeGeometries(geometries);
    }

    /**
     * 创建白桦树叶 - 改进版：更稀疏，更垂直分布
     */
    private createBirchLeavesGeometry(config: TreeGeometryConfig, trunkHeight: number): THREE.BufferGeometry {
        const geometries: THREE.BufferGeometry[] = [];
        // 白桦树叶起始高度
        const baseHeight = trunkHeight * 0.6; 
        const clusters = config.clusters || 8;
        const sizeBase = config.clusterSize || 0.4;
        const totalH = config.height || 5.0;
        
        for (let i = 0; i < clusters; i++) {
            const hPercent = i / clusters; // 0 (bottom) -> 1 (top)
            
            // 越高越靠近中心
            const r = (1.0 - hPercent * 0.6) * 1.0 * (0.8 + Math.random() * 0.4);
            const angle = Math.random() * Math.PI * 2;
            const h = baseHeight + hPercent * (totalH - baseHeight) + Math.random() * 0.5;
            
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;
            
            const size = sizeBase * (0.8 + Math.random() * 0.5);
            
            // 白桦树叶比较小且碎，用 Dodecahedron
            const geo = new THREE.DodecahedronGeometry(size, 0);
            
            geo.translate(x, h, z);
            geometries.push(geo);
        }

        // 必定有一个顶部盖子
        const top = new THREE.DodecahedronGeometry(sizeBase, 0);
        top.translate(0, totalH + sizeBase * 0.5, 0);
        geometries.push(top);

        return this.mergeGeometries(geometries);
    }
    
    /**
     * 简单的几何体合并工具
     */
    private mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        
        let vertexOffset = 0;
        
        geometries.forEach(geo => {
            const posAttr = geo.attributes.position;
            const normAttr = geo.attributes.normal;
            const uvAttr = geo.attributes.uv;
            const indexAttr = geo.index;
            
            for (let i = 0; i < posAttr.count; i++) {
                positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
                normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
                uvs.push(uvAttr.getX(i), uvAttr.getY(i));
            }
            
            if (indexAttr) {
                for (let i = 0; i < indexAttr.count; i++) {
                    indices.push(indexAttr.getX(i) + vertexOffset);
                }
            } else {
                 for (let i = 0; i < posAttr.count; i++) {
                    indices.push(i + vertexOffset);
                }
            }
            
            vertexOffset += posAttr.count;
        });
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);

        // 确保清理原始临时的 geometries
        geometries.forEach(g => g.dispose());
        
        return geometry;
    }
}
