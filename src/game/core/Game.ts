/**
 * Game - 使用 TSL 和 GPU Compute 优化的游戏主类
 * 集成所有 shader 系统，最大化 GPU 性能
 */
import * as THREE from "three";
import { Level } from "../level/Level";
import { Pathfinding } from "./Pathfinding";
import { PhysicsSystem } from "./PhysicsSystem";
import { enableBVH } from './BVH';
import { UniformManager } from "../shaders/TSLMaterials";
import {
    EnemyConfig,
    EffectConfig,
} from "./GameConfig";
import { SystemManager } from './engine/SystemManager';
import { fillFrameContext } from './engine/FrameContextBuilder';
import { runShaderWarmup } from './warmup/ShaderWarmupService';
import { resolveWarmupOptions } from './warmup/WarmupConfig';
import { runInitPipeline } from './init/InitPipeline';
import { resolveInitConfig } from './init/InitConfig';
import { createGameInitSteps } from './init/GameInitSteps';
import { LoadedGate } from './init/LoadedGate';
import { HitchProfiler, resolveHitchProfilerSettings } from './perf/HitchProfiler';
import { FpsCounter } from './perf/FpsCounter';
import { createWebGPURenderer } from './render/RendererFactory';
import { createSceneAndCamera } from './render/SceneFactory';
import { resizeCameraAndRenderer } from './render/Resize';
import { createGameplayComposition } from './composition/GameplayComposition';
import { createPlayerController } from './composition/PlayerFactory';
import { createGpuSystems } from './composition/GpuSystemsFactory';
import { createAndRegisterSystemGraph } from './composition/SystemGraphFactory';
import { createRenderComposition } from './composition/RenderCompositionFactory';
import { createWebGpuSimulationFacade } from './gpu/GpuSimulationFacade';

import type { RuntimeSettings } from './settings/RuntimeSettings';
import type { RuntimeSettingsSource } from './settings/RuntimeSettings';
import { createDefaultRuntimeSettings } from './settings/RuntimeSettingsStore';

import { getDefaultGameServices } from './services/GameServices';
import type { GameServices } from './services/GameServices';

import { GameEventBus } from './events/GameEventBus';
import { attachDefaultGameEventHandlers } from './events/DefaultGameEventHandlers';
import type { GameRuntime } from './runtime/GameRuntime';
import type { GpuSimulationFacade, ParticleSimulation } from './gpu/GpuSimulationFacade';

type GameRuntimeBuilder = Pick<
    GameRuntime,
    | "container"
    | "renderer"
    | "objects"
    | "uniforms"
    | "services"
    | "events"
    | "clock"
    | "fpsCounter"
    | "hitchProfiler"
    | "systemManager"
    | "frameContext"
    | "systemTimings"
    | "loadedGate"
    | "disposeDefaultEventHandlers"
> & {
    scene?: GameRuntime["scene"];
    camera?: GameRuntime["camera"];
    world?: Pick<GameRuntime["world"], "physicsSystem" | "level"> & {
        pathfinding?: GameRuntime["world"]["pathfinding"];
    };
    gpu?: GameRuntime["gpu"];
    render?: {
        ambientLight: GameRuntime["render"]["ambientLight"];
        sunLight: GameRuntime["render"]["sunLight"];
        postProcessing?: GameRuntime["render"]["postProcessing"];
        scopeAimProgress?: GameRuntime["render"]["scopeAimProgress"];
        shadowSystem?: GameRuntime["render"]["shadowSystem"];
        renderSystem?: GameRuntime["render"]["renderSystem"];
    };
    gameplay?: GameRuntime["gameplay"];
    player?: GameRuntime["player"];
};

export class Game {
    private container: HTMLElement;
    private clock: THREE.Clock;

    // Runtime graph: renderer/scene/camera/systems are grouped here to keep Game as a composition root.
    private runtime: GameRuntime | null = null;

    // During the init pipeline we build up the runtime incrementally without using `null as any`.
    private runtimeBuilder: GameRuntimeBuilder | null = null;

    private initConfig = resolveInitConfig();

    // Keep a stable function reference so removeEventListener works.
    private readonly onResizeBound = this.onWindowResize.bind(this);

    // 游戏对象
    private objects: THREE.Object3D[] = [];

    private readonly fpsCounter = new FpsCounter();

    private hitchProfiler: HitchProfiler;

    // 加载回调
    private onProgressCallback?: (progress: number, desc: string) => void;
    private onLoadedCallback?: () => void;
    private readonly loadedGate: LoadedGate;

    private runtimeSettings: RuntimeSettings = createDefaultRuntimeSettings();
    private readonly runtimeSettingsSource: RuntimeSettingsSource = {
        getRuntimeSettings: () => this.runtimeSettings,
    };

    private readonly services: GameServices;

    private readonly events = new GameEventBus();
    private disposeDefaultEventHandlers: (() => void) | null = null;

    constructor(
        container: HTMLElement,
        onLoaded?: () => void,
        onProgress?: (progress: number, desc: string) => void,
        opts?: { runtimeSettings?: RuntimeSettings; services?: GameServices }
    ) {
        this.container = container;
        this.onLoadedCallback = onLoaded;
        this.onProgressCallback = onProgress;
        this.clock = new THREE.Clock();

        this.services = opts?.services ?? getDefaultGameServices();

        if (opts?.runtimeSettings) {
            this.runtimeSettings = opts.runtimeSettings;
        }

        this.hitchProfiler = new HitchProfiler(resolveHitchProfilerSettings());

        this.loadedGate = new LoadedGate(() => {
            this.updateProgress(100, "Game Loaded");
            this.onLoadedCallback?.();
        });

        // 异步初始化流程，以支持进度更新
        this.initGame();
    }

    /** Best-effort pointer lock (may require a user gesture in browsers). */
    public lockPointer() {
        try {
            this.runtime?.player.controller?.lock();
        } catch {
            // ignore
        }
    }

    public unlockPointer() {
        try {
            this.runtime?.player.controller?.unlock();
        } catch {
            // ignore
        }
    }

    private readonly updateProgress = (progress: number, desc: string) => {
        if (this.onProgressCallback) {
            this.onProgressCallback(progress, desc);
        }
        // 简单的延迟，让 UI 有机会渲染 (在同步代码中这其实并不真正让出主线程，但对于步骤间的逻辑分隔有用)
        // 在 React 的 useEffect 中使用 setTimeout 才是真正让出主线程的关键
    };

    private async initGame() {
        const actions = {
            initRendererAndUniforms: () => this.initRendererAndUniforms(),
            initSceneAndCamera: () => this.initSceneAndCamera(),
            initPhysicsAndLevel: () => this.initPhysicsAndLevel(),
            initPathfinding: () => this.initPathfinding(),
            initComputeAndParticles: () => this.initComputeAndParticles(),
            initEffectsWeatherSoundAndGameplay: () => this.initEffectsWeatherSoundAndGameplay(),
            initPlayer: () => this.initPlayer(),
            initPostFxAndRenderSystems: () => this.initPostFxAndRenderSystems(),
            initCoreUpdateSystems: () => this.initCoreUpdateSystems(),
            runWarmup: () => this.runWarmup(),
            startMainLoop: () => this.startMainLoop(),
        };

        await runInitPipeline(
            createGameInitSteps(actions),
            { yieldBetweenSteps: this.initConfig.yieldBetweenSteps, yieldMs: this.initConfig.yieldMs }
        );
    }

    private requireBuilder(step: string): GameRuntimeBuilder {
        const builder = this.runtimeBuilder;
        if (!builder) {
            throw new Error(`Game init error: runtime builder missing at ${step}`);
        }
        return builder;
    }

    private finalizeRuntime(): void {
        const builder = this.requireBuilder("finalizeRuntime");

        const assertDefined = <T>(value: T | null | undefined, name: string): T => {
            if (value === undefined || value === null) {
                throw new Error(`Game init error: ${name} not ready`);
            }
            return value;
        };

        const scene = assertDefined(builder.scene, "scene");
        const camera = assertDefined(builder.camera, "camera");

        const worldPartial = assertDefined(builder.world, "world");
        const world: GameRuntime["world"] = {
            physicsSystem: worldPartial.physicsSystem,
            level: worldPartial.level,
            pathfinding: assertDefined(worldPartial.pathfinding, "world.pathfinding"),
        };

        const gpu = assertDefined(builder.gpu, "gpu");

        const renderPartial = assertDefined(builder.render, "render");
        const render: GameRuntime["render"] = {
            postProcessing: assertDefined(renderPartial.postProcessing, "render.postProcessing"),
            scopeAimProgress: assertDefined(renderPartial.scopeAimProgress, "render.scopeAimProgress"),
            shadowSystem: assertDefined(renderPartial.shadowSystem, "render.shadowSystem"),
            renderSystem: assertDefined(renderPartial.renderSystem, "render.renderSystem"),
            ambientLight: renderPartial.ambientLight,
            sunLight: renderPartial.sunLight,
        };

        const gameplay = assertDefined(builder.gameplay, "gameplay");
        const player = assertDefined(builder.player, "player");

        this.runtime = {
            container: builder.container,
            renderer: builder.renderer,
            scene,
            camera,
            objects: builder.objects,
            uniforms: builder.uniforms,
            services: builder.services,
            events: builder.events,
            clock: builder.clock,
            fpsCounter: builder.fpsCounter,
            hitchProfiler: builder.hitchProfiler,
            systemManager: builder.systemManager,
            frameContext: builder.frameContext,
            systemTimings: builder.systemTimings,
            loadedGate: builder.loadedGate,
            world,
            gpu,
            render,
            gameplay,
            player,
            disposeDefaultEventHandlers: builder.disposeDefaultEventHandlers,
        };

        this.runtimeBuilder = null;
    }

    private initRendererAndUniforms(): void {
        this.updateProgress(10, "i18n:loading.stage.webgpu");

        const uniforms = UniformManager.getInstance();

        // Default event wiring: systems emit events; this adapter updates state, plays audio, and triggers common FX.
        this.disposeDefaultEventHandlers?.();
        this.disposeDefaultEventHandlers = attachDefaultGameEventHandlers(this.events, {
            services: this.services,
            setDamageFlashIntensity: (v) => {
                uniforms.damageFlash.value = v;
            },
        });

        const renderer = createWebGPURenderer(this.container);

        this.runtimeBuilder = {
            container: this.container,
            renderer,
            objects: this.objects,
            uniforms,
            services: this.services,
            events: this.events,
            clock: this.clock,
            fpsCounter: this.fpsCounter,
            hitchProfiler: this.hitchProfiler,
            systemManager: new SystemManager(),
            frameContext: {
                delta: 0,
                playerPos: { x: 0, y: 0, z: 0 },
                health: 0,
                aimProgress: 0,
            },
            systemTimings: Object.create(null),
            loadedGate: this.loadedGate,
            disposeDefaultEventHandlers: this.disposeDefaultEventHandlers,
        };
    }

    private initSceneAndCamera(): void {
        this.updateProgress(20, "i18n:loading.stage.scene");

        const builder = this.requireBuilder("initSceneAndCamera");

        const created = createSceneAndCamera();
        builder.scene = created.scene;
        builder.camera = created.camera;
        // render module is filled later; store lights there for discoverability
        builder.render = {
            ambientLight: created.ambientLight,
            sunLight: created.sunLight,
        };
    }

    private initPhysicsAndLevel(): void {
        this.updateProgress(30, "i18n:loading.stage.physics");
        enableBVH();

        const builder = this.requireBuilder("initPhysicsAndLevel");
        if (!builder.scene) return;

        const physicsSystem = new PhysicsSystem();
        const level = new Level(builder.scene, this.objects, physicsSystem);
        builder.world = {
            physicsSystem,
            level,
        };
    }

    private initPathfinding(): void {
        this.updateProgress(45, "i18n:loading.stage.pathfinding");
        const builder = this.requireBuilder("initPathfinding");
        if (!builder.world) return;
        const pathfinding = new Pathfinding(this.objects);
        builder.world.pathfinding = pathfinding;
    }

    private initComputeAndParticles(): void {
        this.updateProgress(55, "i18n:loading.stage.compute");

        const builder = this.requireBuilder("initComputeAndParticles");
        if (!builder.scene) return;

        const gpu = createGpuSystems({
            renderer: builder.renderer,
            scene: builder.scene,
            gpuCompute: this.initConfig.gpuCompute,
            particles: this.initConfig.particles,
        });

        builder.gpu = {
            gpuCompute: gpu.gpuCompute,
            particleSystem: gpu.particleSystem,
            simulation: createWebGpuSimulationFacade({
                gpuCompute: gpu.gpuCompute,
                particleSystem: gpu.particleSystem,
            }),
        };
    }

    private initEffectsWeatherSoundAndGameplay(): void {
        this.updateProgress(65, "i18n:loading.stage.effects");

        const builder = this.requireBuilder("initEffectsWeatherSoundAndGameplay");
        if (!builder.scene || !builder.camera || !builder.world || !builder.world.pathfinding || !builder.gpu || !builder.render) return;

        const gameplay = createGameplayComposition({
            events: this.events,
            services: this.services,
            scene: builder.scene,
            camera: builder.camera,
            renderer: builder.renderer,
            objects: this.objects,
            level: builder.world.level,
            physicsSystem: builder.world.physicsSystem,
            pathfinding: builder.world.pathfinding,
            simulation: builder.gpu.simulation,
            uniforms: builder.uniforms,
            ambientLight: builder.render.ambientLight,
            sunLight: builder.render.sunLight,
            maxGpuEnemies: this.initConfig.gpuCompute.maxEnemies,
        });

        builder.gameplay = {
            explosionManager: gameplay.explosionManager,
            weatherSystem: gameplay.weatherSystem,
            soundManager: gameplay.soundManager,
            enemyTrailSystem: gameplay.enemyTrailSystem,
            enemySystem: gameplay.enemySystem,
            pickupSystem: gameplay.pickupSystem,
            grenadeSystem: gameplay.grenadeSystem,
            spawnSystem: gameplay.spawnSystem,
            audioSystem: gameplay.audioSystem,
        };
    }

    private initPlayer(): void {
        this.updateProgress(75, "i18n:loading.stage.player");

        const builder = this.requireBuilder("initPlayer");
        if (!builder.scene || !builder.camera || !builder.world || !builder.gpu || !builder.gameplay) return;

        const controller = createPlayerController({
            settings: this.runtimeSettingsSource,
            services: this.services,
            events: this.events,
            camera: builder.camera,
            container: this.container,
            scene: builder.scene,
            objects: this.objects,
            physicsSystem: builder.world.physicsSystem,
            level: builder.world.level,
            particleSystem: builder.gpu.simulation.particles,
            enemies: builder.gameplay.enemySystem.all,
            pickups: builder.gameplay.pickupSystem,
            grenades: builder.gameplay.grenadeSystem,
            weather: builder.gameplay.weatherSystem,
            spawn: { x: 0, z: 0 },
        });

        builder.player = { controller };
    }

    public setRuntimeSettings(settings: RuntimeSettings): void {
        this.runtimeSettings = settings;
    }

    /** Reset the current session without reloading the page. */
    public reset(): void {
        try {
            this.services.state.reset();

            const runtime = this.runtime;
            if (!runtime) return;

            // Best-effort: clear active enemies so a new run starts clean.
            runtime.gameplay.enemySystem.clearAll();

            // Reset player physics + position.
            const spawnX = 0;
            const spawnZ = 0;
            const spawnHeight = runtime.world.level?.getTerrainHeight(spawnX, spawnZ) ?? 0;
            runtime.camera.position.set(spawnX, spawnHeight + 2.0, spawnZ);
            runtime.player.controller?.resetPhysics?.();
        } catch {
            // ignore
        }
    }

    private initPostFxAndRenderSystems(): void {
        this.updateProgress(85, "i18n:loading.stage.postfx");
        const builder = this.requireBuilder("initPostFxAndRenderSystems");
        if (!builder.scene || !builder.camera || !builder.render) return;
        const render = createRenderComposition({
            renderer: builder.renderer,
            scene: builder.scene,
            camera: builder.camera,
            uniforms: builder.uniforms,
            sunLight: builder.render.sunLight,
        });
        builder.render.postProcessing = render.postProcessing;
        builder.render.scopeAimProgress = render.scopeAimProgress;
        builder.render.shadowSystem = render.shadowSystem;
        builder.render.renderSystem = render.renderSystem;
    }

    private initCoreUpdateSystems(): void {
        const builder = this.requireBuilder("initCoreUpdateSystems");
        if (!builder.camera || !builder.world || !builder.gpu || !builder.render || !builder.gameplay || !builder.player) return;
        if (!builder.render.scopeAimProgress || !builder.render.shadowSystem || !builder.render.renderSystem) return;

        const core = createAndRegisterSystemGraph({
            systemManager: builder.systemManager,
            player: builder.player.controller,
            camera: builder.camera,
            scopeAimProgress: builder.render.scopeAimProgress,
            uniforms: builder.uniforms,
            simulation: builder.gpu.simulation,
            level: builder.world.level,
            enemyConfig: EnemyConfig,
            weatherSystem: builder.gameplay.weatherSystem,
            enemySystem: builder.gameplay.enemySystem,
            enemyTrailSystem: builder.gameplay.enemyTrailSystem,
            grenadeSystem: builder.gameplay.grenadeSystem,
            pickupSystem: builder.gameplay.pickupSystem,
            spawnSystem: builder.gameplay.spawnSystem,
            audioSystem: builder.gameplay.audioSystem,
            shadowSystem: builder.render.shadowSystem,
            renderSystem: builder.render.renderSystem,
        });

        void core;

        // All required runtime pieces are now available; freeze into a fully-typed runtime object.
        this.finalizeRuntime();

        this.updateProgress(90, "i18n:loading.stage.spawn");
        window.addEventListener("resize", this.onResizeBound);
    }

    private async runWarmup(): Promise<void> {
        if (!this.runtime) return;
        await runShaderWarmup({
            renderer: this.runtime.renderer,
            scene: this.runtime.scene,
            camera: this.runtime.camera,
            playerController: this.runtime.player.controller,
            level: this.runtime.world.level,
            physicsSystem: this.runtime.world.physicsSystem,
            enemySystem: this.runtime.gameplay.enemySystem,
            uniformManager: this.runtime.uniforms,
            simulation: this.runtime.gpu.simulation,
            postProcessing: this.runtime.render.postProcessing,
            updateProgress: this.updateProgress,
            options: resolveWarmupOptions(),
        });
    }

    private startMainLoop(): void {
        this.updateProgress(98, "i18n:loading.stage.startLoop");
        this.runtime?.renderer.setAnimationLoop(this.animate);

        this.updateProgress(99, "i18n:loading.stage.finalize");
        this.loadedGate.start(this.initConfig.loading.onLoadedDelayFrames);
    }

    /**
     * 设置光照
     */
    /**
     * 窗口大小变化
     */
    private onWindowResize() {
        if (!this.runtime) return;
        resizeCameraAndRenderer({
            camera: this.runtime.camera,
            renderer: this.runtime.renderer,
            width: window.innerWidth,
            height: window.innerHeight,
        });
    }

    /**
     * 主循环
     */
    private readonly animate = () => {
        const runtime = this.runtime;
        if (!runtime) return;

        const frameStartMs = runtime.hitchProfiler.beginFrame();
        const rawDelta = runtime.clock.getDelta();
        const delta = Math.min(rawDelta, 0.1);

        runtime.fpsCounter.update(delta);

        const gameState = this.services.state.getState();

        if (gameState.isGameOver) {
            runtime.player.controller.unlock();
            return;
        }

        // Update core systems (uniforms/compute/particles/weather/level) via SystemManager.
        // Keeps the main loop slimmer and makes it easier to add/remove systems.
        fillFrameContext({
            frame: runtime.frameContext,
            delta,
            cameraPosition: runtime.camera.position,
            health: gameState.health,
        });

        if (runtime.hitchProfiler.isEnabled()) {
            // Keep per-system timings for hitch logs.
            let t0 = performance.now();
            runtime.systemManager.update(runtime.frameContext, runtime.systemTimings, () => performance.now());
            const _tCoreSystemsMs = performance.now() - t0;
            void _tCoreSystemsMs;
        } else {
            runtime.systemManager.update(runtime.frameContext);
        }

        // Hitch profiler logging (heavy work only runs on slow frames).
        if (runtime.hitchProfiler.isEnabled()) {
            runtime.hitchProfiler.recordFrame({
                frameStartMs,
                rawDeltaSeconds: rawDelta,
                camera: runtime.camera,
                renderer: runtime.renderer,
                systemTimings: runtime.systemTimings,
                enemies: runtime.gameplay.enemySystem,
                pickups: runtime.gameplay.pickupSystem,
                grenades: runtime.gameplay.grenadeSystem,
            });
        }

        // Defer "loaded" callback until a few frames have been presented.
        runtime.loadedGate.update();

    };

    /**
     * 获取当前 FPS
     */
    public getFPS(): number {
        return this.fpsCounter.getFPS();
    }

    /**
     * 获取粒子系统 (用于外部触发效果)
     */
    public getSimulation(): GpuSimulationFacade {
        if (!this.runtime) {
            throw new Error('Game runtime not initialized yet');
        }
        return this.runtime.gpu.simulation;
    }

    public getParticles(): ParticleSimulation {
        return this.getSimulation().particles;
    }

    /**
     * 触发伤害效果
     */
    public triggerDamageEffect() {
        const runtime = this.runtime;
        if (!runtime) return;
        runtime.uniforms.damageFlash.value = EffectConfig.damageFlash.intensity;
    }

    /**
     * 销毁
     */
    public dispose() {
        this.disposeDefaultEventHandlers?.();
        this.disposeDefaultEventHandlers = null;

        const runtime = this.runtime;
        if (!runtime) return;

        runtime.disposeDefaultEventHandlers = null;

        // Stop the render loop first so nothing schedules more GPU work.
        try {
            runtime.renderer.setAnimationLoop(null);
        } catch {
            // ignore
        }

        runtime.player.controller.dispose();
        runtime.systemManager.dispose();
        runtime.gameplay.explosionManager.dispose();

        // GPU resources (explicit)
        try {
            runtime.gpu.gpuCompute.dispose();
        } catch {
            // ignore
        }
        try {
            runtime.gpu.particleSystem.dispose();
        } catch {
            // ignore
        }

        runtime.render.postProcessing.dispose();

        runtime.renderer.dispose();

        window.removeEventListener("resize", this.onResizeBound);
        this.container.removeChild(runtime.renderer.domElement);

        this.runtime = null;
    }
}
