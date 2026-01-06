import { InitialState } from './GameConfig';

export type WeaponType = 'gun' | 'grenade';
export type StanceType = 'stand' | 'crouch' | 'prone';

export interface GameState {
    health: number;
    ammo: number;
    grenades: number;
    currentWeapon: WeaponType;
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

    private constructor() {
        this.state = {
            health: InitialState.health,
            ammo: InitialState.ammo,
            grenades: InitialState.grenades,
            currentWeapon: 'gun',
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
            currentWeapon: 'gun',
            stance: 'stand',
            score: InitialState.score,
            isGameOver: false,
            pickupHint: null
        };
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
