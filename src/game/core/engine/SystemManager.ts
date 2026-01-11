import type { FrameContext, System } from './System';

export class FunctionSystem implements System {
    public readonly name: string;
    private readonly onUpdate: (frame: FrameContext) => void;
    private readonly onDispose?: () => void;

    constructor(
        name: string,
        onUpdate: (frame: FrameContext) => void,
        onDispose?: () => void
    ) {
        this.name = name;
        this.onUpdate = onUpdate;
        this.onDispose = onDispose;
    }

    update(frame: FrameContext): void {
        this.onUpdate(frame);
    }

    dispose(): void {
        this.onDispose?.();
    }
}

export class SystemManager {
    private systems: System[] = [];

    add(system: System): this {
        this.systems.push(system);
        return this;
    }

    update(
        frame: FrameContext,
        timings?: Record<string, number>,
        now: () => number = () => performance.now()
    ): void {
        const measure = Boolean(timings);
        for (let i = 0; i < this.systems.length; i++) {
            const system = this.systems[i];
            if (!measure) {
                system.update(frame);
                continue;
            }

            const t0 = now();
            system.update(frame);
            timings![system.name] = now() - t0;
        }
    }

    dispose(): void {
        for (let i = this.systems.length - 1; i >= 0; i--) {
            try {
                this.systems[i].dispose?.();
            } catch {
                // Best-effort: dispose should never crash shutdown.
            }
        }
        this.systems = [];
    }
}
