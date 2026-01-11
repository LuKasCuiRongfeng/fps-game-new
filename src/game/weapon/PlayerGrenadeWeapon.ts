import * as THREE from 'three';
import { GrenadeHand } from '../entities/GrenadeTSL';
import type { GameServices } from '../core/services/GameServices';
import type { GameEventBus } from '../core/events/GameEventBus';
import { IPlayerWeapon, WeaponContext } from './WeaponTypes';

export class PlayerGrenadeWeapon implements IPlayerWeapon {
    public readonly id = 'grenade' as const;
    public readonly category = 'throwable' as const;

    private camera: THREE.Camera;
    private grenadeHand: GrenadeHand;
    private services: GameServices;
    private events: GameEventBus;

    private onGrenadeThrow: ((position: THREE.Vector3, direction: THREE.Vector3) => void) | null = null;

    private tmpThrowPosition = new THREE.Vector3();
    private tmpThrowDirection = new THREE.Vector3();

    constructor(camera: THREE.Camera, grenadeHand: GrenadeHand, services: GameServices, events: GameEventBus) {
        this.camera = camera;
        this.grenadeHand = grenadeHand;
        this.services = services;
        this.events = events;
    }

    public setGrenadeThrowCallback(callback: (position: THREE.Vector3, direction: THREE.Vector3) => void) {
        this.onGrenadeThrow = callback;
    }

    public show(): void {
        this.grenadeHand.show();
    }

    public hide(): void {
        this.grenadeHand.hide();
    }

    public update(delta: number): void {
        // grenadeHand update 由 PlayerWeaponSystem 统一调用
        void delta;
    }

    public onTriggerDown(ctx: WeaponContext): void {
        void ctx;
        const state = this.services.state.getState();
        if (state.grenades <= 0) return;
        if (this.grenadeHand.isPlaying()) return;

        this.grenadeHand.startThrow(() => {
            if (!this.onGrenadeThrow) return;

            const throwPosition = this.tmpThrowPosition.copy(this.camera.position);
            throwPosition.y -= 0.2;

            const throwDirection = this.tmpThrowDirection;
            this.camera.getWorldDirection(throwDirection);

            this.onGrenadeThrow(throwPosition, throwDirection);
            this.events.emit({ type: 'state:updateGrenades', delta: -1 });
        });
    }

    public onTriggerUp(): void {
        // no-op
    }

    public startAiming(): void {
        // no-op
    }

    public stopAiming(): void {
        // no-op
    }

    public getAimProgress(): number {
        return 0;
    }

    public dispose(): void {
        // grenadeHand 生命周期由 PlayerWeaponSystem 管理
    }
}
