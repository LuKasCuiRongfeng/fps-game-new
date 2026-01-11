import * as THREE from 'three';
import type { System, FrameContext } from '../core/engine/System';
import { SoundManager } from '../core/SoundManager';
import type { WeatherSystem } from '../level/WeatherSystem';
import type { Level } from '../level/Level';
import type { Enemy } from '../enemy/Enemy';
import type { WeatherType } from '../core/GameConfig';

export class AudioSystem implements System {
    public readonly name = 'audio';

    private readonly sound: SoundManager;
    private readonly weather: WeatherSystem;
    private readonly level: Level;
    private readonly enemies: Enemy[];

    private readonly tmpPlayerPos = new THREE.Vector3();

    private lastWeather: WeatherType | null = null;

    constructor(opts: {
        sound: SoundManager;
        weather: WeatherSystem;
        level: Level;
        enemies: Enemy[];
    }) {
        this.sound = opts.sound;
        this.weather = opts.weather;
        this.level = opts.level;
        this.enemies = opts.enemies;
    }

    update(frame: FrameContext): void {
        this.tmpPlayerPos.set(frame.playerPos.x, frame.playerPos.y, frame.playerPos.z);

        // Combat check: any living enemy within 20m.
        let isCombat = false;
        for (const enemy of this.enemies) {
            if (enemy.isDead) continue;
            const distSq = enemy.mesh.position.distanceToSquared(this.tmpPlayerPos);
            if (distSq < 20 * 20) {
                isCombat = true;
                break;
            }
        }

        const currentWeather = this.weather.getCurrentWeather();

        if (this.lastWeather !== currentWeather) {
            this.sound.playWeatherSound(currentWeather);
            this.lastWeather = currentWeather;
        }

        if (isCombat) {
            this.sound.setBGMState('combat');
        } else if (currentWeather === 'rainy') {
            this.sound.setBGMState('rainy');
        } else {
            this.sound.setBGMState('sunny');
        }

        // Sync rain intensity to level.
        const isRainy = currentWeather === 'rainy';
        const targetRain = isRainy ? 1.0 : 0.0;
        this.level.rainIntensity.value = THREE.MathUtils.lerp(
            this.level.rainIntensity.value,
            targetRain,
            frame.delta * 0.5
        );
    }
}
