import { PlayerConfig, WeaponConfig } from '../GameConfig';
import type { RuntimeSettings } from './RuntimeSettings';

export function createDefaultRuntimeSettings(): RuntimeSettings {
    return {
        cameraSensitivity: PlayerConfig.camera.sensitivity,
        cameraSmoothFactor: PlayerConfig.camera.smoothFactor,
        defaultFov: PlayerConfig.camera.defaultFov,
        aimFov: PlayerConfig.camera.aimFov,
        aimSensitivityMultiplier: PlayerConfig.camera.aimSensitivityMultiplier,
        fovLerpSpeed: PlayerConfig.camera.fovLerpSpeed,

        walkSpeed: PlayerConfig.movement.walkSpeed,
        runSpeed: PlayerConfig.movement.runSpeed,
        jumpHeight: PlayerConfig.movement.jumpHeight,
        gravity: PlayerConfig.movement.gravity,
        friction: PlayerConfig.movement.friction,

        weaponSwitchCooldownMs: WeaponConfig.switching.cooldown,
    };
}

export type RuntimeSettingsListener = (settings: RuntimeSettings) => void;

/**
 * Small observable store for runtime-tunable settings.
 * UI owns persistence; game code reads settings through this store.
 */
export class RuntimeSettingsStore {
    private settings: RuntimeSettings;
    private listeners: RuntimeSettingsListener[] = [];

    constructor(initial: RuntimeSettings) {
        this.settings = initial;
    }

    static loadFromLocalStorage(key: string = 'runtimeSettings'): RuntimeSettingsStore {
        const defaults = createDefaultRuntimeSettings();
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return new RuntimeSettingsStore(defaults);
            const parsed = JSON.parse(raw) as Partial<RuntimeSettings>;
            return new RuntimeSettingsStore({ ...defaults, ...parsed });
        } catch {
            return new RuntimeSettingsStore(defaults);
        }
    }

    get(): RuntimeSettings {
        return this.settings;
    }

    set(next: RuntimeSettings): void {
        this.settings = next;
        for (const l of this.listeners) l(next);
    }

    subscribe(listener: RuntimeSettingsListener): () => void {
        this.listeners.push(listener);
        listener(this.settings);
        return () => {
            this.listeners = this.listeners.filter((x) => x !== listener);
        };
    }

    saveToLocalStorage(key: string = 'runtimeSettings'): void {
        try {
            localStorage.setItem(key, JSON.stringify(this.settings));
        } catch {
            // ignore
        }
    }
}
