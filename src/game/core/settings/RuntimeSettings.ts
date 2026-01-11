export type RuntimeSettings = {
    cameraSensitivity: number;
    cameraSmoothFactor: number;
    defaultFov: number;
    aimFov: number;
    aimSensitivityMultiplier: number;
    fovLerpSpeed: number;

    walkSpeed: number;
    runSpeed: number;
    jumpHeight: number;
    gravity: number;
    friction: number;

    weaponSwitchCooldownMs: number;
};

export type RuntimeSettingsSource = {
    getRuntimeSettings(): RuntimeSettings;
};
