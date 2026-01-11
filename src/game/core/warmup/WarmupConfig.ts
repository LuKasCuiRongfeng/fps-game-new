import {
    readEnumFromQuery,
    readEnumFromStorage,
    readStringFromQuery,
    readStringFromStorage,
    readBooleanFlagFromQuery,
    readBooleanFlagFromStorage,
} from "../runtime/RuntimeToggles";

export type WarmupProfileName = "default" | "fast" | "off";

export type WarmupOptions = {
    enabled: boolean;

    // Coverage for compile/render sampling.
    yawSteps: number;
    pitches: number[];

    // Temporary camera projection expansion.
    minFov: number;
    minFar: number;

    // Which phases to run.
    doCompileViews: boolean;
    doNoCullRender: boolean;
    doRenderViews: boolean;

    // Fixed-step delta/health for warmup updates.
    warmupDelta: number;
    warmupHealth: number;
};

export const WarmupProfiles: Record<WarmupProfileName, WarmupOptions> = {
    default: {
        enabled: true,
        yawSteps: 16,
        pitches: [0, -0.45, 0.45],
        minFov: 120,
        minFar: 2000,
        doCompileViews: true,
        doNoCullRender: true,
        doRenderViews: true,
        warmupDelta: 0.016,
        warmupHealth: 100,
    },
    fast: {
        enabled: true,
        yawSteps: 8,
        pitches: [0],
        minFov: 105,
        minFar: 1500,
        doCompileViews: true,
        doNoCullRender: true,
        doRenderViews: false,
        warmupDelta: 0.016,
        warmupHealth: 100,
    },
    off: {
        enabled: false,
        yawSteps: 0,
        pitches: [],
        minFov: 0,
        minFar: 0,
        doCompileViews: false,
        doNoCullRender: false,
        doRenderViews: false,
        warmupDelta: 0.016,
        warmupHealth: 100,
    },
};

export function resolveWarmupOptions(): WarmupOptions {
    // Default profile.
    let profile: WarmupProfileName = "default";

    const allowedProfiles = ["default", "fast", "off"] as const;

    // Precedence (to preserve existing behavior):
    // 1) query `warmup=0|1` overrides everything
    // 2) query `warmupProfile`
    // 3) storage `warmup=0|1`
    // 4) storage `warmupProfile`

    const warmupQueryRaw = readStringFromQuery("warmup");
    if (warmupQueryRaw !== null) {
        const warmupQuery = readBooleanFlagFromQuery("warmup");
        if (warmupQuery === false) return WarmupProfiles.off;
        if (warmupQuery === true) return WarmupProfiles.default;
        // If present but invalid, ignore and fall through to profile.
    }

    const queryProfile = readEnumFromQuery("warmupProfile", allowedProfiles);
    if (queryProfile) profile = queryProfile;

    const warmupStoredRaw = readStringFromStorage("warmup");
    if (warmupStoredRaw !== null) {
        const warmupStored = readBooleanFlagFromStorage("warmup");
        if (warmupStored === false) return WarmupProfiles.off;
        if (warmupStored === true) return WarmupProfiles.default;
        // If present but invalid, ignore and fall through to stored profile.
    }

    const storedProfile = readEnumFromStorage("warmupProfile", allowedProfiles);
    if (storedProfile) profile = storedProfile;

    return WarmupProfiles[profile];
}
