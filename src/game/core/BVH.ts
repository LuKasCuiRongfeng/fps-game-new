import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

let enabled = false;

export function enableBVH() {
    if (enabled) return;
    enabled = true;

    // Patch prototypes once.
    (THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
    (THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
    (THREE.Mesh.prototype as any).raycast = acceleratedRaycast;
}

export function buildBVHForObject(root: THREE.Object3D) {
    root.traverse((obj) => {
        // Skip instanced meshes; BVH doesn't apply the same way and can be expensive.
        if ((obj as any).isInstancedMesh) return;
        if (!(obj as any).isMesh) return;

        const mesh = obj as THREE.Mesh;
        const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
        if (!geometry) return;

        // Already built
        if ((geometry as any).boundsTree) return;

        // Some geometries might be non-indexed or tiny; still fine.
        // Build bounds tree for faster raycast.
        try {
            // three-mesh-bvh adds computeBoundsTree/disposeBoundsTree at runtime via prototype patch.
            (geometry as any).computeBoundsTree?.();
        } catch {
            // If BVH build fails (rare), fall back to default raycast.
        }
    });
}
