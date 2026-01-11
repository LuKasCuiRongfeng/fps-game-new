export class FpsCounter {
    private frameCount = 0;
    private accumulatorSeconds = 0;
    private fps = 60;

    public getFPS(): number {
        return this.fps;
    }

    public update(deltaSeconds: number): void {
        this.frameCount++;
        this.accumulatorSeconds += deltaSeconds;

        if (this.accumulatorSeconds >= 1.0) {
            this.fps = Math.round(this.frameCount / this.accumulatorSeconds);
            this.frameCount = 0;
            this.accumulatorSeconds = 0;
        }
    }
}
