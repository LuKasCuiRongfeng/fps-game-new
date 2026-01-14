/// <reference lib="webworker" />

import { MapConfig, EnvironmentConfig } from '../core/GameConfig';
import { hash2iToU32, mulberry32 } from '../core/util/SeededRandom';
import { terrainHeightCpu } from '../shaders/TerrainHeight';

type ExcludeArea = { x: number; z: number; radius: number };

type GrassTypeId = 'tall' | 'shrub' | 'dry';

type TreeTypeId = 0 | 1 | 2;

type GrassTypeParams = {
    id: GrassTypeId;
    noiseScale: number;
    noiseThreshold: number;
    scaleMin: number;
    scaleMax: number;
};

type GenerateGrassChunkRequest = {
    kind: 'grass';
    requestId: number;
    key: number;
    cx: number;
    cz: number;
    size: number;
    seedU32: number;
    viewerX: number;
    viewerZ: number;
    excludeAreas: ExcludeArea[];
    grassDensityScale: number;
    grassFarDensityMultiplier: number;
    grassDetailRadiusChunks: number;
    grassMaxInstancesPerTypeNear: number;
    grassMaxInstancesPerTypeFar: number;
    waterLevel: number;
    distribution: {
        macroWeight: { base: number; exponent: number; amplitude: number };
        denseFactor: { start: number; range: number; power: number };
        shoreFade: { startDistance: number; min: number; max: number };
        microThresholdShift: { sparseBoost: number; denseReduce: number };
    };
    grassTypes: GrassTypeParams[];
    // base densities in instances per m^2
    densityByType: Record<GrassTypeId, number>;
};

type TreeTypeParams = {
    type: TreeTypeId;
    probability: number;
    scaleMin: number;
    scaleMax: number;
};

type GenerateTreeChunkRequest = {
    kind: 'trees';
    requestId: number;
    key: number;
    cx: number;
    cz: number;
    size: number;
    seedU32: number;
    excludeAreas: ExcludeArea[];
    minAltitude: number;
    noise: { scale: number; threshold: number };
    distribution: {
        macroWeight: { base: number; exponent: number; amplitude: number };
        denseFactor: { start: number; range: number; power: number };
        shoreFade: { startDistance: number; min: number; max: number };
        microThresholdShift: { sparseBoost: number; denseReduce: number };
    };
    density: number;
    types: TreeTypeParams[];
};

type GrassTypeResult = {
    id: GrassTypeId;
    count: number;
    transforms: Float32Array;
    positionsXZ: Float32Array;
};

type TreeTypeResult = {
    type: TreeTypeId;
    count: number;
    transforms: Float32Array;
    positionsXZ: Float32Array;
};

type GenerateGrassChunkResponse = {
    kind: 'grass';
    requestId: number;
    key: number;
    cx: number;
    cz: number;
    viewerX: number;
    viewerZ: number;
    results: GrassTypeResult[];
};

type GenerateTreeChunkResponse = {
    kind: 'trees';
    requestId: number;
    key: number;
    cx: number;
    cz: number;
    results: TreeTypeResult[];
};

function clamp01(v: number): number {
    return Math.min(1, Math.max(0, v));
}

function writeTransformXZRotScale(out: Float32Array, offset: number, x: number, z: number, rotY: number, s: number) {
    // vec4 layout: [x, z, rotY, scale]
    out[offset] = x;
    out[offset + 1] = z;
    out[offset + 2] = rotY;
    out[offset + 3] = s;
}

function macroNoiseGrass(x: number, z: number): number {
    const hash2 = (hx: number, hz: number) => {
        const s = Math.sin(hx * 12.9898 + hz * 78.233) * 43758.5453;
        return s - Math.floor(s);
    };
    const s1 = 0.0012;
    const s2 = 0.0027;
    const s3 = 0.006;
    let n = 0;
    n += (Math.sin(x * s1) * Math.sin(z * s1) + 1) * 0.5;
    n += (Math.sin(x * s2 + 1.7) * Math.sin(z * s2 + 2.1) + 1) * 0.5 * 0.6;
    n += (Math.sin(x * s3 + 3.9) * Math.sin(z * s3 + 4.2) + 1) * 0.5 * 0.25;
    n = n * 0.85 + hash2(x * 0.2, z * 0.2) * 0.15;
    return clamp01(n / (1 + 0.6 + 0.25));
}

function macroNoiseTrees(x: number, z: number): number {
    const hash2 = (hx: number, hz: number) => {
        const s = Math.sin(hx * 12.9898 + hz * 78.233) * 43758.5453;
        return s - Math.floor(s);
    };
    const s1 = 0.0009;
    const s2 = 0.0022;
    let n = 0;
    n += (Math.sin(x * s1) * Math.sin(z * s1) + 1) * 0.5;
    n += (Math.sin(x * s2 + 1.3) * Math.sin(z * s2 + 2.7) + 1) * 0.5 * 0.7;
    n = n * 0.85 + hash2(x * 0.15, z * 0.15) * 0.15;
    return clamp01(n / (1 + 0.7));
}

function generateGrassChunk(req: GenerateGrassChunkRequest): GenerateGrassChunkResponse {
    const {
        cx,
        cz,
        size,
        seedU32,
        viewerX,
        viewerZ,
        excludeAreas,
        grassDensityScale,
        grassFarDensityMultiplier,
        grassDetailRadiusChunks,
        grassMaxInstancesPerTypeNear,
        grassMaxInstancesPerTypeFar,
        waterLevel,
        distribution,
        grassTypes,
        densityByType,
    } = req;

    const maxGrassDist = MapConfig.boundaryRadius + 50;
    const maxGrassDistSq = (maxGrassDist + size / 2) * (maxGrassDist + size / 2);
    if (cx * cx + cz * cz > maxGrassDistSq) {
        return { kind: 'grass', requestId: req.requestId, key: req.key, cx, cz, viewerX, viewerZ, results: [] };
    }

    const rng = mulberry32(seedU32);

    const m = macroNoiseGrass(cx, cz);
    const wCfg = distribution.macroWeight;
    const patchRaw = wCfg.base + Math.pow(m, wCfg.exponent) * wCfg.amplitude;
    const patchNorm = patchRaw / Math.max(1e-6, (wCfg.base + wCfg.amplitude));

    const dfCfg = distribution.denseFactor;
    const denseFactor = Math.pow(clamp01((m - dfCfg.start) / Math.max(1e-6, dfCfg.range)), dfCfg.power);

    const shoreCfg = distribution.shoreFade;
    const d = Math.sqrt(cx * cx + cz * cz);
    const shoreFade = clamp01(1 - (d - shoreCfg.startDistance) / Math.max(1, (MapConfig.boundaryRadius - shoreCfg.startDistance)));
    const localMultiplier = (0.35 + 1.35 * patchNorm) * (shoreCfg.min + shoreCfg.max * shoreFade);

    const detailRadius = Math.max(0, grassDetailRadiusChunks) * size;
    const ddx = cx - viewerX;
    const ddz = cz - viewerZ;
    const isNear = ddx * ddx + ddz * ddz <= detailRadius * detailRadius;
    const lodDensityMul = isNear ? 1.0 : Math.min(1, Math.max(0, grassFarDensityMultiplier));
    const maxPerType = isNear ? Math.max(0, grassMaxInstancesPerTypeNear) : Math.max(0, grassMaxInstancesPerTypeFar);

    const chunkArea = size * size;

    const results: GrassTypeResult[] = [];
    for (const type of grassTypes) {
        const baseDensity = densityByType[type.id] ?? 0;
        const base = Math.floor(baseDensity * chunkArea);
        const target = Math.max(0, Math.floor(base * localMultiplier * lodDensityMul * Math.max(0, grassDensityScale)));
        const targetCount = Math.min(maxPerType, target);
        if (targetCount <= 0) continue;

        const oversample = isNear ? 3.0 : 2.0;
        const attemptCount = Math.max(targetCount, Math.floor(targetCount * oversample));

        const transforms = new Float32Array(targetCount * 4);
        const positionsXZ = new Float32Array(targetCount * 2);

        const tCfg = distribution.microThresholdShift;
        const thresholdShift = (1 - denseFactor) * tCfg.sparseBoost - denseFactor * tCfg.denseReduce;
        const effectiveThreshold = Math.min(0.98, Math.max(0.02, type.noiseThreshold + thresholdShift));

        let validCount = 0;
        for (let i = 0; i < attemptCount; i++) {
            const rx = (rng() - 0.5) * size;
            const rz = (rng() - 0.5) * size;
            const wx = cx + rx;
            const wz = cz + rz;

            const typeOffset = type.id === 'dry' ? 100 : 0;
            let n = Math.sin((wx + typeOffset) * type.noiseScale) * Math.sin((wz + typeOffset) * type.noiseScale);
            n += Math.sin(wx * type.noiseScale * 2.3) * Math.sin(wz * type.noiseScale * 2.3) * 0.5;
            if (((n / 1.5 + 1) * 0.5) < effectiveThreshold + (rng() * 0.15 - 0.075)) {
                continue;
            }

            let ok = true;
            for (const area of excludeAreas) {
                const dx = wx - area.x;
                const dz = wz - area.z;
                const rr = (area.radius * 0.8);
                if (dx * dx + dz * dz < rr * rr) {
                    ok = false;
                    break;
                }
            }
            if (!ok) continue;

            const y = terrainHeightCpu(wx, wz);
            if (y < waterLevel + 0.5) continue;

            const rotY = rng() * Math.PI * 2;
            const s = type.scaleMin + rng() * (type.scaleMax - type.scaleMin);

            const pi = validCount * 2;
            positionsXZ[pi] = wx;
            positionsXZ[pi + 1] = wz;

            writeTransformXZRotScale(transforms, validCount * 4, wx, wz, rotY, s);
            validCount++;
            if (validCount >= targetCount) break;
        }

        if (validCount > 0) {
            results.push({
                id: type.id,
                count: validCount,
                transforms: validCount === targetCount ? transforms : transforms.subarray(0, validCount * 4),
                positionsXZ: validCount === targetCount ? positionsXZ : positionsXZ.subarray(0, validCount * 2),
            });
        }
    }

    return { kind: 'grass', requestId: req.requestId, key: req.key, cx, cz, viewerX, viewerZ, results };
}

function getTreeMicroNoise(x: number, z: number, scale: number): number {
    let n = Math.sin(x * scale) * Math.sin(z * scale);
    n += Math.sin(x * scale * 2.1 + 1.2) * Math.sin(z * scale * 2.1 + 2.3) * 0.5;
    n += Math.sin(x * scale * 4.3 + 3.4) * Math.sin(z * scale * 4.3 + 4.5) * 0.25;
    return (n / 1.75 + 1) * 0.5;
}

function generateTreeChunk(req: GenerateTreeChunkRequest): GenerateTreeChunkResponse {
    const { cx, cz, size, seedU32, excludeAreas, minAltitude, noise, distribution, density, types } = req;

    // Only generate within island bounds.
    const maxTreeDist = MapConfig.boundaryRadius + 50;
    const maxTreeDistSq = (maxTreeDist + size / 2) * (maxTreeDist + size / 2);
    if (cx * cx + cz * cz > maxTreeDistSq) {
        return { kind: 'trees', requestId: req.requestId, key: req.key, cx, cz, results: [] };
    }

    const rng = mulberry32(seedU32);

    const m = macroNoiseTrees(cx, cz);
    const wCfg = distribution.macroWeight;
    const patchRaw = wCfg.base + Math.pow(m, wCfg.exponent) * wCfg.amplitude;
    const patchNorm = patchRaw / Math.max(1e-6, (wCfg.base + wCfg.amplitude));

    const dfCfg = distribution.denseFactor;
    const denseFactor = Math.pow(clamp01((m - dfCfg.start) / Math.max(1e-6, dfCfg.range)), dfCfg.power);

    const shoreCfg = distribution.shoreFade;
    const d = Math.sqrt(cx * cx + cz * cz);
    const shoreFade = clamp01(1 - (d - shoreCfg.startDistance) / Math.max(1, (MapConfig.boundaryRadius - shoreCfg.startDistance)));
    const localMultiplier = (0.35 + 1.35 * patchNorm) * (shoreCfg.min + shoreCfg.max * shoreFade);

    const baseCount = Math.max(0, Math.floor(size * size * Math.max(0, density)));
    const targetCount = Math.max(0, Math.floor(baseCount * localMultiplier));
    if (targetCount <= 0 || types.length <= 0) {
        return { kind: 'trees', requestId: req.requestId, key: req.key, cx, cz, results: [] };
    }

    // Build cumulative probability table.
    let probSum = 0;
    const cumulative: Array<{ type: TreeTypeId; p: number; scaleMin: number; scaleMax: number }> = [];
    for (const t of types) {
        probSum += Math.max(0, t.probability);
        cumulative.push({ type: t.type, p: probSum, scaleMin: t.scaleMin, scaleMax: t.scaleMax });
    }
    if (probSum <= 0) {
        // fallback to uniform
        cumulative.length = 0;
        const step = 1 / types.length;
        let acc = 0;
        for (const t of types) {
            acc += step;
            cumulative.push({ type: t.type, p: acc, scaleMin: t.scaleMin, scaleMax: t.scaleMax });
        }
        probSum = 1;
    }

    // First pass: count per type (so we can allocate exact-sized typed arrays).
    const counts = new Map<TreeTypeId, number>();
    for (const t of types) counts.set(t.type, 0);

    const oversample = 4;
    const attemptBudget = Math.max(targetCount, targetCount * oversample);

    const baseThreshold = noise.threshold;
    const tCfg = distribution.microThresholdShift;
    const thresholdShift = (1 - denseFactor) * tCfg.sparseBoost - denseFactor * tCfg.denseReduce;
    const effectiveThreshold = Math.min(0.98, Math.max(0.02, baseThreshold + thresholdShift));

    // Store temp picks so we can fill output arrays in a second pass without redoing the expensive checks.
    const picked: Array<{ x: number; z: number; rotY: number; s: number; type: TreeTypeId }> = [];
    picked.length = 0;

    for (let i = 0; i < attemptBudget; i++) {
        const rx = (rng() - 0.5) * size;
        const rz = (rng() - 0.5) * size;
        const wx = cx + rx;
        const wz = cz + rz;

        const noiseVal = getTreeMicroNoise(wx, wz, noise.scale);
        if (noiseVal < effectiveThreshold + (rng() * 0.1 - 0.05)) continue;

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

        const y = terrainHeightCpu(wx, wz);
        if (y < minAltitude) continue;

        const r = rng() * probSum;
        let selected = cumulative[0];
        for (const c of cumulative) {
            if (r <= c.p) {
                selected = c;
                break;
            }
        }

        const s = selected.scaleMin + rng() * (selected.scaleMax - selected.scaleMin);
        const rotY = rng() * Math.PI * 2;

        picked.push({ x: wx, z: wz, rotY, s, type: selected.type });
        counts.set(selected.type, (counts.get(selected.type) ?? 0) + 1);

        if (picked.length >= targetCount) break;
    }

    const results: TreeTypeResult[] = [];
    for (const t of types) {
        const c = counts.get(t.type) ?? 0;
        if (c <= 0) continue;
        results.push({
            type: t.type,
            count: c,
            transforms: new Float32Array(c * 4),
            positionsXZ: new Float32Array(c * 2),
        });
    }

    // Cursor per type
    const cursor = new Map<TreeTypeId, number>();
    for (const r of results) cursor.set(r.type, 0);
    const byType = new Map<TreeTypeId, TreeTypeResult>();
    for (const r of results) byType.set(r.type, r);

    for (const p of picked) {
        const out = byType.get(p.type);
        if (!out) continue;
        const idx = cursor.get(p.type) ?? 0;
        cursor.set(p.type, idx + 1);

        const pi = idx * 2;
        out.positionsXZ[pi] = p.x;
        out.positionsXZ[pi + 1] = p.z;

        writeTransformXZRotScale(out.transforms, idx * 4, p.x, p.z, p.rotY, p.s);
    }

    return { kind: 'trees', requestId: req.requestId, key: req.key, cx, cz, results };
}

type WorkerRequest = GenerateGrassChunkRequest | GenerateTreeChunkRequest;

type WorkerResponse = GenerateGrassChunkResponse | GenerateTreeChunkResponse;

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
    const req = ev.data;

    if (req.kind === 'grass') {
        const res = generateGrassChunk(req);

        const transfer: ArrayBuffer[] = [];
        for (const r of res.results) {
            transfer.push(r.transforms.buffer as ArrayBuffer);
            transfer.push(r.positionsXZ.buffer as ArrayBuffer);
        }

        (self as unknown as DedicatedWorkerGlobalScope).postMessage(res, transfer);
        return;
    }

    if (req.kind === 'trees') {
        const res = generateTreeChunk(req);

        const transfer: ArrayBuffer[] = [];
        for (const r of res.results) {
            transfer.push(r.transforms.buffer as ArrayBuffer);
            transfer.push(r.positionsXZ.buffer as ArrayBuffer);
        }

        (self as unknown as DedicatedWorkerGlobalScope).postMessage(res, transfer);
        return;
    }
};
