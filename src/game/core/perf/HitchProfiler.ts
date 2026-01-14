import * as THREE from "three";

import { readBooleanFlag, readNumber } from "../runtime/RuntimeToggles";

export type HitchProfilerSettings = {
    enabled: boolean;
    thresholdMs: number;
    logBudget: number;
};

export type HitchExtraCounters = {
    vegetation?: {
        trees?: Record<string, number>;
        grass?: Record<string, number>;
    };
    shadows?: Record<string, number>;
};

export type RendererWithInfo = {
    info?: {
        memory?: {
            geometries?: number;
            textures?: number;
        };
    };
};

export function resolveHitchProfilerSettings(): HitchProfilerSettings {
    // Enable by default outside production.
    // In some runtimes `import.meta.env.DEV` may be missing/falsey; `PROD` is more reliable.
    const isProd = Boolean(import.meta.env?.PROD);
    const isDev = !isProd;

    const hitchEnabledOverride = readBooleanFlag("hitch");
    const hitchThresholdOverride = readNumber("hitchMs");

    const disabled = hitchEnabledOverride === false;
    const forced = hitchEnabledOverride === true;

    const thresholdMs =
        hitchThresholdOverride !== null && hitchThresholdOverride > 0
            ? hitchThresholdOverride
            : 24; // ~1.5 frames at 60fps

    return {
        enabled: (isDev || forced) && !disabled,
        thresholdMs,
        logBudget: 50,
    };
}

export class HitchProfiler {
    private enabled: boolean;
    private thresholdMs: number;
    private logBudget: number;
    private bannerLogged: boolean = false;

    private lastLogAtMs = Number.NEGATIVE_INFINITY;
    private readonly minLogIntervalMs = 200;

    constructor(settings: HitchProfilerSettings) {
        this.enabled = settings.enabled;
        this.thresholdMs = settings.thresholdMs;
        this.logBudget = settings.logBudget;
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    public getThresholdMs(): number {
        return this.thresholdMs;
    }

    public beginFrame(): number {
        if (!this.enabled) return 0;

        if (!this.bannerLogged) {
            this.bannerLogged = true;
            console.log(
                `[HITCH] profiler enabled (threshold ${this.thresholdMs}ms). ` +
                    `Use localStorage overrides: localStorage.setItem('hitch','1') / localStorage.setItem('hitchMs','12').`
            );
        }

        return performance.now();
    }

    public recordFrame(params: {
        frameStartMs: number;
        rawDeltaSeconds: number;
        camera: THREE.PerspectiveCamera;
        scene?: THREE.Scene;
        renderer: RendererWithInfo | null | undefined;
        systemTimings: Record<string, number>;
        extra?: HitchExtraCounters;
        enemies: {
            all: ReadonlyArray<{
                isDead: boolean;
                mesh: THREE.Object3D;
                isRenderCulled?: () => boolean;
            }>;
        };
        pickups: { all: ReadonlyArray<unknown> };
        grenades: { activeCount: number };
    }): void {
        if (!this.enabled || this.logBudget <= 0) return;

        const nowMs = performance.now();
        const frameCpuMs = nowMs - params.frameStartMs;

        const rawDeltaMs = params.rawDeltaSeconds * 1000;

        // Ignore the first frame (three.Clock can report 0) and tab/background pauses.
        if (rawDeltaMs <= 0.1) return;
        if (rawDeltaMs > 1000 && frameCpuMs < this.thresholdMs) return;

        const isCpuHitch = frameCpuMs >= this.thresholdMs;
        const isSchedulingStall = rawDeltaMs >= this.thresholdMs && frameCpuMs < this.thresholdMs;

        // Only log scheduling stalls that are likely to be felt, but not caused by long pauses.
        const isWorthLogging = isCpuHitch || (isSchedulingStall && rawDeltaMs <= 250);
        if (!isWorthLogging) return;

        // Reduce spam on steady borderline frames.
        if (nowMs - this.lastLogAtMs < this.minLogIntervalMs && frameCpuMs < this.thresholdMs * 1.25) return;

        this.logBudget--;
        this.lastLogAtMs = nowMs;

        const t = (name: string) => params.systemTimings[name] ?? 0;

        let visibleEnemies = 0;
        for (const e of params.enemies.all) {
            if (!e.isDead && e.mesh.visible) visibleEnemies++;
        }

        // Frustum stats: if hitch correlates with enemies entering the frustum, it's likely render-side.
        const frustum = new THREE.Frustum();
        const projView = new THREE.Matrix4();
        projView.multiplyMatrices(params.camera.projectionMatrix, params.camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projView);

        let enemiesInFrustum = 0;
        let renderCulledEnemies = 0;
        for (const e of params.enemies.all) {
            if (e.isDead) continue;
            if (typeof e.isRenderCulled === "function" && e.isRenderCulled()) {
                renderCulledEnemies++;
                continue;
            }
            // Cheap point test; good enough to correlate facing-direction spikes.
            if (frustum.containsPoint(e.mesh.position)) enemiesInFrustum++;
        }

        const info = params.renderer?.info;
        const geometries = info?.memory?.geometries ?? 0;
        const textures = info?.memory?.textures ?? 0;
        const sceneChildren = params.scene?.children?.length ?? 0;

        const accountedMs = Object.values(params.systemTimings).reduce((sum, v) => sum + (v ?? 0), 0);
        const unaccountedMs = Math.max(0, frameCpuMs - accountedMs);

        const topSystems = Object.entries(params.systemTimings)
            .filter(([, ms]) => (ms ?? 0) >= 0.2)
            .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
            .slice(0, 6)
            .map(([name, ms]) => `${name}=${ms.toFixed(1)}`)
            .join(' ');

        const kind = isCpuHitch ? 'HITCH' : 'STALL';
        const schedGapMs = Math.max(0, rawDeltaMs - frameCpuMs);

        const vegTrees = params.extra?.vegetation?.trees;
        const vegGrass = params.extra?.vegetation?.grass;
        const vegPart =
            vegTrees || vegGrass
                ? ` | veg trees=${vegTrees ? JSON.stringify(vegTrees) : '{}'} grass=${vegGrass ? JSON.stringify(vegGrass) : '{}'} `
                : '';

        const shadowsExtra = params.extra?.shadows;
        const shadowsPart = shadowsExtra ? ` | shadows ${JSON.stringify(shadowsExtra)} ` : '';


        console.log(
            `[${kind}] cpu ${frameCpuMs.toFixed(1)}ms (rawDelta ${rawDeltaMs.toFixed(1)}ms, schedGap ${schedGapMs.toFixed(1)}ms, unaccounted ${unaccountedMs.toFixed(1)}ms) ` +
                `player ${t("player").toFixed(1)} | level ${t("level").toFixed(1)} | uniforms ${t("uniforms").toFixed(1)} | compute ${t("gpuCompute").toFixed(1)} | ` +
                `particles ${t("particles").toFixed(1)} | weather ${t("weather").toFixed(1)} | pickups ${t("pickups").toFixed(1)} | ` +
                `enemies ${t("enemies").toFixed(1)} | trails ${t("trails").toFixed(1)} | grenades ${t("grenades").toFixed(1)} | ` +
                `spawns ${t("spawns").toFixed(1)} | audio ${t("audio").toFixed(1)} | shadows ${t("shadows").toFixed(1)} | render ${t("render").toFixed(1)} ` +
                `| top ${topSystems} ` +
                `| enemies=${params.enemies.all.length} visibleEnemies=${visibleEnemies} frustumEnemies=${enemiesInFrustum} culledEnemies=${renderCulledEnemies} ` +
                `geom=${geometries} tex=${textures} sceneChildren=${sceneChildren} ` +
                `pickups=${params.pickups.all.length} grenades=${params.grenades.activeCount}` +
                vegPart +
                shadowsPart
        );
    }
}
