import type { FrameContext, System } from '../core/engine/System';
import type { ParticleSimulation } from '../core/gpu/GpuSimulationFacade';

export class ParticleUpdateSystem implements System {
    public readonly name = 'particles';

    private readonly particles: ParticleSimulation;

    constructor(particles: ParticleSimulation) {
        this.particles = particles;
    }

    update(frame: FrameContext): void {
        this.particles.update(frame.delta);
    }
}
