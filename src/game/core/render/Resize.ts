import type * as THREE from 'three';
// @ts-ignore - WebGPU types not fully available
import type { WebGPURenderer } from 'three/webgpu';

export function resizeCameraAndRenderer(opts: {
    camera: THREE.PerspectiveCamera;
    renderer: WebGPURenderer;
    width: number;
    height: number;
}): void {
    opts.camera.aspect = opts.width / opts.height;
    opts.camera.updateProjectionMatrix();
    opts.renderer.setSize(opts.width, opts.height);
}
