import * as THREE from 'three';
import { uniform } from 'three/tsl';

// Shared wind uniforms used by multiple TSL materials.
// WeatherSystem drives these so vegetation wind matches current weather.
export const WindUniforms = {
    speed: uniform(1.5),
    strength: uniform(0.0),
    direction: uniform(new THREE.Vector3(1, 0, 0)),
};

export function setWindFromWeather(opts: {
    windStrength: number; // WeatherConfig windStrength (roughly 0..2.5)
    windDirection: THREE.Vector3;
}): void {
    const dir = opts.windDirection;
    if (dir.lengthSq() > 0.0001) {
        WindUniforms.direction.value.copy(dir).normalize();
    } else {
        WindUniforms.direction.value.set(1, 0, 0);
    }

    // Map weather strength to shader-friendly sway amplitude.
    // Previously most vegetation used ~0.15 as a good baseline.
    WindUniforms.strength.value = 0.1 * opts.windStrength;

    // Faster gusty motion for stronger wind.
    WindUniforms.speed.value = 1.2 + opts.windStrength * 0.6;
}
