export class LoadedGate {
    private pending = false;
    private remainingFrames = 0;
    private loaded = false;

    private readonly onLoaded: () => void;

    constructor(onLoaded: () => void) {
        this.onLoaded = onLoaded;
    }

    public isLoaded(): boolean {
        return this.loaded;
    }

    public start(delayFrames: number): void {
        if (this.loaded) return;
        this.pending = true;
        this.remainingFrames = Math.max(0, Math.floor(delayFrames));
    }

    public update(): void {
        if (!this.pending || this.loaded) return;

        this.remainingFrames--;
        if (this.remainingFrames <= 0) {
            this.pending = false;
            this.loaded = true;
            this.onLoaded();
        }
    }
}
