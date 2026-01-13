import type { RuntimeSettingsSource } from '../core/settings/RuntimeSettings';
import type { WeaponId } from '../weapon/WeaponTypes';

export type PlayerInputBindings = {
    domElement: HTMLElement;
    settings: RuntimeSettingsSource;

    // Reads current aim progress (0..1) so we can scale sensitivity.
    getAimProgress: () => number;

    // Called on first user gesture to resume audio.
    resumeAudio: () => void;

    // Weapon / action hooks
    onTriggerDown: (isAiming: boolean) => void;
    onTriggerUp: () => void;
    onStartAiming: () => void;
    onStopAiming: () => void;

    onSwitchNextWeapon: () => void;
    onSwitchPrevWeapon: () => void;
    onSwitchToWeapon: (id: WeaponId) => void;

    onQuickThrowGrenade: () => void;

    onPickup: () => void;
    onWeatherCycle: () => void;

    onJumpPressed: () => void;
    onToggleCrouch: () => void;
    onToggleProne: () => void;

    // Pointer lock hooks
    onLockChanged?: (locked: boolean) => void;

    // Look input (already multiplied by sensitivity)
    onLookDelta: (yawDelta: number, pitchDelta: number) => void;
};

export class PlayerInputController {
    private readonly bindings: PlayerInputBindings;

    private locked = false;
    private aiming = false;

    // Movement state
    private moveForward = false;
    private moveBackward = false;
    private moveLeft = false;
    private moveRight = false;
    private running = false;

    // Weapon switch throttle
    private lastWeaponSwitchTime = 0;

    constructor(bindings: PlayerInputBindings) {
        this.bindings = bindings;
        this.attach();
    }

    private isUiModalOpen(): boolean {
        return document.body?.dataset?.uiModalOpen === '1';
    }

    dispose(): void {
        // NOTE: Listeners are attached with stable bound functions.
        // For now, rely on best-effort cleanup via removeEventListener.
        const el = this.bindings.domElement;
        const doc = el.ownerDocument ?? document;
        el.removeEventListener('click', this.onClick);
        el.removeEventListener('mousedown', this.onMouseDown);
        el.removeEventListener('mouseup', this.onMouseUp);
        el.removeEventListener('wheel', this.onWheel);
        el.removeEventListener('contextmenu', this.onContextMenu);

        doc.removeEventListener('pointerlockchange', this.onPointerLockChange);
        doc.removeEventListener('mousemove', this.onMouseMove);
        doc.removeEventListener('keydown', this.onKeyDown);
        doc.removeEventListener('keyup', this.onKeyUp);
    }

    isLocked(): boolean {
        return this.locked;
    }

    isRunning(): boolean {
        return this.running;
    }

    isAiming(): boolean {
        return this.aiming;
    }

    getMoveForward(): boolean {
        return this.moveForward;
    }

    getMoveBackward(): boolean {
        return this.moveBackward;
    }

    getMoveLeft(): boolean {
        return this.moveLeft;
    }

    getMoveRight(): boolean {
        return this.moveRight;
    }

    requestLock(): void {
        try {
            this.bindings.resumeAudio();
        } catch {
            // ignore
        }
        if (this.locked) return;

        const el = this.bindings.domElement;
        const doc = el.ownerDocument ?? document;
        const target: HTMLElement = el.isConnected ? el : (doc.body ?? el);

        try {
            target.requestPointerLock();
        } catch {
            // ignore
        }
    }

    unlock(): void {
        try {
            const el = this.bindings.domElement;
            const doc = el.ownerDocument ?? document;
            doc.exitPointerLock();
        } catch {
            // ignore
        }
    }

    private attach(): void {
        const el = this.bindings.domElement;
        const doc = el.ownerDocument ?? document;
        el.addEventListener('click', this.onClick);
        el.addEventListener('mousedown', this.onMouseDown);
        el.addEventListener('mouseup', this.onMouseUp);
        el.addEventListener('wheel', this.onWheel, { passive: true });
        el.addEventListener('contextmenu', this.onContextMenu);

        doc.addEventListener('pointerlockchange', this.onPointerLockChange);
        doc.addEventListener('mousemove', this.onMouseMove);

        doc.addEventListener('keydown', this.onKeyDown);
        doc.addEventListener('keyup', this.onKeyUp);
    }

    private readonly onClick = (_event: MouseEvent) => {
        if (this.isUiModalOpen()) return;
        this.requestLock();
    };

    private readonly onMouseDown = (event: MouseEvent) => {
        if (this.isUiModalOpen()) return;
        if (event.button === 0) {
            // In some embedded runtimes (Tauri WebView), pointer lock can fail with WrongDocumentError.
            // Firing should still work even without lock, so don't hard-gate left click.
            if (!this.locked) this.requestLock();
            this.bindings.onTriggerDown(this.aiming);
        } else if (event.button === 2) {
            if (!this.locked) this.requestLock();
            this.aiming = true;
            this.bindings.onStartAiming();
        }
    };

    private readonly onMouseUp = (event: MouseEvent) => {
        if (this.isUiModalOpen()) return;
        if (event.button === 0) {
            this.bindings.onTriggerUp();
        } else if (event.button === 2) {
            this.aiming = false;
            this.bindings.onStopAiming();
        }
    };

    private readonly onWheel = (event: WheelEvent) => {
        if (!this.locked) return;

        const now = performance.now();
        const cooldown = this.bindings.settings.getRuntimeSettings().weaponSwitchCooldownMs;
        if (now - this.lastWeaponSwitchTime < cooldown) return;

        if (event.deltaY > 0) {
            this.bindings.onSwitchNextWeapon();
            this.lastWeaponSwitchTime = now;
        } else if (event.deltaY < 0) {
            this.bindings.onSwitchPrevWeapon();
            this.lastWeaponSwitchTime = now;
        }
    };

    private readonly onContextMenu = (event: MouseEvent) => {
        event.preventDefault();
    };

    private readonly onPointerLockChange = () => {
        const el = this.bindings.domElement;
        const doc = el.ownerDocument ?? document;
        const ple = doc.pointerLockElement;

        // Some runtimes reject pointer lock on a canvas; we may fall back to doc.body.
        this.locked = ple === el || ple === doc.body;

        if (!this.locked) {
            this.aiming = false;
            this.bindings.onTriggerUp();
            this.bindings.onStopAiming();
        }

        this.bindings.onLockChanged?.(this.locked);
    };

    private readonly onMouseMove = (event: MouseEvent) => {
        if (!this.locked) return;

        const movementX = event.movementX || 0;
        const movementY = event.movementY || 0;

        const aimProgress = this.bindings.getAimProgress();
        const s = this.bindings.settings.getRuntimeSettings();
        const sensitivity = s.cameraSensitivity * (1 - aimProgress * (1 - s.aimSensitivityMultiplier));

        // Keep sign consistent with the previous PlayerController implementation.
        const yawDelta = -movementX * sensitivity;
        const pitchDelta = -movementY * sensitivity;

        this.bindings.onLookDelta(yawDelta, pitchDelta);
    };

    private readonly onKeyDown = (event: KeyboardEvent) => {
        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW':
                this.moveForward = true;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                this.moveLeft = true;
                break;
            case 'ArrowDown':
            case 'KeyS':
                this.moveBackward = true;
                break;
            case 'ArrowRight':
            case 'KeyD':
                this.moveRight = true;
                break;
            case 'Space':
                this.bindings.onJumpPressed();
                break;
            case 'KeyC':
                this.bindings.onToggleCrouch();
                break;
            case 'KeyZ':
                this.bindings.onToggleProne();
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                this.running = true;
                break;
            case 'KeyF':
                this.bindings.onPickup();
                break;
            case 'Digit1':
                this.bindings.onSwitchToWeapon('rifle');
                break;
            case 'Digit2':
                this.bindings.onSwitchToWeapon('grenade');
                break;
            case 'KeyG':
                this.bindings.onQuickThrowGrenade();
                break;
            case 'KeyT':
                this.bindings.onWeatherCycle();
                break;
        }
    };

    private readonly onKeyUp = (event: KeyboardEvent) => {
        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW':
                this.moveForward = false;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                this.moveLeft = false;
                break;
            case 'ArrowDown':
            case 'KeyS':
                this.moveBackward = false;
                break;
            case 'ArrowRight':
            case 'KeyD':
                this.moveRight = false;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                this.running = false;
                break;
        }
    };
}
