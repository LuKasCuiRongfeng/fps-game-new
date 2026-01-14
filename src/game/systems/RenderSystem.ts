import type { FrameContext, System } from '../core/engine/System';
import type { PostProcessing } from 'three/webgpu';

export class RenderSystem implements System {
    public readonly name = 'render';

    private readonly postProcessing: PostProcessing;

    constructor(postProcessing: PostProcessing) {
        this.postProcessing = postProcessing;
    }

    update(_frame: FrameContext): void {
        // Official three/webgpu PostProcessing render is fire-and-forget.
        this.postProcessing.render();
    }
}
