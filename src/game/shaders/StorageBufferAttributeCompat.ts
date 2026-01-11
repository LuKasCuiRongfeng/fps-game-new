import * as THREE from 'three';

export function createStorageBufferAttribute(
    array: Float32Array | Uint32Array | Int32Array | Uint16Array | Int16Array | Uint8Array | Int8Array,
    itemSize: number
): THREE.BufferAttribute {
    // NOTE: Keep this key non-static so Rollup doesn't rewrite it into a named import.
    // (three's ESM build doesn't always export StorageBufferAttribute as a named export.)
    const key = 'Storage' + 'BufferAttribute';
    const Ctor = (THREE as any)[key];
    if (typeof Ctor === 'function') {
        // @ts-ignore - WebGPU API
        return new Ctor(array, itemSize);
    }
    return new THREE.BufferAttribute(array as any, itemSize);
}
