import { readBooleanFlag, readNumber } from "../runtime/RuntimeToggles";

export type InitConfig = {
    yieldBetweenSteps: boolean;
    yieldMs: number;

    gpuCompute: {
        gridSize: number;
        maxEnemies: number;
    };

    particles: {
        maxParticles: number;
    };

    loading: {
        onLoadedDelayFrames: number;
    };
};

export const DefaultInitConfig: InitConfig = {
    // Default to yielding only on selected expensive steps.
    // Can be overridden via `?initYield=1`.
    yieldBetweenSteps: false,
    yieldMs: 0,

    gpuCompute: {
        gridSize: 100,
        maxEnemies: 10000,
    },

    particles: {
        maxParticles: 50000,
    },

    loading: {
        onLoadedDelayFrames: 8,
    },
};

export function resolveInitConfig(): InitConfig {
    const config: InitConfig = {
        ...DefaultInitConfig,
        gpuCompute: { ...DefaultInitConfig.gpuCompute },
        particles: { ...DefaultInitConfig.particles },
        loading: { ...DefaultInitConfig.loading },
    };

    const yieldParam = readBooleanFlag("initYield");
    if (yieldParam !== null) config.yieldBetweenSteps = yieldParam;

    const yieldMs = readNumber("initYieldMs");
    if (yieldMs !== null && yieldMs >= 0) config.yieldMs = yieldMs;

    const onLoadedDelayFrames = readNumber("onLoadedDelayFrames");
    if (onLoadedDelayFrames !== null && onLoadedDelayFrames >= 0) {
        config.loading.onLoadedDelayFrames = onLoadedDelayFrames;
    }

    const maxParticles = readNumber("maxParticles");
    if (maxParticles !== null && maxParticles > 0) config.particles.maxParticles = maxParticles;

    const maxEnemies = readNumber("maxGpuEnemies");
    if (maxEnemies !== null && maxEnemies > 0) config.gpuCompute.maxEnemies = maxEnemies;

    const gridSize = readNumber("gpuGridSize");
    if (gridSize !== null && gridSize > 0) config.gpuCompute.gridSize = gridSize;

    return config;
}
