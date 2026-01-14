import * as THREE from 'three';
import { invoke } from '@tauri-apps/api/core';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type GrassModelId = 'weed_plant_02_1k';
export type TreeModelId = 'quiver_tree_02_1k';

export type TreeModelParts = {
    trunk: THREE.BufferGeometry;
    leaves: THREE.BufferGeometry;
};

type Cached<T> = { promise: Promise<T> };

type Extracted = {
    all: THREE.BufferGeometry[];
    trunk: THREE.BufferGeometry[];
    leaves: THREE.BufferGeometry[];
};

const cacheExtracted = new Map<GrassModelId | TreeModelId, Cached<Extracted>>();
const cacheGrass = new Map<string, Cached<THREE.BufferGeometry>>();
const cacheTree = new Map<string, Cached<TreeModelParts>>();

function zipFilenameForModel(id: GrassModelId | TreeModelId): string {
    return `${id}.fbx.zip`;
}

function isLeavesMaterialName(name: string | undefined): boolean {
    if (!name) return false;
    return /leaf|leaves|foliage|needle|needles/i.test(name);
}

function bakeBaseTransform(geometries: THREE.BufferGeometry[], opts: { targetHeight: number }): void {
    const combined = mergeGeometries(geometries.map((g) => g.clone()), false);
    if (!combined) return;

    combined.computeBoundingBox();
    const bb = combined.boundingBox;
    if (!bb) return;

    const height = Math.max(1e-6, bb.max.y - bb.min.y);
    const scale = opts.targetHeight / height;
    const translateY = -bb.min.y;

    for (const g of geometries) {
        g.translate(0, translateY, 0);
        g.scale(scale, scale, scale);
        g.computeBoundingBox();
        g.computeBoundingSphere();
    }

    combined.dispose();
}

function extractMergedGeometries(root: THREE.Object3D): Extracted {
    root.updateMatrixWorld(true);

    const all: THREE.BufferGeometry[] = [];
    const trunk: THREE.BufferGeometry[] = [];
    const leaves: THREE.BufferGeometry[] = [];

    root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh || !(mesh as any).isMesh) return;
        if (!mesh.geometry) return;

        const geom = (mesh.geometry as THREE.BufferGeometry).clone();
        geom.applyMatrix4(mesh.matrixWorld);

        all.push(geom);

        const mat = mesh.material as any;
        const matName = typeof mat?.name === 'string' ? mat.name : undefined;
        if (isLeavesMaterialName(matName) || isLeavesMaterialName(mesh.name)) {
            leaves.push(geom);
        } else {
            trunk.push(geom);
        }
    });

    return { all, trunk, leaves };
}

function mergeOrThrow(geoms: THREE.BufferGeometry[], label: string): THREE.BufferGeometry {
    const merged = mergeGeometries(geoms, false);
    if (!merged) {
        throw new Error(`Failed to merge ${label} geometries`);
    }
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
}

function mergeAndDisposeInputsOrThrow(geoms: THREE.BufferGeometry[], label: string): THREE.BufferGeometry {
    try {
        return mergeOrThrow(geoms, label);
    } finally {
        for (const g of geoms) g.dispose();
    }
}

async function loadFbxObjectFromZip(modelId: GrassModelId | TreeModelId): Promise<THREE.Object3D> {
    const zipFilename = zipFilenameForModel(modelId);

    const bytes = await invoke<number[]>('load_model_fbx_from_zip', { zipFilename });
    const arrayBuffer = Uint8Array.from(bytes).buffer;

    // Prevent FBXLoader from trying to fetch external textures by mapping all URLs to a tiny 1x1 PNG.
    // We apply our own GPU Node materials after extracting geometry.
    const manager = new THREE.LoadingManager();
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2G8WcAAAAASUVORK5CYII=';
    manager.setURLModifier(() => tinyPng);

    const loader = new FBXLoader(manager);
    const root = loader.parse(arrayBuffer, '');
    return root;
}

async function getExtracted(modelId: GrassModelId | TreeModelId): Promise<Extracted> {
    const existing = cacheExtracted.get(modelId);
    if (existing) return existing.promise;

    const promise = (async () => {
        const root = await loadFbxObjectFromZip(modelId);
        return extractMergedGeometries(root);
    })();

    cacheExtracted.set(modelId, { promise });
    return promise;
}

function keyFor(modelId: string, targetHeight: number): string {
    // Keep the key stable for floats. Heights here come from config and are small.
    const h = Math.round(targetHeight * 1000) / 1000;
    return `${modelId}@${h}`;
}

export async function loadGrassModelGeometry(id: GrassModelId, opts: { targetHeight: number }): Promise<THREE.BufferGeometry> {
    const cacheKey = keyFor(id, opts.targetHeight);
    const existing = cacheGrass.get(cacheKey);
    if (existing) return existing.promise;

    const promise = (async () => {
        const extracted = await getExtracted(id);
        const source = extracted.all.length > 0 ? extracted.all : extracted.trunk;
        const geoms = source.map((g) => g.clone());
        bakeBaseTransform(geoms, { targetHeight: opts.targetHeight });
        return mergeAndDisposeInputsOrThrow(geoms, `grass(${id})`);
    })();

    cacheGrass.set(cacheKey, { promise });
    return promise;
}

export async function loadTreeModelParts(id: TreeModelId, opts: { targetHeight: number }): Promise<TreeModelParts> {
    const cacheKey = keyFor(id, opts.targetHeight);
    const existing = cacheTree.get(cacheKey);
    if (existing) return existing.promise;

    const promise = (async () => {
        const extracted = await getExtracted(id);

        const trunkSource = extracted.trunk.length > 0 ? extracted.trunk : extracted.all;
        const leavesSource = extracted.leaves.length > 0 ? extracted.leaves : [];

        const trunkGeoms = trunkSource.map((g) => g.clone());
        const leavesGeoms = leavesSource.map((g) => g.clone());

        // Ensure both parts share the same base alignment/scale.
        const toBake = [...trunkGeoms, ...leavesGeoms];
        if (toBake.length > 0) bakeBaseTransform(toBake, { targetHeight: opts.targetHeight });

        const trunk = mergeAndDisposeInputsOrThrow(trunkGeoms, `tree-trunk(${id})`);
        const leaves = leavesGeoms.length > 0 ? mergeAndDisposeInputsOrThrow(leavesGeoms, `tree-leaves(${id})`) : trunk.clone();

        return { trunk, leaves };
    })();

    cacheTree.set(cacheKey, { promise });
    return promise;
}
