export interface FrameContext {
    delta: number;
    // Use the camera.position reference to avoid per-frame allocations.
    playerPos: { x: number; y: number; z: number };
    health: number;
    aimProgress: number;
}

export interface System {
    readonly name: string;
    update(frame: FrameContext): void;
    dispose?(): void;
}
