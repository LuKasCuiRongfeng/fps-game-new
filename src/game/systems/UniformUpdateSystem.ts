import type * as THREE from 'three';
import type { FrameContext, System } from '../core/engine/System';
import type { UniformManager } from '../shaders/TSLMaterials';

export class UniformUpdateSystem implements System {
    public readonly name = 'uniforms';

    private readonly uniforms: UniformManager;
    private readonly cameraPosition: THREE.Vector3;

    constructor(opts: { uniforms: UniformManager; cameraPosition: THREE.Vector3 }) {
        this.uniforms = opts.uniforms;
        this.cameraPosition = opts.cameraPosition;
    }

    update(frame: FrameContext): void {
        this.uniforms.update(frame.delta, this.cameraPosition, frame.health);
    }
}
