export interface GameState {
    health: number;
    ammo: number;
    score: number;
    isGameOver: boolean;
}

export type GameStateListener = (state: GameState) => void;

export class GameStateService {
    private static instance: GameStateService;
    private state: GameState;
    private listeners: GameStateListener[] = [];

    private constructor() {
        this.state = {
            health: 100,
            ammo: 30000,
            score: 0,
            isGameOver: false
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
        this.state.health = Math.max(0, Math.min(100, this.state.health + amount));
        if (this.state.health <= 0) {
            this.state.isGameOver = true;
        }
        this.notifyListeners();
    }

    public updateAmmo(amount: number) {
        this.state.ammo = Math.max(0, this.state.ammo + amount);
        this.notifyListeners();
    }

    public updateScore(amount: number) {
        this.state.score += amount;
        this.notifyListeners();
    }

    public reset() {
        this.state = {
            health: 100,
            ammo: 30000,
            score: 0,
            isGameOver: false
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
