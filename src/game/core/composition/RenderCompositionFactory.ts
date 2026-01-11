import type * as THREE from 'three';
// @ts-ignore - WebGPU types not fully available
import type { WebGPURenderer, PostProcessing } from 'three/webgpu';

import type { UniformManager } from '../../shaders/TSLMaterials';
import { createPostFXPipeline } from '../render/PostFXPipeline';
import type { NumberUniform } from '../render/PostFXPipeline';

import { ShadowSystem } from '../../systems/ShadowSystem';
import { RenderSystem } from '../../systems/RenderSystem';

export function createRenderComposition(opts: {
    renderer: WebGPURenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    uniforms: UniformManager;
    sunLight: THREE.DirectionalLight;
}): {
    postProcessing: PostProcessing;
    scopeAimProgress: NumberUniform;
    shadowSystem: ShadowSystem;
    renderSystem: RenderSystem;
} {
    const fx = createPostFXPipeline({
        renderer: opts.renderer,
        scene: opts.scene,
        camera: opts.camera,
        uniforms: opts.uniforms,
    });

    const shadowSystem = new ShadowSystem(opts.sunLight);
    const renderSystem = new RenderSystem(fx.postProcessing);

    return {
        postProcessing: fx.postProcessing,
        scopeAimProgress: fx.scopeAimProgress,
        shadowSystem,
        renderSystem,
    };
}
