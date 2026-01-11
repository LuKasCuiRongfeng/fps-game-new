import * as THREE from 'three';
import { WeatherConfig, type WeatherType } from '../core/GameConfig';
import { setWindFromWeather } from '../shaders/WindUniforms';

export class WindController {
    public readonly direction = new THREE.Vector3(1, 0, 0);
    public strength: number = 0;

    private readonly targetDirection = new THREE.Vector3(1, 0, 0);

    public apply(opts: { weather: WeatherType; progress: number }): void {
        const config = WeatherConfig[opts.weather];
        const lerpT = opts.progress * 0.1;

        this.strength = THREE.MathUtils.lerp(this.strength, config.windStrength, lerpT);

        // Only steer direction for weathers that explicitly define it.
        // Otherwise keep the previous direction and just fade strength.
        if (opts.weather === 'windy') {
            const windConfig = WeatherConfig.windy.wind;
            this.targetDirection
                .set(windConfig.direction.x, windConfig.direction.y, windConfig.direction.z)
                .normalize();
            this.direction.lerp(this.targetDirection, lerpT);
        } else if (opts.weather === 'sandstorm') {
            this.targetDirection.set(1, 0.05, 0.2).normalize();
            this.direction.lerp(this.targetDirection, lerpT);
        }

        if (this.direction.lengthSq() > 0.0001) {
            this.direction.normalize();
        } else {
            this.direction.set(1, 0, 0);
        }

        setWindFromWeather({
            windStrength: this.strength,
            windDirection: this.direction,
        });
    }
}
