import * as THREE from 'three';
import { WeatherConfig, type WeatherType } from '../core/GameConfig';

export class WeatherSceneApplier {
    private readonly skyTarget = new THREE.Color();
    private readonly fogTarget = new THREE.Color();
    private readonly sunTarget = new THREE.Color();

    public apply(opts: {
        scene: THREE.Scene;
        ambientLight: THREE.AmbientLight | null;
        sunLight: THREE.DirectionalLight | null;
        weather: WeatherType;
        progress: number;
    }): void {
        const config = WeatherConfig[opts.weather];
        const lerpT = opts.progress * 0.1;

        // Sky
        if (opts.scene.background instanceof THREE.Color) {
            this.skyTarget.set(config.skyColor);
            (opts.scene.background as THREE.Color).lerp(this.skyTarget, lerpT);
        }

        // Fog
        if (opts.scene.fog instanceof THREE.Fog) {
            this.fogTarget.set(config.fogColor);
            opts.scene.fog.color.lerp(this.fogTarget, lerpT);
            opts.scene.fog.near = THREE.MathUtils.lerp(opts.scene.fog.near, config.fogNear, lerpT);
            opts.scene.fog.far = THREE.MathUtils.lerp(opts.scene.fog.far, config.fogFar, lerpT);
        }

        // Lights
        if (opts.ambientLight) {
            opts.ambientLight.intensity = THREE.MathUtils.lerp(
                opts.ambientLight.intensity,
                config.ambientIntensity,
                lerpT
            );
        }

        if (opts.sunLight) {
            opts.sunLight.intensity = THREE.MathUtils.lerp(opts.sunLight.intensity, config.sunIntensity, lerpT);
            this.sunTarget.set(config.sunColor);
            opts.sunLight.color.lerp(this.sunTarget, lerpT);
        }
    }
}
