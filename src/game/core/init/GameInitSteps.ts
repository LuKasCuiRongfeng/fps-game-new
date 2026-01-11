import type { InitStep } from "./InitPipeline";

export type GameInitCallbacks = {
    initRendererAndUniforms: () => void;
    initSceneAndCamera: () => void;
    initPhysicsAndLevel: () => void;
    initPathfinding: () => void;
    initComputeAndParticles: () => void;
    initEffectsWeatherSoundAndGameplay: () => void;
    initPlayer: () => void;
    initPostFxAndRenderSystems: () => void;
    initCoreUpdateSystems: () => void;
    runWarmup: () => Promise<void>;
    startMainLoop: () => void;
};

export function createGameInitSteps(cb: GameInitCallbacks): InitStep[] {
    return [
        // Yield only on heavier steps by default (InitConfig can override globally).
        { name: "webgpu", run: cb.initRendererAndUniforms, yieldAfter: true },
        { name: "scene", run: cb.initSceneAndCamera, yieldAfter: true },
        { name: "physics", run: cb.initPhysicsAndLevel, yieldAfter: true },
        { name: "pathfinding", run: cb.initPathfinding },
        { name: "compute", run: cb.initComputeAndParticles, yieldAfter: true },
        { name: "effects", run: cb.initEffectsWeatherSoundAndGameplay, yieldAfter: true },
        { name: "player", run: cb.initPlayer, yieldAfter: true },
        { name: "postfx", run: cb.initPostFxAndRenderSystems, yieldAfter: true },
        { name: "core-systems", run: cb.initCoreUpdateSystems },
        { name: "warmup", run: cb.runWarmup, yieldAfter: true },
        { name: "start-loop", run: cb.startMainLoop, yieldAfter: true },
    ];
}
