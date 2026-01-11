import type { WeatherType } from '../core/GameConfig';

export interface WeatherAutoChangeConfig {
    enabled: boolean;
    minDuration: number;
    maxDuration: number;
}

export interface WeatherStateSnapshot {
    currentWeather: WeatherType;
    targetWeather: WeatherType;
    transitionProgress: number;
}

export interface WeatherUpdateResult {
    snapshot: WeatherStateSnapshot;
    autoNextWeather: WeatherType | null;
}

export class WeatherStateMachine {
    private readonly transitionDuration: number;
    private readonly autoChange: WeatherAutoChangeConfig;
    private readonly weathers: readonly WeatherType[];

    private currentWeather: WeatherType;
    private targetWeather: WeatherType;
    private transitionProgress: number;

    private weatherTimer: number = 0;
    private nextWeatherChange: number = 0;

    constructor(opts: {
        initialWeather: WeatherType;
        transitionDuration: number;
        autoChange: WeatherAutoChangeConfig;
        weathers: readonly WeatherType[];
    }) {
        this.currentWeather = opts.initialWeather;
        this.targetWeather = opts.initialWeather;
        this.transitionProgress = 1.0;

        this.transitionDuration = Math.max(0.001, opts.transitionDuration);
        this.autoChange = opts.autoChange;
        this.weathers = opts.weathers;

        this.scheduleNextWeatherChange();
    }

    public getSnapshot(): WeatherStateSnapshot {
        return {
            currentWeather: this.currentWeather,
            targetWeather: this.targetWeather,
            transitionProgress: this.transitionProgress,
        };
    }

    public setWeather(weather: WeatherType, immediate: boolean = false): boolean {
        if (weather === this.targetWeather) return false;

        this.targetWeather = weather;

        if (immediate) {
            this.currentWeather = weather;
            this.transitionProgress = 1.0;
        } else {
            this.transitionProgress = 0.0;
        }

        this.scheduleNextWeatherChange();
        return true;
    }

    public update(delta: number): WeatherUpdateResult {
        // Transition
        if (this.transitionProgress < 1.0) {
            this.transitionProgress += delta / this.transitionDuration;
            if (this.transitionProgress >= 1.0) {
                this.transitionProgress = 1.0;
                this.currentWeather = this.targetWeather;
            }
        }

        // Auto switch
        let autoNextWeather: WeatherType | null = null;
        if (this.autoChange.enabled) {
            this.weatherTimer += delta;
            if (this.weatherTimer >= this.nextWeatherChange) {
                autoNextWeather = this.getRandomWeather();
            }
        }

        return {
            snapshot: this.getSnapshot(),
            autoNextWeather,
        };
    }

    private scheduleNextWeatherChange() {
        if (!this.autoChange.enabled) return;

        const min = this.autoChange.minDuration;
        const max = this.autoChange.maxDuration;
        this.nextWeatherChange = min + Math.random() * (max - min);
        this.weatherTimer = 0;
    }

    private getRandomWeather(): WeatherType {
        // Avoid choosing the current *or* the current target to support rapid transitions.
        const avoid1 = this.currentWeather;
        const avoid2 = this.targetWeather;

        const available = this.weathers.filter((w) => w !== avoid1 && w !== avoid2);
        const pickFrom = available.length > 0 ? available : this.weathers.filter((w) => w !== avoid2);
        return pickFrom[Math.floor(Math.random() * pickFrom.length)];
    }
}
