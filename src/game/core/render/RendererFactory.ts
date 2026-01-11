import * as THREE from 'three';
// @ts-ignore - WebGPU types not fully available
import { WebGPURenderer } from 'three/webgpu';

export function createWebGPURenderer(container: HTMLElement): WebGPURenderer {
    const renderer = new WebGPURenderer({
        antialias: true,
        powerPreference: 'high-performance',
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    container.appendChild(renderer.domElement);

    return renderer;
}
