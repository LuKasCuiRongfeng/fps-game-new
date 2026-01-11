export type InitStep = {
    name: string;
    run: () => void | Promise<void>;
    yieldAfter?: boolean;
    yieldMs?: number;
};

export async function runInitPipeline(
    steps: InitStep[],
    options?: {
        yieldBetweenSteps?: boolean;
        yieldMs?: number;
    }
): Promise<void> {
    const yieldBetweenSteps = options?.yieldBetweenSteps ?? true;
    const yieldMs = options?.yieldMs ?? 0;

    for (const step of steps) {
        await step.run();

        const shouldYield = step.yieldAfter ?? yieldBetweenSteps;
        const ms = step.yieldMs ?? yieldMs;

        if (shouldYield) {
            await new Promise<void>((resolve) => setTimeout(resolve, ms));
        }
    }
}
