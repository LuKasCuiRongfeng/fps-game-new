import type { FrameContext, System } from '../core/engine/System';
import type { GPUParticleSystem } from '../shaders/GPUParticles';

export class ParticleUpdateSystem implements System {
    public readonly name = 'particles';

    private readonly particles: GPUParticleSystem;

    constructor(particles: GPUParticleSystem) {
        this.particles = particles;
    }

    update(frame: FrameContext): void {
        this.particles.update(frame.delta);
    }
}
