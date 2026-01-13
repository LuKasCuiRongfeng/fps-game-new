export type RandomFn = () => number;

/**
 * Deterministic RNG utilities for procedural generation.
 *
 * - `hash2iToU32` turns 2D integer coords + seed into a uint32.
 * - `mulberry32` returns a stable RNG function yielding [0, 1).
 * - `packChunkKey` packs signed int16 chunk coords into a uint32-like JS number.
 */

export function hash2iToU32(xi: number, zi: number, seed: number): number {
    // Force to 32-bit ints
    let x = xi | 0;
    let z = zi | 0;
    let h = (seed | 0) ^ 0x9e3779b9;

    // Mix (inspired by Jenkins/xxhash style avalanching)
    h ^= x + 0x7f4a7c15 + (h << 6) + (h >>> 2);
    h ^= z + 0x165667b1 + (h << 6) + (h >>> 2);

    // Final avalanche
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;

    return h >>> 0;
}

export function mulberry32(seedU32: number): RandomFn {
    let t = seedU32 >>> 0;
    return () => {
        t = (t + 0x6d2b79f5) >>> 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

export function packChunkKey(chunkX: number, chunkZ: number): number {
    // Signed 16-bit packing is plenty for a 10km radius with 500m chunks.
    const offset = 32768;
    const xx = (chunkX + offset) & 0xffff;
    const zz = (chunkZ + offset) & 0xffff;
    return (xx << 16) | zz;
}
