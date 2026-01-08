import { InitialState } from './GameConfig';
import type { WeaponId } from '../weapon/WeaponTypes';

export type WeaponType = WeaponId;
export type StanceType = 'stand' | 'crouch' | 'prone';

export interface GameState {
    health: number;
    ammo: number;
    grenades: number;
    currentWeapon: WeaponType;
    chargeProgress: number; // 0..1 (knife/scythe charge)
    stance: StanceType;  // 当前姿态
    score: number;
    isGameOver: boolean;
    pickupHint: string | null;  // 显示拾取提示
}

export type GameStateListener = (state: GameState) => void;

export class GameStateService {
    private static instance: GameStateService;
    private state: GameState;
    private listeners: GameStateListener[] = [];

    private lastChargeProgressNotified = 0;

    private constructor() {
        this.state = {
            health: InitialState.health,
            ammo: InitialState.ammo,
            grenades: InitialState.grenades,
            currentWeapon: 'rifle',
            chargeProgress: 0,
            stance: 'stand',
            score: InitialState.score,
            isGameOver: false,
            pickupHint: null
        };
    }

    public static getInstance(): GameStateService {
        if (!GameStateService.instance) {
            GameStateService.instance = new GameStateService();
        }
        return GameStateService.instance;
    }

    public getState(): GameState {
        return { ...this.state };
    }

    public updateHealth(amount: number) {
        this.state.health = Math.max(0, Math.min(InitialState.health, this.state.health + amount));
        if (this.state.health <= 0) {
            this.state.isGameOver = true;
        }
        this.notifyListeners();
    }

    public updateAmmo(amount: number) {
        this.state.ammo = Math.max(0, this.state.ammo + amount);
        this.notifyListeners();
    }
    
    public updateGrenades(amount: number) {
        this.state.grenades = Math.max(0, this.state.grenades + amount);
        this.notifyListeners();
    }
    
    public setCurrentWeapon(weapon: WeaponType) {
        this.state.currentWeapon = weapon;
        // Switch weapon should clear charge UI immediately
        this.state.chargeProgress = 0;
        this.lastChargeProgressNotified = 0;
        this.notifyListeners();
    }

    public setChargeProgress(progress: number) {
        const p = Math.max(0, Math.min(1, progress));
        // Throttle updates to reduce React churn (only notify if meaningfully changed).
        if (this.lastChargeProgressNotified === 0 && p > 0) {
            // Always notify when charge becomes visible.
            this.state.chargeProgress = p;
            this.lastChargeProgressNotified = p;
            this.notifyListeners();
            return;
        }
        if (Math.abs(p - this.lastChargeProgressNotified) < 0.02 && p !== 0 && p !== 1) {
            this.state.chargeProgress = p;
            return;
        }
        this.state.chargeProgress = p;
        this.lastChargeProgressNotified = p;
        this.notifyListeners();
    }
    
    public setStance(stance: StanceType) {
        this.state.stance = stance;
        this.notifyListeners();
    }

    public updateScore(amount: number) {
        this.state.score += amount;
        this.notifyListeners();
    }

    public setPickupHint(hint: string | null) {
        this.state.pickupHint = hint;
        this.notifyListeners();
    }

    public reset() {
        this.state = {
            health: InitialState.health,
            ammo: InitialState.ammo,
            grenades: InitialState.grenades,
            currentWeapon: 'rifle',
            chargeProgress: 0,
            stance: 'stand',
            score: InitialState.score,
            isGameOver: false,
            pickupHint: null
        };
        this.lastChargeProgressNotified = 0;
        this.notifyListeners();
    }

    public subscribe(listener: GameStateListener) {
        this.listeners.push(listener);
        listener(this.state); // Initial state
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notifyListeners() {
        this.listeners.forEach(listener => listener({ ...this.state }));
    }
}
