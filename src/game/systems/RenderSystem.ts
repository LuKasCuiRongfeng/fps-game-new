import type { FrameContext, System } from '../core/engine/System';
// @ts-ignore - WebGPU types not fully available
import type { PostProcessing } from 'three/webgpu';

export class RenderSystem implements System {
    public readonly name = 'render';

    private readonly postProcessing: PostProcessing;

    constructor(postProcessing: PostProcessing) {
        this.postProcessing = postProcessing;
    }

    update(_frame: FrameContext): void {
        // Intentionally not awaited; WebGPU work is scheduled asynchronously.
        this.postProcessing.render();
    }
}
