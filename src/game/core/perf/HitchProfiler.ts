import * as THREE from "three";

import { readBooleanFlag, readNumber } from "../runtime/RuntimeToggles";

export type HitchProfilerSettings = {
    enabled: boolean;
    thresholdMs: number;
    logBudget: number;
};

export function resolveHitchProfilerSettings(): HitchProfilerSettings {
    // Enable by default outside production.
    // In some runtimes `import.meta.env.DEV` may be missing/falsey; `PROD` is more reliable.
    const env = (import.meta as any)?.env;
    const isProd = Boolean(env?.PROD);
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
                    `Force enable: add ?hitch=1, adjust: ?hitchMs=12, or run localStorage.setItem('hitch','1').`
            );
        }

        return performance.now();
    }

    public recordFrame(params: {
        frameStartMs: number;
        rawDeltaSeconds: number;
        camera: THREE.PerspectiveCamera;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        renderer: any;
        systemTimings: Record<string, number>;
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

        const frameTotalMs = performance.now() - params.frameStartMs;
        if (frameTotalMs < this.thresholdMs) return;

        this.logBudget--;

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

        // Renderer stats (WebGPU/three): calls/triangles rise sharply when many enemies are visible.
        const info = params.renderer?.info;
        const calls = info?.render?.calls ?? 0;
        const tris = info?.render?.triangles ?? 0;
        const lines = info?.render?.lines ?? 0;
        const points = info?.render?.points ?? 0;

        const rawDeltaMs = params.rawDeltaSeconds * 1000;

        console.log(
            `[HITCH] ${frameTotalMs.toFixed(1)}ms (rawDelta ${rawDeltaMs.toFixed(1)}ms) ` +
                `player ${t("player").toFixed(1)} | uniforms ${t("uniforms").toFixed(1)} | compute ${t("gpuCompute").toFixed(1)} | ` +
                `particles ${t("particles").toFixed(1)} | weather ${t("weather").toFixed(1)} | pickups ${t("pickups").toFixed(1)} | ` +
                `enemies ${t("enemies").toFixed(1)} | trails ${t("trails").toFixed(1)} | grenades ${t("grenades").toFixed(1)} | ` +
                `spawns ${t("spawns").toFixed(1)} | audio ${t("audio").toFixed(1)} | shadows ${t("shadows").toFixed(1)} | render ${t("render").toFixed(1)} ` +
                `| enemies=${params.enemies.all.length} visibleEnemies=${visibleEnemies} frustumEnemies=${enemiesInFrustum} culledEnemies=${renderCulledEnemies} ` +
                `calls=${calls} tris=${tris} lines=${lines} points=${points} ` +
                `pickups=${params.pickups.all.length} grenades=${params.grenades.activeCount}`
        );
    }
}
