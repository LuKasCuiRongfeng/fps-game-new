/**
 * Game - 使用 TSL 和 GPU Compute 优化的游戏主类
 * 集成所有 shader 系统，最大化 GPU 性能
 */
import * as THREE from "three";
// @ts-ignore - WebGPU types not fully available
import { WebGPURenderer, PostProcessing } from "three/webgpu";

import { PlayerController } from "../player/PlayerController";
import { ExplosionManager } from "../entities/ExplosionEffect";
import { SoundManager } from "./SoundManager";
import { Level } from "../level/Level";
import { Pathfinding } from "./Pathfinding";
import { PhysicsSystem } from "./PhysicsSystem";
import { enableBVH } from './BVH';
import { UniformManager } from "../shaders/TSLMaterials";
import { GPUComputeSystem } from "../shaders/GPUCompute";
import { GPUParticleSystem } from "../shaders/GPUParticles";
import {
    LevelConfig,
    EnemyConfig,
    EffectConfig,
} from "./GameConfig";
import { WeatherSystem } from "../level/WeatherSystem";
import type { FrameContext } from './engine/System';
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
import type { NumberUniform } from './render/PostFXPipeline';
import { createWebGPURenderer } from './render/RendererFactory';
import { createSceneAndCamera } from './render/SceneFactory';
import { resizeCameraAndRenderer } from './render/Resize';
import { createGameplayComposition } from './composition/GameplayComposition';
import { createPlayerController } from './composition/PlayerFactory';
import { createGpuSystems } from './composition/GpuSystemsFactory';
import { createAndRegisterSystemGraph } from './composition/SystemGraphFactory';
import { createRenderComposition } from './composition/RenderCompositionFactory';

import type { RuntimeSettings } from './settings/RuntimeSettings';
import type { RuntimeSettingsSource } from './settings/RuntimeSettings';
import { createDefaultRuntimeSettings } from './settings/RuntimeSettingsStore';

import { getDefaultGameServices } from './services/GameServices';
import type { GameServices } from './services/GameServices';

import { GameEventBus } from './events/GameEventBus';
import { attachDefaultGameEventHandlers } from './events/DefaultGameEventHandlers';

import { EnemyTrailSystem } from '../systems/EnemyTrailSystem';
import { EnemySystem } from '../systems/EnemySystem';
import { PickupSystem } from '../systems/PickupSystem';
import { GrenadeSystem } from '../systems/GrenadeSystem';
import { SpawnSystem } from '../systems/SpawnSystem';
import { AudioSystem } from '../systems/AudioSystem';
import type { ShadowSystem } from '../systems/ShadowSystem';
import type { RenderSystem } from '../systems/RenderSystem';
import type { PlayerUpdateSystem } from '../systems/PlayerUpdateSystem';
import type { UniformUpdateSystem } from '../systems/UniformUpdateSystem';
import type { GPUComputeUpdateSystem } from '../systems/GPUComputeUpdateSystem';
import type { ParticleUpdateSystem } from '../systems/ParticleUpdateSystem';
import type { LevelUpdateSystem } from '../systems/LevelUpdateSystem';

export class Game {
    private container: HTMLElement;
    private renderer: WebGPURenderer;
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private playerController: PlayerController;
    private clock: THREE.Clock;

    private systemManager = new SystemManager();
    private frameContext: FrameContext = {
        delta: 0,
        playerPos: { x: 0, y: 0, z: 0 },
        health: 0,
        aimProgress: 0,
    };
    private systemTimings: Record<string, number> = Object.create(null);

    private initConfig = resolveInitConfig();

    // Keep a stable function reference so removeEventListener works.
    private readonly onResizeBound = this.onWindowResize.bind(this);

    // 游戏对象
    private objects: THREE.Object3D[] = [];

    // Domain systems (gameplay)
    private enemyTrailSystem!: EnemyTrailSystem;
    private enemySystem!: EnemySystem;
    private pickupSystem!: PickupSystem;
    private grenadeSystem!: GrenadeSystem;
    private spawnSystem!: SpawnSystem;
    private audioSystem!: AudioSystem;

    // 系统
    private physicsSystem!: PhysicsSystem;
    private pathfinding!: Pathfinding;
    private level!: Level;
    private uniformManager: UniformManager;
    private gpuCompute!: GPUComputeSystem;
    private particleSystem!: GPUParticleSystem;
    private explosionManager!: ExplosionManager;
    private weatherSystem!: WeatherSystem;
    private soundManager: SoundManager | null = null;

    // 光照引用 (用于天气系统)
    private ambientLight!: THREE.AmbientLight;
    private sunLight!: THREE.DirectionalLight;

    // 后处理
    private postProcessing!: PostProcessing;
    private scopeAimProgress!: NumberUniform; // 瞄准进度 (0-1)

    private shadowSystem!: ShadowSystem;
    private renderSystem!: RenderSystem;

    // Core update systems (no ad-hoc closures)
    private playerUpdateSystem!: PlayerUpdateSystem;
    private uniformUpdateSystem!: UniformUpdateSystem;
    private gpuComputeUpdateSystem!: GPUComputeUpdateSystem;
    private particleUpdateSystem!: ParticleUpdateSystem;
    private levelUpdateSystem!: LevelUpdateSystem;

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
            this.playerController?.lock();
        } catch {
            // ignore
        }
    }

    public unlockPointer() {
        try {
            this.playerController?.unlock();
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

    private initRendererAndUniforms(): void {
        this.updateProgress(10, "i18n:loading.stage.webgpu");

        this.uniformManager = UniformManager.getInstance();

        // Default event wiring: systems emit events; this adapter updates state, plays audio, and triggers common FX.
        this.disposeDefaultEventHandlers?.();
        this.disposeDefaultEventHandlers = attachDefaultGameEventHandlers(this.events, {
            services: this.services,
            setDamageFlashIntensity: (v) => {
                this.uniformManager.damageFlash.value = v;
            },
        });

        this.renderer = createWebGPURenderer(this.container);
    }

    private initSceneAndCamera(): void {
        this.updateProgress(20, "i18n:loading.stage.scene");

        const created = createSceneAndCamera();
        this.scene = created.scene;
        this.camera = created.camera;
        this.ambientLight = created.ambientLight;
        this.sunLight = created.sunLight;
    }

    private initPhysicsAndLevel(): void {
        this.updateProgress(30, "i18n:loading.stage.physics");
        enableBVH();

        this.physicsSystem = new PhysicsSystem();
        this.level = new Level(this.scene, this.objects, this.physicsSystem);
    }

    private initPathfinding(): void {
        this.updateProgress(45, "i18n:loading.stage.pathfinding");
        this.pathfinding = new Pathfinding(this.objects);
    }

    private initComputeAndParticles(): void {
        this.updateProgress(55, "i18n:loading.stage.compute");
        const gpu = createGpuSystems({
            renderer: this.renderer,
            scene: this.scene,
            gpuCompute: this.initConfig.gpuCompute,
            particles: this.initConfig.particles,
        });
        this.gpuCompute = gpu.gpuCompute;
        this.particleSystem = gpu.particleSystem;
    }

    private initEffectsWeatherSoundAndGameplay(): void {
        this.updateProgress(65, "i18n:loading.stage.effects");

        const gameplay = createGameplayComposition({
            events: this.events,
            services: this.services,
            scene: this.scene,
            camera: this.camera,
            renderer: this.renderer,
            objects: this.objects,
            level: this.level,
            physicsSystem: this.physicsSystem,
            pathfinding: this.pathfinding,
            gpuCompute: this.gpuCompute,
            particleSystem: this.particleSystem,
            uniforms: this.uniformManager,
            ambientLight: this.ambientLight,
            sunLight: this.sunLight,
            maxGpuEnemies: 100,
        });

        this.explosionManager = gameplay.explosionManager;
        this.weatherSystem = gameplay.weatherSystem;
        this.soundManager = gameplay.soundManager;
        this.enemyTrailSystem = gameplay.enemyTrailSystem;
        this.enemySystem = gameplay.enemySystem;
        this.pickupSystem = gameplay.pickupSystem;
        this.grenadeSystem = gameplay.grenadeSystem;
        this.spawnSystem = gameplay.spawnSystem;
        this.audioSystem = gameplay.audioSystem;
    }

    private initPlayer(): void {
        this.updateProgress(75, "i18n:loading.stage.player");

        this.playerController = createPlayerController({
            settings: this.runtimeSettingsSource,
            services: this.services,
            events: this.events,
            camera: this.camera,
            container: this.container,
            scene: this.scene,
            objects: this.objects,
            physicsSystem: this.physicsSystem,
            level: this.level,
            particleSystem: this.particleSystem,
            enemies: this.enemySystem.all,
            pickups: this.pickupSystem,
            grenades: this.grenadeSystem,
            weather: this.weatherSystem,
            spawn: { x: 0, z: 0 },
        });
    }

    public setRuntimeSettings(settings: RuntimeSettings): void {
        this.runtimeSettings = settings;
    }

    /** Reset the current session without reloading the page. */
    public reset(): void {
        try {
            this.services.state.reset();

            // Best-effort: clear active enemies so a new run starts clean.
            (this.enemySystem as any)?.clearAll?.();

            // Reset player physics + position.
            const spawnX = 0;
            const spawnZ = 0;
            const spawnHeight = this.level?.getTerrainHeight(spawnX, spawnZ) ?? 0;
            this.camera.position.set(spawnX, spawnHeight + 2.0, spawnZ);
            this.playerController?.resetPhysics?.();
        } catch {
            // ignore
        }
    }

    private initPostFxAndRenderSystems(): void {
        this.updateProgress(85, "i18n:loading.stage.postfx");
        const render = createRenderComposition({
            renderer: this.renderer,
            scene: this.scene,
            camera: this.camera,
            uniforms: this.uniformManager,
            sunLight: this.sunLight,
        });
        this.postProcessing = render.postProcessing;
        this.scopeAimProgress = render.scopeAimProgress;
        this.shadowSystem = render.shadowSystem;
        this.renderSystem = render.renderSystem;
    }

    private initCoreUpdateSystems(): void {
        const core = createAndRegisterSystemGraph({
            systemManager: this.systemManager,
            player: this.playerController,
            camera: this.camera,
            scopeAimProgress: this.scopeAimProgress,
            uniforms: this.uniformManager,
            gpuCompute: this.gpuCompute,
            particleSystem: this.particleSystem,
            level: this.level,
            enemyConfig: EnemyConfig,
            weatherSystem: this.weatherSystem,
            enemySystem: this.enemySystem,
            enemyTrailSystem: this.enemyTrailSystem,
            grenadeSystem: this.grenadeSystem,
            pickupSystem: this.pickupSystem,
            spawnSystem: this.spawnSystem,
            audioSystem: this.audioSystem,
            shadowSystem: this.shadowSystem,
            renderSystem: this.renderSystem,
        });

        this.playerUpdateSystem = core.playerUpdateSystem;
        this.uniformUpdateSystem = core.uniformUpdateSystem;
        this.gpuComputeUpdateSystem = core.gpuComputeUpdateSystem;
        this.particleUpdateSystem = core.particleUpdateSystem;
        this.levelUpdateSystem = core.levelUpdateSystem;

        this.updateProgress(90, "i18n:loading.stage.spawn");
        window.addEventListener("resize", this.onResizeBound);
    }

    private async runWarmup(): Promise<void> {
        await runShaderWarmup({
            renderer: this.renderer,
            scene: this.scene,
            camera: this.camera,
            playerController: this.playerController,
            level: this.level,
            physicsSystem: this.physicsSystem,
            enemySystem: this.enemySystem,
            uniformManager: this.uniformManager,
            gpuCompute: this.gpuCompute,
            particleSystem: this.particleSystem,
            postProcessing: this.postProcessing,
            updateProgress: this.updateProgress,
            options: resolveWarmupOptions(),
        });
    }

    private startMainLoop(): void {
        this.updateProgress(98, "i18n:loading.stage.startLoop");
        this.renderer.setAnimationLoop(this.animate);

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
        resizeCameraAndRenderer({
            camera: this.camera,
            renderer: this.renderer,
            width: window.innerWidth,
            height: window.innerHeight,
        });
    }

    /**
     * 主循环
     */
    private readonly animate = () => {
        const frameStartMs = this.hitchProfiler.beginFrame();
        const rawDelta = this.clock.getDelta();
        const delta = Math.min(rawDelta, 0.1);

        this.fpsCounter.update(delta);

        const gameState = this.services.state.getState();

        if (gameState.isGameOver) {
            this.playerController.unlock();
            return;
        }

        // Update core systems (uniforms/compute/particles/weather/level) via SystemManager.
        // Keeps the main loop slimmer and makes it easier to add/remove systems.
        fillFrameContext({
            frame: this.frameContext,
            delta,
            cameraPosition: this.camera.position,
            health: gameState.health,
        });

        if (this.hitchProfiler.isEnabled()) {
            // Keep per-system timings for hitch logs.
            let t0 = performance.now();
            this.systemManager.update(this.frameContext, this.systemTimings, () => performance.now());
            const _tCoreSystemsMs = performance.now() - t0;
            void _tCoreSystemsMs;
        } else {
            this.systemManager.update(this.frameContext);
        }

        // Hitch profiler logging (heavy work only runs on slow frames).
        if (this.hitchProfiler.isEnabled()) {
            this.hitchProfiler.recordFrame({
                frameStartMs,
                rawDeltaSeconds: rawDelta,
                camera: this.camera,
                renderer: this.renderer,
                systemTimings: this.systemTimings,
                enemies: this.enemySystem,
                pickups: this.pickupSystem,
                grenades: this.grenadeSystem,
            });
        }

        // Defer "loaded" callback until a few frames have been presented.
        this.loadedGate.update();

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
    public getParticleSystem(): GPUParticleSystem {
        return this.particleSystem;
    }

    /**
     * 触发伤害效果
     */
    public triggerDamageEffect() {
        this.uniformManager.damageFlash.value = EffectConfig.damageFlash.intensity;
    }

    /**
     * 销毁
     */
    public dispose() {
        this.disposeDefaultEventHandlers?.();
        this.disposeDefaultEventHandlers = null;

        this.playerController.dispose();
        // Best-effort dispose for systems managed by the engine layer.
        this.systemManager.dispose();
        this.explosionManager.dispose();
        this.renderer.dispose();

        window.removeEventListener("resize", this.onResizeBound);
        this.container.removeChild(this.renderer.domElement);
    }
}
